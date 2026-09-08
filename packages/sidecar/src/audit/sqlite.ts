/**
 * Minimal SQLite adapter over Node's built-in `node:sqlite`.
 *
 * Why: `better-sqlite3` is a native module — its prebuilt binaries constantly
 * lag Node releases (e.g. no ABI-147 build for Node 26), breaking `npm install`
 * and Docker builds on fresh Node versions. `node:sqlite` ships with Node ≥
 * 22.5 (flagged experimental, stable in practice since 23) and covers
 * everything AgentGuard needs.
 *
 * The adapter exposes a `better-sqlite3`-like surface:
 *   - `exec(sql)`                    — run raw SQL (no params)
 *   - `prepare(sql).run/all/get`     — named (@name) and positional (?) params
 *   - `transaction(fn)`              — synchronous tx with BEGIN IMMEDIATE
 *   - `pragma(str)`                  — same call shape as better-sqlite3
 *   - `close()`                      — idempotent
 *
 * Notes vs better-sqlite3:
 *   - `this.hits`-style property bags are NOT supported; always pass a params
 *     object or an array.
 *   - `node:sqlite` throws on empty parameter sets in some versions — the
 *     adapter defends with `.run()`/`.all()` overloads that omit params.
 */

import { DatabaseSync } from 'node:sqlite';

export type SqlParam = string | number | bigint | Uint8Array | null;

export interface StatementResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** Suppress the node:sqlite experimental warning — it fires on every process start. */
function silenceExperimentalWarning(): void {
  const orig = process.emitWarning;
  if ((orig as unknown as { __agentguardPatched?: boolean }).__agentguardPatched) return;
  const patched = (warning: string | Error, ...args: unknown[]) => {
    if (typeof warning === 'string' && warning.includes('SQLite is an experimental feature')) {
      return undefined;
    }
    return (orig as (w: string | Error, ...a: unknown[]) => void)(warning, ...args);
  };
  (patched as unknown as { __agentguardPatched: boolean }).__agentguardPatched = true;
  process.emitWarning = patched as typeof process.emitWarning;
}

export class SqliteDb {
  private db: DatabaseSync;
  private closed = false;

  constructor(path: string, opts: { readonly?: boolean } = {}) {
    silenceExperimentalWarning();
    this.db = new DatabaseSync(path, { readOnly: Boolean(opts.readonly) });
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(setting: string): unknown {
    return this.db.prepare(`PRAGMA ${setting}`).get();
  }

  prepare(sql: string): Statement {
    return new StatementImpl(this.db, sql);
  }

  /** BEGIN IMMEDIATE transaction — matches better-sqlite3 `txn.immediate()` semantics. */
  transactionImmediate<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      this.inTx = false;
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } finally {
        this.inTx = false;
      }
      throw err;
    }
  }

  private inTx = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  isOpen(): boolean {
    return !this.closed;
  }
}

export interface Statement {
  run(...args: SqlParam[]): StatementResult;
  run(params: Record<string, SqlParam>): StatementResult;
  get(...args: SqlParam[]): Record<string, unknown> | undefined;
  get(params: Record<string, SqlParam>): Record<string, unknown> | undefined;
  all(...args: SqlParam[]): Array<Record<string, unknown>>;
  all(params: Record<string, SqlParam>): Array<Record<string, unknown>>;
}

export class StatementImpl implements Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string
  ) {}

  run(...args: unknown[]): StatementResult {
    const stmt = this.db.prepare(this.sql);
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const r = stmt.run(args[0] as Record<string, SqlParam>);
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
    }
    const r = args.length === 0 ? stmt.run() : stmt.run(...(args as SqlParam[]));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get(...args: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql);
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      return stmt.get(args[0] as Record<string, SqlParam>) as Record<string, unknown> | undefined;
    }
    return (args.length === 0 ? stmt.get() : stmt.get(...(args as SqlParam[]))) as
      | Record<string, unknown>
      | undefined;
  }

  all(...args: unknown[]): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(this.sql);
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      return stmt.all(args[0] as Record<string, SqlParam>) as Array<Record<string, unknown>>;
    }
    return (args.length === 0 ? stmt.all() : stmt.all(...(args as SqlParam[]))) as Array<
      Record<string, unknown>
    >;
  }
}
