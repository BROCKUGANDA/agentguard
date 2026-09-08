# AgentGuard

> **Multi-Agent Security Orchestrator for AI Workflows**
>
> Policy-as-code guardrails for AI agent tool calls — RBAC, rate limits, time windows, PII redaction, a tamper-evident audit chain, and a real-time dashboard. Built on the [Volcano ADK](https://volcano.dev/).

AI agents are autonomous. They read files, send emails, query databases, merge pull requests. **Nothing stops them** from making a destructive call — until now.

AgentGuard sits **between your agent and the tool**. Every call is evaluated **before it executes**. Denied calls never run. Allowed calls run with optional PII redaction. Every decision is written to a SHA-256 hash-chained audit log and streamed live to a dashboard.

```
Agent (Volcano SDK)
  │
  ├─ wrapMCP(filesystemMcp)  ──► POST /check ──► Policy Engine
  ├─ wrapMCP(emailMcp)       ──► POST /check ──► RBAC + rate limit
  └─ wrapMCP(githubMcp)      ──► POST /check ──► PII redaction
                                                    │
                                          ┌─────────┤
                                          ▼         ▼
                                     allow/redact   deny
                                          │         │
                                          ▼         ▼
                                     tool runs   blocked error
                                          │
                                          ▼
                                 SHA-256 audit chain
                                          │
                                          ▼
                                 WebSocket → Dashboard
```

---

## Quick Start

### Option 1: Docker (recommended)

```bash
docker compose up -d --build
```

- **Dashboard**: http://localhost:5173
- **Sidecar API**: http://localhost:9559
- **Health check**: `curl http://localhost:9559/health`

### Option 2: Local Dev

**Prerequisites**: Node.js >= 22.5 ([download](https://nodejs.org/) or `scoop install nodejs`)

```bash
# 1. Install dependencies
npm install

# 2. Build all packages
npm run build

# 3. Start the sidecar (terminal 1)
NODE_OPTIONS=--experimental-sqlite npx tsx packages/sidecar/src/server.ts

# 4. Start the dashboard (terminal 2)
npx vite --config packages/dashboard/vite.config.ts
```

Open http://localhost:5173 in your browser.

> **Windows**: Use the included `start-dev.bat` to start both servers at once.

### Option 3: Verify the Audit Chain (no LLM needed)

```bash
# Start the sidecar
npx agentguard serve --policy ./policies/agentguard.yaml

# Run the deterministic crew smoke test
cd examples/deterministic-crew && npm run smoke
```

---

## Try It

Once the sidecar is running, send policy decisions and watch them appear live on the dashboard:

### Block a guest from reading secrets

```bash
curl -X POST http://localhost:9559/check \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: default" \
  -d '{"tool":"filesystem.read_file","agentId":"guest-bot","role":"guest","args":{"path":"/secrets/api-key"}}'
```

Response: `{"allow":false,"reason":"guest role denied access to secrets",...}`

### Redact PII from an email

```bash
curl -X POST http://localhost:9559/check \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: default" \
  -d '{"tool":"email.send","agentId":"demo-agent","role":"developer","args":{"to":"hr@x.com","subject":"SSN 123-45-6789 attached"}}'
```

Response: `{"allow":true,"reason":"PII redacted from email payload","redactedArgs":{"subject":"SSN [REDACTED:us_ssn] attached",...}}`

### Verify the audit chain

```bash
curl -X POST http://localhost:9559/audit/verify \
  -H "X-Tenant-Id: default"
```

Response: `{"valid":true,"count":58,"verified":true,...}`

---

## Embed in Your Agent

```bash
npm install @agentguard/core
```

```ts
import { agent, llmOpenAI, mcpStdio } from "@volcano.dev/agent";
import { wrapMCP } from "@agentguard/core";

// Wrap any MCP handle — every tool call goes through the sidecar first
const guardedFs = wrapMCP(filesystemMcp, {
  sidecarUrl: "http://localhost:9559",
  mcpId: "filesystem",
  agentId: "my-agent",
  agentRole: "developer",        // RBAC role
  failClosed: true,              // deny when sidecar unreachable
  filterTools: true,             // hide disallowed tools from the LLM (default)
});

// Use it normally — the guard is transparent
const result = await agent({ llm: llmOpenAI({ apiKey }), name: "my-agent" })
  .then({ prompt: "Write a report to /tmp/report.md", mcps: [guardedFs] })
  .run();
```

### Automatic Tool Selection

When `filterTools: true` (default), `listTools()` is filtered so the LLM **only sees tools its role can call**. A guest agent never sees `delete_file`. A reader never sees `merge_pull_request`. This saves tokens and prevents wasted attempts.

---

## Policy Language

Policies are plain YAML — no DSL to learn. Hot-reloadable without restart.

```yaml
version: "1"
default: deny                    # zero-trust: explicit allow required

agents:
  "*":          { role: guest }
  "coordinator": { role: admin }
  "developer":  { role: developer }
  "auditor":    { role: reader }

rules:
  - id: guest-cannot-read-secrets
    match: { tool: "filesystem.read_file", args: { path: "*secrets*" } }
    decision: deny
    conditions: { rbac: { role: guest, action: deny } }

  - id: pii-redact-email
    match: { tool: "email.send" }
    decision: redact             # allow but mask PII
    conditions:
      data_classification:
        patterns:
          - { name: us_ssn, regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b" }
        match_on: ["args.subject", "args.body"]

  - id: prod-db-only-business-hours
    match: { tool: "filesystem.delete_file", args: { path: "*prod*" } }
    decision: deny
    conditions:
      time_window: { tz: UTC, allow: [{ start: "09:00", end: "17:00" }] }
```

Rule types: **RBAC** | **rate_limit** | **time_window** | **data_classification** (deny or redact)

---

## Features

| Feature | Description |
|---------|-------------|
| **Policy enforcement** | Every tool call evaluated before execution — allow, deny, or redact |
| **Automatic tool selection** | LLM only sees tools its role can call (`filterTools`) |
| **RBAC** | Role-based access control — guest, reader, developer, admin |
| **Rate limiting** | Per-agent, per-tool token bucket |
| **Time windows** | Schedule-based access (e.g. prod DB only 09:00-17:00 UTC) |
| **PII redaction** | SSN, credit card, email masking — raw PII never touches disk |
| **Audit chain** | SHA-256 hash-chained log — tamper-evident, verifiable |
| **Real-time dashboard** | WebSocket live feed, KPIs, agent status, policy viewer |
| **Multi-agent crews** | `.then()`, `.parallel()`, `.branch()`, `.forEach()` orchestration |
| **Multi-tenant** | Per-tenant policy + audit DB isolation |
| **Alerting** | Slack webhook on critical denies (SSRF-guarded) |
| **Observability** | OpenTelemetry traces + metrics |
| **MCP server mode** | AgentGuard as a read-only MCP tool for Claude Desktop |

---

## Multi-Agent Crews

AgentGuard supports all Volcano SDK orchestration patterns:

```ts
// Sequential
await agent({ llm, name: "crew" })
  .then({ prompt: "Read report.csv", mcps: [guardedFs] })
  .then({ prompt: "Email summary", mcps: [guardedEmail] })
  .run();

// Parallel batch
await agent({ llm, name: "crew" })
  .parallel([
    { prompt: "Write logs", mcps: [guardedFs] },
    { prompt: "Write metrics", mcps: [guardedFs] },
  ])
  .run();

// Conditional fallback
await agent({ llm, name: "crew" })
  .branch(
    (history) => !history.some(h => h.failed),
    { true: (a) => a.then({ prompt: "Delete temp", mcps: [guardedFs] }),
      false: (a) => a.then({ prompt: "Log blocked", mcps: [guardedFs] }) }
  )
  .run();
```

Each agent gets its own role with different tool access — enforced by policy, not prompts.

---

## Production Ready

```bash
# .env
AGENTGUARD_ADMIN_TOKEN=$(openssl rand -base64 32)     # protect admin routes
AGENTGUARD_SLACK_WEBHOOK=https://hooks.slack.com/...   # critical-deny alerts
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel:4318           # traces + metrics
```

- **Docker**: multi-arch (`amd64` + `arm64`), non-root user, `tini`, healthcheck
- **Hardened**: CSP, HSTS, nosniff, 1MB body cap, per-IP rate limit, SSRF guard, PII log scrubbing
- **Fail closed**: `NODE_ENV=production` + no admin token → admin routes refuse (503)
- **Zero native deps**: uses Node's built-in `node:sqlite` — no compilation needed
- **Hot-reload**: `curl -X POST localhost:9559/policies/reload` — zero downtime

---

## CLI

```bash
npx agentguard init my-project --template gdpr    # scaffold a project
npx agentguard serve --policy ./policies/agentguard.yaml  # start sidecar
npx agentguard validate policies/*.yaml           # lint policy
npx agentguard doctor                             # pre-flight check
npx agentguard audit-verify ./data/audit.sqlite   # verify hash chain
npx agentguard export-audit ./data/audit.sqlite   # compliance export
npx agentguard mcp                                # run as MCP server
```

---

## Examples

| Example | Shows |
|---------|-------|
| [`basic-agent`](examples/basic-agent) | One agent, filesystem + email, starter policy |
| [`multi-agent-crew`](examples/multi-agent-crew) | Coordinator + specialists, per-role RBAC matrix |
| [`deterministic-crew`](examples/deterministic-crew) | No-LLM crew handoff (reproducible) |
| [`custom-policy`](examples/custom-policy) | Custom rules + hot-reload + chain verify |

---

## Project Structure

```
packages/core      wrapMCP() interceptor + policy client
packages/sidecar    Policy engine, audit chain, alerts, WebSocket, multi-tenant
packages/dashboard  React UI — live feed, audit chain, policies, agents
packages/cli        init · serve · validate · audit-verify · doctor · export-audit · mcp
policies/           Default policy (hot-reloadable YAML)
demo/               Demo MCP servers + 7-scenario multi-agent demo
examples/           Example projects with smoke tests
docs/               Documentation
```

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design and data flow
- [Policy Language](docs/POLICY-LANGUAGE.md) — rule types and conditions
- [Audit Chain](docs/AUDIT-CHAIN.md) — SHA-256 hash chain verification
- [Hackathon](docs/HACKATHON.md) — problem, solution, and technology used

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent SDK | `@volcano.dev/agent` v1.2.0 (Volcano ADK) |
| Policy Engine | Node.js + Fastify |
| Audit Store | `node:sqlite` (built-in, zero native deps) |
| Dashboard | React 18 + Vite + TailwindCSS |
| Observability | OpenTelemetry |
| Container | Docker multi-arch (`linux/amd64` + `linux/arm64`) |

---

## License

MIT
