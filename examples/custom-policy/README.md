# custom-policy

The minimal AgentGuard setup: **one agent, one MCP server, a hand-written custom
policy**. It shows the full policy-as-code loop:

1. custom rules fire (sandbox allowlist, `.env` guard, RBAC)
2. `POST /policies/reload` applies edits without a restart
3. `POST /audit/verify` proves the tamper-evident SHA-256 chain holds

## Run it (no LLM required)

```bash
# 1. Build the workspace (once)
npm install && npm run build

# 2. Terminal 1 — sidecar with the custom policy
cd examples/custom-policy
npx agentguard serve --policy ./policies/agentguard.yaml --audit-db ./data/audit.sqlite

# 3. Terminal 2 — policy + reload + chain smoke
npm run smoke
```

Expected: `✓ All custom-policy checks passed` — writes outside `/sandbox` and any
`.env` read are blocked by *your* rules, the policy reloads cleanly, and the
audit chain verifies.

## Author your own rule

```yaml
rules:
  - id: deny-slack-inner-circle
    description: "Nobody DMs the CEO's account"
    match:
      tool: "slack.send"
      args:
        channel: "*ceo*"
    decision: deny
    reason: "inner-circle channel is off-limits"
    conditions:
      rbac:
        role: [guest, developer, admin, reader]
        action: deny
```

Save → `curl -X POST localhost:9559/policies/reload` → live.

## Anatomy

| File | What it shows |
|---|---|
| `policies/agentguard.yaml` | Three custom rules: `.env` guard, `/sandbox` write jail, trusted-read RBAC |
| `src/index.ts` | One agent, one guarded MCP handle |
| `src/smoke.ts` | Custom-rule assertions + `reload` + `audit/verify` loop |

## Validate before deploying

```bash
npx agentguard validate ./policies/agentguard.yaml
```