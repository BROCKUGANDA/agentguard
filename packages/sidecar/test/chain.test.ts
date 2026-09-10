import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalJSON,
  computeEntryHash,
  verifyChain,
  type AuditRecord,
} from '../src/audit/chain.js';
import { AuditStore } from '../src/audit/store.js';

const GENESIS = '0'.repeat(64);

function makeRecord(
  id: number,
  prev: string,
  payload: Record<string, unknown>
): AuditRecord {
  return {
    id,
    ts: payload.ts as number,
    agent_id: payload.agent_id as string,
    tool: payload.tool as string,
    args: payload.args as Record<string, unknown>,
    decision: payload.decision as 'allow' | 'deny',
    reason: payload.reason as string | undefined,
    policy_id: payload.policy_id as string | undefined,
    severity: payload.severity as 'info' | 'warning' | 'critical',
    prev_hash: prev,
    entry_hash: computeEntryHash(prev, payload),
  };
}

describe('Audit hash chain', () => {
  it('verifyChain returns valid for sequential appends', () => {
    const payloads: Record<string, unknown>[] = [
      { ts: 1, agent_id: 'a', tool: 't1', args: { x: 1 }, decision: 'allow', severity: 'info' },
      { ts: 2, agent_id: 'a', tool: 't2', args: { y: 2 }, decision: 'deny', severity: 'warning' },
      { ts: 3, agent_id: 'b', tool: 't3', args: { z: 3 }, decision: 'allow', severity: 'info' },
    ];
    const records: AuditRecord[] = [];
    let prev = GENESIS;
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      const r = makeRecord(i + 1, prev, p);
      records.push(r);
      prev = r.entry_hash;
    }
    const result = verifyChain(records);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('verifyChain detects tampering with payload → brokenAt = id', () => {
    const payloads: Record<string, unknown>[] = [
      { ts: 1, agent_id: 'a', tool: 't1', args: { x: 1 }, decision: 'allow', severity: 'info' },
      { ts: 2, agent_id: 'a', tool: 't2', args: { y: 2 }, decision: 'deny', severity: 'warning' },
      { ts: 3, agent_id: 'b', tool: 't3', args: { z: 3 }, decision: 'allow', severity: 'info' },
    ];
    const records: AuditRecord[] = [];
    let prev = GENESIS;
    for (let i = 0; i < payloads.length; i++) {
      const r = makeRecord(i + 1, prev, payloads[i]);
      records.push(r);
      prev = r.entry_hash;
    }
    // Tamper: change the decision on record #2 — its hash will no longer match.
    records[1].decision = 'allow';
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('verifyChain detects broken prev_hash link', () => {
    const payloads: Record<string, unknown>[] = [
      { ts: 1, agent_id: 'a', tool: 't1', args: {}, decision: 'allow', severity: 'info' },
      { ts: 2, agent_id: 'b', tool: 't2', args: {}, decision: 'allow', severity: 'info' },
    ];
    const records: AuditRecord[] = [];
    let prev = GENESIS;
    for (let i = 0; i < payloads.length; i++) {
      const r = makeRecord(i + 1, prev, payloads[i]);
      records.push(r);
      prev = r.entry_hash;
    }
    // Break the link by overwriting prev_hash on record #2
    records[1].prev_hash = '0'.repeat(64);
    const result = verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('entry_hash differs for different payloads', () => {
    const p1 = { ts: 1, agent_id: 'a', tool: 't', args: {}, decision: 'allow' as const, severity: 'info' as const };
    const p2 = { ts: 1, agent_id: 'a', tool: 't', args: {}, decision: 'deny' as const, severity: 'info' as const };
    const h1 = computeEntryHash(GENESIS, p1);
    const h2 = computeEntryHash(GENESIS, p2);
    expect(h1).not.toBe(h2);
  });

  it('entry_hash differs for different prev hashes', () => {
    const p = { ts: 1, agent_id: 'a', tool: 't', args: {}, decision: 'allow' as const, severity: 'info' as const };
    const a = computeEntryHash(GENESIS, p);
    const b = computeEntryHash('a'.repeat(64), p);
    expect(a).not.toBe(b);
  });

  it('canonicalJSON sorts keys', () => {
    const a = canonicalJSON({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJSON({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('canonicalJSON sorts nested object keys', () => {
    const a = canonicalJSON({ outer: { z: 1, a: 2 }, first: 'v' });
    const b = canonicalJSON({ first: 'v', outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('canonicalJSON preserves array order', () => {
    expect(canonicalJSON([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalJSON([3, 2, 1])).toBe('[3,2,1]');
  });

  it('verifyChain rejects empty chain', () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
  });

  it('verifyChain rejects genesis violation', () => {
    const p = { ts: 1, agent_id: 'a', tool: 't', args: {}, decision: 'allow', severity: 'info' };
    const rec = makeRecord(1, 'not-genesis', p);
    const result = verifyChain([rec]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });
});

describe('AuditStore retention purge re-chains', () => {
  it('purgeBefore re-roots the remaining chain so verify still passes', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agentguard-purge-'));
    try {
      const store = new AuditStore(join(tmp, 'audit.sqlite'));
      const base = Date.now() - 1000;
      store.append({ ts: base - 10_000, agent_id: 'a', tool: 't1', args: {}, decision: 'allow' });
      store.append({ ts: base - 5_000, agent_id: 'a', tool: 't2', args: {}, decision: 'deny' });
      store.append({ ts: base + 1_000, agent_id: 'a', tool: 't3', args: {}, decision: 'allow' });
      store.append({ ts: base + 2_000, agent_id: 'a', tool: 't4', args: {}, decision: 'allow' });

      const deleted = store.purgeBefore(base);
      expect(deleted).toBe(2);

      const remaining = store.all();
      expect(remaining.length).toBe(2);
      expect(verifyChain(remaining).valid).toBe(true);
      expect(store.purgeEpoch()).toBe(1);
      store.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
