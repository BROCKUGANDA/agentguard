/**
 * Framework-agnostic adapter — use AgentGuard without @volcano.dev/agent.
 *
 * `wrapCallTool` takes any `callTool(name, args)` function (LangChain,
 * AutoGen, CrewAI, raw MCP, etc.) and returns a guarded version that
 * checks with the AgentGuard sidecar before invoking the original.
 *
 * @example
 * ```ts
 * import { wrapCallTool } from '@agentguard/core';
 *
 * const guardedCall = wrapCallTool(myCallTool, {
 *   sidecarUrl: 'http://localhost:9559',
 *   agentId: 'my-langchain-agent',
 *   failClosed: true,
 *   toolPrefix: 'mytools',  // → 'mytools.read_file'
 * });
 *
 * const result = await guardedCall('read_file', { path: '/tmp/x' });
 * ```
 */

import { AgentGuardBlockedError } from './errors.js';
import { createHttpPolicyClient } from './policy-client.js';
import type { PolicyClient, PolicyDecision } from './types.js';

/** A generic tool-call function: (toolName, args) → result. */
export type CallToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface WrapCallToolOptions {
  /** Base URL of the AgentGuard sidecar (e.g. `http://localhost:9559`). */
  sidecarUrl: string;
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
  /**
   * Prefix prepended to the tool name when sending to the sidecar
   * (e.g. `toolPrefix: 'filesystem'` → `filesystem.read_file`).
   * Defaults to no prefix (the raw tool name is used).
   */
  toolPrefix?: string;
  /** Tenant id for multi-tenant sidecar deployments. Defaults to `'default'`. */
  tenantId?: string;
  /** Optional callback fired for every decision (allow and deny). */
  onDecision?: (
    decision: PolicyDecision,
    context: { toolName: string; args: Record<string, unknown>; result?: unknown; latencyMs: number },
  ) => void;
  /** Injected policy client (mainly for tests). */
  client?: PolicyClient;
}

/**
 * Wrap any `callTool(name, args)` function so every call is policy-checked
 * first. Works with Lang1Chain, AutoGen, CrewAI, raw MCP clients, or any
 * framework that exposes a tool-call function.
 */
export function wrapCallTool(
  callTool: CallToolFn,
  opts: WrapCallToolOptions,
): CallToolFn {
  const client: PolicyClient =
    opts.client ??
    createHttpPolicyClient({
      sidecarUrl: opts.sidecarUrl,
      failClosed: opts.failClosed,
      timeoutMs: opts.timeoutMs,
      tenantId: opts.tenantId,
    });

  const prefix = opts.toolPrefix ? `${opts.toolPrefix}.` : '';

  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const start = Date.now();
    const fullName = `${prefix}${name}`;
    const decision: PolicyDecision = await client.check({
      tool: fullName,
      args,
      agentId: opts.agentId,
      agentRole: opts.agentRole,
      timestamp: start,
    });

    if (!decision.allow) {
      const callLatency = Date.now() - start;
      opts.onDecision?.(decision, { toolName: fullName, args, latencyMs: callLatency });
      throw new AgentGuardBlockedError(
        decision.reason ?? `Tool call blocked by policy ${decision.policy ?? '(unknown)'}`,
        decision,
      );
    }

    const callArgs = decision.redactedArgs ?? args;
    try {
      const result = await callTool(name, callArgs);
      const callLatency = Date.now() - start;
      opts.onDecision?.(decision, { toolName: fullName, args, result, latencyMs: callLatency });
      return result;
    } catch (err) {
      const callLatency = Date.now() - start;
      opts.onDecision?.(decision, { toolName: fullName, args, latencyMs: callLatency });
      throw err;
    }
  };
}