import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { checkWebhookSsrf, IPRateLimiter, scrubArgsForAudit, redactPII } from '../src/hardening.js';

// Policy exercising the redact decision: emails with SSNs are MASKED and
// allowed through, instead of blocked outright.
const POLICY_YAML = [
  'version: "1"',
  'default: deny',
  'agents:',
  '  "*":',
  '    role: guest',
  '  dev-agent:',
  '    role: developer',
  'rules:',
  '  - id: redact-ssn-in-email',
  '    description: "Mask SSNs in outbound email instead of blocking"',
  '    match:',
  '      tool: email.send',
  '    decision: redact',
  '    reason: "SSN redacted from outbound email"',
  '    conditions:',
  '      data_classification:',
  '        patterns:',
  '          - name: us_ssn',
  '            regex: "[0-9]{3}-[0-9]{2}-[0-9]{4}"',
  '        match_on: ["args.subject", "args.body"]',
  '        replacement: "[SSN-REMOVED]"',
  '  - id: deny-everything-else',
  '    match:',
  '      tool: "*"',
  '    decision: deny',
  '    conditions:',
  '      rbac:',
  '        role: [guest, developer]',
  '        action: deny',
].join('\n');

describe('Hardening + redact decisions', () => {
  let app: FastifyInstance;
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'agentguard-hardening-'));
    writeFileSync(join(tmp, 'policy.yaml'), POLICY_YAML, 'utf8');
    app = await buildServer({
      policyFile: join(tmp, 'policy.yaml'),
      auditDb: join(tmp, 'audit.sqlite'),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('redact decision (PII masking flow)', () => {
    it('returns allow=true with redactedArgs masking the SSN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/check',
        payload: {
          agentId: 'dev-agent',
          role: 'developer',
          tool: 'email.send',
          args: { to: 'hr@x.com', subject: 'SSN 123-45-6789 attached', body: '' },
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.allow).toBe(true);
      expect(body.ruleId).toBe('redact-ssn-in-email');
      expect(body.redactedArgs).toBeDefined();
      expect(String(body.redactedArgs.subject)).not.toContain('123-45-6789');
      expect(body.redactedArgs.subject).toBe('SSN [SSN-REMOVED] attached');
      // Untouched args pass through unchanged.
      expect(body.redactedArgs.to).toBe('hr@x.com');
    });

    it('audit trail stores the REDACTED args, never the raw PII', async () => {
      await app.inject({
        method: 'POST',
        url: '/check',
        payload: {
          agentId: 'dev-agent',
          role: 'developer',
          tool: 'email.send',
          args: { subject: 'again 987-65-4321', body: '' },
        },
      });
      const recent = await app.inject({ method: 'GET', url: '/audit/recent?limit=1' });
      const row = recent.json()[0];
      expect(row.decision).toBe('allow');
      expect(JSON.stringify(row.args)).not.toContain('987-65-4321');
      expect(row.args.subject).toBe('again [SSN-REMOVED]');
      expect(String(row.reason)).toContain('SSN redacted');
    });

    it('clean args skip the redact rule (no match → no-op) and fall through to later rules', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/check',
        payload: {
          agentId: 'dev-agent',
          role: 'developer',
          tool: 'email.send',
          args: { subject: 'no pii here', body: 'clean' },
        },
      });
      const body = res.json();
      // The redact rule's data_classification condition didn't match, so the
      // rule is skipped entirely — evaluation continues to the next rule
      // (deny-everything-else in this fixture policy). A redact rule is a
      // PII-triggered transform, not a blanket allow.
      expect(body.allow).toBe(false);
      expect(body.ruleId).toBe('deny-everything-else');
      expect(body.redactedArgs).toBeUndefined();
    });
  });

  describe('security headers', () => {
    it('sets X-Content-Type-Options, X-Frame-Options and CSP on every response', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(String(res.headers['content-security-policy'])).toContain('default-src');
    });
  });

  describe('per-IP rate limiter', () => {
    it('allows up to max requests per window then rejects', () => {
      const limiter = new IPRateLimiter(3, 60_000);
      expect(limiter.hit('1.2.3.4')).toBe(true);
      expect(limiter.hit('1.2.3.4')).toBe(true);
      expect(limiter.hit('1.2.3.4')).toBe(true);
      expect(limiter.hit('1.2.3.4')).toBe(false); // 4th within the window → denied
      // A different IP has its own bucket.
      expect(limiter.hit('5.6.7.8')).toBe(true);
    });

    it('refills the bucket after the window elapses', () => {
      const limiter = new IPRateLimiter(1, 5); // 5ms window for the test
      expect(limiter.hit('a')).toBe(true);
      expect(limiter.hit('a')).toBe(false);
      // Wait for the window to pass; the bucket refills.
      const t = Date.now();
      while (Date.now() - t < 10) {
        /* busy-wait 10ms */
      }
      expect(limiter.hit('a')).toBe(true);
    });

    it('sweep() drops stale buckets so memory stays bounded', () => {
      const limiter = new IPRateLimiter(1, 5);
      limiter.hit('stale-ip');
      const t = Date.now();
      while (Date.now() - t < 10) {
        /* busy-wait */
      }
      limiter.sweep();
      expect(limiter.hit('stale-ip')).toBe(true); // re-created fresh post-sweep
    });
  });

  describe('admin token gate', () => {
    const originalEnv = process.env.AGENTGUARD_ADMIN_TOKEN;
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      if (originalEnv === undefined) delete process.env.AGENTGUARD_ADMIN_TOKEN;
      else process.env.AGENTGUARD_ADMIN_TOKEN = originalEnv;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    });

    it('rejects admin routes with 401 when a token is set and none is sent', async () => {
      process.env.AGENTGUARD_ADMIN_TOKEN = 'secret-token-123';
      const res = await app.inject({ method: 'POST', url: '/audit/verify' });
      expect(res.statusCode).toBe(401);
    });

    it('accepts admin routes with the correct Bearer token', async () => {
      process.env.AGENTGUARD_ADMIN_TOKEN = 'secret-token-123';
      const res = await app.inject({
        method: 'POST',
        url: '/audit/verify',
        headers: { authorization: 'Bearer secret-token-123' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().valid).toBe(true);
    });

    it('refuses admin routes in production with no token configured (fail closed)', async () => {
      delete process.env.AGENTGUARD_ADMIN_TOKEN;
      process.env.NODE_ENV = 'production';
      const res = await app.inject({ method: 'POST', url: '/audit/verify' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('admin_token_not_configured');
    });
  });

  describe('webhook SSRF guard', () => {
    it('blocks loopback, link-local and private targets', () => {
      expect(checkWebhookSsrf('http://127.0.0.1:9559/x')).toContain('not allowed');
      expect(checkWebhookSsrf('http://169.254.169.254/latest/meta-data')).toContain('not allowed');
      expect(checkWebhookSsrf('http://10.1.2.3/hook')).toContain('not allowed');
      expect(checkWebhookSsrf('http://192.168.0.5/hook')).toContain('not allowed');
      expect(checkWebhookSsrf('http://[::1]/hook')).toContain('not allowed');
      expect(checkWebhookSsrf('file:///etc/passwd')).toContain('disallowed protocol');
    });

    it('allows public webhooks (hostnames and public IPs)', () => {
      expect(checkWebhookSsrf('https://hooks.slack.com/services/T0/B0/xxx')).toBeNull();
      expect(checkWebhookSsrf('https://1.2.3.4/hook')).toBeNull();
      expect(checkWebhookSsrf('https://example.com/webhook')).toBeNull();
    });
  });

  describe('PII scrubbing for audit', () => {
    it('scrubs nested strings in args objects', () => {
      const scrubbed = scrubArgsForAudit({
        to: 'hr@x.com',
        nested: { body: 'ssn 123-45-6789 and token sk-abcdefghijklmnopqrstuvwx' },
        list: ['user@example.com'],
        n: 42,
      }) as Record<string, unknown>;
      expect(JSON.stringify(scrubbed)).not.toContain('123-45-6789');
      expect(JSON.stringify(scrubbed)).not.toContain('user@example.com');
      expect(JSON.stringify(scrubbed)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
      expect((scrubbed as { n: number }).n).toBe(42);
    });

    it('credit-card pattern does not hang on long digit runs', () => {
      const start = Date.now();
      redactPII('x'.repeat(100) + ' '.repeat(100) + '9'.repeat(50_000));
      expect(Date.now() - start).toBeLessThan(500);
    });
  });

  describe('deny path stores scrubbed args', () => {
    it('does not persist raw SSN on deny decisions', async () => {
      await app.inject({
        method: 'POST',
        url: '/check',
        payload: {
          agentId: 'guest-bot',
          role: 'guest',
          tool: 'email.send',
          args: { subject: 'ssn 111-22-3333', body: 'contact me@evil.test' },
        },
      });
      const recent = await app.inject({ method: 'GET', url: '/audit/recent?limit=5' });
      const rows = recent.json() as Array<{ args: Record<string, unknown>; decision: string }>;
      const denyRows = rows.filter((r) => r.decision === 'deny');
      expect(denyRows.length).toBeGreaterThan(0);
      const dumped = JSON.stringify(denyRows);
      expect(dumped).not.toContain('111-22-3333');
      expect(dumped).not.toContain('contact me@evil.test');
    });
  });

  describe('IP rate limiter bucket cap', () => {
    it('caps map size under flood', () => {
      const limiter = new IPRateLimiter(10, 60_000, 5);
      for (let i = 0; i < 20; i++) limiter.hit(`ip-${i}`);
      expect(limiter.size).toBeLessThanOrEqual(5);
    });
  });
});
