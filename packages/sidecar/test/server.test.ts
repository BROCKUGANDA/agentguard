import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

const POLICY_YAML = `
version: "1"
default: deny
agents:
  "*":
    role: guest
  dev-agent:
    role: developer
rules:
  - id: allow-developer-write
    match:
      tool: filesystem.write_file
    decision: allow
    conditions:
      rbac:
        role: developer
        action: allow
  - id: deny-pii-email
    match:
      tool: email.send
    decision: deny
    reason: "PII detected"
    conditions:
      data_classification:
        patterns:
          - name: ssn
            regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b'
        match_on: ["args.subject", "args.body"]
`;

describe('Fastify server', () => {
  let app: FastifyInstance;
  let tmp: string;
  let policyPath: string;
  let dbPath: string;
  let apps: FastifyInstance[] = [];

  async function build(): Promise<FastifyInstance> {
    const a = await buildServer({
      policyFile: policyPath,
      auditDb: dbPath,
      logger: false,
    });
    await a.ready();
    apps.push(a);
    return a;
  }

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'agentguard-test-'));
    policyPath = join(tmp, 'policy.yaml');
    dbPath = join(tmp, 'audit.sqlite');
    writeFileSync(policyPath, POLICY_YAML, 'utf8');
    app = await build();
  });

  afterAll(async () => {
    for (const a of apps) {
      try {
        await a.close();
      } catch {
        /* ignore */
      }
    }
    apps = [];
    rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Reset audit DB between tests by closing the current app and building a fresh one.
    await app.close();
    rmSync(dbPath, { force: true });
    app = await build();
  });

  it('GET /health returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('0.1.0');
    expect(body.rules_loaded).toBeGreaterThan(0);
  });

  it('POST /check with allow rule → decision.allow=true and audit count increments', async () => {
    const before = (await app.inject({ method: 'GET', url: '/health' })).json().audit_count;
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      payload: {
        agentId: 'dev-agent',
        tool: 'filesystem.write_file',
        args: { path: '/tmp/out' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allow).toBe(true);
    expect(body.ruleId).toBe('allow-developer-write');
    const after = (await app.inject({ method: 'GET', url: '/health' })).json().audit_count;
    expect(after).toBe(before + 1);
  });

  it('POST /check with deny rule → decision.allow=false and audit row present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      payload: {
        agentId: 'mailer',
        tool: 'email.send',
        args: { subject: 'SSN 123-45-6789 attached', body: '', to: 'x@y.com' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allow).toBe(false);
    expect(body.ruleId).toBe('deny-pii-email');

    const recent = await app.inject({ method: 'GET', url: '/audit/recent?limit=10' });
    const rows = recent.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].tool).toBe('email.send');
    expect(rows[0].decision).toBe('deny');
  });

  it('POST /check rejects invalid body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      payload: { wrong: 'shape' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /audit/recent returns last N', async () => {
    // Make 3 decisions
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/check',
        payload: { agentId: 'dev-agent', tool: 'filesystem.write_file', args: { i } },
      });
    }
    const res = await app.inject({ method: 'GET', url: '/audit/recent?limit=2' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.length).toBe(2);
    // DESC order is guaranteed by row id; ties in ts are possible when calls
    // land in the same millisecond, so assert ordering by id, not ts.
    expect(Number(rows[0].id)).toBeGreaterThan(Number(rows[1].id));
    expect(rows[0].ts).toBeGreaterThanOrEqual(rows[1].ts);
  });

  it('POST /audit/verify returns valid for clean chain', async () => {
    await app.inject({
      method: 'POST',
      url: '/check',
      payload: { agentId: 'dev-agent', tool: 'filesystem.write_file', args: {} },
    });
    const res = await app.inject({ method: 'POST', url: '/audit/verify' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.count).toBeGreaterThan(0);
  });

  it('GET /policies returns the YAML file', async () => {
    const res = await app.inject({ method: 'GET', url: '/policies' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('allow-developer-write');
  });

  it('POST /policies/reload swaps rules', async () => {
    const res = await app.inject({ method: 'POST', url: '/policies/reload' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.rules_loaded).toBeGreaterThan(0);
  });

  it('GET /audit/by-agent filters correctly', async () => {
    await app.inject({
      method: 'POST',
      url: '/check',
      payload: { agentId: 'agent-A', tool: 'filesystem.write_file', args: {} },
    });
    await app.inject({
      method: 'POST',
      url: '/check',
      payload: { agentId: 'agent-B', tool: 'filesystem.write_file', args: {} },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/audit/by-agent?agentId=agent-A&since=0',
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows.every((r: { agentId: string }) => r.agentId === 'agent-A')).toBe(true);
    expect(rows.length).toBe(1);
  });
});
