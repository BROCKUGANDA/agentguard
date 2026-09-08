# multi-agent-crew

An AgentGuard example: a **coordinator orchestrating specialist sub-agents**, each
with a distinct policy role. The same tool behaves differently per role.

| Agent | Role | Can do |
|---|---|---|
| `coordinator` | admin | everything, incl. merging PRs |
| `operator` | developer | read/write files, clean email |
| `analyst` | reader | read files, list repos |
| `auditor` | auditor | read-only oversight |
| *(anyone else)* | guest | list repos only |

## Run it (no LLM required)

```bash
# 1. Build the workspace (once)
npm install && npm run build

# 2. Terminal 1 — sidecar with the crew policy
cd examples/multi-agent-crew
npx agentguard serve --policy ./policies/agentguard.yaml --audit-db ./data/audit.sqlite

# 3. Terminal 2 — deterministic role-matrix smoke
npm run smoke
```

Expected: `✓ 9 checks passed` — including *auditor cannot write*, *analyst
cannot merge a PR* but *coordinator can*.

## Run it with real agents

```bash
cp .env.example .env && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — you'll see three agents
with different roles producing different decisions for the same tools.

## Anatomy

| File | What it shows |
|---|---|
| `policies/agentguard.yaml` | Per-role RBAC, PII blocks, admin-only merges, `alerts:` block wired to a webhook |
| `src/index.ts` | Agent crew: `coordinator.then({ prompt, mcps })` delegating to role-scoped guarded handles |
| `src/smoke.ts` | The role × tool decision matrix, verified over `POST /check` |

## Multi-tenant variant

Run the sidecar in tenant mode and every crew can have its own policy file:

```bash
AGENTGUARD_TENANT_DATA_DIR=./data AGENTGUARD_TENANT_POLICY_DIR=./policies npx agentguard serve
curl -H "X-Tenant-Id: crew-a" -X POST localhost:9559/check -d '{"tool":"filesystem.read_file","agentId":"analyst","args":{"path":"/srv/x"}}'
```

The first request auto-creates `policies/crew-a.yaml` + `data/tenants/crew-a/audit.sqlite`.