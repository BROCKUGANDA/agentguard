/**
 * `wrapMCP` — the heart of AgentGuard.
 *
 * Given a {@link MCPHandle} returned from `mcp()` / `mcpStdio()`, this
 * function returns a NEW handle whose `callTool(name, args)` first asks the
 * AgentGuard sidecar for a policy decision. The sidecar's response is the
 * single source of truth:
 *
 *   allow=false                     → throw {@link AgentGuardBlockedError},
 *                                     original tool is NEVER invoked.
 *   allow=true, redactedArgs set    → original tool is called with the
 *                                     redacted args.
 *   allow=true, no redaction        → original tool is called with the
 *                                     caller's args unchanged.
 *
 * The new handle is intentionally a thin proxy: `id`, `url`, `auth`,
 * `transport`, `process`, `listTools`, and `cleanup` are all preserved so
 * the SDK (and any user code that introspects the handle) sees the same
 * identity. Only `callTool` is wrapped.
 */

import {
  AgentGuardBlockedError,

} from './errors.js';
import { createHttpPolicyClient } from './policy-client.js';
import type {
  MCPHandle,
  PolicyClient,
  PolicyDecision,
  WrapOptions,
} from './types.js';

/** A tool call result we capture for the audit hook. */
interface CallResult {
  args: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

/**
 * Wrap an {@link MCPHandle} so every tool call is policy-checked first.
 *
 * The wrapper holds a single {@link PolicyClient}; if none is provided, a
 * default HTTP client is constructed from `sidecarUrl` + `failClosed`.
 */
export function wrapMCP(handle: MCPHandle, opts: WrapOptions): MCPHandle {
  const client: PolicyClient =
    opts.client ??
    createHttpPolicyClient({
      sidecarUrl: opts.sidecarUrl,
      failClosed: opts.failClosed,
      timeoutMs: opts.timeoutMs,
      tenantId: opts.tenantId,
    });

  // Close-over the original callTool so we always invoke the unwrapped one.
  const originalCallTool = handle.callTool.bind(handle);
  const originalListTools = handle.listTools.bind(handle);
  const originalCleanup = handle.cleanup?.bind(handle);

  // ─── Automatic tool selection ───────────────────────────────────────────
  // When filterTools is enabled (default), listTools() is filtered so the
  // LLM only sees tools the agent's role is allowed to call. The filtered
  // list is cached for 60s to avoid repeated /allowed-tools round-trips.
  const filterTools = opts.filterTools ?? true;
  let toolCache: { result: unknown; expiry: number } | null = null;
  const TOOL_CACHE_TTL_MS = 60_000;

  async function filteredListTools(): Promise<unknown> {
    const now = Date.now();
    if (toolCache && toolCache.expiry > now) return toolCache.result;

    const allResult = await originalListTools();
    if (!filterTools) return allResult;

    const toolsArr = (allResult as { tools?: unknown[] }).tools;
    if (!Array.isArray(toolsArr) || toolsArr.length === 0) return allResult;

    const toolNames = toolsArr.map((t: unknown) => {
      const name = (t as { name?: string }).name;
      return name ? `${opts.mcpId ?? handle.id}.${name}` : '';
    }).filter(Boolean);

    if (toolNames.length === 0) return allResult;

    try {
      const url = `${opts.sidecarUrl.replace(/\/+$/, '')}/allowed-tools`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': opts.tenantId ?? 'default',
        },
        body: JSON.stringify({
          agentId: opts.agentId,
          role: opts.agentRole,
          tools: toolNames,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
      });
      if (!res.ok) return allResult;
      const { allowed } = (await res.json()) as { allowed?: string[] };
      if (!Array.isArray(allowed)) return allResult;

      const allowedSet = new Set(allowed);
      const filteredTools = toolsArr.filter((t: unknown) => {
        const name = (t as { name?: string }).name;
        return name ? allowedSet.has(`${opts.mcpId ?? handle.id}.${name}`) : true;
      });
      const result = { ...allResult, tools: filteredTools };
      toolCache = { result, expiry: now + TOOL_CACHE_TTL_MS };
      return result;
    } catch {
      // On any error, fail open — show all tools. Policy still blocks at call time.
      return allResult;
    }
  }

  // Serialise concurrent tool calls against the same handle so two parallel
  // decisions can't race on a shared state. Volcano's MCP pool is already
  // serialised per-endpoint, but the wrapper is a defensive boundary.
  let chain: Promise<unknown> = Promise.resolve();

  async function guardedCallTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const start = Date.now();
    const fullName = `${opts.mcpId ?? handle.id}.${name}`;
    const decision: PolicyDecision = await client.check({
      tool: fullName,
      args,
      agentId: opts.agentId,
      agentRole: opts.agentRole,
      sessionId: opts.sessionId,
      timestamp: start,
    });

    if (!decision.allow) {
      const callLatency = Date.now() - start;
      // Surface to caller
      opts.onDecision?.(decision, {
        toolName: fullName,
        args,
        latencyMs: callLatency,
      });
      throw new AgentGuardBlockedError(
        decision.reason ?? `Tool call blocked by policy ${decision.policy ?? '(unknown)'}`,
        decision,
      );
    }

    const callArgs = decision.redactedArgs ?? args;
    const callResult: CallResult = { args: callArgs };
    try {
      callResult.result = await originalCallTool(name, callArgs);
      return callResult.result;
    } catch (err) {
      callResult.error = err;
      throw err;
    } finally {
      const callLatency = Date.now() - start;
      opts.onDecision?.(decision, {
        toolName: fullName,
        args,
        result: callResult.result,
        latencyMs: callLatency,
      });
    }
  }

  const wrappedCallTool = (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    const next = chain.then(() => guardedCallTool(name, args));
    // Swallow errors on the chain itself so a failed call doesn't poison
    // subsequent ones — the caller still receives the rejection from `next`.
    chain = next.catch(() => undefined);
    return next;
  };

  // Reconstruct the handle, preserving identity. We deliberately mirror the
  // SDK's MCPHandle shape rather than `Object.assign` so accidental additions
  // to the SDK surface surface as TypeScript errors here.
  const wrapped: MCPHandle = {
    id: handle.id,
    url: handle.url,
    auth: handle.auth,
    transport: handle.transport,
    process: handle.process,
    listTools: (filterTools ? filteredListTools : originalListTools) as MCPHandle['listTools'],
    callTool: wrappedCallTool,
    cleanup: originalCleanup,
  };

  return wrapped;
}