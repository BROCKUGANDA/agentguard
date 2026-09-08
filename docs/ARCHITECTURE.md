# AgentGuard Architecture

## System goals

AgentGuard is a **policy-enforcing proxy** between AI agents and the tools they call. It exists to answer three questions about every action an agent takes:

1. **Was it allowed?** (policy decision)
2. **Who, what, when, why?** (audit log)
3. **Can we prove the log wasn't tampered with?** (hash chain)

## Process topology

Three processes, each independently scalable:

```
┌─────────────────┐         HTTP          ┌─────────────────┐       WS       ┌─────────────────┐
│ Agent process   │ ────────────────────▶ │ Sidecar         │ ────────────▶ │ Dashboard       │
│ (your app)      │   POST /check         │ (Node + Fastify) │  /stream      │ (React + Vite)  │
└─────────────────┘                       └─────────────────┘               └─────────────────┘
```

The agent **never** executes a tool directly — it calls `wrapMCP(handle)` which forwards every `callTool` invocation to the sidecar first. This is the only interception point in the system.

## Why wrap MCPHandle, not the Agent class

`@volcano.dev/agent` exposes:

- ✅ `MCPHandle.callTool(name, args)` — the tool invocation primitive
- ❌ No `beforeTool` hook on the Agent class
- ⚠️ Only a post-execution `onToolCall` callback (audit only)

Wrapping `MCPHandle` is the **only** SDK-supported way to intercept calls before they execute. The wrapped handle is a drop-in replacement — the agent doesn't know it's wrapped.

## Policy decision flow

```
agent.run() ──▶ LLM picks tool from listTools()
              ──▶ LLM emits tool_call(filesystem.read_file, {path})  // mcpId-prefixed
              ──▶ framework calls guardedFs.callTool("read_file", {path})
                ├─▶ wrapMCP checks guard policy client.check({...})
                ├─▶ client POSTs to sidecar /check
                ├─▶ engine iterates rules (first-match wins)
                │     ├─ RBAC
                │     ├─ rate_limit
                │     ├─ time_window
                │     └─ data_classification
                ├─▶ decision.allow === true  → forward callTool (with redactedArgs if any)
                ├─▶ decision.allow === false → throw AgentGuardBlockedError
                └─▶ audit row written + WebSocket event broadcast
              ──▶ tool result returned to LLM (or error)
```

## Policy language

```yaml
rules:
  - id: time-window-production-db
    match:
      tool: "filesystem.delete_file"
      args: { path: "*prod*" }
    decision: deny
    conditions:
      time_window:
        tz: "UTC"
        allow: [{ start: "09:00", end: "17:00", weekdays: [mon..fri] }]
        invert: true
```

See `docs/POLICY-LANGUAGE.md` for the full grammar.

## Audit chain integrity

Every audit row stores:

```sql
prev_hash   TEXT NOT NULL   -- sha256 of previous row's canonical payload
entry_hash  TEXT NOT NULL   -- sha256(prev_hash + canonicalJSON(this row's payload))
```

Tampering with any row breaks the chain at exactly that row's `id` — verifiable in O(n) via `POST /audit/verify`.

## Failure modes

| Mode | Sidecar down | Decision |
|---|---|---|
| **fail-closed** (default) | unreachable | throw `AgentGuardUnreachableError` — agent must abort the call |
| **fail-open** | unreachable | synthetic `allow` with `policy: 'fail-open'` — agent proceeds |

Choose with `AGENTGUARD_FAIL_CLOSED=true|false` or `wrapMCP({ failClosed })`.

## Observability

The sidecar emits OTel spans:

- `agentguard.policy.evaluate` — every `/check` request
- `agentguard.audit.append` — every audit row written
- `agentguard.http.request` — every inbound HTTP request

When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, traces ship to that collector. When not, the SDK is a no-op (zero overhead).

## Why Node + Fastify?

- **Sub-millisecond routing** — Fastify is faster than Express for JSON-heavy APIs
- **Native WebSocket support** via `@fastify/websocket`
- **`node:sqlite`** — Node's built-in synchronous SQLite binding: zero native addons to compile, works on every Node ≥ 22.5 and every architecture (the append path keeps sub-millisecond latency because it's synchronous)
- **Single static binary** — `pkg` can compile the sidecar to a single executable for deployment

## Files of interest

```
packages/
  core/src/wrapMCP.ts       ← THE interception primitive
  core/src/policy-client.ts ← sidecar HTTP client
  sidecar/src/policy/engine.ts ← rule iteration + OTel
  sidecar/src/audit/chain.ts   ← sha256 hashing + verification
  sidecar/src/server.ts        ← Fastify bootstrap
  dashboard/src/components/   ← UI components
policies/agentguard.yaml     ← demo policy
demo/run.ts                  ← 90-second walkthrough
```