import type { DataClassConfig } from '../schema.js';

/**
 * Walk a dot-path against a nested object.
 *
 * - 'args.subject'      → obj.args.subject
 * - 'args.recipients.0' → obj.args.recipients[0]
 *
 * Returns undefined if any segment is missing.
 */
function dotGet(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Coerce a value to a string for regex matching.
 * Objects/arrays → JSON. null/undefined → ''.
 */
function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/**
 * Pre-compile patterns once at load time.
 */
export interface CompiledDataClass {
  raw: DataClassConfig;
  patterns: { name: string; re: RegExp }[];
}

/**
 * Strip an optional leading `args.` prefix. Policy authors may write either
 * `args.subject` (matching the JSON wire shape) or `subject` (matching the
 * in-process args object) — both resolve the same way.
 */
function stripArgsPrefix(path: string): string {
  return path.startsWith('args.') ? path.slice(5) : path;
}

/** Cap the input string length before regex testing (defends against huge payloads). */
const MAX_INPUT_LEN = 100_000;
/** Adversarial string used to probe for catastrophic backtracking at load time. */
const BACKTRACK_PROBE = 'a'.repeat(10_000);
/** Time budget (ms) for the backtracking probe at load time. */
const BACKTRACK_BUDGET_MS = 50;

/**
 * Validate a regex won't catastrophically backtrack. Runs the pattern
 * against a 10KB adversarial string with a 50ms budget. Throws if the
 * regex is too slow (likely ReDoS-vulnerable).
 */
function assertRegexSafe(name: string, source: string): void {
  let re: RegExp;
  try {
    re = new RegExp(source, 'g');
  } catch (err) {
    throw new Error(`data_classification pattern "${name}" is invalid: ${(err as Error).message}`);
  }
  const start = Date.now();
  re.lastIndex = 0;
  re.test(BACKTRACK_PROBE);
  if (Date.now() - start > BACKTRACK_BUDGET_MS) {
    throw new Error(
      `data_classification pattern "${name}" took ${Date.now() - start}ms on a 10KB probe ` +
        `(budget ${BACKTRACK_BUDGET_MS}ms) — likely ReDoS-vulnerable. Simplify the regex.`
    );
  }
}

export function compileDataClass(cfg: DataClassConfig): CompiledDataClass {
  return {
    raw: cfg,
    patterns: cfg.patterns.map((p) => {
      assertRegexSafe(p.name, p.regex);
      return { name: p.name, re: new RegExp(p.regex, 'g') };
    }),
  };
}

export interface DataClassMatch {
  match: true;
  matchedPattern: string;
  matchedField: string;
}

/**
 * Scan the configured args paths for any of the configured regex patterns.
 *
 * Returns the first match (deterministic: order of `match_on`, then order of
 * `patterns`). Returns null when nothing matches.
 */
export function evaluateDataClass(
  compiled: CompiledDataClass,
  args: Record<string, unknown>
): DataClassMatch | null {
  for (const field of compiled.raw.match_on) {
    const v = dotGet(args, stripArgsPrefix(field));
    const text = toText(v);
    if (text === '') continue;
    // Cap input length to defend against pathological payloads.
    const capped = text.length > MAX_INPUT_LEN ? text.slice(0, MAX_INPUT_LEN) : text;
    for (const { name, re } of compiled.patterns) {
      // Reset the regex state — RegExp with /g is stateful across .test() calls.
      re.lastIndex = 0;
      if (re.test(capped)) {
        return { match: true, matchedPattern: name, matchedField: field };
      }
    }
  }
  return null;
}

/**
 * Produce a deep-cloned copy of `args` with every configured field rewritten:
 * each regex pattern that fires is replaced by `replacement` (default
 * `[REDACTED:<pattern-name>]`) across every match_on path.
 *
 * Non-string values at a matched path are replaced wholesale with the
 * placeholder — partial masking inside objects/arrays isn't attempted.
 */
export function redactDataClass(
  compiled: CompiledDataClass,
  args: Record<string, unknown>
): { redactedArgs: Record<string, unknown>; matched: Array<{ field: string; pattern: string }> } {
  const clone = structuredClone(args) as Record<string, unknown>;
  const matched: Array<{ field: string; pattern: string }> = [];

  for (const field of compiled.raw.match_on) {
    const parts = stripArgsPrefix(field).split('.');
    // Navigate to the parent object of the target field.
    let cur: unknown = clone;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') {
        ok = false;
        break;
      }
      cur = (cur as Record<string, unknown>)[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (!ok || cur === null || cur === undefined || typeof cur !== 'object') continue;
    const container = cur as Record<string, unknown>;
    const original = container[leaf];
    if (original === undefined) continue;

    const text = toText(original);
    if (text === '') continue;

    let replaced = text;
    let hit = false;
    for (const { name, re } of compiled.patterns) {
      re.lastIndex = 0;
      const placeholder = compiled.raw.replacement ?? `[REDACTED:${name}]`;
      const next = replaced.replace(re, placeholder);
      if (next !== replaced) {
        hit = true;
        matched.push({ field, pattern: name });
        replaced = next;
      }
    }
    if (hit) {
      // A string field gets the masked text back; other types (objects,
      // arrays) are masked wholesale — partial masking isn't attempted.
      container[leaf] = typeof original === 'string' ? replaced : compiled.raw.replacement ?? '[REDACTED]';
    }
  }
  return { redactedArgs: clone, matched };
}
