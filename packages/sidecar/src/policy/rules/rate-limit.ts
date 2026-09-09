import type { RateLimitConfig } from '../schema.js';

/**
 * Sliding-window in-memory rate limiter.
 *
 * - `check(key, max, windowMs)` returns true if the call is allowed
 *   (under the limit) and false if it would exceed `max` within `windowMs`.
 * - Old timestamps are trimmed on every check, so memory stays bounded
 *   to keys that have been used recently.
 *
 * Single-process only — adequate for the sidecar's single-instance deploy.
 * For a clustered sidecar, swap to a Redis backend.
 */
const MAX_KEYS = 50_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /**
   * Returns true if the call is permitted, false if it would exceed the limit.
   * Recording is atomic with the check, so two concurrent checks can't both
   * see "n < max" and both pass.
   */
  check(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const existing = this.hits.get(key) ?? [];
    // Trim entries older than the window.
    let i = 0;
    while (i < existing.length && existing[i] <= cutoff) {
      i++;
    }
    const live = i > 0 ? existing.slice(i) : existing.slice();

    if (live.length >= max) {
      // Re-store the trimmed list and reject.
      this.hits.set(key, live);
      return false;
    }

    live.push(now);
    // Refresh insertion order for approximate LRU; evict oldest under flood.
    this.hits.delete(key);
    if (this.hits.size >= MAX_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, live);
    return true;
  }

  /** Drop all counters (test/reload convenience). */
  reset(): void {
    this.hits.clear();
  }

  /** Current key count (for tests / metrics). */
  get size(): number {
    return this.hits.size;
  }

  /** Compose a namespaced key from the rule's scope. */
  static makeKey(
    scope: RateLimitConfig['scope'],
    agentId: string,
    tool: string
  ): string {
    switch (scope) {
      case 'agent_tool':
        return `${agentId}:${tool}`;
      case 'tool':
        return `:${tool}`;
      case 'agent':
        return `${agentId}:`;
    }
  }

  /** Window string → milliseconds. */
  static windowMs(window: RateLimitConfig['window']): number {
    switch (window) {
      case '1s':
        return 1_000;
      case '1m':
        return 60_000;
      case '5m':
        return 300_000;
      case '1h':
        return 3_600_000;
    }
  }
}
