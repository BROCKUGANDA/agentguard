/**
 * TenantManager — per-tenant policy + audit isolation.
 *
 * Multi-tenant mode is enabled by passing `tenants: { dataDir, policyDir }`
 * to buildServer(). Each tenant id (from the `X-Tenant-Id` header, or the
 * `?tenant=` query param for WebSocket) gets its OWN:
 *
 *   - policy file   → <policyDir>/<id>.yaml  (auto-created from the starter
 *                     policy on first request)
 *   - audit DB      → <dataDir>/tenants/<id>/audit.sqlite (auto-created)
 *   - policy engine → per-tenant instance (independent rate-limit state)
 *   - alert engine  → per-tenant dispatcher
 *   - event stream  → per-tenant broadcast (dashboard sees only its tenant)
 *
 * Tenants are provisioned lazily on first request, so the server starts with
 * zero state and a rogue header can never touch another tenant's data.
 *
 * Tenant ids are validated against TENANT_ID_RE; anything else is rejected
 * with 400 by the caller.
 */

import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { PolicyEngine } from '../policy/engine.js';
import { AuditStore } from '../audit/store.js';
import { AlertDispatcher } from '../alerts/dispatcher.js';
import { EventStream } from '../ws/stream.js';
import { STARTER_POLICY_YAML, TENANT_ID_RE } from './starter-policy.js';
import { parse as parseYaml } from 'yaml';
import { PolicyFileSchema } from '../policy/schema.js';

export interface TenantContext {
  id: string;
  engine: PolicyEngine;
  auditStore: AuditStore;
  alertDispatcher: AlertDispatcher;
  stream: EventStream;
  policyFile: string;
  auditDb: string;
  createdAt: number;
}

export interface TenantManagerOptions {
  /** Root dir for per-tenant audit DBs: <dataDir>/tenants/<id>/audit.sqlite */
  dataDir: string;
  /** Dir holding per-tenant policy files: <policyDir>/<id>.yaml */
  policyDir: string;
  /** Seed policy for the "default" tenant (legacy mode) — optional. */
  defaultPolicyFile?: string;
  /** Pre-existing audit DB for the "default" tenant (legacy mode) — optional. */
  defaultAuditDb?: string;
  /** Env object used to resolve ${VAR} in webhook URLs. */
  webhookEnv?: Record<string, string>;
  /** Logger used to surface engine load failures. */
  log?: { warn: (msg: string, ...a: unknown[]) => void; error?: (msg: string, ...a: unknown[]) => void };
}

/** Map a raw header value to a validated tenant id, or null when invalid. */
export function normalizeTenantId(raw: string | undefined): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  if (!TENANT_ID_RE.test(id)) return null;
  return id;
}

/**
 * Validate a tenant policy file's shape WITHOUT throwing — used at
 * auto-provision time so a hand-edited (broken) policy degrades to the
 * starter defaults instead of failing the tenant's first request.
 */
function looksValidPolicy(yaml: string): boolean {
  try {
    const parsed = parseYaml(yaml);
    PolicyFileSchema.parse(parsed);
    return true;
  } catch {
    return false;
  }
}

export class TenantManager {
  private readonly contexts = new Map<string, TenantContext>();
  private readonly dataDir: string;
  private readonly policyDir: string;
  private readonly opts: TenantManagerOptions;

  constructor(opts: TenantManagerOptions) {
    this.opts = opts;
    this.dataDir = resolve(opts.dataDir);
    this.policyDir = resolve(opts.policyDir);
    mkdirSync(join(this.dataDir, 'tenants'), { recursive: true });
    mkdirSync(this.policyDir, { recursive: true });
  }

  /** Resolve (and lazily provision) a tenant context. */
  get(id: string): TenantContext {
    let ctx = this.contexts.get(id);
    if (ctx) return ctx;

    const isDefault = id === 'default';

    // ── Policy file ─────────────────────────────────────────────────────
    // Default tenant: prefer the explicitly configured policy file (legacy
    // single-tenant setups keep their existing policy). Other tenants, and a
    // default tenant without an override, get <policyDir>/<id>.yaml seeded
    // from the starter policy on first request.
    let policyFile: string;
    if (isDefault && this.opts.defaultPolicyFile) {
      policyFile = resolve(this.opts.defaultPolicyFile);
    } else {
      policyFile = join(this.policyDir, `${id}.yaml`);
      if (!existsSync(policyFile)) {
        writeFileSync(policyFile, STARTER_POLICY_YAML, 'utf8');
        this.opts.log?.warn?.(`[tenant:${id}] no policy file — wrote starter policy to ${policyFile}`);
      }
    }

    // ── Audit DB ────────────────────────────────────────────────────────
    let auditDb: string;
    if (isDefault && this.opts.defaultAuditDb) {
      auditDb = resolve(this.opts.defaultAuditDb);
    } else {
      auditDb = join(this.dataDir, 'tenants', id, 'audit.sqlite');
    }

    // ── Engine + store + alerts + stream ────────────────────────────────
    const engine = new PolicyEngine();
    try {
      engine.loadFromFile(policyFile);
    } catch (err) {
      this.opts.log?.error?.(`[tenant:${id}] policy load failed (${(err as Error).message}); booting with zero rules → all checks deny`);
      if (!isDefault) {
        // A broken hand-edited policy shouldn't brick provisioning; rewrite
        // the starter so the operator has a known-good baseline.
        try {
          writeFileSync(policyFile, STARTER_POLICY_YAML, 'utf8');
          engine.loadFromFile(policyFile);
        } catch {
          /* keep the empty engine (fail closed) */
        }
      }
    }

    const auditStore = new AuditStore(auditDb);
    const alertDispatcher = new AlertDispatcher(auditStore.raw());
    alertDispatcher.setAlerts(engine.alertsConfig());
    alertDispatcher.setWebhookEnv(this.opts.webhookEnv ?? (process.env as Record<string, string>));

    // Re-pull alerts whenever this tenant's policy reloads.
    engine.onReload = () => alertDispatcher.setAlerts(engine.alertsConfig());

    const stream = new EventStream();

    ctx = {
      id,
      engine,
      auditStore,
      alertDispatcher,
      stream,
      policyFile,
      auditDb,
      createdAt: Date.now(),
    };
    this.contexts.set(id, ctx);
    return ctx;
  }

  /** Whether a tenant context has already been provisioned. */
  has(id: string): boolean {
    return this.contexts.has(id);
  }

  /**
   * Enumerate known tenants: provisioned contexts + policy files on disk +
   * tenant data dirs. Sorted for deterministic output.
   */
  list(): string[] {
    const ids = new Set<string>(this.contexts.keys());
    // The explicitly configured default policy is not a tenant.
    const defaultPolicyName = this.opts.defaultPolicyFile ? basename(this.opts.defaultPolicyFile) : null;
    try {
      for (const f of readdirSync(this.policyDir)) {
        if ((f.endsWith('.yaml') || f.endsWith('.yml')) && f !== defaultPolicyName) ids.add(f.replace(/\.ya?ml$/, ''));
      }
    } catch {
      /* policyDir may not exist yet */
    }
    try {
      for (const d of readdirSync(join(this.dataDir, 'tenants'))) {
        if (TENANT_ID_RE.test(d)) ids.add(d);
      }
    } catch {
      /* no tenants yet */
    }
    return [...ids].sort();
  }

  /** Count provisioned tenants (contexts actually created this boot). */
  provisionedCount(): number {
    return this.contexts.size;
  }

  /** Close every tenant store + stream (idempotent). */
  close(): void {
    for (const ctx of this.contexts.values()) {
      try {
        ctx.stream.close();
      } catch {
        /* ignore */
      }
      try {
        ctx.auditStore.close();
      } catch {
        /* ignore */
      }
    }
    this.contexts.clear();
  }
}

// Re-export for callers that want to validate ids without a full manager.
export { TENANT_ID_RE };

export function looksValidPolicyYaml(yaml: string): boolean {
  return looksValidPolicy(yaml);
}