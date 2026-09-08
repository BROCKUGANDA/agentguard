import { createHash } from 'node:crypto';

export type Severity = 'info' | 'warning' | 'critical';

export interface AuditRecord {
  id: number;
  ts: number;
  agent_id: string;
  tool: string;
  args: Record<string, unknown>;
  decision: 'allow' | 'deny';
  reason?: string;
  policy_id?: string;
  severity: Severity;
  prev_hash: string;
  entry_hash: string;
}

/**
 * Canonical JSON serialization — recursive key sort so identical payloads
 * always hash the same, regardless of property insertion order.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJSON(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]));
  return '{' + parts.join(',') + '}';
}

/**
 * Compute the SHA-256 entry hash for a new audit record.
 *
 *   hash(prev_hash || canonicalJSON(payload_without_hashes))
 *
 * The payload must omit `id`, `prev_hash`, and `entry_hash` to make the
 * function self-contained — the caller has already supplied `prev_hash`.
 */
export function computeEntryHash(prev: string, payload: Record<string, unknown>): string {
  return createHash('sha256').update(prev + canonicalJSON(payload)).digest('hex');
}

/**
 * Verify a contiguous audit chain end-to-end.
 *
 * - Returns `{ valid: true }` if every entry's prev_hash matches the previous
 *   entry's entry_hash, AND every entry_hash reproduces correctly.
 * - Returns `{ valid: false, brokenAt: <id> }` at the first divergence.
 */
export function verifyChain(
  records: AuditRecord[]
): { valid: boolean; brokenAt?: number } {
  if (records.length === 0) return { valid: true };

  const first = records[0];
  // Genesis prev_hash is conventionally '0' * 64 (256 bits). We accept either
  // 64 zeros or the literal string 'genesis' for robustness.
  const GENESIS = '0'.repeat(64);
  if (first.prev_hash !== GENESIS && first.prev_hash !== 'genesis') {
    return { valid: false, brokenAt: first.id };
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const expectedPrev = i === 0 ? first.prev_hash : records[i - 1].entry_hash;
    if (r.prev_hash !== expectedPrev) {
      return { valid: false, brokenAt: r.id };
    }
    const recomputed = computeEntryHash(r.prev_hash, {
      ts: r.ts,
      agent_id: r.agent_id,
      tool: r.tool,
      args: r.args,
      decision: r.decision,
      reason: r.reason,
      policy_id: r.policy_id,
      severity: r.severity,
    });
    if (recomputed !== r.entry_hash) {
      return { valid: false, brokenAt: r.id };
    }
  }
  return { valid: true };
}

export const GENESIS_HASH = '0'.repeat(64);
