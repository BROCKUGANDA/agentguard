# @agentguard/sidecar

Policy engine + tamper-evident audit server for AgentGuard.
Receives tool-call decisions from Volcano SDK agents and emits allow/deny verdicts
backed by a SHA-256 hash chain. Live WebSocket stream for the dashboard.

## Architecture

```
Agent (Volcano SDK)            Sidecar                Dashboard
        │                         │                        │
        │  POST /check            │                        │
        ├────────────────────────▶│                        │
        │   { agentId, tool,      │ engine.check()         │
        │     args, role }        │   ↓ first-match-wins   │
        │                         │ auditStore.append()    │
        │                         │ stream.broadcast() ───▶│  WS /stream
        │  { allow, ruleId, ... } │                        │
        ◀────────────────────────┤                        │
```

## Quickstart

```bash
# from repo root
npm install
npm run dev:sidecar       # tsx watch src/server.ts → :9559

# or directly
cd packages/sidecar
npm install
npm run dev
```

Env vars (all optional):

| Var | Default | Effect |
|---|---|---|
| `PORT` | `9559` | Listen port |
| `HOST` | `127.0.0.1` | Bind address |
| `AGENTGUARD_POLICY_FILE` | `../../policies/agentguard.yaml` | YAML path |
| `AGENTGUARD_AUDIT_DB` | `../data/audit.sqlite` | SQLite path |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Enable OTel export |
| `LOG_LEVEL` | `info` | Pino log level |

## HTTP API

### `GET /health`
```bash
curl http://localhost:9559/health
# {"ok":true,"version":"0.1.0","rules_loaded":5,"audit_count":42}
```

### `POST /check`
Evaluates a tool call against the loaded policy and writes an audit row.

```bash
curl -X POST http://localhost:9559/check \
  -H 'content-type: application/json' \
  -d '{"agentId":"dev","tool":"filesystem.write_file","args":{"path":"/tmp/x"}}'
# {"allow":true,"decisionId":"...","ruleId":"allow-developer-write","reason":undefined,"latencyMs":0.41}
```

### `GET /audit/recent?limit=100`
Returns the last N audit rows (DESC by id).

```bash
curl 'http://localhost:9559/audit/recent?limit=5'
```

### `GET /audit/by-agent?agentId=X&since=N`
Returns every audit row for an agent since timestamp N (ms).

```bash
curl 'http://localhost:9559/audit/by-agent?agentId=demo-agent&since=0'
```

### `POST /audit/verify`
Verifies the SHA-256 chain end-to-end.

```bash
curl -X POST http://localhost:9559/audit/verify
# {"valid":true,"count":42}
```

### `GET /policies`
Returns the raw YAML policy file.

### `POST /policies/reload`
Hot-reloads the policy from disk.

## WebSocket: `ws://localhost:9559/stream`

```js
const ws = new WebSocket('ws://localhost:9559/stream');
ws.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  // { type: 'decision' | 'violation' | 'reload' | 'hello', payload, ts }
};
```

Event types:
- `decision` — call was allowed
- `violation` — call was denied (ruleId + reason included)
- `reload` — policy file reloaded (rules_loaded included)

## Standalone audit verifier

Verify any SQLite audit DB without running the server:

```bash
npm run audit:verify -- /path/to/audit.sqlite
# {"valid":true,"count":42}
# exit 0 if valid, 1 if broken, 2 on usage/I-O error
```

## Tests

```bash
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # tsc → dist/
```

## Rule types

| Type | Purpose | Verdict logic |
|---|---|---|
| `rbac` | role-based access | rule fires if `caller role ∈ config.roles` and (optionally) `resource === caller resource` |
| `rate_limit` | per-(agent,tool) flood protection | fires DENY when bucket hits `max` within `window` |
| `time_window` | business-hours / weekend lockdown | fires ALLOW or DENY (with `invert: true`) based on wall-clock time in `tz` |
| `data_classification` | PII redaction | fires DENY when any regex matches any of the configured args fields |

Multiple conditions on one rule are AND-combined — they must all agree on the verdict
or the rule is treated as inapplicable (engine keeps walking).

## Audit chain

Each audit row carries `prev_hash` and `entry_hash`. The hash is:

```
sha256( prev_hash || canonicalJSON({
  ts, agent_id, tool, args, decision, reason, policy_id, severity
}) )
```

`canonicalJSON` sorts object keys recursively so identical payloads always hash the same.
Any post-hoc modification to a row invalidates every subsequent `entry_hash`, detectable
via `POST /audit/verify` or `npm run audit:verify`.
