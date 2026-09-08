# 🛡️ AgentGuard

> Multi-Agent Security Orchestrator for AI Workflows — policy-as-code guardrails for [@volcano.dev/agent](https://volcano.dev/) MCP tool calls, with PII redaction, a tamper-evident audit chain, a real-time dashboard, and an MCP server mode.

Every tool call your agent makes is evaluated **before it executes**: RBAC, rate limits, time windows, PII redaction. Decisions are written to a SHA-256 hash-chained audit log. The dashboard streams them live. The agent *cannot* bypass it — the guard sits between the agent and the tool.

```
┌──────────────────────────────────────────────────────────────┐
│ Agent (@volcano.dev/agent)                                   │
│   guardedFs    = wrapMCP(filesystemMcp, { mcpId, agentId })  │
│   guardedEmail = wrapMCP(emailMcp,     { mcpId, agentId })   │
└───────────────────────────┬──────────────────────────────────┘
                            │ POST /check (every tool call)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ AgentGuard sidecar (Node + Fastify)  · multi-tenant           │
│  /check          policy decision → allow | deny | redact      │
│  /audit/recent · /audit/verify      hash-chained SQLite      │
│  /policies  GET/POST reload         policy-as-code hot swap  │
│  /tenants                          per-tenant isolation      │
│  WS /stream                        live events → dashboard   │
└──────────────┬───────────────────────────────┬───────────────┘
               │ WebSocket                     │ same-origin /api
               ▼                               ▼
┌────────────────────────────────────────────┐
│ Dashboard (React + Vite, :5173)             │
│  Live feed · Audit chain · Policies · Agents│
└────────────────────────────────────────────┘
```

---

## 🚀 Run in 60 seconds (Docker)

The image runs **both** the sidecar and the dashboard in one container, multi-arch (`linux/amd64` + `linux/arm64`), with healthchecks and a non-root user.

```bash
docker compose up -d --build

# dashboard → http://localhost:5173
# sidecar   → http://localhost:9559  (curl http://localhost:9559/health)
```

Send a test decision from another terminal (the container runs in multi-tenant
mode — scope it with `X-Tenant-Id`, `default` works out of the box):

```bash
curl -X POST http://localhost:9559/check \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: default" \
  -d '{"tool":"email.send","agentId":"demo-agent","role":"developer","args":{"to":"hr@x.com","subject":"SSN 123-45-6789"}}'
# → {"allow":true,"reason":"PII redacted from email payload",
#    "redactedArgs":{"subject":"SSN [REDACTED:us_ssn] attached", ...}}
```

Refresh the dashboard — the redact decision is in the live feed with the **masked** args (the raw SSN never reaches disk), and clicking **Audit → Verify** proves the chain.

**Multi-tenant by default.** Every `X-Tenant-Id` header gets its own policy file and audit DB, auto-provisioned on first request:

```bash
curl -X POST http://localhost:9559/check -H "X-Tenant-Id: acme" \
  -d '{"tool":"filesystem.read_file","agentId":"bot","args":{"path":"/tmp/x"}}'
# creates policies/acme.yaml + data/tenants/acme/audit.sqlite
```

The dashboard switches tenants in **Settings → Tenant**.

---

## 🔌 Embed in your agent (npm install)

```bash
npm install @agentguard/core
```

Wrap any MCP handle — every tool call goes through the sidecar first:

```ts
import { agent, llmOpenAI, mcpStdio } from "@volcano.dev/agent";
import { wrapMCP } from "@agentguard/core";

const guardedFs = wrapMCP(filesystemMcp, {
  sidecarUrl: "http://localhost:9559",
  mcpId: "filesystem",                       // policy-friendly tool name
  agentId: "my-agent",
  agentRole: "developer",
  failClosed: true,                          // deny when sidecar unreachable
  onDecision: (d, ctx) => console.log(d.allow ? "✅" : "🚫", ctx.toolName),
});

const result = await agent({ llm: llmOpenAI({ apiKey }), name: "my-agent" })
  .then({ prompt: "Write a report to /tmp/report.md", mcps: [guardedFs] })
  .run();
```

> `mcpId` maps the SDK's hashed handle ids (`mcp_3f9a2b1c.read_file`) to
> stable names your policy can match (`filesystem.read_file`).

**Policy** (`policies/agentguard.yaml`) is plain YAML — no DSL to learn:

```yaml
version: "1"
default: deny
agents:
  "*":      { role: guest }
  "my-agent": { role: developer }
rules:
  - id: pii-block-email
    match: { tool: "email.send" }
    decision: deny
    reason: "PII detected in payload"
    conditions:
      data_classification:
        patterns:
          - { name: us_ssn, regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b" }
        match_on: ["args.subject", "args.body"]
```

Rule types: **RBAC** roles · **rate_limit** · **time_window** · **data_classification** (PII deny **or redact**). See [`docs/POLICY-LANGUAGE.md`](docs/POLICY-LANGUAGE.md).

### Redact: allow the call, mask the PII

`decision: redact` lets the email go out — but matched patterns are stripped first, and `wrapMCP` transparently substitutes the masked args. The audit trail records the masked version, so raw PII never touches disk:

```yaml
  - id: pii-redact-email
    match:
      tool: "email.send"
    decision: redact               # not deny — mask and allow
    reason: "PII redacted from email payload"
    conditions:
      data_classification:
        patterns:
          - name: us_ssn
            regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
        match_on: ["args.subject", "args.body"]
        replacement: "[REDACTED]"   # optional; default [REDACTED:<name>]
```

## Scaffold a whole project

```bash
npx agentguard init my-agent --template gdpr        # starter | gdpr | finance-pii |
cd my-agent                                        #   healthcare-hipaa | dev-strict |
cp .env.example .env                               #   prod-permissive
npx agentguard serve --policy ./policies/agentguard.yaml
npm run dev
```

```bash
npx agentguard templates                 # list built-in policy templates
npx agentguard validate policies/*.yaml  # lint policy YAML
npx agentguard audit-verify ./data/audit.sqlite   # verify the hash chain
npx agentguard doctor                    # env + policy + sidecar + chain + security posture
npx agentguard export-audit ./data/audit.sqlite --out ./evidence   # compliance export
```

### `agentguard doctor` — pre-flight check

```
🛡️  AgentGuard doctor
  ✓ Node.js version  — v24.4.1 (node:sqlite available)
  ✓ Policy file (policies/agentguard.yaml)  — valid — 9 rules, default: deny
  ✓ Sidecar (http://localhost:9559)  — v0.1.0 · 9 rules · 3 audit entries
  ⊘ Audit DB (./data/audit.sqlite)  — not created yet (appears after the first /check)
  ⚠ Admin token (AGENTGUARD_ADMIN_TOKEN)  — not set — admin routes open in dev
```

### `agentguard export-audit` — compliance evidence

Exports the audit log as JSONL plus a summary with per-agent/per-tool
breakdowns, chain verification, and a SHA-256 receipt of the export itself —
auditors can prove the evidence file wasn't altered after generation.

### `agentguard mcp` — use AgentGuard from Claude Desktop & any MCP host

AgentGuard runs as an MCP server over stdio, exposing four read-only tools:
`agentguard_check` (would this call be allowed/denied/redacted?), 
`agentguard_audit_verify`, `agentguard_policy_view`, `agentguard_recent_denials`.
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentguard": {
      "command": "npx",
      "args": ["agentguard", "mcp"],
      "env": { "AGENTGUARD_SIDECAR_URL": "http://localhost:9559" }
    }
  }
}
```

Your AI assistant can now consult the policy engine *before* invoking risky
tools — and every consultation lands in the same tamper-evident audit log.

---

## 🏭 Deploy to production

`docker compose up` IS the production shape — persistent audit volume, hot-reloadable policy mount, restart policy, healthcheck, capped logs. Production knobs:

```bash
# .env
AGENTGUARD_ADMIN_TOKEN=$(openssl rand -base64 32)  # protect /policies/reload,
                                                   # /alerts/recent, /alerts/test-fire
AGENTGUARD_SLACK_WEBHOOK=https://hooks.slack.com/services/...  # critical-deny alerts
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel:4318       # traces + metrics
```

- **Multi-arch**: `npm run docker:build:multiarch` (`docker buildx --platform linux/amd64,linux/arm64`)
- **Hardened**: non-root `agentguard` user, `tini` signals, OWASP headers, CSP, 1 MB body cap, per-IP rate limit (600/min) on every route, webhook SSRF guard, PII scrubbed from logs, errors and the audit store at rest.
- **Fail closed**: with `NODE_ENV=production` and no `AGENTGUARD_ADMIN_TOKEN`, admin routes refuse to serve (503) instead of opening to the internet.
- **Zero native deps**: the audit chain runs on Node's built-in `node:sqlite` — `npm install` never compiles anything, on any Node ≥ 22.5 / any architecture.
- **Policy ops**: edit `policies/*.yaml` → `curl -X POST localhost:9559/policies/reload` — zero downtime.
- **Tenant isolation**: per-tenant policies, audit DBs, engines and alert dispatchers; a rogue tenant header can never touch another tenant's data.

---

## Examples (`examples/`)

| Example | Shows |
|---|---|
| [`basic-agent`](examples/basic-agent) | One agent, filesystem + email, starter policy · `npm run smoke` |
| [`multi-agent-crew`](examples/multi-agent-crew) | Coordinator + specialists, per-role decision matrix · `npm run smoke` |
| [`deterministic-crew`](examples/deterministic-crew) | No-LLM crew handoff: coordinator → researcher → writer → reviewer · `npm run smoke` |
| [`custom-policy`](examples/custom-policy) | Hand-written rules + hot-reload + chain verify · `npm run smoke` |

```bash
npm install && npm run build
npx agentguard serve --policy examples/basic-agent/policies/agentguard.yaml
(cd examples/basic-agent && npm run smoke)
```

## Packages

| Path | Role |
|---|---|
| `packages/core` | `wrapMCP()` interceptor + typed policy client (`mcpId`, `failClosed`, redaction substitution) |
| `packages/sidecar` | Policy engine, multi-tenant manager, audit chain, alerts, WebSocket |
| `packages/dashboard` | React UI — live feed, audit chain, policies, agents, tenant switcher |
| `packages/cli` | `init` · `serve` · `validate` · `audit-verify` · `templates` · `doctor` · `export-audit` · `mcp` |
| `policies/agentguard.yaml` | Default policy (hot-reloadable) |
| `demo/` | Demo MCP servers + 7-scenario multi-agent demo |

### Demo MCP servers (`demo/mcp-*`)

| Server | Transport | Tools |
|---|---|---|
| `mcp-filesystem` | stdio | `read_file`, `write_file`, `delete_file` (sandboxed) |
| `mcp-email` | stdio | `send` (email simulation) |
| `mcp-github` | stdio | `list_repos`, `create_issue`, `merge_pull_request` |
| `mcp-database` | stdio | `query` (SELECT), `execute` (DML) |
| `mcp-slack` | stdio | `send_message`, `list_channels` (stub) |
| `mcp-http` | HTTP (`/mcp`) | `http_get`, `http_post` (remote MCP demo) |

### Demo prerequisites

The multi-agent demo (`demo/run.ts`) uses a local LLM for orchestration:

```bash
# 1. Start a local LLM (llama-server with qwen2.5-1.5b)
llama-server -m qwen2.5-1.5b-instruct-q4_k_m.gguf --port 8080

# 2. Start the AgentGuard sidecar
npm run dev:sidecar

# 3. Run the demo (7 scenarios across 4 orchestration patterns)
npm run demo
```

For a no-LLM check, use the deterministic crew smoke test:

```bash
npx agentguard serve --policy ./policies/agentguard.yaml
(cd examples/deterministic-crew && npm run smoke)
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/POLICY-LANGUAGE.md`](docs/POLICY-LANGUAGE.md) · [`docs/AUDIT-CHAIN.md`](docs/AUDIT-CHAIN.md) · [`docs/DEMO.md`](docs/DEMO.md) · [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)

## License

MIT