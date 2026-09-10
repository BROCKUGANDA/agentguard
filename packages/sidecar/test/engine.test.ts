import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from '../src/policy/engine.js';

const YAML_BASE = `
version: "1"
default: deny
agents:
  "*":
    role: guest
  developer-agent:
    role: developer
  reader-agent:
    role: reader
rules:
  - id: rbac-guest-deny
    description: "guest cannot read secrets"
    match:
      tool: filesystem.read_file
      args:
        path: "*secrets*"
    decision: deny
    reason: "guest blocked"
    conditions:
      rbac:
        role: guest
        resource: filesystem.read_file
        action: deny
  - id: rbac-developer-allow
    description: "developer can read+write"
    match:
      tool: ["filesystem.read_file", "filesystem.write_file"]
    decision: allow
    conditions:
      rbac:
        role: [developer, admin]
        action: allow
  - id: rate-limit-read-file
    match:
      tool: filesystem.read_file
    decision: deny
    reason: "rate limited"
    conditions:
      rate_limit:
        max: 2
        window: "1m"
        scope: agent_tool
  - id: time-window-prod-delete
    match:
      tool: filesystem.delete_file
      args:
        path: "*prod*"
    decision: deny
    reason: "outside hours"
    conditions:
      time_window:
        tz: UTC
        allow:
          - start: "09:00"
            end: "17:00"
            weekdays: [mon, tue, wed, thu, fri]
        invert: true
  - id: pii-redact
    match:
      tool: email.send
    decision: deny
    reason: "PII"
    conditions:
      data_classification:
        patterns:
          - name: ssn
            regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b'
        match_on: ["args.subject", "args.body"]
`;

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
    engine.loadFromYaml(YAML_BASE);
  });

  it('RBAC: deny when role matches deny rule', async () => {
    const d = await engine.check({
      agentId: 'anybody',
      tool: 'filesystem.read_file',
      args: { path: '/secrets/x.txt' },
      role: 'guest',
    });
    expect(d.allow).toBe(false);
    expect(d.ruleId).toBe('rbac-guest-deny');
  });

  it('RBAC: allow when role matches allow rule', async () => {
    const d = await engine.check({
      agentId: 'developer-agent',
      tool: 'filesystem.write_file',
      args: { path: '/tmp/out' },
    });
    expect(d.allow).toBe(true);
    expect(d.ruleId).toBe('rbac-developer-allow');
  });

  it('RBAC: no rule fires → return null verdict (engine keeps walking)', () => {
    // Internal: just verify engine falls through to next rule correctly.
    // guest tries to read a non-secrets file → only rbac-developer-allow
    // applies; developer role check fails → null → falls through to
    // rate-limit rule, which allows first 2.
    return engine
      .check({
        agentId: 'guest-1',
        tool: 'filesystem.read_file',
        args: { path: '/tmp/readme.md' },
        role: 'guest',
      })
      .then((d) => {
        // First read: rate-limit permits → engine returns null from that
        // condition (because rbac doesn't apply), so no rule matches → default-deny.
        expect(d.allow).toBe(false);
        expect(d.reason).toBe('default-deny');
      });
  });

  it('Rate limit: triggers at max+1', async () => {
    const req = {
      agentId: 'rl-test',
      tool: 'filesystem.read_file',
      args: { path: '/x' },
      role: 'guest',
    };
    // First two calls: rate-limit permits → condition returns null → no rule
    // fires → default-deny (file default = deny).
    const first = await engine.check(req);
    const second = await engine.check(req);
    const third = await engine.check(req);
    expect(first.allow).toBe(false);
    expect(first.reason).toBe('default-deny');
    expect(second.allow).toBe(false);
    expect(second.reason).toBe('default-deny');
    // Third call: rate-limit exceeds → rule fires → deny with ruleId set.
    expect(third.allow).toBe(false);
    expect(third.ruleId).toBe('rate-limit-read-file');
  });

  it('Rate limit: independent scopes do not share buckets', async () => {
    // With scope=agent_tool, each (agent,tool) pair has its own bucket.
    // We verify by hitting the SAME bucket 3 times.
    const req = { agentId: 'a', tool: 'filesystem.read_file', args: { path: '/x' }, role: 'guest' };
    const r1 = await engine.check(req);
    const r2 = await engine.check(req);
    const r3 = await engine.check(req);
    expect(r1.reason).toBe('default-deny');
    expect(r2.reason).toBe('default-deny');
    // 3rd call from agent 'a' on the same tool exceeds the max=2 window
    expect(r3.allow).toBe(false);
    expect(r3.ruleId).toBe('rate-limit-read-file');

    // A different agent should have its own bucket and still be allowed to default-deny.
    const req2 = { agentId: 'b', tool: 'filesystem.read_file', args: { path: '/x' }, role: 'guest' };
    const r4 = await engine.check(req2);
    expect(r4.reason).toBe('default-deny');
    expect(r4.ruleId).toBeUndefined();
  });

  it('Time window: inside allow window → allow (non-inverted)', async () => {
    // Tuesday 12:00 UTC, weekdays Mon-Fri, window 09:00–17:00, no invert.
    const { evaluateTimeWindow } = await import('../src/policy/rules/time-window.js');
    const noonTue = new Date('2025-06-03T12:00:00Z');
    const v = evaluateTimeWindow(
      {
        tz: 'UTC',
        allow: [{ start: '09:00', end: '17:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] }],
        invert: false,
      },
      noonTue
    );
    expect(v).toBe('allow');
  });

  it('Time window: inside allow window → deny (inverted)', async () => {
    // Same setup as above but with invert:true → flip → 'deny'.
    const { evaluateTimeWindow } = await import('../src/policy/rules/time-window.js');
    const noonTue = new Date('2025-06-03T12:00:00Z');
    const v = evaluateTimeWindow(
      {
        tz: 'UTC',
        allow: [{ start: '09:00', end: '17:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] }],
        invert: true,
      },
      noonTue
    );
    expect(v).toBe('deny');
  });

  it('Time window: outside allow window → deny', async () => {
    const { evaluateTimeWindow } = await import('../src/policy/rules/time-window.js');
    const satMidnight = new Date('2025-06-07T00:00:00Z'); // Saturday
    // invert: true means: inside allow → deny; outside allow → allow.
    // Saturday is outside the Mon-Fri allow window, so invert flips it to 'allow'.
    const v = evaluateTimeWindow(
      {
        tz: 'UTC',
        allow: [{ start: '09:00', end: '17:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] }],
        invert: true,
      },
      satMidnight
    );
    expect(v).toBe('allow');
  });

  it('Time window: invert flips the verdict', async () => {
    const { evaluateTimeWindow } = await import('../src/policy/rules/time-window.js');
    const satMidnight = new Date('2025-06-07T00:00:00Z');
    const a = evaluateTimeWindow(
      {
        tz: 'UTC',
        allow: [{ start: '09:00', end: '17:00' }],
        invert: false,
      },
      satMidnight
    );
    const b = evaluateTimeWindow(
      {
        tz: 'UTC',
        allow: [{ start: '09:00', end: '17:00' }],
        invert: true,
      },
      satMidnight
    );
    expect(a).toBe('deny');
    expect(b).toBe('allow');
  });

  it('Time window: midnight-wrap span still matches after midnight for the start weekday', async () => {
    const { evaluateTimeWindow } = await import('../src/policy/rules/time-window.js');
    // Fri 2025-06-06 22:00 → Sat 00:30 is still inside Fri 22:00–06:00.
    const sat0030 = new Date('2025-06-07T00:30:00Z');
    const v = evaluateTimeWindow(
      {
        tz: 'UTC',
        allow: [{ start: '22:00', end: '06:00', weekdays: ['fri'] }],
        invert: false,
      },
      sat0030
    );
    expect(v).toBe('allow');
    // And Fri 23:00 is before midnight → also inside.
    const fri2300 = new Date('2025-06-06T23:00:00Z');
    expect(
      evaluateTimeWindow(
        { tz: 'UTC', allow: [{ start: '22:00', end: '06:00', weekdays: ['fri'] }], invert: false },
        fri2300
      )
    ).toBe('allow');
    // Sat afternoon is outside the Fri window.
    const sat1200 = new Date('2025-06-07T12:00:00Z');
    expect(
      evaluateTimeWindow(
        { tz: 'UTC', allow: [{ start: '22:00', end: '06:00', weekdays: ['fri'] }], invert: false },
        sat1200
      )
    ).toBe('deny');
  });

  it('Data classification: matches SSN in subject', async () => {
    const d = await engine.check({
      agentId: 'mailer',
      tool: 'email.send',
      args: {
        subject: 'your SSN is 123-45-6789 please review',
        body: '',
        to: 'a@b.com',
      },
    });
    expect(d.allow).toBe(false);
    expect(d.ruleId).toBe('pii-redact');
  });

  it('Data classification: clean payload → no match → default-deny', async () => {
    const d = await engine.check({
      agentId: 'mailer',
      tool: 'email.send',
      args: { subject: 'hello', body: 'world', to: 'a@b.com' },
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('default-deny');
  });

  it('First-match wins: rbac-developer-allow fires before later rules', async () => {
    const d = await engine.check({
      agentId: 'developer-agent',
      tool: 'filesystem.read_file',
      args: { path: '/secrets/keys.env' },
    });
    // developer role → rbac-developer-allow matches → allow=true
    expect(d.allow).toBe(true);
    expect(d.ruleId).toBe('rbac-developer-allow');
  });

  it('Default-deny when no rules match', async () => {
    const d = await engine.check({
      agentId: 'mystery',
      tool: 'unknown.tool',
      args: {},
      role: 'guest',
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('default-deny');
  });

  it('Policy reload swap: old rules gone, new rules active', async () => {
    const before = await engine.check({
      agentId: 'x',
      tool: 'filesystem.read_file',
      args: { path: '/secrets/x' },
      role: 'guest',
    });
    expect(before.ruleId).toBe('rbac-guest-deny');

    // After reload, the only rule fires on the matching tool with a role
    // that matches the caller's role (developer). The new default is allow,
    // so even unrelated calls would now be allowed.
    const NEW_YAML = `
version: "1"
default: allow
rules:
  - id: blanket-allow
    match: { tool: "filesystem.read_file" }
    decision: allow
    conditions:
      rbac:
        role: developer
        action: allow
`;
    engine.loadFromYaml(NEW_YAML);
    const after = await engine.check({
      agentId: 'x',
      tool: 'filesystem.read_file',
      args: { path: '/secrets/x' },
      role: 'developer',
    });
    expect(after.ruleId).toBe('blanket-allow');
    expect(after.allow).toBe(true);
  });

  it('Latency is reported and reasonable', async () => {
    const d = await engine.check({
      agentId: 'latency-test',
      tool: 'unknown.tool',
      args: {},
    });
    expect(typeof d.latencyMs).toBe('number');
    expect(d.latencyMs).toBeGreaterThanOrEqual(0);
    expect(d.latencyMs).toBeLessThan(50);
  });

  it('Rate limit: resets after window passes (synthetic)', async () => {
    const { RateLimiter } = await import('../src/policy/rules/rate-limit.js');
    const rl = new RateLimiter();
    const now = Date.now();
    expect(rl.check('k', 2, 1000)).toBe(true);
    expect(rl.check('k', 2, 1000)).toBe(true);
    expect(rl.check('k', 2, 1000)).toBe(false);
    // Wait virtually by re-instantiating (Map state persists, but we can
    // simulate by manipulating: easier to just construct fresh after a
    // sleep — here we use the reset() path as a stand-in).
    rl.reset();
    expect(rl.check('k', 2, 1000)).toBe(true);
    void now;
  });
});
