# AgentGuard Audit Chain — Tamper Evidence

Every audit row is appended to a SHA-256 hash chain. Tampering with any row breaks the chain at exactly that row's `id`.

## Schema

```sql
CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  agent_id   TEXT    NOT NULL,
  tool       TEXT    NOT NULL,
  args       TEXT    NOT NULL,    -- JSON
  decision   TEXT    NOT NULL,    -- 'allow' | 'deny'
  reason     TEXT,
  policy_id  TEXT,
  severity   TEXT    NOT NULL DEFAULT 'info',
  prev_hash  TEXT    NOT NULL,
  entry_hash TEXT    NOT NULL UNIQUE
);
```

## Hash computation

```
canonical = JSON.stringify(payload, sortedKeys)   // keys sorted recursively
entry_hash = SHA-256(prev_hash || canonical)
```

`prev_hash` is the `entry_hash` of the previous row (or `0` * 64 for the first row).

## Properties

1. **Deterministic** — `canonicalJSON` sorts keys recursively, so the same logical payload always hashes the same.
2. **Chained** — changing any earlier row invalidates every later row's `prev_hash`.
3. **Detect-only** — we don't fix tampered rows, we surface `brokenAt: <id>` so an auditor knows exactly where the chain broke.
4. **Append-only** — the store uses `INSERT` and never `UPDATE`/`DELETE`. SQLite can enforce this with `PRAGMA secure_delete = ON;` and running in WAL mode (post-hackathon stretch).

## Verification

### Via HTTP

```bash
curl -X POST http://localhost:9559/audit/verify
# { "valid": true, "checkedRows": 1234 }

curl -X POST http://localhost:9559/audit/verify
# { "valid": false, "brokenAt": 42, "checkedRows": 1234 }
```

### Via CLI

```bash
npx tsx packages/sidecar/src/cli/verify-audit.ts ./data/audit.sqlite
# exit 0 → valid
# exit 1 → brokenAt: <id>
```

### Implementation

```ts
// packages/sidecar/src/audit/chain.ts
export function verifyChain(records: AuditRecord[]): { valid: boolean; brokenAt?: number } {
  let expectedPrev = '0'.repeat(64);
  for (const r of records) {
    if (r.prev_hash !== expectedPrev) return { valid: false, brokenAt: r.id };
    const payload = { ts: r.ts, agent_id: r.agent_id, tool: r.tool, args: r.args, decision: r.decision, reason: r.reason, policy_id: r.policy_id, severity: r.severity };
    const recomputed = computeEntryHash(r.prev_hash, payload);
    if (recomputed !== r.entry_hash) return { valid: false, brokenAt: r.id };
    expectedPrev = r.entry_hash;
  }
  return { valid: true };
}
```

## What this does NOT protect against

- A attacker with write access to the DB file can rewrite the entire chain (prev_hash + entry_hash for every row). Mitigations:
  - Run SQLite in append-only mode (immutable file, `chattr +i` on Linux)
  - Mirror to S3 with Object Lock (post-hackathon)
  - Mirror to a write-once remote (post-hackathon)
- Sidecar process compromise → attacker can lie about decisions. Mitigations:
  - Run sidecar as a separate process / container with reduced privileges
  - Sign decisions with an offline key (post-hackathon)

For hackathon scope, the hash chain demonstrates the principle. Production hardening is documented as stretch goals.