/**
 * `agentguard export-audit` — export the audit log as compliance evidence.
 *
 *   npx agentguard export-audit ./data/audit.sqlite --out ./evidence
 *
 * Produces:
 *   evidence/audit-<timestamp>.jsonl   — one entry per line, full record
 *   evidence/audit-<timestamp>.summary.json — counts, chain verification,
 *     first/last entry, per-agent and per-decision breakdowns, SHA-256 of the
 *     JSONL file itself (receipt: the export's integrity is provable too).
 *
 * Exits 0 on a valid chain, 1 when the chain is broken (compliance evidence
 * of tampering is still exported).
 */
import chalk from 'chalk';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface ExportOptions {
  out?: string;
  format?: 'jsonl' | 'json';
}

export async function exportAuditCommand(dbPath: string | undefined, opts: ExportOptions): Promise<void> {
  const path = dbPath ?? './data/audit.sqlite';
  if (!existsSync(path)) {
    console.error(chalk.red(`✗ Database not found: ${path}`));
    process.exit(1);
  }

  const { DatabaseSync } = await import('node:sqlite');
  // node:sqlite prints an experimental banner on every process — silence it
  // (the sidecar's audit/sqlite.ts does the same).
  const origWarn = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...a: unknown[]) => {
    if (typeof w === 'string' && w.includes('SQLite is an experimental')) return undefined;
    return (origWarn as (w: string | Error, ...a: unknown[]) => void)(w, ...a);
  }) as typeof process.emitWarning;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = (db
      .prepare('SELECT * FROM audit ORDER BY id ASC')
      .all() as Array<{
      id: number;
      ts: number;
      agent_id: string;
      tool: string;
      args: string;
      decision: string;
      reason: string | null;
      policy_id: string | null;
      severity: string;
      prev_hash: string;
      entry_hash: string;
    }>).map((r) => ({
      id: r.id,
      ts: r.ts,
      timestamp: new Date(r.ts).toISOString(),
      agent_id: r.agent_id,
      tool: r.tool,
      args: (() => {
        try {
          return JSON.parse(r.args) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
      decision: r.decision,
      reason: r.reason ?? undefined,
      policy_id: r.policy_id ?? undefined,
      severity: r.severity,
      prev_hash: r.prev_hash,
      entry_hash: r.entry_hash,
    }));

    // Chain verification against the exported records.
    const { verifyChain } = (await import('@agentguard/sidecar/dist/audit/chain.js')) as {
      verifyChain: (records: unknown[]) => { valid: boolean; brokenAt?: number };
    };
    const chain = verifyChain(rows);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = resolve(opts.out ?? '.');
    mkdirSync(outDir, { recursive: true });

    // JSONL body
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
    const jsonlPath = join(outDir, `audit-${stamp}.jsonl`);
    await writeFile(jsonlPath, jsonl, 'utf8');
    const jsonlSha = createHash('sha256').update(jsonl).digest('hex');

    // Summary
    const byAgent = new Map<string, number>();
    const byTool = new Map<string, number>();
    let allowed = 0;
    let denied = 0;
    for (const r of rows) {
      byAgent.set(r.agent_id, (byAgent.get(r.agent_id) ?? 0) + 1);
      byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + 1);
      if (r.decision === 'allow') allowed++;
      else denied++;
    }

    const summary = {
      generated_at: new Date().toISOString(),
      source_db: resolve(path),
      entries: rows.length,
      decisions: { allowed, denied },
      chain: {
        valid: chain.valid,
        broken_at: chain.brokenAt ?? null,
      },
      first_entry: rows[0]?.timestamp ?? null,
      last_entry: rows.length > 0 ? rows[rows.length - 1].timestamp : null,
      by_agent: Object.fromEntries([...byAgent.entries()].sort((a, b) => b[1] - a[1])),
      by_tool: Object.fromEntries([...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)),
      export: {
        file: jsonlPath,
        sha256: jsonlSha,
        note: 'SHA-256 of the .jsonl file — verify this export has not been altered after generation.',
      },
    };
    const summaryPath = join(outDir, `audit-${stamp}.summary.json`);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    console.log(chalk.green(`✓ Exported ${rows.length} entries`));
    console.log(chalk.dim(`  ${jsonlPath}`));
    console.log(chalk.dim(`  ${summaryPath}`));
    console.log(chalk.dim(`  export sha256: ${jsonlSha.slice(0, 16)}…`));
    if (!chain.valid) {
      console.log(chalk.red(`✗ WARNING: audit chain is BROKEN at entry ${chain.brokenAt}`));
      process.exit(1);
    }
    console.log(chalk.green('✓ Hash chain verified — export is tamper-evident evidence.'));
  } finally {
    db.close();
  }
}
