/**
 * AgentGuard alert dispatcher.
 *
 * Loads `policy.alerts` from the loaded policy file. When a policy decision
 * matches an alert rule (severity + rule_ids or any-deny), the alert is:
 *   1. Persisted to the `alerts` SQLite table (immutable history)
 *   2. Dispatched to the configured webhook(s) (Slack-compatible)
 *   3. Marked delivered/failed in the same row
 *
 * Delivery is best-effort with a 5-second timeout. Failures are logged
 * but never block the policy decision path.
 */

import type { SqliteDb } from '../audit/sqlite.js';
import { checkWebhookSsrf } from '../hardening.js';
import type { Alert as AlertConfig, Decision } from '../policy/schema.js';

export interface AlertRecord {
  id: number;
  ts: number;
  decision_id: string;
  rule_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  agent_id: string;
  tool: string;
  reason: string | null;
  webhook_url: string | null;
  delivery_status: 'pending' | 'delivered' | 'failed';
  delivery_error: string | null;
  delivered_at: number | null;
}

export class AlertDispatcher {
  private alerts: AlertConfig[] = [];
  private webhookEnv: Record<string, string> = {};

  constructor(private db: SqliteDb) {
    this.ensureTable();
  }

  setAlerts(alerts: AlertConfig[] | undefined): void {
    this.alerts = alerts ?? [];
  }

  setWebhookEnv(env: Record<string, string>): void {
    this.webhookEnv = env;
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        decision_id TEXT NOT NULL,
        rule_id TEXT,
        severity TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        reason TEXT,
        webhook_url TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        delivery_error TEXT,
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id);
    `);
  }

  /**
   * Inspect a decision and fire any matching alerts.
   * Always returns immediately; delivery happens in background.
   */
  async evaluateAndDispatch(
    decision: Decision,
    ctx: { agent_id: string; tool: string },
    /** Optional one-shot alerts (e.g. test-fire) that bypass `this.alerts`. */
    ephemeral?: AlertConfig[],
  ): Promise<void> {
    // Source: ephemeral list (test-fire) or configured policy alerts.
    const source = ephemeral ?? this.alerts;
    // Alerts fire for BOTH allow and deny when `on_decision` matches.
    // (The old early-return made `on_decision: allow` dead config.)
    const matching = source.filter((a) => this.matches(a, decision));
    if (matching.length === 0) return;

    for (const alert of matching) {
      const webhookUrl = this.resolveWebhook(alert.webhook);
      const alertId = this.insertAlert({
        ts: Date.now(),
        decision_id: decision.decisionId,
        rule_id: decision.ruleId ?? null,
        severity: alert.severity,
        agent_id: ctx.agent_id,
        tool: ctx.tool,
        reason: decision.reason ?? null,
        webhook_url: webhookUrl,
        delivery_status: 'pending',
        delivery_error: null,
        delivered_at: null,
      });

      // Fire-and-forget delivery (don't block policy path)
      void this.deliver(alertId, alert, decision, ctx);
    }
  }

  private matches(alert: AlertConfig, decision: Decision): boolean {
    // on_decision is 'allow' | 'deny' — fire when it equals the decision outcome.
    const outcome = decision.allow ? 'allow' : 'deny';
    if (alert.on_decision !== outcome) return false;
    if (alert.rule_ids && alert.rule_ids.length > 0) {
      if (!decision.ruleId || !alert.rule_ids.includes(decision.ruleId)) return false;
    }
    return true;
  }

  private resolveWebhook(template: string | undefined): string | null {
    if (!template) return null;
    // Replace ${VAR} placeholders with env values
    return template.replace(/\$\{([^}]+)\}/g, (_, name) => this.webhookEnv[name] ?? '');
  }

  private insertAlert(rec: Omit<AlertRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO alerts (ts, decision_id, rule_id, severity, agent_id, tool, reason, webhook_url, delivery_status, delivery_error, delivered_at)
      VALUES (@ts, @decision_id, @rule_id, @severity, @agent_id, @tool, @reason, @webhook_url, @delivery_status, @delivery_error, @delivered_at)
    `);
    const result = stmt.run(rec);
    return Number(result.lastInsertRowid);
  }

  private async deliver(
    alertId: number,
    alert: AlertConfig,
    decision: Decision,
    ctx: { agent_id: string; tool: string }
  ): Promise<void> {
    const url = this.resolveWebhook(alert.webhook);
    if (!url) {
      this.markFailed(alertId, 'webhook URL empty (env var not set)');
      return;
    }
    // SSRF guard: policy files are untrusted input — a webhook may not point
    // at loopback, link-local, or private ranges. (DNS-rebinding is out of
    // scope for the sidecar's threat model; webhooks are operator-configured.)
    const ssrf = checkWebhookSsrf(url);
    if (ssrf) {
      this.markFailed(alertId, `webhook blocked: ${ssrf}`);
      return;
    }

    const payload = {
      text: this.formatSlackMessage(decision, ctx, alert),
      agentguard: {
        decision_id: decision.decisionId,
        rule_id: decision.ruleId,
        severity: alert.severity,
        agent_id: ctx.agent_id,
        tool: ctx.tool,
        reason: decision.reason,
        latency_ms: decision.latencyMs,
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        this.markFailed(alertId, `HTTP ${res.status}: ${await res.text().catch(() => '')}`);
        return;
      }
      this.markDelivered(alertId);
    } catch (e) {
      this.markFailed(alertId, e instanceof Error ? e.message : String(e));
    }
  }

  private formatSlackMessage(
    decision: Decision,
    ctx: { agent_id: string; tool: string },
    alert: AlertConfig
  ): string {
    const sev = alert.severity.toUpperCase();
    const rule = decision.ruleId ?? 'default-deny';
    return [
      `:shield: *AgentGuard ${sev}* — policy denied an action`,
      `• *Agent*: ${ctx.agent_id}`,
      `• *Tool*: ${ctx.tool}`,
      `• *Rule*: \`${rule}\``,
      `• *Reason*: ${decision.reason ?? '(none)'}`,
      `• *Decision ID*: \`${decision.decisionId}\``,
    ].join('\n');
  }

  private markDelivered(alertId: number): void {
    this.db
      .prepare('UPDATE alerts SET delivery_status = ?, delivered_at = ? WHERE id = ?')
      .run('delivered', Date.now(), alertId);
  }

  private markFailed(alertId: number, error: string): void {
    this.db
      .prepare('UPDATE alerts SET delivery_status = ?, delivery_error = ? WHERE id = ?')
      .run('failed', error.slice(0, 500), alertId);
  }

  // ─── Query API ─────────────────────────────────────────────────────────

  recent(limit: number, filter?: { severity?: string; rule_id?: string }): AlertRecord[] {
    let sql = 'SELECT * FROM alerts';
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter?.severity) {
      where.push('severity = ?');
      params.push(filter.severity);
    }
    if (filter?.rule_id) {
      where.push('rule_id = ?');
      params.push(filter.rule_id);
    }
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY ts DESC LIMIT ?';
    params.push(limit);
    return (this.db.prepare(sql).all(...(params as unknown as never[])) as unknown) as AlertRecord[];
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as n FROM alerts').get() as { n: number }).n;
  }

  failedCount(): number {
    return (this.db
      .prepare(`SELECT COUNT(*) as n FROM alerts WHERE delivery_status = 'failed'`)
      .get() as { n: number }).n;
  }
}