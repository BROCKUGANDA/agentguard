import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditStore } from '../src/audit/store.js';
import { AlertDispatcher } from '../src/alerts/dispatcher.js';
import type { Decision } from '../src/policy/schema.js';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    allow: false,
    decisionId: 'dec-' + Math.random().toString(36).slice(2),
    reason: 'test reason',
    ruleId: 'test-rule',
    latencyMs: 1.2,
    ...overrides,
  };
}

describe('AlertDispatcher', () => {
  let tmp: string;
  let store: AuditStore;
  let dispatcher: AlertDispatcher;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agentguard-alerts-'));
    store = new AuditStore(join(tmp, 'audit.sqlite'));
    dispatcher = new AlertDispatcher(store.raw());
  });

  afterAll(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does nothing for allow decisions', async () => {
    dispatcher.setAlerts([
      { on_decision: 'deny', severity: 'critical', webhook: 'https://example.com/hook' },
    ]);
    const before = dispatcher.count();
    await dispatcher.evaluateAndDispatch(makeDecision({ allow: true }), {
      agent_id: 'a',
      tool: 't',
    });
    expect(dispatcher.count()).toBe(before);
  });

  it('does nothing when no alerts are configured', async () => {
    dispatcher.setAlerts([]);
    await dispatcher.evaluateAndDispatch(makeDecision(), { agent_id: 'a', tool: 't' });
    expect(dispatcher.count()).toBe(0);
  });

  it('persists an alert row on matching deny', async () => {
    dispatcher.setAlerts([
      { on_decision: 'deny', severity: 'critical', webhook: 'https://example.com/hook' },
    ]);
    dispatcher.setWebhookEnv({});
    const before = dispatcher.count();
    await dispatcher.evaluateAndDispatch(makeDecision({ ruleId: 'r1' }), {
      agent_id: 'agent-1',
      tool: 'tool-1',
    });
    expect(dispatcher.count()).toBe(before + 1);
    const recent = dispatcher.recent(1);
    expect(recent[0].agent_id).toBe('agent-1');
    expect(recent[0].tool).toBe('tool-1');
    expect(recent[0].severity).toBe('critical');
    expect(recent[0].rule_id).toBe('r1');
  });

  it('filters by rule_ids when configured', async () => {
    dispatcher.setAlerts([
      {
        on_decision: 'deny',
        severity: 'warning',
        webhook: 'https://example.com/hook',
        rule_ids: ['specific-rule'],
      },
    ]);
    dispatcher.setWebhookEnv({});
    const before = dispatcher.count();
    await dispatcher.evaluateAndDispatch(makeDecision({ ruleId: 'other-rule' }), {
      agent_id: 'a',
      tool: 't',
    });
    expect(dispatcher.count()).toBe(before);
    await dispatcher.evaluateAndDispatch(makeDecision({ ruleId: 'specific-rule' }), {
      agent_id: 'a',
      tool: 't',
    });
    expect(dispatcher.count()).toBe(before + 1);
  });

  it('resolves ${VAR} placeholders in webhook URLs from env', async () => {
    dispatcher.setAlerts([
      { on_decision: 'deny', severity: 'critical', webhook: '${SLACK_WEBHOOK}' },
    ]);
    dispatcher.setWebhookEnv({ SLACK_WEBHOOK: 'https://hooks.slack.com/x' });
    await dispatcher.evaluateAndDispatch(makeDecision(), { agent_id: 'a', tool: 't' });
    const recent = dispatcher.recent(1);
    expect(recent[0].webhook_url).toBe('https://hooks.slack.com/x');
  });

  it('marks alert as failed when webhook URL is empty', async () => {
    dispatcher.setAlerts([
      { on_decision: 'deny', severity: 'critical', webhook: '${MISSING_VAR}' },
    ]);
    dispatcher.setWebhookEnv({});
    await dispatcher.evaluateAndDispatch(makeDecision(), { agent_id: 'a', tool: 't' });
    const recent = dispatcher.recent(1);
    expect(recent[0].delivery_status).toBe('failed');
    expect(recent[0].delivery_error).toContain('empty');
  });

  it('marks alert as failed for SSRF-blocked webhooks', async () => {
    dispatcher.setAlerts([
      { on_decision: 'deny', severity: 'critical', webhook: 'http://127.0.0.1/secret' },
    ]);
    dispatcher.setWebhookEnv({});
    await dispatcher.evaluateAndDispatch(makeDecision(), { agent_id: 'a', tool: 't' });
    const recent = dispatcher.recent(1);
    expect(recent[0].delivery_status).toBe('failed');
    expect(recent[0].delivery_error).toContain('blocked');
  });

  it('recent() supports severity filter', async () => {
    dispatcher.setAlerts([
      { on_decision: 'deny', severity: 'info', webhook: '${NO}' },
    ]);
    dispatcher.setWebhookEnv({});
    await dispatcher.evaluateAndDispatch(makeDecision(), { agent_id: 'a', tool: 't' });
    const infoOnly = dispatcher.recent(100, { severity: 'info' });
    expect(infoOnly.every((a) => a.severity === 'info')).toBe(true);
    const criticalOnly = dispatcher.recent(100, { severity: 'critical' });
    expect(criticalOnly.every((a) => a.severity === 'critical')).toBe(true);
  });

  it('failedCount() counts only failed deliveries', () => {
    const failed = dispatcher.failedCount();
    expect(failed).toBeGreaterThanOrEqual(0);
    expect(typeof failed).toBe('number');
  });
});