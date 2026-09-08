import { describe, it, expect } from 'vitest';
import { redactPII, checkWebhookSsrf, IPRateLimiter, generateAdminToken } from '../src/hardening.js';

describe('redactPII', () => {
  it('redacts US SSNs', () => {
    expect(redactPII('SSN: 123-45-6789')).toBe('SSN: [REDACTED:us_ssn]');
    expect(redactPII('multiple 123-45-6789 and 987-65-4321')).toBe(
      'multiple [REDACTED:us_ssn] and [REDACTED:us_ssn]'
    );
  });

  it('redacts credit card numbers', () => {
    expect(redactPII('card: 4242-4242-4242-4242')).toContain('[REDACTED:credit_card]');
    expect(redactPII('4111111111111111')).toContain('[REDACTED:credit_card]');
  });

  it('redacts email addresses', () => {
    expect(redactPII('contact: user@example.com')).toBe('contact: [REDACTED:email]');
  });

  it('redacts Bearer tokens', () => {
    expect(redactPII('Authorization: Bearer abc123def456ghi789jkl')).toBe(
      'Authorization: Bearer [REDACTED]'
    );
  });

  it('redacts all PII types in a single string', () => {
    const input = 'user@example.com SSN 123-45-6789 Bearer tok_12345678901234567890';
    const out = redactPII(input) as string;
    expect(out).not.toContain('user@example.com');
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('tok_12345678901234567890');
  });

  it('returns non-string input unchanged', () => {
    expect(redactPII(42)).toBe(42);
    expect(redactPII(null)).toBe(null);
    expect(redactPII(undefined)).toBe(undefined);
    expect(redactPII({ a: 1 })).toEqual({ a: 1 });
  });

  it('leaves clean strings untouched', () => {
    expect(redactPII('no pii here')).toBe('no pii here');
    expect(redactPII('')).toBe('');
  });
});

describe('IPRateLimiter (edge cases)', () => {
  it('handles unknown IPs by creating fresh buckets', () => {
    const limiter = new IPRateLimiter(2, 60_000);
    expect(limiter.hit('new-ip-1')).toBe(true);
    expect(limiter.hit('new-ip-1')).toBe(true);
    expect(limiter.hit('new-ip-1')).toBe(false);
    expect(limiter.hit('new-ip-2')).toBe(true);
  });

  it('sweep removes only stale buckets', () => {
    const limiter = new IPRateLimiter(1, 5);
    limiter.hit('fresh');
    const t = Date.now();
    while (Date.now() - t < 1) { /* let a tick pass */ }
    limiter.hit('stale');
    const t2 = Date.now();
    while (Date.now() - t2 < 60) { /* wait past 10x window */ }
    limiter.sweep();
    expect(limiter.hit('fresh')).toBe(true);
    expect(limiter.hit('stale')).toBe(true);
  });
});

describe('checkWebhookSsrf (edge cases)', () => {
  it('rejects non-URL strings', () => {
    expect(checkWebhookSsrf('not-a-url')).toContain('unparseable');
  });

  it('rejects ftp protocol', () => {
    expect(checkWebhookSsrf('ftp://example.com/x')).toContain('disallowed protocol');
  });

  it('rejects IPv6 unique-local addresses', () => {
    expect(checkWebhookSsrf('http://[fd00::1]/x')).toContain('not allowed');
    expect(checkWebhookSsrf('http://[fc00::1]/x')).toContain('not allowed');
  });

  it('rejects IPv6 link-local addresses', () => {
    expect(checkWebhookSsrf('http://[fe80::1]/x')).toContain('not allowed');
  });

  it('allows public IPv4 addresses', () => {
    expect(checkWebhookSsrf('https://8.8.8.8/dns')).toBeNull();
    expect(checkWebhookSsrf('https://203.0.113.1/x')).toBeNull();
  });

  it('rejects 100.64.0.0/10 (CGNAT range)', () => {
    expect(checkWebhookSsrf('http://100.64.0.1/x')).toContain('not allowed');
    expect(checkWebhookSsrf('http://100.127.255.1/x')).toContain('not allowed');
  });
});

describe('generateAdminToken', () => {
  it('produces a non-empty base64url string', () => {
    const token = generateAdminToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique tokens', () => {
    const a = generateAdminToken();
    const b = generateAdminToken();
    expect(a).not.toBe(b);
  });
});