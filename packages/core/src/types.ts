/**
 * Shared types for AgentGuard core.
 *
 * These types describe the wire format between AgentGuard's interceptor
 * (this package) and the AgentGuard sidecar. They are deliberately tiny
 * so the sidecar can implement them in any language.
 */

import type { MCPHandle } from '@volcano.dev/agent';

/**
 * The decision returned by the sidecar for a single tool call attempt.
 *
 * - `allow=true`  → proceed; if `redactedArgs` is present, use it INSTEAD of
 *                   the caller's original args before invoking the tool.
 * - `allow=false` → the call must NOT be made; the caller throws
 *                   {@link AgentGuardBlockedError}.
 */
export interface PolicyDecision {
  allow: boolean;
  /** Human-readable explanation; surfaced to the user on block and in audit logs. */
  reason?: string;
  /** Identifier of the policy that produced the decision (e.g. OPA path). */
  policy?: string;
  /**
   * Argument substitution: when the caller is allowed to proceed, the sidecar
   * may rewrite sensitive fields (e.g. redacting a credential) and the
   * interceptor MUST use these args in place of the original ones.
   */
  redactedArgs?: Record<string, unknown>;
  /** Stable ID for this decision. Echoed in errors and audit hooks. */
  decisionId: string;
  /** Round-trip latency between interceptor and sidecar in milliseconds. */
  latencyMs: number;
  /** Severity classification used by the sidecar for alerting/SIEM routing. */
  severity: 'info' | 'warning' | 'critical';
}

/** Request payload sent to the sidecar's POST /check endpoint. */
export interface PolicyCheckRequest {
  /** Fully qualified tool name: `${mcpHandle.id}.${tool.name}`. */
  tool: string;
  /** Original arguments the caller is attempting to pass to the tool. */
  args: Record<string, unknown>;
  /** Stable identifier for the agent making the call. */
  agentId: string;
  /** Optional role / persona — used by policy rules for RBAC checks. */
  agentRole?: string;
  /** Stable identifier for the parent conversation / run. */
  sessionId?: string;
  /** Unix epoch milliseconds when the interceptor created the request. */
  timestamp: number;
}

/**
 * A small, transport-agnostic interface describing what an AgentGuard policy
 * client must do. The default implementation is {@link HttpPolicyClient}
 * (see `./policy-client.ts`), but tests and advanced users can swap in mocks,
 * in-process evaluators, or unix-socket transports.
 */
export interface PolicyClient {
  /**
   * Evaluate a request against policy. Resolves with a decision or throws
   * {@link AgentGuardUnreachableError} if the sidecar is unreachable AND
   * `failClosed=true` (otherwise the implementation should resolve with a
   * synthetic allow).
   */
  check(req: PolicyCheckRequest): Promise<PolicyDecision>;
  /** Lightweight liveness probe; does not count as a policy evaluation. */
  health(): Promise<{ ok: boolean; version: string }>;
  /** Release any sockets / timers. Idempotent. */
  close(): void;
}

/** Optional callback fired for *every* decision (allow and deny) for audit. */
export type OnDecision = (
  decision: PolicyDecision,
  context: {
    /** Fully qualified tool name (`${handle.id}.${name}`). */
    toolName: string;
    /** Original args the caller attempted. */
    args: Record<string, unknown>;
    /** Result returned by the tool. Only present on `allow` decisions. */
    result?: unknown;
    /** Overall wall-clock latency observed by the interceptor. */
    latencyMs: number;
  },
) => void;

/**
 * Options for {@link wrapMCP}. At minimum you need the sidecar URL and an
 * agent identity.
 */
export interface WrapOptions {
  /** Base URL of the AgentGuard sidecar (e.g. `http://localhost:9559`). */
  sidecarUrl: string;
  /**
   * Policy-friendly logical id for the wrapped MCP server. The SDK derives
   * `handle.id` from a hash of the spawn command (`mcp_<hash>`), which is
   * useless for policy authoring — pass a stable id like `'filesystem'` so
   * policy rules can match `filesystem.read_file`. Defaults to `handle.id`.
   */
  mcpId?: string;
  /** Stable ID for the agent (used in audit logs and policy lookups). */
  agentId: string;
  /** Optional role — RBAC hint for policy rules. */
  agentRole?: string;
  /**
   * Behaviour when the sidecar is unreachable:
   * - `true`  → throw {@link AgentGuardUnreachableError} (fail closed)
   * - `false` → synthetic allow with `policy: 'fail-open'` (fail open)
   */
  failClosed: boolean;
  /** Per-request timeout in milliseconds. Defaults to 1000. */
  timeoutMs?: number;
  /** Optional callback fired for every decision (allow and deny). */
  onDecision?: OnDecision;
  /**
   * Injected policy client (mainly for tests). When omitted, an
   * {@link HttpPolicyClient} is created from `sidecarUrl`.
   */
  client?: PolicyClient;
  /** Optional stable session/run ID; propagated to every check request. */
  sessionId?: string;
  /**
   * Tenant id for multi-tenant sidecar deployments. Sent as the
   * `X-Tenant-Id` header on every /check request so the sidecar scopes
   * policy + audit to this tenant. Defaults to `'default'`.
   */
  tenantId?: string;
  /**
   * When `true` (default), `listTools()` is filtered so the LLM only sees
   * tools the agent's role is allowed to call. This is "automatic tool
   * selection" — the LLM never wastes tokens attempting doomed calls.
   * Set to `false` to show all tools (policy still blocks at call time).
   */
  filterTools?: boolean;
}

/** Re-export so callers can `import type { MCPHandle }` from this package. */
export type { MCPHandle };