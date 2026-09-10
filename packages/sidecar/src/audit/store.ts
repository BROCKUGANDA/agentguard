import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  computeEntryHash,
  GENESIS_HASH,
  type AuditRecord,
  type Severity,
} from './chain.js';
import { SqliteDb } from './sqlite.js';

export interface AppendInput {
  ts: number;
  agent_id: string;
  tool: string;
  args: Record<string, unknown>;
  decision: 'allow' | 'deny';
  reason?: string;
  policy_id?: string;
  severity?: Severity;
}

interface Row {
  id: number;
  ts: number;
  agent_id: string;
  tool: string;
  args: string;
  decision: 'allow' | 'deny';
  reason: string | null;
  policy_id: string | null;
  severity: Severity;
  prev_hash: string;
  entry_hash: string;
}

function rowToRecord(r: Row): AuditRecord {
  return {
    id: r.id,
    ts: r.ts,
    agent_id: r.agent_id,
    tool: r.tool,
    args: JSON.parse(r.args) as Record<string, unknown>,
    decision: r.decision,
    reason: r.reason ?? undefined,
    policy_id: r.policy_id ?? undefined,
    severity: r.severity,
    prev_hash: r.prev_hash,
    entry_hash: r.entry_hash,
  };
}

/**
 * SQLite-backed audit log with SHA-256 hash chaining.
 *
 * Atomic append: BEGIN IMMEDIATE → read last entry_hash → compute new hash →
 * INSERT → COMMIT. The BEGIN IMMEDIATE prevents two writers from both seeing
 * the same prev_hash and forging a fork.
 *
 * The DB is single-writer by design (sidecar process). Reads are non-blocking.
 *
 * Backed by Node's built-in `node:sqlite` (see ./sqlite.ts) — no native
 * addons, so the audit log works on any Node ≥ 22.5 without compilation.
 */
export class AuditStore {
  private readonly db: SqliteDb;

  constructor(dbPath: string) {
    const abs = resolve(dbPath);
    mkdirSync(dirname(abs), { recursive: true });
    this.db = new SqliteDb(abs);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  /** Expose the underlying sqlite handle for sibling stores (e.g. AlertDispatcher). */
  raw(): SqliteDb {
    return this.db;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        policy_id TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS audit_agent_ts ON audit(agent_id, ts);
      CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
      CREATE TABLE IF NOT EXISTS audit_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * Append a record. Computes prev_hash from the current chain tip and
   * derives a new entry_hash atomically. Returns the persisted record.
   */
  append(rec: AppendInput): AuditRecord {
    const result = this.db.transactionImmediate(() => {
      const last = this.db
        .prepare('SELECT entry_hash FROM audit ORDER BY id DESC LIMIT 1')
        .get() as { entry_hash: string } | undefined;
      const prev = last?.entry_hash ?? GENESIS_HASH;

      const payload = {
        ts: rec.ts,
        agent_id: rec.agent_id,
        tool: rec.tool,
        args: rec.args,
        decision: rec.decision,
        reason: rec.reason,
        policy_id: rec.policy_id,
        severity: rec.severity ?? 'info',
      };
      const entryHash = computeEntryHash(prev, payload);

      const info = this.db
        .prepare(
          `INSERT INTO audit
           (ts, agent_id, tool, args, decision, reason, policy_id, severity, prev_hash, entry_hash)
           VALUES (@ts, @agent_id, @tool, @args, @decision, @reason, @policy_id, @severity, @prev_hash, @entry_hash)`
        )
        .run({
          ts: rec.ts,
          agent_id: rec.agent_id,
          tool: rec.tool,
          args: JSON.stringify(rec.args),
          decision: rec.decision,
          reason: rec.reason ?? null,
          policy_id: rec.policy_id ?? null,
          severity: rec.severity ?? 'info',
          prev_hash: prev,
          entry_hash: entryHash,
        });

      return {
        id: Number(info.lastInsertRowid),
        prev_hash: prev,
        entry_hash: entryHash,
        severity: payload.severity,
      };
    });

    return {
      id: result.id,
      ts: rec.ts,
      agent_id: rec.agent_id,
      tool: rec.tool,
      args: rec.args,
      decision: rec.decision,
      reason: rec.reason,
      policy_id: rec.policy_id,
      severity: result.severity as Severity,
      prev_hash: result.prev_hash,
      entry_hash: result.entry_hash,
    };
  }

  recent(limit: number): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as Row[];
    return rows.map(rowToRecord);
  }

  /**
   * Cursor-based pagination: return up to `limit` rows with id < `beforeId`
   * (or the most recent rows when `beforeId` is null). Returns items + the
   * next cursor (id of the last item, or null if exhausted) + total count.
   */
  recentPaginated(limit: number, beforeId?: number): {
    items: AuditRecord[];
    nextCursor: number | null;
    total: number;
  } {
    const rows: Row[] = beforeId
      ? (this.db
          .prepare('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?')
          .all(beforeId, limit) as unknown as Row[])
      : (this.db
          .prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?')
          .all(limit) as unknown as Row[]);
    const items = rows.map(rowToRecord);
    const total = this.count();
    const nextCursor =
      items.length === limit && items.length < total
        ? items[items.length - 1].id
        : null;
    return { items, nextCursor, total };
  }

  byAgent(agentId: string, since: number): AuditRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit WHERE agent_id = ? AND ts >= ? ORDER BY id ASC')
      .all(agentId, since) as unknown as Row[];
    return rows.map(rowToRecord);
  }

  /** Return every record, ascending — for chain verification. */
  all(): AuditRecord[] {
    const rows = this.db.prepare('SELECT * FROM audit ORDER BY id ASC').all() as unknown as Row[];
    return rows.map(rowToRecord);
  }

  count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM audit').get() as { n: number };
    return r.n;
  }

  /** Count rows by decision — O(1) index scan, no row payload loaded. */
  countByDecision(): { allow: number; deny: number } {
    const rows = this.db
      .prepare('SELECT decision, COUNT(*) AS n FROM audit GROUP BY decision')
      .all() as Array<{ decision: string; n: number }>;
    let allow = 0;
    let deny = 0;
    for (const r of rows) {
      if (r.decision === 'allow') allow = r.n;
      else deny += r.n;
    }
    return { allow, deny };
  }

  /** Per-agent stats for the window [windowStart, now] — SQL aggregation. */
  agentStats(windowStart: number): Array<{
    agent_id: string;
    callsLastHour: number;
    blocksLastHour: number;
    lastTs: number;
    lastDecision: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT agent_id,
                SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS calls_last_hour,
                SUM(CASE WHEN ts >= ? AND decision = 'deny' THEN 1 ELSE 0 END) AS blocks_last_hour,
                MAX(ts) AS last_ts
         FROM audit
         GROUP BY agent_id`
      )
      .all(windowStart, windowStart) as Array<{
        agent_id: string;
        calls_last_hour: number;
        blocks_last_hour: number;
        last_ts: number | null;
      }>;
    // lastDecision needs a follow-up per agent (SQLite can't argmax in one pass).
    return rows.map((r) => ({
      agent_id: r.agent_id,
      callsLastHour: r.calls_last_hour ?? 0,
      blocksLastHour: r.blocks_last_hour ?? 0,
      lastTs: r.last_ts ?? 0,
      lastDecision: r.last_ts != null ? this.lastDecisionFor(r.agent_id) : 'allow',
    }));
  }

  private lastDecisionFor(agentId: string): string {
    const r = this.db
      .prepare('SELECT decision FROM audit WHERE agent_id = ? ORDER BY ts DESC LIMIT 1')
      .get(agentId) as { decision: string } | undefined;
    return r?.decision ?? 'allow';
  }

  /**
   * Delete rows older than `beforeTs`, then re-root the remaining chain so
   * the new first row has a genesis `prev_hash` and every subsequent
   * `entry_hash` is recomputed. Without re-rooting, retention purges leave
   * the head pointing at a deleted row and `verifyChain` always reports a
   * false tamper. The purge epoch is recorded in `audit_meta`.
   */
  purgeBefore(beforeTs: number): number {
    const r = this.db.prepare('DELETE FROM audit WHERE ts < ?').run(beforeTs);
    if (r.changes > 0) {
      this.rechainFromHead();
      const prevEpoch = Number(
        (this.db.prepare(`SELECT value FROM audit_meta WHERE key = 'purge_epoch'`).get() as
          | { value: string }
          | undefined)?.value ?? '0',
      );
      this.db
        .prepare(
          `INSERT INTO audit_meta (key, value) VALUES ('purge_epoch', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(String(prevEpoch + 1));
    }
    return r.changes;
  }

  /** Rebuild hashes from the current head so the remaining chain is contiguous. */
  private rechainFromHead(): void {
    this.db.transactionImmediate(() => {
      const rows = this.db
        .prepare('SELECT id, ts, agent_id, tool, args, decision, reason, policy_id, severity FROM audit ORDER BY id ASC')
        .all() as Array<{
          id: number;
          ts: number;
          agent_id: string;
          tool: string;
          args: string;
          decision: string;
          reason: string | null;
          policy_id: string | null;
          severity: Severity;
        }>;
      let prev = GENESIS_HASH;
      for (const row of rows) {
        const payload = {
          ts: row.ts,
          agent_id: row.agent_id,
          tool: row.tool,
          args: JSON.parse(row.args) as Record<string, unknown>,
          decision: row.decision,
          reason: row.reason ?? undefined,
          policy_id: row.policy_id ?? undefined,
          severity: row.severity,
        };
        const entryHash = computeEntryHash(prev, payload);
        this.db
          .prepare('UPDATE audit SET prev_hash = ?, entry_hash = ? WHERE id = ?')
          .run(prev, entryHash, row.id);
        prev = entryHash;
      }
    });
  }

  /** Number of retention re-roots performed (0 = never purged). */
  purgeEpoch(): number {
    const row = this.db.prepare(`SELECT value FROM audit_meta WHERE key = 'purge_epoch'`).get() as
      | { value: string }
      | undefined;
    return Number(row?.value ?? '0');
  }

  /** Vacuum to reclaim space after purges. */
  vacuum(): void {
    this.db.exec('VACUUM');
  }

  close(): void {
    this.db.close();
  }
}
