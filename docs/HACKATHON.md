# AgentGuard — Problem, Solution & Technology

> AI Builders Hackathon 2026 submission · Multi-Agent Security Orchestrator for AI workflows

---

## The Problem

AI agents are now autonomous. They don't just answer questions — they **call tools**: read files, send emails, query databases, merge pull requests, delete data. Frameworks like `@volcano.dev/agent` make it trivial to give an LLM access to the entire filesystem, production databases, and external APIs.

**Nothing stops them.**

A multi-agent crew of 5 agents with access to 20 tools produces **100 possible tool-call paths per step**. One hallucinated `delete_file` call, one prompt injection that triggers `email.send` with PII, one agent that merges a PR without review — and you have a production incident.

The industry's answer so far has been:
- **Logging** (post-hoc — the damage is already done)
- **Prompt engineering** ("don't delete files") — trivially bypassed by prompt injection
- **Sandboxing** (coarse — all-or-nothing, doesn't understand tool semantics)

There is no **policy enforcement layer** that sits between the agent and the tool, evaluates every call **before** it executes, and produces a **tamper-evident audit trail** that compliance teams can verify.

---

## The Solution

**AgentGuard** is that enforcement layer.

### Architecture

```
Agent (Volcano SDK) ──► wrapMCP() ──► POST /check ──► Policy Engine
                         intercept      sidecar          RBAC + rate limit
                                                          + time window
                                                          + PII redaction
                                                              │
                                              ┌───────────────┤
                                              ▼               ▼
                                         allow + redact     deny
                                              │               │
                                              ▼               ▼
                                         tool executes    AgentGuardBlockedError
                                              │          (agent never sees the tool)
                                              ▼
                                         SHA-256 audit chain
                                              │
                                              ▼
                                         WebSocket live stream
                                              │
                                              ▼
                                         React Dashboard
```

### How it works — step by step

1. **Intercept**: `wrapMCP()` wraps any MCP handle. The agent calls `guardedFs.callTool("read_file", {path})` — the wrapper intercepts before the real tool runs.

2. **Evaluate**: The wrapper sends `POST /check` to the sidecar with the tool name, args, agent identity, and role. The policy engine evaluates rules in order: RBAC → rate limit → time window → PII classification. First match wins.

3. **Decide**: Three outcomes:
   - **Allow** — tool executes with original args
   - **Redact** — tool executes with sensitive fields masked (SSN → `[REDACTED:us_ssn]`)
   - **Deny** — `AgentGuardBlockedError` thrown, tool never invoked

4. **Audit**: Every decision (allow, deny, redact) is appended to a SHA-256 hash-chained SQLite audit log. Each entry includes the previous entry's hash — tampering breaks the chain and is detectable via `POST /audit/verify`.

5. **Stream**: The sidecar broadcasts decisions over WebSocket to the React dashboard, which shows a live feed of allows and denies with reasons, agents, tools, and timestamps.

6. **Alert**: Critical denies fire webhooks (Slack-compatible) with SSRF protection.

### Key innovation: Automatic Tool Selection

AgentGuard doesn't just block calls — it **hides disallowed tools from the LLM entirely**. When `filterTools: true` (default), `listTools()` is filtered so the LLM never sees tools its role can't call. This:
- Reduces wasted tokens on doomed calls
- Prevents the LLM from even attempting blocked operations
- Makes role-based tool visibility automatic — no prompt engineering needed

---

## Technology Used

### Core Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Agent SDK** | `@volcano.dev/agent` v1.2.0 | Volcano ADK — provides `agent()`, `llmOpenAI()`, `mcpStdio()`, and chain patterns (`.then()`, `.parallel()`, `.branch()`, `.forEach()`) |
| **Policy Engine** | Node.js + Fastify | Sub-millisecond policy evaluation, zero external deps |
| **Audit Store** | `node:sqlite` (experimental) | Built-in Node.js SQLite — no native deps, perfect for edge/serverless |
| **Dashboard** | React 18 + Vite + TailwindCSS | Real-time WebSocket feed, lazy-loaded routes, responsive |
| **Policy DSL** | YAML | Human-readable, hot-reloadable, version-controlled |
| **Observability** | OpenTelemetry | Auto-instruments policy evaluations as spans |
| **Container** | Docker (multi-arch) | `linux/amd64` + `linux/arm64`, non-root, tini, healthcheck |

### Security Controls

| Control | Implementation |
|---------|---------------|
| **RBAC** | Role-based access control — guest, reader, developer, admin |
| **Rate Limiting** | Per-agent, per-tool token bucket (configurable window) |
| **Time Windows** | Cron-like access schedules (e.g. prod DB only 09:00–17:00 UTC) |
| **PII Redaction** | Regex-based data classification — SSN, credit card, email masking |
| **Audit Chain** | SHA-256 hash-chained log — tamper-evident, verifiable |
| **SSRF Guard** | Webhook URL validation blocks loopback/private IPs |
| **Admin Auth** | Bearer token with constant-time comparison, fail-closed in production |
| **Security Headers** | CSP, HSTS, nosniff, DENY frame, Permissions-Policy |
| **PII Log Redaction** | Pino redact paths for SSN/CC/email/bearer in logs |

### Advanced Patterns (Volcano SDK)

AgentGuard supports all Volcano SDK orchestration patterns:

- **`.then()`** — sequential agent steps with automatic audit hooks
- **`.parallel()`** — concurrent batch execution with pre/post hooks (burst detection)
- **`.branch()`** — conditional fallback (e.g. if delete blocked → write to notes instead)
- **`.forEach()`** — loop over items (e.g. read multiple files in sequence)

### Multi-Agent Crews

Three crew patterns:
1. **LLM-driven crew** — coordinator delegates to role-scoped specialists
2. **Deterministic crew** — no LLM, reproducible handoff chain
3. **7-scenario demo** — all orchestration patterns in one run

Each agent gets its own role (admin, developer, reader, auditor, guest) with different tool access — enforced by policy, not prompts.

### Production Readiness

- Multi-tenant isolation (per-tenant policy + audit DB)
- Hot-reloadable policies (`POST /policies/reload`)
- Audit retention purge (configurable TTL)
- OpenTelemetry traces + metrics
- Slack webhook alerting
- CLI tools: `doctor`, `export-audit`, `audit-verify`, `mcp`
- MCP server mode (AgentGuard as a read-only MCP tool for Claude Desktop)

---

## Getting Started

```bash
# Docker (recommended)
docker compose up -d --build
# → Dashboard: http://localhost:5173
# → Sidecar:   http://localhost:9559

# Or local dev
npm install
npm run build
npm run demo    # needs OPENAI_API_KEY
```

See [README.md](../README.md) for full documentation.

---

## Team

Built for the AI Builders Hackathon 2026.