import { describe, it, expect, vi } from 'vitest';
import { wrapMCP } from '../src/wrapMCP.js';
import { createHttpPolicyClient } from '../src/policy-client.js';
import { AgentGuardBlockedError, AgentGuardUnreachableError } from '../src/errors.js';
import type { MCPHandle, PolicyClient, PolicyDecision } from '../src/types.js';

function makeHandle(overrides: Partial<MCPHandle> = {}): MCPHandle {
  return {
    id: 'mcp_a3f9d2e1',
    url: 'http://localhost:0/mcp',
    transport: 'http',
    listTools: vi.fn(async () => ({ tools: [{ name: 'read_file' }] })),
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => ({
      ok: true,
      name,
      args,
    })),
    ...overrides,
  };
}

function allowDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    allow: true,
    policy: 'p.test',
    decisionId: 'dec_1',
    latencyMs: 5,
    severity: 'info',
    ...overrides,
  };
}

function denyDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    allow: false,
    reason: 'forbidden',
    policy: 'p.test',
    decisionId: 'dec_2',
    latencyMs: 7,
    severity: 'critical',
    ...overrides,
  };
}

describe('wrapMCP', () => {
  it('allows when sidecar says allow', async () => {
    const original = makeHandle();
    const check = vi.fn(async () => allowDecision());
    const client: PolicyClient = {
      check,
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    const result = await wrapped.callTool('read_file', { p: 1 });
    expect(original.callTool).toHaveBeenCalledWith('read_file', { p: 1 });
    expect(result).toEqual({ ok: true, name: 'read_file', args: { p: 1 } });
    expect(check).toHaveBeenCalledOnce();
  });

  it('blocks when sidecar says deny', async () => {
    const original = makeHandle();
    const check = vi.fn(async () => denyDecision());
    const client: PolicyClient = {
      check,
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    await expect(wrapped.callTool('read_file', { p: 1 })).rejects.toBeInstanceOf(
      AgentGuardBlockedError,
    );
    expect(original.callTool).not.toHaveBeenCalled();
  });

  it('uses redactedArgs when provided', async () => {
    const original = makeHandle();
    const check = vi.fn(async () =>
      allowDecision({ redactedArgs: { p: 'REDACTED' } }),
    );
    const client: PolicyClient = {
      check,
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    await wrapped.callTool('read_file', { p: 'secret' });
    expect(original.callTool).toHaveBeenCalledWith('read_file', { p: 'REDACTED' });
  });

  it('fail-closed when sidecar unreachable (HttpPolicyClient)', async () => {
    const original = makeHandle();
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = createHttpPolicyClient({
      sidecarUrl: 'http://x',
      failClosed: true,
      fetch: fetchImpl,
    });
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    await expect(wrapped.callTool('read_file', { p: 1 })).rejects.toBeInstanceOf(
      AgentGuardUnreachableError,
    );
    expect(original.callTool).not.toHaveBeenCalled();
  });

  it('fail-open when sidecar unreachable (HttpPolicyClient)', async () => {
    const original = makeHandle();
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = createHttpPolicyClient({
      sidecarUrl: 'http://x',
      failClosed: false,
      fetch: fetchImpl,
    });
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: false,
      client,
    });
    const result = await wrapped.callTool('read_file', { p: 1 });
    expect(original.callTool).toHaveBeenCalledWith('read_file', { p: 1 });
    expect(result).toEqual({ ok: true, name: 'read_file', args: { p: 1 } });
  });

  it('preserves id, url, listTools', async () => {
    const original = makeHandle({
      id: 'mcp_X',
      url: 'http://example/mcp',
      auth: { type: 'bearer', token: 't' },
    });
    const client: PolicyClient = {
      check: async () => allowDecision(),
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    expect(wrapped.id).toBe('mcp_X');
    expect(wrapped.url).toBe('http://example/mcp');
    expect(wrapped.auth).toEqual({ type: 'bearer', token: 't' });
    await wrapped.listTools();
    expect(original.listTools).toHaveBeenCalled();
  });

  it('invokes onDecision callback with latency', async () => {
    const original = makeHandle();
    const client: PolicyClient = {
      check: async () => allowDecision({ latencyMs: 9 }),
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const onDecision = vi.fn();
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
      onDecision,
    });
    await wrapped.callTool('read_file', { p: 1 });
    expect(onDecision).toHaveBeenCalledOnce();
    const [_decision, ctx] = onDecision.mock.calls[0];
    expect(ctx.toolName).toBe('mcp_a3f9d2e1.read_file');
    expect(ctx.args).toEqual({ p: 1 });
    expect(typeof ctx.latencyMs).toBe('number');
    expect(ctx.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('qualifies tool name with handle.id', async () => {
    const original = makeHandle({ id: 'mcp_abc' });
    const check = vi.fn(async () => allowDecision());
    const client: PolicyClient = {
      check,
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    await wrapped.callTool('list', {});
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'mcp_abc.list' }),
    );
  });

  it('throws on empty sidecarUrl when no client is injected', () => {
    const original = makeHandle();
    expect(() =>
      wrapMCP(original, {
        sidecarUrl: '   ',
        agentId: 'a',
        failClosed: true,
      }),
    ).toThrow(AgentGuardUnreachableError);
  });

  it('runs concurrent callTool without serialising (throughput)', async () => {
    const original = makeHandle();
    let inFlight = 0;
    let maxInFlight = 0;
    const check = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return allowDecision();
    });
    const client: PolicyClient = {
      check,
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const wrapped = wrapMCP(original, {
      sidecarUrl: 'http://x',
      agentId: 'a',
      failClosed: true,
      client,
    });
    await Promise.all([
      wrapped.callTool('a', {}),
      wrapped.callTool('b', {}),
      wrapped.callTool('c', {}),
    ]);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('filterTools fails closed (empty list) on allowed-tools HTTP error', async () => {
    const original = makeHandle({
      listTools: vi.fn(async () => ({
        tools: [{ name: 'read_file' }, { name: 'delete_file' }],
      })),
    });
    const client: PolicyClient = {
      check: async () => allowDecision(),
      health: async () => ({ ok: true, version: '1' }),
      close: () => undefined,
    };
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const prev = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const wrapped = wrapMCP(original, {
        sidecarUrl: 'http://sidecar.invalid',
        agentId: 'a',
        failClosed: true,
        filterTools: true,
        client,
      });
      const result = (await wrapped.listTools()) as { tools: unknown[] };
      expect(result.tools).toEqual([]);
    } finally {
      globalThis.fetch = prev;
    }
  });
});