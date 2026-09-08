# basic-agent

An AgentGuard example: **one agent, two guarded tools** (filesystem + email), starter policy.

Every tool call is evaluated by the sidecar before it runs. The policy:

- lets `developer` read/write files, blocks `guest` from `/secrets` and deletes
- blocks any email containing an SSN or an embedded email address (PII)
- caps every agent-tool at 120 calls/minute
- denies everything else by default

## Run it (no LLM required)

```bash
# 1. Build the workspace (once)
npm install && npm run build

# 2. Terminal 1 — start the policy sidecar with THIS example's policy
cd examples/basic-agent
npx agentguard serve --policy ./policies/agentguard.yaml --audit-db ./data/audit.sqlite

# 3. Terminal 2 — run the deterministic policy smoke
npm run smoke
```

You should see every decision the policy promises: `✓ 6 checks passed`.

## Run it with a real agent

```bash
cp .env.example .env        # add OPENAI_API_KEY, or LLM_BASE_URL for a local model
npm run dev                 # the agent writes a file, then tries to email an SSN
```

Open [http://localhost:5173](http://localhost:5173) (dashboard) to watch the live
audit feed while the agent runs.

## Anatomy

| File | What it shows |
|---|---|
| `policies/agentguard.yaml` | Policy-as-code: RBAC, PII classification, rate limits, default-deny |
| `src/index.ts` | `wrapMCP(filesystemMcp, { mcpId: "filesystem", agentId: "assistant", ... })` |
| `src/smoke.ts` | LLM-free end-to-end policy verification over `POST /check` |

Key detail: `mcpId` gives your policy stable tool names (`filesystem.read_file`)
instead of the SDK's hashed handle ids (`mcp_3f9a2b1c.read_file`).