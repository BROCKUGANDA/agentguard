import type { TimeWindowConfig } from '../schema.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Weekday = (typeof WEEKDAYS)[number];

function parseHHMM(s: string): { h: number; m: number } {
  const [hStr, mStr] = s.split(':');
  return { h: Number(hStr), m: Number(mStr) };
}

/**
 * Get the UTC offset (in minutes) of the named timezone for a given instant.
 * Pure `Intl.DateTimeFormat` — no external tz library required.
 *
 * We format the instant twice (with and without the named tz) and diff the
 * minute fields. The named tz's hour is the local hour in that zone.
 */
function tzOffsetMinutes(tz: string, at: Date): number {
  const dtfLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtfLocal.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');

  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second')
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/**
 * Convert `at` to a wall-clock time in the named timezone.
 */
function wallClockInTz(tz: string, at: Date): {
  weekday: Weekday;
  hour: number;
  minute: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const wkShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const weekday: Weekday =
    wkShort.toLowerCase().slice(0, 3) === 'wed'
      ? 'wed'
      : (WEEKDAYS.find((w) => wkShort.toLowerCase().startsWith(w)) ?? 'sun');
  let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  if (hour === 24) hour = 0;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { weekday, hour, minute };
}

/**
 * Time-window check. Pure function — `now` injectable for testing.
 *
 * Semantics: an allow rule says "the call is permitted DURING these windows".
 * With `invert: true`, the semantic flips to "deny during these windows".
 *
 * Returns:
 *   - 'allow' if the call is inside an allowed window (and not inverted).
 *   - 'deny'  if the call is outside an allowed window, or inside an inverted window.
 *   - null    if the rule doesn't apply (engine should keep walking).
 */
export function evaluateTimeWindow(
  cond: TimeWindowConfig,
  now: Date = new Date()
): 'allow' | 'deny' | null {
  // Validate timezone at evaluation time so we fail loud, not silently.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: cond.tz });
  } catch {
    throw new Error(`Invalid timezone: ${cond.tz}`);
  }

  // Sanity-check tz (touch once; not used at runtime except as offset anchor).
  void tzOffsetMinutes(cond.tz, now);

  const clk = wallClockInTz(cond.tz, now);
  const nowMinutes = clk.hour * 60 + clk.minute;
  const today = clk.weekday;

  const insideAny = cond.allow.some((span) => {
    const startMin = parseHHMM(span.start).h * 60 + parseHHMM(span.start).m;
    const endMin = parseHHMM(span.end).h * 60 + parseHHMM(span.end).m;
    if (startMin === endMin) {
      // Degenerate empty window — treat as never-inside.
      return false;
    }

    if (startMin < endMin) {
      // Same-day window — weekday must match today.
      if (span.weekdays && span.weekdays.length > 0 && !span.weekdays.includes(today)) {
        return false;
      }
      return nowMinutes >= startMin && nowMinutes < endMin;
    }

    // Window wraps midnight: e.g. Fri 22:00 → Sat 06:00 with weekdays:[fri].
    // Evening (>= startMin) belongs to today's weekday; early morning
    // (< endMin) belongs to yesterday's weekday. Mid-day (endMin..startMin)
    // is outside the window entirely.
    if (span.weekdays && span.weekdays.length > 0) {
      const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(today) + 6) % 7];
      const startOk = span.weekdays.includes(today);
      const endOk = span.weekdays.includes(yesterday);
      if (nowMinutes >= startMin) return startOk;
      if (nowMinutes < endMin) return endOk;
      return false;
    }
    return nowMinutes >= startMin || nowMinutes < endMin;
  });

  if (cond.invert) {
    return insideAny ? 'deny' : 'allow';
  }
  return insideAny ? 'allow' : 'deny';
}
