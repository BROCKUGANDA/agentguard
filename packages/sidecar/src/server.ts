import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PolicyEngine } from './policy/engine.js';
import { AuditStore } from './audit/store.js';
import { verifyChain } from './audit/chain.js';
import { CheckRequestSchema, type Decision } from './policy/schema.js';
import { initTelemetry } from './observability/otel.js';
import { BODY_LIMIT, requireAdmin, applyHardening, scrubArgsForAudit } from './hardening.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TenantManager, normalizeTenantId, type TenantContext } from './tenant/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION = '0.1.0';

export interface ServerDeps {
  policyFile: string;
  auditDb: string;
  port?: number;
  host?: string;
  logger?: boolean | object;
  webhookEnv?: Record<string, string>;
  /**
   * Enable multi-tenant mode. When provided, every request is scoped to a
   * tenant via the `X-Tenant-Id` header (default `default`); each tenant gets
   * its own policy file, audit DB, engine, alerts and WS stream, auto-created
   * on first request. Omit for legacy single-tenant behaviour (the header is
   * ignored and `policyFile`/`auditDb` are used directly).
   */
  tenants?: { dataDir: string; policyDir: string };
}

/** Rolling latency estimate — the audit row doesn't persist latency today. */
function makeLatencyTracker() {
  // EWMA with a fixed learning rate. The previous cap of `Math.min(n, 1000)`
  // froze the average after 1000 samples (0.001 step size), so a latency
  // spike after 10K requests barely moved the reported value. A fixed
  // alpha keeps the estimate responsive to regime changes.
  const ALPHA = 0.01;
  let avg = 0;
  let n = 0;
  return {
    observe(ms: number): void {
      n += 1;
      avg = n === 1 ? ms : avg + ALPHA * (ms - avg);
    },
    get(): number {
      return n === 0 ? 0 : avg;
    },
    reset(): void {
      avg = 0;
      n = 0;
    },
  };
}

/** Map an audit row to the dashboard's AuditEntry wire shape. */
function toAuditEntry(r: ReturnType<AuditStore['recent']>[number]) {
  return {
    id: String(r.id),
    ts: r.ts,
    timestamp: new Date(r.ts).toISOString(),
    agentId: r.agent_id,
    tool: r.tool,
    decision: r.decision,
    reason: r.reason,
    ruleId: r.policy_id,
    severity: r.severity,
    args: r.args,
    hash: r.entry_hash,
    prevHash: r.prev_hash,
  };
}

/** Map the engine's parsed policy to the dashboard PolicySet shape. */
function toPolicySet(
  engine: PolicyEngine,
  rawYaml: string,
  updatedAt: number
) {
  const p = engine.getPolicy();
  return {
    version: p?.version ?? '1',
    default: p?.default ?? 'deny',
    rules:
      p?.rules.map((r) => ({
        id: r.id,
        description: r.description,
        decision: r.decision,
        tool: (Array.isArray(r.match.tool) ? r.match.tool : [r.match.tool]) as string | string[],
        reason: r.reason,
      })) ?? [],
    agents: p?.agents ?? {},
    source: rawYaml,
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

/**
 * Build a Fastify instance wired with the policy engine + audit store +
 * websocket broadcaster. Exported separately from `start()` so tests can
 * use `fastify.inject()` without binding a port.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const tenantsMode = Boolean(deps.tenants);

  // ─── Tenant resolution ───────────────────────────────────────────────────
  // Legacy mode (no `tenants` config): the manager still provisions a single
  // "default" tenant that maps 1:1 to policyFile/auditDb — identical behaviour
  // to the pre-tenant sidecar, so all existing callers keep working, while
  // tenant mode activates the full per-tenant isolation machinery.
  const manager = new TenantManager({
    dataDir: deps.tenants?.dataDir ?? resolve(dirname(deps.auditDb)),
    policyDir: deps.tenants?.policyDir ?? resolve(dirname(deps.policyFile)),
    defaultPolicyFile: deps.policyFile,
    defaultAuditDb: deps.auditDb,
    webhookEnv: deps.webhookEnv,
    log: { warn: (m) => console.warn(m), error: (m) => console.error(m) },
  });

  /** Resolve the tenant context for a request (legacy mode → always default). */
  function resolveTenant(rawHeader: string | undefined): TenantContext | null {
    if (!tenantsMode) return manager.get('default');
    const id = normalizeTenantId(rawHeader);
    if (!id) return null;
    return manager.get(id);
  }

  /** Per-tenant latency trackers for /kpis. */
  const tenantLatency = new Map<string, ReturnType<typeof makeLatencyTracker>>();
  function latencyFor(tenantId: string) {
    let t = tenantLatency.get(tenantId);
    if (!t) {
      t = makeLatencyTracker();
      tenantLatency.set(tenantId, t);
    }
    return t;
  }

  const app = Fastify({
    logger: deps.logger ?? {
      level: process.env.LOG_LEVEL ?? 'info',
      // Pino redact paths: scrub PII from logs at the serializer level
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.args.body',
          'req.body.args.subject',
          'res.body.reason',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: BODY_LIMIT,
  });

  await app.register(cors, {
    origin: (
      process.env.AGENTGUARD_CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]
    ) as unknown as string | string[],
    credentials: true,
  });
  await app.register(websocket, {
    errorHandler: (error, socket) => {
      console.error('[ws] handler error:', error.message);
      try { socket.close(1011, 'internal error'); } catch { /* ignore */ }
    },
  });

  // ─── Hardening: per-IP rate limit + security headers + PII-safe logs ───────
  applyHardening(app);

  // ─── Security headers (defense-in-depth) ───────────────────────────────────
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'interest-cohort=()');
    // Minimal CSP for the JSON API (dashboard is a separate origin)
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // HSTS only meaningful when served over HTTPS; harmless on HTTP
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  // Decorate so handlers can reach them.
  app.decorate('engine', manager.get('default').engine);
  app.decorate('auditStore', manager.get('default').auditStore);
  app.decorate('stream', manager.get('default').stream);
  app.decorate('alertDispatcher', manager.get('default').alertDispatcher);
  app.decorate('policyFile', deps.policyFile);
  app.decorate('tenantManager', manager);
  app.decorate('tenantsMode', tenantsMode);

  // ─── GET / ────────────────────────────────────────────────────────────────
  // Root route — returns basic service info so direct browser hits don't 404.
  app.get('/', async () => {
    return {
      service: 'AgentGuard Sidecar',
      version: VERSION,
      docs: '/health · /agents · /kpis · /audit/recent · /policies · /stream',
      uptime: Math.round(process.uptime()),
    };
  });

  // ─── GET /health ──────────────────────────────────────────────────────────
  app.get('/health', async () => {
    const ctx = manager.has('default') ? manager.get('default') : null;
    const entries = ctx ? ctx.auditStore.count() : 0;
    const last = ctx ? ctx.auditStore.recent(1)[0] : undefined;
    return {
      ok: true,
      version: VERSION,
      uptime: Math.round(process.uptime()),
      rules_loaded: ctx?.engine.rulesLoaded() ?? 0,
      audit_count: entries,
      alert_count: ctx?.alertDispatcher.count() ?? 0,
      alert_failures: ctx?.alertDispatcher.failedCount() ?? 0,
      tenants: tenantsMode ? manager.list() : undefined,
      policies: {
        version: ctx?.engine.getPolicy()?.version ?? '1',
        ruleCount: ctx?.engine.rulesLoaded() ?? 0,
      },
      audit: {
        entries,
        lastEntryAt: last ? new Date(last.ts).toISOString() : null,
      },
    };
  });

  // ─── GET /tenants (multi-tenant mode) ─────────────────────────────────────
  app.get('/tenants', async (_req, reply) => {
    if (!tenantsMode) return reply.send(['default']);
    const ids = manager.list();
    return reply.send(
      ids.map((id) => {
        const ctx = manager.has(id) ? manager.get(id) : null;
        return {
          id,
          provisioned: Boolean(ctx),
          rules: ctx?.engine.rulesLoaded() ?? 0,
          audit_entries: ctx?.auditStore.count() ?? 0,
          created_at: ctx?.createdAt ?? null,
        };
      })
    );
  });

  // ─── POST /check ──────────────────────────────────────────────────────────
  app.post('/check', async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) {
      return reply.code(400).send({ error: 'invalid tenant id', detail: 'X-Tenant-Id must match [a-z0-9_-]{1,63}' });
    }
    const parse = CheckRequestSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'invalid request', details: parse.error.format() });
    }
    const started = performance.now();
    let decision: Decision;
    try {
      decision = await ctx.engine.check(parse.data);
    } catch (err) {
      // Fail closed on engine errors (e.g. invalid timezone) so a broken
      // policy condition cannot 500 the hot path or silently allow calls.
      app.log.error({ err, tool: parse.data.tool, agentId: parse.data.agentId }, 'policy evaluation failed');
      return reply.code(500).send({
        allow: false,
        error: 'policy_evaluation_failed',
        reason: 'policy evaluation failed; call denied (fail-closed)',
        decisionId: 'err_' + Date.now(),
        latencyMs: performance.now() - started,
        severity: 'critical',
      });
    }
    latencyFor(ctx.id).observe(performance.now() - started);

    // Persist the audit row. On redact decisions the audit trail stores the
    // REDACTED args (what the tool actually received). Deny (and plain
    // allow) args are deep-scrubbed so raw PII never lands in SQLite/WS.
    const sourceArgs =
      decision.allow && decision.redactedArgs ? decision.redactedArgs : parse.data.args;
    const auditedArgs = scrubArgsForAudit(sourceArgs) as Record<string, unknown>;
    // Severity: allow → info; deny with critical alert config → critical;
    // redact decisions → warning; other denies → warning.
    const matchingSeverity = ctx.engine
      .alertsConfig()
      .filter((a) => (decision.allow ? a.on_decision === 'allow' : a.on_decision === 'deny'))
      .filter((a) => !a.rule_ids?.length || (decision.ruleId && a.rule_ids.includes(decision.ruleId)))
      .map((a) => a.severity);
    const severity: 'info' | 'warning' | 'critical' = decision.allow
      ? decision.redactedArgs
        ? 'warning'
        : 'info'
      : matchingSeverity.includes('critical')
        ? 'critical'
        : matchingSeverity.includes('warning')
          ? 'warning'
          : 'warning';
    const record = ctx.auditStore.append({
      ts: Date.now(),
      agent_id: parse.data.agentId,
      tool: parse.data.tool,
      args: auditedArgs,
      decision: decision.allow ? 'allow' : 'deny',
      reason: decision.reason,
      policy_id: decision.ruleId,
      severity,
    });

    // Dispatch any matching alerts (fire-and-forget).
    void ctx.alertDispatcher.evaluateAndDispatch(decision, {
      agent_id: parse.data.agentId,
      tool: parse.data.tool,
    });

    // Fan out to this tenant's WebSocket subscribers. Dashboard listeners
    // invalidate ['audit'] + ['kpis'] on type 'audit'.
    ctx.stream.broadcast({
      type: 'audit',
      payload: { decision: { ...decision, severity }, record },
    });

    // Wire-compatible decision for @agentguard/core (requires decisionId,
    // severity, understands `policy` as the rule id) AND legacy consumers
    // that read ruleId directly.
    return reply.code(200).send({
      allow: decision.allow,
      reason: decision.reason,
      policy: decision.ruleId,
      ruleId: decision.ruleId,
      decisionId: decision.decisionId,
      latencyMs: decision.latencyMs,
      // Present only on redact decisions — the masked args to substitute.
      redactedArgs: decision.redactedArgs,
      severity,
    });
  });

  // ─── GET /audit/recent ────────────────────────────────────────────────────
  // Supports cursor pagination: when `cursor` is present, returns
  // { items, nextCursor, total }. Without cursor, returns a flat array
  // (backward compat for existing consumers).
  app.get<{ Querystring: { limit?: string; cursor?: string } }>('/audit/recent', async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit ?? '100', 10) || 100, 1),
      10_000
    );
    const cursorRaw = req.query.cursor;
    if (cursorRaw !== undefined) {
      const cursor = Number.parseInt(cursorRaw, 10) || undefined;
      const page = ctx.auditStore.recentPaginated(limit, cursor);
      return reply.send({
        items: page.items.map(toAuditEntry),
        nextCursor: page.nextCursor,
        total: page.total,
      });
    }
    return reply.send(ctx.auditStore.recent(limit).map(toAuditEntry));
  });

  // ─── GET /audit/by-agent ──────────────────────────────────────────────────
  app.get<{ Querystring: { agentId?: string; since?: string } }>(
    '/audit/by-agent',
    async (req, reply) => {
      const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
      if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
      const agentId = req.query.agentId;
      const since = Number.parseInt(req.query.since ?? '0', 10) || 0;
      if (!agentId) return reply.code(400).send({ error: 'agentId required' });
      return reply.send(ctx.auditStore.byAgent(agentId, since).map(toAuditEntry));
    }
  );

  // ─── POST /audit/verify ───────────────────────────────────────────────────
  app.post('/audit/verify', { preHandler: requireAdmin }, async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
    const records = ctx.auditStore.all();
    if (records.length === 0) return { valid: true, count: 0, verified: true, totalEntries: 0, lastVerifiedAt: new Date().toISOString() };
    const result = verifyChain(records);
    return {
      ...result,
      count: records.length,
      verified: result.valid,
      totalEntries: records.length,
      lastVerifiedAt: new Date().toISOString(),
      brokenAt: result.brokenAt != null ? String(result.brokenAt) : undefined,
    };
  });

  // ─── GET /kpis ────────────────────────────────────────────────────────────
  app.get('/kpis', async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
    // SQL aggregation — avoids loading every audit row into memory on every
    // poll (the dashboard hits /kpis every 6s). Chain integrity is deferred
    // to the explicit /audit/verify endpoint for large datasets.
    const { allow: allowed, deny: blocked } = ctx.auditStore.countByDecision();
    const total = allowed + blocked;
    const VERIFY_THRESHOLD = 1000;
    const integrity =
      total === 0
        ? { verified: true, totalEntries: 0, lastVerifiedAt: new Date().toISOString() }
        : total <= VERIFY_THRESHOLD
          ? (() => {
              const res = verifyChain(ctx.auditStore.all());
              return {
                verified: res.valid,
                totalEntries: total,
                lastVerifiedAt: new Date().toISOString(),
                brokenAt: res.brokenAt != null ? String(res.brokenAt) : undefined,
              };
            })()
          : { verified: null as boolean | null, totalEntries: total, lastVerifiedAt: new Date().toISOString() };
    return reply.send({
      allowed,
      blocked,
      pending: 0,
      avgLatencyMs: latencyFor(ctx.id).get(),
      chainIntegrity: integrity,
    });
  });

  // ─── POST /allowed-tools ──────────────────────────────────────────────────
  // Automatic tool selection: given an agent identity and a list of tool
  // names, returns the subset that policy would allow with empty args.
  // Used by wrapMCP's filterTools to hide disallowed tools from the LLM's
  // listTools() view, reducing wasted tokens on doomed calls.
  app.post<{ Body: { agentId: string; role?: string; tools: string[] } }>(
    '/allowed-tools',
    async (req, reply) => {
      const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
      if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
      const { agentId, role, tools } = req.body ?? {};
      if (!agentId || !Array.isArray(tools) || tools.length > 200) {
        return reply
          .code(400)
          .send({ error: 'agentId and tools[] required (tools max 200)' });
      }
      const allowed: string[] = [];
      for (const tool of tools) {
        if (typeof tool !== 'string' || tool.length === 0) continue;
        const decision = await ctx.engine.check({
          tool,
          args: {},
          agentId,
          role,
        });
        if (decision.allow) allowed.push(tool);
      }
      return reply.send({ allowed, total: tools.length, filtered: tools.length - allowed.length });
    }
  );

  // ─── GET /agents ──────────────────────────────────────────────────────────
  app.get('/agents', async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
    const now = Date.now();
    const windowStart = now - 3_600_000;
    // SQL aggregation — one GROUP BY query instead of loading every row.
    const stats = ctx.auditStore.agentStats(windowStart);
    const byAgent = new Map<
      string,
      { callsLastHour: number; blocksLastHour: number; lastTs: number; lastDecision: string }
    >();
    for (const s of stats) {
      byAgent.set(s.agent_id, {
        callsLastHour: s.callsLastHour,
        blocksLastHour: s.blocksLastHour,
        lastTs: s.lastTs,
        lastDecision: s.lastDecision,
      });
    }
    const policy = ctx.engine.getPolicy();
    // Include policy-declared agents even before they act.
    // Skip the "*" wildcard — it's a role template, not a real agent.
    for (const id of Object.keys(policy?.agents ?? {})) {
      if (id === '*') continue;
      if (!byAgent.has(id)) {
        byAgent.set(id, { callsLastHour: 0, blocksLastHour: 0, lastTs: 0, lastDecision: 'allow' });
      }
    }
    const out = [...byAgent.entries()].map(([agentId, a]) => ({
      agentId,
      role: policy?.agents?.[agentId]?.role ?? policy?.agents?.['*']?.role ?? 'guest',
      state:
        a.lastTs === 0
          ? 'idle'
          : a.lastDecision === 'deny'
            ? 'blocked'
            : now - a.lastTs < 60_000
              ? 'acting'
              : 'idle',
      lastSeen: a.lastTs === 0 ? new Date(now).toISOString() : new Date(a.lastTs).toISOString(),
      callsLastHour: a.callsLastHour,
      blocksLastHour: a.blocksLastHour,
    }));
    return reply.send(out.sort((x, y) => y.callsLastHour - x.callsLastHour));
  });

  // ─── GET /alerts/recent ───────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string; severity?: string; rule_id?: string } }>(
    '/alerts/recent',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
      if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
      const limit = Math.min(
        Math.max(Number.parseInt(req.query.limit ?? '100', 10) || 100, 1),
        10_000
      );
      const filter: { severity?: string; rule_id?: string } = {};
      if (req.query.severity) filter.severity = req.query.severity;
      if (req.query.rule_id) filter.rule_id = req.query.rule_id;
      return reply.send(ctx.alertDispatcher.recent(limit, filter));
    }
  );

  // ─── POST /alerts/test-fire ───────────────────────────────────────────────
  // Synthesizes a deny decision and runs it through the dispatcher. Useful for
  // verifying that a webhook is configured correctly without staging a real
  // policy violation. REQUIRES ADMIN TOKEN (can fire real webhooks).
  app.post<{ Body: { severity?: string; webhook?: string; rule_id?: string; agent_id?: string; tool?: string } }>(
    '/alerts/test-fire',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
      if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
      const { severity = 'critical', webhook, rule_id = 'manual-test', agent_id = 'test-agent', tool = 'test.tool' } = req.body ?? {};

      const resolvedWebhook = webhook
        ?? process.env.AGENTGUARD_SLACK_WEBHOOK
        ?? ctx.engine.alertsConfig().find((a) => a.webhook)?.webhook;
      if (!resolvedWebhook) {
        return reply.code(400).send({
          error: 'no webhook configured',
          detail: 'Pass `webhook` in the body, set AGENTGUARD_SLACK_WEBHOOK, or configure alerts.webhook in the policy.',
        });
      }

      // Ephemeral alert list — never mutates the tenant's live routing, so a
      // concurrent /check can't accidentally hit the test webhook.
      const decision: Decision = {
        allow: false,
        decisionId: 'test-' + Date.now(),
        ruleId: rule_id,
        reason: 'Manual test-fire from dashboard',
        latencyMs: 0,
      };
      await ctx.alertDispatcher.evaluateAndDispatch(
        decision,
        { agent_id, tool },
        [
          {
            on_decision: 'deny',
            severity: severity as 'info' | 'warning' | 'critical',
            webhook: resolvedWebhook,
            rule_ids: [rule_id],
          },
        ],
      );

      return reply.send({ ok: true, webhook: resolvedWebhook });
    }
  );

  // ─── GET /policies ────────────────────────────────────────────────────────
  app.get('/policies', async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
    try {
      const yaml = readFileSync(ctx.policyFile, 'utf8');
      return reply.send(toPolicySet(ctx.engine, yaml, ctx.createdAt));
    } catch (err) {
      return reply.code(500).send({ error: 'failed to read policy', detail: String(err) });
    }
  });

  // ─── POST /policies/reload ────────────────────────────────────────────────
  app.post('/policies/reload', { preHandler: requireAdmin }, async (req, reply) => {
    const ctx = resolveTenant(req.headers['x-tenant-id'] as string | undefined);
    if (!ctx) return reply.code(400).send({ error: 'invalid tenant id' });
    try {
      ctx.engine.loadFromFile(ctx.policyFile);
      ctx.stream.broadcast({ type: 'policy', payload: { rules_loaded: ctx.engine.rulesLoaded() } });
      const yaml = readFileSync(ctx.policyFile, 'utf8');
      return reply.send({
        ok: true,
        rules_loaded: ctx.engine.rulesLoaded(),
        ...toPolicySet(ctx.engine, yaml, ctx.createdAt),
      });
    } catch (err) {
      return reply
        .code(500)
        .send({ error: 'reload failed', detail: (err as Error).message });
    }
  });

  // ─── WS /stream?tenant=<id> ───────────────────────────────────────────────
  // WebSocket upgrades can't carry custom headers from the browser, so the
  // tenant is passed as a query param. Legacy mode ignores it.
  // NOTE: @fastify/websocket v11 passes (socket, request) — not ({ socket, req }).
  app.get('/stream', { websocket: true }, (socket, req) => {
    const raw = (req.query as { tenant?: string } | undefined)?.tenant;
    let ctx: TenantContext | null = null;
    if (!tenantsMode) {
      ctx = manager.get('default');
    } else {
      const id = normalizeTenantId(raw);
      ctx = id ? manager.get(id) : null;
    }
    if (!ctx) {
      try {
        socket.close(4400, 'invalid tenant');
      } catch {
        /* ignore */
      }
      return;
    }
    ctx.stream.addClient(socket);
    socket.send(
      JSON.stringify({ type: 'hello', payload: { tenant: ctx.id, ts: Date.now() } })
    );
  });

  // ─── Audit retention purge ────────────────────────────────────────────────
  // Periodically delete audit rows older than AGENTGUARD_AUDIT_RETENTION_DAYS
  // and reclaim space. Set to 0 to disable (keep forever).
  const retentionDays = Number.parseInt(process.env.AGENTGUARD_AUDIT_RETENTION_DAYS ?? '0', 10);
  let retentionTimer: ReturnType<typeof setInterval> | null = null;
  if (retentionDays > 0) {
    const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h
    retentionTimer = setInterval(() => {
      const before = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      for (const id of manager.list()) {
        const ctx = manager.has(id) ? manager.get(id) : null;
        if (!ctx) continue;
        const deleted = ctx.auditStore.purgeBefore(before);
        if (deleted > 0) app.log.info({ tenant: id, deleted, retentionDays }, 'purged old audit rows');
      }
    }, PURGE_INTERVAL_MS).unref();
  }

  app.addHook('onClose', async () => {
    manager.close();
    if (retentionTimer) clearInterval(retentionTimer);
  });

  return app;
}

/**
 * Production entrypoint: start the server, listen on PORT (default 9559).
 */
let runningApp: FastifyInstance | null = null;

export async function start(): Promise<FastifyInstance> {
  initTelemetry();

  // Process-level safety nets: unhandled rejections from fire-and-forget
  // alert delivery (or any other async path) must not crash the sidecar
  // silently. Log and continue.
  process.on('unhandledRejection', (reason) => {
    console.error('[agentguard] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[agentguard] uncaughtException:', err);
    // In production, an uncaught exception may have corrupted state —
    // exit so the supervisor (tini/docker) restarts us.
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  });

  // dist/server.js → ../../../policies/agentguard.yaml (3 levels up).
  // tsx dev run   → src/server.ts → ../../policies/agentguard.yaml   (2 levels up).
  // We try both: prefer the env override, else look in both candidate paths.
  const candidates = [
    process.env.AGENTGUARD_POLICY_FILE,
    process.env.AGENTGUARD_POLICY_DIR ? join(process.env.AGENTGUARD_POLICY_DIR, 'agentguard.yaml') : undefined,
    `${__dirname}/../../../policies/agentguard.yaml`,
    `${__dirname}/../../policies/agentguard.yaml`,
  ].filter((x): x is string => Boolean(x));

  let policyFile: string | undefined;
  for (const p of candidates) {
    try {
      const { statSync } = await import('node:fs');
      statSync(p);
      policyFile = p;
      break;
    } catch {
      // try next
    }
  }
  if (!policyFile) {
    throw new Error(
      `Could not locate policy file. Tried: ${candidates.join(', ')}. ` +
        `Set AGENTGUARD_POLICY_FILE to override.`
    );
  }
  const auditDb = process.env.AGENTGUARD_AUDIT_DB ?? `${__dirname}/../data/audit.sqlite`;

  const tenants =
    process.env.AGENTGUARD_TENANT_DATA_DIR || process.env.AGENTGUARD_TENANT_POLICY_DIR
      ? {
          dataDir: process.env.AGENTGUARD_TENANT_DATA_DIR ?? `${__dirname}/../data`,
          policyDir: process.env.AGENTGUARD_TENANT_POLICY_DIR ?? `${__dirname}/../../../policies`,
        }
      : undefined;

  const app = await buildServer({
    policyFile,
    auditDb,
    port: Number.parseInt(process.env.PORT ?? '9559', 10),
    host: process.env.HOST ?? '127.0.0.1',
    tenants,
  });

  const port = Number.parseInt(process.env.PORT ?? process.env.AGENTGUARD_PORT ?? '9559', 10);
  // In container/0.0.0.0 mode (AGENTGUARD_BIND_ALL=1) we bind to all interfaces;
  // otherwise default 127.0.0.1 for security in local dev.
  const host = process.env.AGENTGUARD_BIND_ALL === '1' ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1');
  await app.listen({ port, host });
  app.log.info({ port, host, policyFile, auditDb, tenants: Boolean(tenants) }, 'AgentGuard sidecar ready');

  runningApp = app;
  return app;
}

/**
 * Graceful shutdown: close the Fastify server (drains in-flight requests,
 * fires the `onClose` hook which closes all tenant SQLite stores + WS
 * streams). Idempotent — safe to call multiple times.
 */
export async function stop(): Promise<void> {
  if (runningApp) {
    await runningApp.close();
    runningApp = null;
  }
}

// Run when invoked directly (not when imported by tests).
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isMain) {
  start().catch((err) => {
    console.error('sidecar failed to start:', err);
    process.exit(1);
  });
}