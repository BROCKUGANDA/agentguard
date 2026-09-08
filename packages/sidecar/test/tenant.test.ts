import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TenantManager, normalizeTenantId, TENANT_ID_RE } from '../src/tenant/manager.js';

describe('normalizeTenantId', () => {
  it('lowercases and trims valid ids', () => {
    expect(normalizeTenantId('  MyTenant  ')).toBe('mytenant');
    expect(normalizeTenantId('Acme-Co')).toBe('acme-co');
  });

  it('returns null for undefined or empty', () => {
    expect(normalizeTenantId(undefined)).toBeNull();
    expect(normalizeTenantId('')).toBeNull();
    expect(normalizeTenantId('   ')).toBeNull();
  });

  it('rejects ids that fail the regex', () => {
    expect(normalizeTenantId('has space')).toBeNull();
    expect(normalizeTenantId('UPPER!')).toBeNull();
    expect(normalizeTenantId('a'.repeat(64))).toBeNull();
  });

  it('accepts ids matching [a-z0-9_-]{1,63}', () => {
    expect(normalizeTenantId('default')).toBe('default');
    expect(normalizeTenantId('tenant-1')).toBe('tenant-1');
    expect(normalizeTenantId('t_e_s_t')).toBe('t_e_s_t');
    expect(normalizeTenantId('123')).toBe('123');
  });
});

describe('TenantManager', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agentguard-tenant-'));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('provisions a new tenant lazily on first get()', () => {
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-1'),
      policyDir: join(tmp, 'policies-1'),
    });
    expect(mgr.has('acme')).toBe(false);
    const ctx = mgr.get('acme');
    expect(mgr.has('acme')).toBe(true);
    expect(ctx.id).toBe('acme');
    expect(ctx.engine).toBeDefined();
    expect(ctx.auditStore).toBeDefined();
    expect(ctx.stream).toBeDefined();
    expect(existsSync(ctx.policyFile)).toBe(true);
    mgr.close();
  });

  it('returns the same context on repeated get() calls (cached)', () => {
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-2'),
      policyDir: join(tmp, 'policies-2'),
    });
    const a = mgr.get('dup');
    const b = mgr.get('dup');
    expect(a).toBe(b);
    mgr.close();
  });

  it('isolates audit data between tenants', () => {
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-3'),
      policyDir: join(tmp, 'policies-3'),
    });
    const ctxA = mgr.get('tenant-a');
    const ctxB = mgr.get('tenant-b');
    ctxA.auditStore.append({
      ts: Date.now(), agent_id: 'x', tool: 't', args: {}, decision: 'allow',
    });
    expect(ctxA.auditStore.count()).toBe(1);
    expect(ctxB.auditStore.count()).toBe(0);
    mgr.close();
  });

  it('uses defaultPolicyFile for the default tenant', () => {
    const policyFile = join(tmp, 'policies-4', 'default.yaml');
    mkdirSync(join(tmp, 'policies-4'), { recursive: true });
    writeFileSync(policyFile, 'version: "1"\ndefault: deny\nrules: []\n', 'utf8');
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-4'),
      policyDir: join(tmp, 'policies-4'),
      defaultPolicyFile: policyFile,
    });
    const ctx = mgr.get('default');
    expect(ctx.policyFile).toBe(policyFile);
    mgr.close();
  });

  it('list() includes provisioned + on-disk tenants', () => {
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-5'),
      policyDir: join(tmp, 'policies-5'),
    });
    mgr.get('alpha');
    mgr.get('beta');
    const ids = mgr.list();
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
    expect(ids).toEqual([...ids].sort());
    mgr.close();
  });

  it('provisionedCount() reflects contexts created this boot', () => {
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-6'),
      policyDir: join(tmp, 'policies-6'),
    });
    expect(mgr.provisionedCount()).toBe(0);
    mgr.get('x');
    expect(mgr.provisionedCount()).toBe(1);
    mgr.get('y');
    expect(mgr.provisionedCount()).toBe(2);
    mgr.close();
    expect(mgr.provisionedCount()).toBe(0);
  });

  it('close() is idempotent', () => {
    const mgr = new TenantManager({
      dataDir: join(tmp, 'data-7'),
      policyDir: join(tmp, 'policies-7'),
    });
    mgr.get('closable');
    mgr.close();
    mgr.close();
  });

  it('TENANT_ID_RE matches valid ids', () => {
    expect(TENANT_ID_RE.test('default')).toBe(true);
    expect(TENANT_ID_RE.test('a-b_c-123')).toBe(true);
    expect(TENANT_ID_RE.test('UPPER')).toBe(false);
    expect(TENANT_ID_RE.test('has space')).toBe(false);
  });
});