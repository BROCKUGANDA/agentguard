# AgentGuard — 90-Second Demo Walkthrough

## Setup

```bash
# terminal 1 — start the policy + audit sidecar
npm run dev:sidecar

# terminal 2 — start the dashboard
npm run dev:dashboard

# terminal 3 — run the demo
OPENAI_API_KEY=sk-... npm run dev:demo
```

Open `http://localhost:5173` to see the dashboard live.

## The three prompts

### 1. ✅ Allowed: delete temp.log

The agent uses the filesystem MCP to delete a file. Inside business hours, the `time-window-production-db` rule does NOT match (`*prod*` glob), so the call proceeds.

Console output:

```
▶ 1. Allowed: delete temp.log (inside business hours)
  [policy] ✅ ALLOW filesystem.delete_file 0.8ms
  [tool]   filesystem.delete_file({"path":"temp.log"}) -> {"ok":true}
  Final agent output: I have successfully deleted temp.log.
```

Dashboard: green tick in the live feed, KPI counter increments "allowed".

### 2. 🚫 Blocked: delete prod.db (time-window)

The agent tries to delete a file matching `*prod*`. Outside the configured business hours (or — for demo simplicity — the rule is configured with `invert: true` matching always), the `time-window-production-db` rule denies.

Console output:

```
▶ 2. Blocked: delete prod.db (time-window: outside 09:00–17:00 UTC)
  [policy] 🚫 DENY  filesystem.delete_file (time-window-production-db) Production DB delete blocked outside 09:00–17:00 UTC 1.2ms
🛡️  BLOCKED by AgentGuard
    policy : time-window-production-db
    reason : Production DB delete blocked outside 09:00–17:00 UTC
```

Dashboard: red banner with shake animation, KPI counter increments "blocked", audit row appears with `prev_hash` link.

### 3. 🚫 Blocked: email contains SSN (PII redaction)

The agent tries to send an email. The `pii-redact-email` rule scans `args.subject` and `args.body` for the SSN regex `\b\d{3}-\d{2}-\d{4}\b`. Match found → deny.

Console output:

```
▶ 3. Blocked: email contains SSN (PII redaction rule)
  [policy] 🚫 DENY  email.send (pii-redact-email) PII detected in email payload 1.5ms
🛡️  BLOCKED by AgentGuard
    policy : pii-redact-email
    reason : PII detected in email payload
```

Dashboard: red row in LiveFeed, "PII detected: us_ssn in args.body" detail, severity: critical badge.

## Inspect the audit chain

After the demo, verify integrity:

```bash
curl -X POST http://localhost:9559/audit/verify
# { "valid": true, "checkedRows": 7 }
```

Or click the **Verify Chain** button in the dashboard's `/audit` page.

## Hot-reload a policy

Edit `policies/agentguard.yaml`, then:

```bash
curl -X POST http://localhost:9559/policies/reload
# { "ok": true, "rules_loaded": 5 }
```

The dashboard will broadcast a `reload` event. The next tool call uses the new rules.

## What judges see

1. **Real policy enforcement** — three distinct rules fire, each with a different rule type (time-window, data-class, RBAC)
2. **Tamper-evident logs** — every row has `prev_hash` + `entry_hash`, verified end-to-end
3. **Real-time observability** — dashboard updates via WebSocket as decisions happen
4. **Production-ready architecture** — three independent processes, zero-trust default, fail-closed mode
5. **Hackathon polish** — full design system, smooth animations, dark mode