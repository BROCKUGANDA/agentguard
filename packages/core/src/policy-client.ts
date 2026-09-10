/**
 * HTTP client for the AgentGuard sidecar.
 *
 * This is the default {@link PolicyClient} implementation used by
 * {@link wrapMCP} when the caller does not inject one. It uses Node's
 * global `fetch` (Node ≥ 18) and an `AbortSignal.timeout` to bound the
 * round-trip. Responses are validated against a Zod schema so a malformed
 * sidecar reply fails closed rather than silently allowing the call.
 */

import { z } from 'zod';
import {
  AgentGuardUnreachableError,
} from './errors.js';
import type {
  PolicyCheckRequest,
  PolicyClient,
  PolicyDecision,
} from './types.js';

/** Zod schema for the JSON body returned by `POST /check`. */
const DecisionSchema = z.object({
  allow: z.boolean(),
  reason: z.string().optional(),
  policy: z.string().optional(),
  redactedArgs: z.record(z.unknown()).optional(),
  decisionId: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  severity: z.enum(['info', 'warning', 'critical']),
});

const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
});

export interface HttpPolicyClientOptions {
  /** Base URL of the AgentGuard sidecar (no trailing slash). */
  sidecarUrl: string;
  /** Per-request timeout in milliseconds. Defaults to 1000. */
  timeoutMs?: number;
  /**
   * When `true`, network / parse errors throw
   * {@link AgentGuardUnreachableError}. When `false`, `check()` resolves
   * with a synthetic allow (policy: 'fail-open').
   */
  failClosed: boolean;
  /** Optional fetch override for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /**
   * Tenant id for multi-tenant sidecar deployments. Sent as the
   * `X-Tenant-Id` header so the sidecar scopes policy + audit to this
   * tenant. Defaults to `'default'`.
   */
  tenantId?: string;
}

/**
 * Default implementation of {@link PolicyClient}. Wraps Node's global
 * `fetch` with timeouts, structured error mapping, and Zod validation.
 */
export class HttpPolicyClient implements PolicyClient {
  private readonly sidecarUrl: string;
  private readonly timeoutMs: number;
  private readonly failClosed: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly tenantId: string;
  private closed = false;

  constructor(opts: HttpPolicyClientOptions) {
    if (typeof opts.sidecarUrl !== 'string' || opts.sidecarUrl.trim().length === 0) {
      throw new AgentGuardUnreachableError('sidecarUrl is required');
    }
    try {
      // Reject garbage early so a bad config fails at construction, not mid-flight.
      new URL(opts.sidecarUrl);
    } catch {
      throw new AgentGuardUnreachableError(`invalid sidecarUrl: ${opts.sidecarUrl}`);
    }
    this.sidecarUrl = opts.sidecarUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 1000;
    this.failClosed = opts.failClosed;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.tenantId = opts.tenantId ?? 'default';
  }

  async check(req: PolicyCheckRequest): Promise<PolicyDecision> {
    if (this.closed) {
      throw new AgentGuardUnreachableError(
        'AgentGuard policy client is closed',
        {},
      );
    }
    const url = `${this.sidecarUrl}/check`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': this.tenantId,
        },
        body: JSON.stringify({ ...req, role: req.agentRole }),
        // AbortSignal.timeout is supported in Node ≥ 17.3 and modern browsers.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.handleUnreachable('network error talking to AgentGuard sidecar', err);
    }
    if (!res.ok) {
      return this.handleUnreachable(
        `AgentGuard sidecar returned HTTP ${res.status}`,
        new Error(`HTTP ${res.status}`),
        res.status,
      );
    }
    // Cap response size so a compromised/malicious sidecar can't OOM the agent.
    const contentLength = Number(res.headers.get('content-length') ?? '0');
    if (contentLength > 2 * 1024 * 1024) {
      return this.handleUnreachable(
        `AgentGuard sidecar response too large (${contentLength} bytes)`,
        new Error('response too large'),
        res.status,
      );
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      return this.handleUnreachable(
        'AgentGuard sidecar returned unreadable body',
        err,
        res.status,
      );
    }
    if (text.length > 2 * 1024 * 1024) {
      return this.handleUnreachable(
        `AgentGuard sidecar response too large (${text.length} bytes)`,
        new Error('response too large'),
        res.status,
      );
    }
    let json: unknown;
    try {
      json = text.length === 0 ? {} : JSON.parse(text);
    } catch (err) {
      return this.handleUnreachable(
        'AgentGuard sidecar returned invalid JSON',
        err,
        res.status,
      );
    }
    const parsed = DecisionSchema.safeParse(json);
    if (!parsed.success) {
      return this.handleUnreachable(
        'AgentGuard sidecar returned a malformed decision',
        parsed.error,
        res.status,
      );
    }
    return parsed.data;
  }

  async health(): Promise<{ ok: boolean; version: string }> {
    const url = `${this.sidecarUrl}/health`;
    if (this.closed) {
      throw new AgentGuardUnreachableError('AgentGuard policy client is closed', {});
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'x-tenant-id': this.tenantId },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new AgentGuardUnreachableError(
        'AgentGuard sidecar health check failed',
        {},
        { cause: err },
      );
    }
    if (!res.ok) {
      throw new AgentGuardUnreachableError(
        `AgentGuard sidecar health check returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    const parsed = HealthSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new AgentGuardUnreachableError(
        'AgentGuard sidecar health response was malformed',
        {},
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  close(): void {
    this.closed = true;
  }

  /**
   * Centralised fail-open / fail-closed handling. `check()` always either
   * returns a real decision or throws; this method encodes both branches.
   */
  private handleUnreachable(
    message: string,
    cause: unknown,
    status?: number,
  ): Promise<PolicyDecision> | never {
    if (this.failClosed) {
      throw new AgentGuardUnreachableError(
        message,
        { status },
        { cause },
      );
    }
    // Fail open: synthetic allow, decisionId is generated client-side so the
    // event is still correlatable in audit logs.
    const decision: PolicyDecision = {
      allow: true,
      reason: `fail-open: ${message}`,
      policy: 'fail-open',
      decisionId: `failopen_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      latencyMs: 0,
      severity: 'warning',
    };
    return Promise.resolve(decision);
  }
}

/**
 * Construct a {@link HttpPolicyClient} from a {@link WrapOptions}-shaped
 * object. Exposed so callers (and {@link guardedAgent}) can build a client
 * without reaching into the class directly.
 */
export function createHttpPolicyClient(opts: {
  sidecarUrl: string;
  failClosed: boolean;
  timeoutMs?: number;
  tenantId?: string;
}): HttpPolicyClient {
  return new HttpPolicyClient(opts);
}