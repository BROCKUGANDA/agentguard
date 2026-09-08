/**
 * High-level helper that wires an AgentGuard policy client into a
 * `@volcano.dev/agent` {@link AgentBuilder}.
 *
 * Two responsibilities:
 *   1. Provide a `guardMCP(handle)` shorthand bound to the same policy
 *      client, so the caller doesn't repeat `sidecarUrl` / `agentId` on
 *      every call to {@link wrapMCP}.
 *   2. Attach an `onToolCall` audit hook on every step the builder produces,
 *      so even calls made through the SDK's automatic tool-selection loop
 *      are recorded (in addition to the pre-call policy check that
 *      {@link wrapMCP} already performs).
 *
 * IMPORTANT: interception MUST happen at the MCPHandle layer. The
 * `onToolCall` hook is for auditing only — it fires AFTER the tool has
 * already run, so it cannot block the call.
 */

import { agent } from '@volcano.dev/agent';
import type {
  AgentBuilder,
  LLMHandle,
  MCPHandle,
  Step,
  StepResult,
} from '@volcano.dev/agent';

import { wrapMCP } from './wrapMCP.js';
import type {
  OnDecision,
  PolicyClient,
  PolicyDecision,
} from './types.js';
import { createHttpPolicyClient } from './policy-client.js';

export interface GuardedAgentOptions {
  /** LLM the agent should use (e.g. `llmOpenAI({ apiKey })`). */
  llm: LLMHandle;
  /** Stable ID for this agent — used in audit logs and policy rules. */
  agentId: string;
  /** Optional role — RBAC hint for policy rules. */
  agentRole?: string;
  /** Sidecar base URL. Ignored if `client` is provided. */
  sidecarUrl: string;
  /** Fail-closed when the sidecar is unreachable. */
  failClosed: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional override for the policy client (mainly tests). */
  client?: PolicyClient;
  /** Optional audit callback fired for every policy decision. */
  onDecision?: OnDecision;
  /** Optional session/run ID propagated to every check. */
  sessionId?: string;
  /**
   * When `true` (default), `listTools()` is filtered so the LLM only sees
   * tools the agent's role is allowed to call. Set to `false` to show all.
   */
  filterTools?: boolean;
  /**
   * Tenant id for multi-tenant sidecar deployments. Sent as `X-Tenant-Id`
   * on every check so the sidecar scopes policy + audit to this tenant.
   * Defaults to `'default'`.
   */
  tenantId?: string;
  /**
   * Extra {@link AgentOptions} fields forwarded to the SDK `agent(opts)`.
   * `llm` is always overridden by the one in this object.
   */
  agentOptions?: Omit<
    Parameters<typeof agent>[0] extends infer T ? T : never,
    'llm'
  >;
}

/**
 * Wrap an MCP handle with the same policy client the agent will use.
 * Returns the wrapped handle — pass it directly into `mcps: [...]` steps.
 */
export type GuardMCP = (handle: MCPHandle) => MCPHandle;

/**
 * A {@link GuardedAgent} bundles the policy client, the agent builder, and
 * a `guardMCP` shorthand. The builder has its `onToolCall` audit hook
 * already wired in.
 */
export interface GuardedAgent {
  builder: AgentBuilder;
  guardMCP: GuardMCP;
  client: PolicyClient;
}

/**
 * Construct an AgentGuard-protected agent. The returned object exposes the
 * underlying {@link AgentBuilder} so the caller can chain `.then(...)`,
 * `.parallel(...)`, etc. exactly as they would with the raw SDK.
 */
export function guardedAgent(opts: GuardedAgentOptions): GuardedAgent {
  const client: PolicyClient =
    opts.client ??
    createHttpPolicyClient({
      sidecarUrl: opts.sidecarUrl,
      failClosed: opts.failClosed,
      timeoutMs: opts.timeoutMs,
      tenantId: opts.tenantId,
    });

  const guardMCP: GuardMCP = (handle) =>
    wrapMCP(handle, {
      sidecarUrl: opts.sidecarUrl,
      agentId: opts.agentId,
      agentRole: opts.agentRole,
      failClosed: opts.failClosed,
      timeoutMs: opts.timeoutMs,
      client,
      onDecision: opts.onDecision,
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
      filterTools: opts.filterTools,
    });

  // Build the base agent from the SDK.
  const builder = agent({ llm: opts.llm, ...(opts.agentOptions ?? {}) });

  // Wrap `.then()` so every step the caller adds inherits an `onToolCall`
  // audit hook. We do this by replacing `then` with a delegating shim that
  // inspects the step argument and, when it has `mcps` / `mcp`, injects /
  // wraps `onToolCall` to forward to the audit callback.
  const baseThen = builder.then.bind(builder);

  const wrappedThen = (
    stepOrFactory: Step | ((history: StepResult[]) => Step),
  ): AgentBuilder => {
    if (typeof stepOrFactory === 'function') {
      const factory = stepOrFactory;
      const wrappedFactory = (history: StepResult[]): Step =>
        augmentStep(factory(history), opts.onDecision);
      return baseThen(wrappedFactory);
    }
    return baseThen(augmentStep(stepOrFactory, opts.onDecision));
  };

  // Replace the builder's `then` with our augmented version. The other
  // chain methods (parallel, branch, while, ...) compose on top of `then`,
  // so augmenting `then` is sufficient.
  (builder as unknown as { then: typeof builder.then }).then = wrappedThen;

  return { builder, guardMCP, client };
}

/**
 * Attach (or compose with) an `onToolCall` audit hook on a Step. The
 * interception still happens at the MCP layer; this is purely for audit.
 */
function augmentStep(step: Step, onDecision?: OnDecision): Step {
  if (!onDecision) return step;
  // Only steps that can produce tool calls have onToolCall. The union
  // members without it (`agents`-only, the `Step` form without mcps/mcp/tool)
  // are returned unchanged because there's nothing to audit.
  if (!('mcps' in step || 'mcp' in step)) return step;

  const existing = (step as { onToolCall?: (...a: unknown[]) => void }).onToolCall;

  const composedOnToolCall = (
    toolName: string,
    args: unknown,
    result: unknown,
  ): void => {
    // The SDK fires onToolCall AFTER the call regardless of decision. We
    // synthesize a minimal audit envelope so the caller's onDecision can
    // still record "this tool ran" events.
    const syntheticDecision: PolicyDecision = {
      allow: true,
      policy: 'audit',
      decisionId: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      latencyMs: 0,
      severity: 'info',
    };
    onDecision(syntheticDecision, {
      toolName,
      args: (args ?? {}) as Record<string, unknown>,
      result,
      latencyMs: 0,
    });
    // Preserve any user-supplied onToolCall on the original step.
    existing?.(toolName, args, result);
  };

  return { ...step, onToolCall: composedOnToolCall };
}