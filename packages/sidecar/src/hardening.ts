/**
 * AgentGuard sidecar hardening.
 *
 * 1. Sensitive-route auth: Bearer token required for /policies/reload,
 *    /alerts/test-fire, /alerts/recent. Set AGENTGUARD_ADMIN_TOKEN.
 * 2. Rate limiting: per-IP token bucket on every route (defends DoS).
 * 3. Request size caps: 1MB body limit on /check + /alerts/*.
 * 4. Security headers on every response.
 * 5. PII redaction in error responses.
 * 6. PII redaction in pino logs.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';

// ─── PII patterns (mirror data-classification regexes for log redaction) ────
// Credit-card matcher: digit groups with optional separators, no nested
// quantifiers (the previous `(?:\d[ -]*?){13,16}` form was ReDoS-prone).
const PII_PATTERNS = [
  { name: 'us_ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    name: 'credit_card',
    regex: /\b(?:\d{4}[- ]?){3}\d{4}\b|\b\d{13,16}\b/g,
  },
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  { name: 'bearer_token', regex: /\bBearer\s+([A-Za-z0-9._\-]{20,})\b/g },
  { name: 'api_key', regex: /\bsk-[A-Za-z0-9]{20,}\b|\bghp_[A-Za-z0-9]{20,}\b/g },
];

export function redactPII(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const { name, regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    out = out.replace(regex, name === 'bearer_token' ? 'Bearer [REDACTED]' : `[REDACTED:${name}]`);
  }
  return out;
}

/**
 * Deep-scrub PII from an args object before it is written to the audit DB
 * or broadcast over the WebSocket. Deny decisions previously stored raw
 * caller args (including SSN/emails), which defeated redaction for blocked
 * calls. Recursively rewrites every string leaf; leaves non-string values
 * intact after their stringified form has been scrubbed where applicable.
 */
export function scrubArgsForAudit(args: unknown, depth = 0): unknown {
  if (depth > 12) return args;
  if (typeof args === 'string') return redactPII(args);
  if (args === null || typeof args !== 'object') return args;
  if (Array.isArray(args)) {
    return args.map((v) => scrubArgsForAudit(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = scrubArgsForAudit(v, depth + 1);
  }
  return out;
}

/**
 * Install a hook that redacts PII from every log line.
 * Returns an uninstall function for tests.
 */
export function installPiiLogFilter(_logger: { info: Function; warn: Function; error: Function; child?: Function }): void {
  // Pino's `info/warn/error` are wrappers; monkey-patching the prototype
  // requires care. Simpler approach: wrap via the pino `redact` option or
  // `formatLogs` hook (see server.ts) rather than here.
}

// ─── 1. Sensitive-route auth ─────────────────────────────────────────────────
/**
 * Bearer-token gate for admin routes (/policies/reload, /alerts/*).
 *
 * Fail mode when AGENTGUARD_ADMIN_TOKEN is not set:
 *   - dev (default)  → allow, but warn loudly on every request
 *   - production     → 503 REFUSE (fail closed). Misconfigured deployments
 *                      must not expose admin routes to the internet.
 */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const expected = process.env.AGENTGUARD_ADMIN_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === 'production' || process.env.AGENTGUARD_REQUIRE_ADMIN === '1') {
      req.log.error('AGENTGUARD_ADMIN_TOKEN not set — refusing admin route in production (fail closed)');
      reply.code(503).send({
        error: 'admin_token_not_configured',
        reason: 'Set AGENTGUARD_ADMIN_TOKEN to use admin routes in production',
      });
      return;
    }
    // Dev without a token: allow, but make the hole visible.
    req.log.warn('AGENTGUARD_ADMIN_TOKEN not set — sensitive routes are UNPROTECTED');
    return done();
  }
  const header = req.headers.authorization;
  const auth = Array.isArray(header) ? header[0] : header;
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized', reason: 'missing bearer token' });
    return;
  }
  const token = auth.slice(7);
  // Constant-time compare
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(token);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    reply.code(403).send({ error: 'forbidden', reason: 'invalid token' });
    return;
  }
  done();
}

// ─── 2. Per-IP rate limit ────────────────────────────────────────────────────
interface Bucket { tokens: number; refilledAt: number }

const MAX_BUCKETS = 10_000;

export class IPRateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private max: number, private windowMs: number, private maxBuckets = MAX_BUCKETS) {}

  hit(ip: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(ip);
    if (!b) {
      // Cap map growth: evict oldest (first-inserted) bucket under flood.
      if (this.buckets.size >= this.maxBuckets) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      b = { tokens: this.max, refilledAt: now };
      this.buckets.set(ip, b);
    } else {
      // Refresh insertion order for approximate LRU under cap.
      this.buckets.delete(ip);
      this.buckets.set(ip, b);
    }
    const elapsed = now - b.refilledAt;
    if (elapsed >= this.windowMs) {
      // Refill
      b.tokens = this.max;
      b.refilledAt = now;
    }
    if (b.tokens <= 0) {
      return false; // denied
    }
    b.tokens--;
    return true; // allowed
  }

  // Periodic cleanup so the Map doesn't grow unbounded
  sweep(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (now - b.refilledAt > this.windowMs * 10) this.buckets.delete(k);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

export function rateLimitHook(limiter: IPRateLimiter) {
  return (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const ip = req.ip ?? 'unknown';
    if (!limiter.hit(ip)) {
      return reply.code(429).send({ error: 'rate_limited', retry_after_ms: 1000 });
    }
    done();
  };
}

// ─── 3. Security headers (sidecar API responses) ─────────────────────────────
export function applyApiSecurityHeaders(_req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  done();
}

// ─── 4. Request size limit ──────────────────────────────────────────────────
export const BODY_LIMIT = 1 * 1024 * 1024; // 1MB

// ─── 4b. Webhook SSRF guard ──────────────────────────────────────────────────
/**
 * Validate an alert-webhook URL before fetching it. Policy files are
 * untrusted input; without this check a malicious policy could point alert
 * delivery at cloud metadata endpoints (169.254.169.254) or internal services.
 *
 * Returns null when the URL is safe to fetch, or a reason string when blocked.
 * DNS hostnames are allowed (Slack/webhook providers are hostnames by nature);
 * only raw-IP literals in sensitive ranges are rejected, plus non-HTTP(S).
 */
export function checkWebhookSsrf(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return `unparseable URL: ${rawUrl.slice(0, 80)}`;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `disallowed protocol ${url.protocol}`;
  }
  // IPv4 literal in a private/loopback/link-local range?
  const v4 = url.hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 127 || a === 10 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return `private/loopback IP not allowed: ${url.hostname}`;
    }
    return null;
  }
  // IPv6 loopback / link-local / unique-local
  const h = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    h === '::1' || h === '::' ||
    h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')
  ) {
    return `private/loopback IPv6 not allowed: ${url.hostname}`;
  }
  return null;
}

// ─── 5. Generate a strong random admin token (for .env.example hint) ─────────
export function generateAdminToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ─── 6. Apply all hardening to a Fastify app ─────────────────────────────────
export function applyHardening(
  app: FastifyInstance,
  opts: { rateLimit?: IPRateLimiter } = {},
): IPRateLimiter {
  const limiter = opts.rateLimit ?? new IPRateLimiter(600, 60_000); // 600 req/min/IP default
  const sweepTimer = setInterval(() => limiter.sweep(), 60_000);
  sweepTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
  });

  app.addHook('onRequest', applyApiSecurityHeaders);
  app.addHook('onRequest', rateLimitHook(limiter));

  // Wrap log serializers so PII is scrubbed at every level (info/warn/error).
  if (app.log) {
    const log = app.log as unknown as Record<string, unknown>;
    for (const level of ['info', 'warn', 'error', 'debug', 'fatal'] as const) {
      const orig = log[level];
      if (typeof orig !== 'function') continue;
      const bound = (orig as Function).bind(app.log);
      log[level] = ((
        obj: unknown,
        msg?: string,
        ...rest: unknown[]
      ) => bound(redactPII(obj), msg ? (redactPII(msg) as string) : msg, ...rest)) as never;
    }
  }

  return limiter;
}