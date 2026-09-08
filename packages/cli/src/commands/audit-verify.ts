/**
 * `agentguard audit-verify` — verify the SHA-256 hash chain integrity
 * of a SQLite audit database.
 *
 *   npx agentguard audit-verify ./data/audit.sqlite
 *
 * Exits 0 if valid, 1 if broken (and prints the brokenAt row).
 */
import chalk from 'chalk';
import { existsSync } from 'node:fs';

export async function auditVerifyCommand(dbPath: string | undefined): Promise<void> {
  const path = dbPath ?? './data/audit.sqlite';
  if (!existsSync(path)) {
    console.error(chalk.red(`✗ Database not found: ${path}`));
    process.exit(1);
  }

  let verifyChain: (records: unknown[]) => { valid: boolean; brokenAt?: number };
  try {
    ({ verifyChain } = (await import(
      '@agentguard/sidecar/dist/audit/chain.js'
    )) as unknown as { verifyChain: (records: unknown[]) => { valid: boolean; brokenAt?: number } });
  } catch {
    console.error(chalk.red('✗ @agentguard/sidecar not installed'));
    process.exit(1);
  }

  // Open the DB read-only to pull records (node:sqlite ships with Node — no native addon)
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // Mirror the AuditStore row shape: args is stored TEXT (JSON) and
    // optional columns come back as NULL — verifyChain expects the
    // parsed-object form the store hands over.
    const rows = (db.prepare('SELECT * FROM audit ORDER BY id ASC').all() as Array<{
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
    if (rows.length === 0) {
      console.log(chalk.dim('(no audit rows)'));
      return;
    }
    const result = verifyChain(rows);
    if (result.valid) {
      console.log(chalk.green(`✓ Chain valid — ${rows.length} rows verified`));
      process.exit(0);
    } else {
      console.log(chalk.red(`✗ Chain BROKEN at row #${result.brokenAt} (${rows.length} total)`));
      process.exit(1);
    }
  } finally {
    db.close();
  }
}