#!/usr/bin/env node
/**
 * Standalone CLI: verify the SHA-256 audit chain for an SQLite DB.
 *
 * Usage:
 *   tsx src/cli/verify-audit.ts <path-to-sqlite-file>
 *
 * Exits 0 if the chain is valid, 1 if it's broken (prints brokenAt id),
 * 2 on usage / I/O errors.
 */
import { AuditStore } from '../audit/store.js';
import { verifyChain } from '../audit/chain.js';

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: verify-audit <path-to-sqlite>');
    process.exit(2);
  }

  const store = new AuditStore(dbPath);
  try {
    const records = store.all();
    if (records.length === 0) {
      console.log(JSON.stringify({ valid: true, count: 0, note: 'empty chain' }));
      process.exit(0);
    }
    const result = verifyChain(records);
    if (result.valid) {
      console.log(JSON.stringify({ valid: true, count: records.length }));
      process.exit(0);
    }
    console.log(JSON.stringify({ valid: false, brokenAt: result.brokenAt, count: records.length }));
    process.exit(1);
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error('verify-audit failed:', err);
  process.exit(2);
});
