import { describe, it, expect, vi } from 'vitest';
import { createHttpPolicyClient } from '../src/policy-client.js';
import { AgentGuardUnreachableError } from '../src/errors.js';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('HttpPolicyClient', () => {
  it('validates response with zod (rejects malformed)', async () => {
    const fetchImpl = mockFetch(async () =>
      new Response(JSON.stringify({ allow: 'yes' }), { status: 200 }),
    );
    const client = createHttpPolicyClient({
      sidecarUrl: 'http://sidecar',
      failClosed: true,
      fetch: fetchImpl,
    });
    await expect(
      client.check({
        tool: 'mcp.read_file',
        args: {},
        agentId: 'a',
        timestamp: Date.now(),
      }),
    ).rejects.toBeInstanceOf(AgentGuardUnreachableError);
  });

  it('returns parsed decision on valid response', async () => {
    const fetchImpl = mockFetch(async () =>
      new Response(
        JSON.stringify({
          allow: true,
          policy: 'p',
          decisionId: 'd1',
          latencyMs: 1,
          severity: 'info',
        }),
        { status: 200 },
      ),
    );
    const client = createHttpPolicyClient({
      sidecarUrl: 'http://sidecar',
      failClosed: true,
      fetch: fetchImpl,
    });
    const decision = await client.check({
      tool: 'mcp.read_file',
      args: {},
      agentId: 'a',
      timestamp: Date.now(),
    });
    expect(decision.allow).toBe(true);
    expect(decision.decisionId).toBe('d1');
  });

  it('timeout throws AgentGuardUnreachableError', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      // Honour the AbortSignal: reject when aborted.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;
    const client = createHttpPolicyClient({
      sidecarUrl: 'http://sidecar',
      failClosed: true,
      timeoutMs: 5,
      fetch: fetchImpl,
    });
    await expect(
      client.check({
        tool: 'mcp.read_file',
        args: {},
        agentId: 'a',
        timestamp: Date.now(),
      }),
    ).rejects.toBeInstanceOf(AgentGuardUnreachableError);
  });

  it('health endpoint returns version', async () => {
    const fetchImpl = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, version: '1.2.3' }), { status: 200 }),
    );
    const client = createHttpPolicyClient({
      sidecarUrl: 'http://sidecar',
      failClosed: true,
      fetch: fetchImpl,
    });
    const h = await client.health();
    expect(h).toEqual({ ok: true, version: '1.2.3' });
  });
});