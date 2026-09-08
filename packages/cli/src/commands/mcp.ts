/**
 * `agentguard mcp` — run AgentGuard as an MCP server over stdio.
 *
 * Lets any MCP host (Claude Desktop, IDEs, agent frameworks) use AgentGuard
 * as a tool: the host's agent can ask "would this tool call be allowed?"
 * before acting, verify the audit chain, and inspect the active policy.
 *
 * Implements MCP 2024-11-05 JSON-RPC over stdio (initialize, tools/list,
 * tools/call). Responses are plain JSON lines — no SDK dependency.
 *
 * All tools are READ-ONLY against the sidecar: /check is POSTed as a
 * hypothetical (it does append to the audit log — that's the point: every
 * policy evaluation is recorded), but this server never reloads policies
 * or fires alerts.
 */

interface McpOptions {
  url?: string;
  token?: string;
}

const sidecarUrlOf = (o: McpOptions): string =>
  (o.url ?? process.env.AGENTGUARD_SIDECAR_URL ?? 'http://localhost:9559').replace(/\/+$/, '');

const adminTokenOf = (o: McpOptions): string | undefined =>
  o.token ?? process.env.AGENTGUARD_ADMIN_TOKEN ?? undefined;

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'agentguard_check',
    description:
      'Ask AgentGuard whether a tool call would be allowed, denied, or redacted under the current policy. ' +
      'Use this BEFORE an agent invokes risky tools (file writes, email, HTTP). ' +
      'The evaluation is recorded in the tamper-evident audit log.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Fully-qualified tool name, e.g. "filesystem.write_file"' },
        agentId: { type: 'string', description: 'Identity of the calling agent' },
        role: { type: 'string', description: 'Optional role override (developer, admin, guest…)' },
        args: {
          type: 'object',
          description: 'The tool-call arguments to evaluate',
          additionalProperties: true,
        },
        tenant: { type: 'string', description: 'Tenant id for multi-tenant sidecars (default: "default")' },
      },
      required: ['tool', 'agentId', 'args'],
    },
  },
  {
    name: 'agentguard_audit_verify',
    description: 'Verify the SHA-256 hash chain of the audit log. Proves no entry was tampered with.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string', description: 'Tenant id (default: "default")' },
      },
    },
  },
  {
    name: 'agentguard_policy_view',
    description: 'Return the active policy (rules, roles, default decision) as YAML text.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string', description: 'Tenant id (default: "default")' },
      },
    },
  },
  {
    name: 'agentguard_recent_denials',
    description: 'List recent denied tool calls from the audit log — what did the policy block lately?',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows to return (default 10, max 100)' },
        tenant: { type: 'string', description: 'Tenant id (default: "default")' },
      },
    },
  },
] as const;

// ─── Tool implementations ────────────────────────────────────────────────────
async function callTool(
  name: string,
  args: Record<string, unknown>,
  opts: McpOptions,
): Promise<string> {
  const base = sidecarUrlOf(opts);
  const tenant = typeof args.tenant === 'string' && args.tenant ? args.tenant : 'default';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-tenant-id': tenant,
  };
  const token = adminTokenOf(opts);
  if (token) headers.authorization = `Bearer ${token}`;

  if (name === 'agentguard_check') {
    const res = await fetch(`${base}/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool: args.tool,
        agentId: args.agentId,
        role: args.role,
        args: args.args ?? {},
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`sidecar HTTP ${res.status}`);
    const d = (await res.json()) as {
      allow: boolean;
      reason?: string;
      ruleId?: string;
      redactedArgs?: Record<string, unknown>;
    };
    const verdict = d.allow
      ? d.redactedArgs
        ? `ALLOW WITH REDACTION — ${d.ruleId}: ${d.reason ?? ''}\nredacted args the tool will receive: ${JSON.stringify(d.redactedArgs)}`
        : `ALLOW — ${d.ruleId ?? 'no rule'}${d.reason ? `: ${d.reason}` : ''}`
      : `DENY — ${d.ruleId ?? 'default-deny'}: ${d.reason ?? 'blocked by policy'}`;
    return verdict;
  }

  if (name === 'agentguard_audit_verify') {
    const res = await fetch(`${base}/audit/verify`, { method: 'POST', headers, signal: AbortSignal.timeout(5000) });
    if (res.status === 503) throw new Error('admin token not configured on sidecar');
    if (!res.ok) throw new Error(`sidecar HTTP ${res.status} (admin token may be required)`);
    const v = (await res.json()) as { valid?: boolean; count?: number; brokenAt?: number };
    return v.valid
      ? `Chain VALID — ${v.count ?? 0} entries verified, no tampering detected.`
      : `Chain BROKEN at entry ${v.brokenAt ?? '?'} — the audit log was modified after the fact.`;
  }

  if (name === 'agentguard_policy_view') {
    const res = await fetch(`${base}/policies`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`sidecar HTTP ${res.status}`);
    const p = (await res.json()) as { source?: string };
    return p.source ?? JSON.stringify(p);
  }

  if (name === 'agentguard_recent_denials') {
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 100);
    const res = await fetch(`${base}/audit/recent?limit=${limit}`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`sidecar HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{
      timestamp?: string;
      agent_id?: string;
      tool?: string;
      decision?: string;
      reason?: string;
    }>;
    const denies = rows.filter((r) => r.decision === 'deny');
    if (denies.length === 0) return `No denied calls in the last ${limit} audit entries.`;
    return denies
      .map((r) => `• ${r.timestamp ?? ''} ${r.agent_id} → ${r.tool}: ${r.reason ?? 'blocked'}`)
      .join('\n');
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ─── JSON-RPC over stdio ─────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function write(id: JsonRpcRequest['id'], result: unknown): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }) + '\n',
  );
}

function writeError(id: JsonRpcRequest['id'], code: number, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }) + '\n',
  );
}

export async function mcpCommand(opts: McpOptions): Promise<void> {
  let buf = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch {
        continue; // ignore malformed lines — never crash the server
      }
      void handle(req, opts).catch((err: unknown) => {
        writeError(req.id ?? null, -32603, (err as Error).message);
      });
    }
  });

  process.stdin.on('end', () => process.exit(0));

  // Keep the process alive while stdin is open.
  await new Promise<void>(() => {});
}

async function handle(req: JsonRpcRequest, opts: McpOptions): Promise<void> {
  switch (req.method) {
    case 'initialize':
      write(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agentguard', version: '0.1.0' },
      });
      return;
    case 'notifications/initialized':
      return; // notification — no response
    case 'tools/list':
      write(req.id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await callTool(name, args, opts);
        write(req.id, { content: [{ type: 'text', text }] });
      } catch (err) {
        // Tool errors are reported as isResult:false content, not JSON-RPC
        // errors, per the MCP spec.
        write(req.id, {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        });
      }
      return;
    }
    case 'ping':
      write(req.id, {});
      return;
    default:
      if (req.id !== undefined && req.id !== null) {
        writeError(req.id, -32601, `Method not found: ${req.method}`);
      }
  }
}
