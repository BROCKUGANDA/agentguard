import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { parse as parseYaml } from 'yaml';
import {
  PolicyFileSchema,
  type CheckRequest,
  type Decision,
  type PolicyFile,
  type Condition,
  type RBACConfig,
  type RateLimitConfig,
  type TimeWindowConfig,
  type DataClassConfig,
} from './schema.js';
import { evaluateRBAC } from './rules/rbac.js';
import { RateLimiter } from './rules/rate-limit.js';
import { evaluateTimeWindow } from './rules/time-window.js';
import {
  compileDataClass,
  evaluateDataClass,
  redactDataClass,
  type CompiledDataClass,
} from './rules/data-classification.js';

/**
 * Match a glob-style pattern with `*` wildcards.
 *   fnmatch('filesystem.delete_file', 'filesystem.delete_file') === true
 *   fnmatch('prod.db',          '*prod*')                      === true
 *   fnmatch('temp.log',         '*prod*')                      === false
 *
 * Compiled RegExp objects are cached by pattern — globMatch is called on
 * every /check for every rule's arg constraints, so recompiling would be
 * expensive under load.
 */
const globRegexCache = new Map<string, RegExp>();
const GLOB_CACHE_MAX = 2_000;
function globMatch(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value === pattern;
  let re = globRegexCache.get(pattern);
  if (!re) {
    // Convert glob to RegExp: escape regex chars, then turn * into .*
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    re = new RegExp(`^${escaped}$`);
    if (globRegexCache.size >= GLOB_CACHE_MAX) {
      // Evict oldest entry to keep the cache bounded under attacker-chosen patterns.
      const oldest = globRegexCache.keys().next().value;
      if (oldest !== undefined) globRegexCache.delete(oldest);
    }
    globRegexCache.set(pattern, re);
  }
  return re.test(value);
}

interface ArgConstraints {
  [argName: string]: string; // glob pattern
}

interface CompiledRule {
  id: string;
  description?: string;
  toolNames: string[];
  argConstraints?: ArgConstraints;
  decision: 'allow' | 'deny' | 'redact';
  reason?: string;
  conditions: Condition[];
  compiledDataClass?: CompiledDataClass;
}

const tracer = trace.getTracer('agentguard.policy');

/**
 * The policy engine. Loads YAML, indexes rules, evaluates a CheckRequest
 * against them in order. First-match-wins; falls back to file's `default`.
 */
export class PolicyEngine {
  private policy: PolicyFile | null = null;
  private compiled: CompiledRule[] = [];
  private readonly rateLimiter = new RateLimiter();
  private ruleCount = 0;
  /** Callback fired after a successful loadFromFile/loadFromYaml. */
  onReload: (() => void) | null = null;

  loadFromFile(path: string): void {
    const raw = readFileSync(path, 'utf8');
    this.loadFromYaml(raw);
  }

  loadFromYaml(yaml: string): void {
    const parsed = parseYaml(yaml);
    const validated = PolicyFileSchema.parse(parsed);
    this.policy = validated;
    this.compiled = validated.rules.map((r) => this.compileRule(r));
    this.ruleCount = this.compiled.length;
    // Reset rate limiter on reload so a new policy doesn't carry stale buckets.
    this.rateLimiter.reset();
    this.onReload?.();
  }

  /** Exposed for /health. */
  rulesLoaded(): number {
    return this.ruleCount;
  }

  /** Return the alerts config block from the current policy (for dispatcher). */
  alertsConfig() {
    return this.policy?.alerts ?? [];
  }

  /** Return the current YAML as parsed object — for /policies GET. */
  getPolicy(): PolicyFile | null {
    return this.policy;
  }

  /**
   * Main evaluation entrypoint.
   *
   * Performance: in-process rules (RBAC, time-window, data-class) are < 1ms each.
   * Rate-limit is Map lookup + small array slice — also < 1ms.
   * The 50ms p99 budget is comfortably met.
   */
  async check(req: CheckRequest): Promise<Decision> {
    const start = performance.now();
    const decisionId = randomUUID();

    if (!this.policy) {
      return {
        allow: false,
        decisionId,
        reason: 'policy-not-loaded',
        latencyMs: performance.now() - start,
      };
    }

    // Resolve role: explicit override > agents map > default "*"
    const agentCfg = this.policy.agents?.[req.agentId];
    const wildcard = this.policy.agents?.['*'];
    const role = req.role ?? agentCfg?.role ?? wildcard?.role;

    const span = tracer.startSpan('agentguard.policy.evaluate', {
      attributes: {
        'agentguard.agent_id': req.agentId,
        'agentguard.tool': req.tool,
        'agentguard.role': role ?? 'unknown',
      },
    });

    try {
      for (const cr of this.compiled) {
        // Tool match: a rule matches when the tool is listed OR a list entry
        // is a glob (e.g. "*" for catch-all, "filesystem.*" for a namespace).
        const toolMatch =
          cr.toolNames.includes(req.tool) ||
          cr.toolNames.some((t) => t.includes('*') && globMatch(req.tool, t));
        if (!toolMatch) continue;
        if (!this.argsMatch(cr.argConstraints, req.args)) continue;

        // Conditions are AND-combined: all must succeed (or be no-op) for this
        // rule to fire. A single `null` from any evaluator short-circuits to
        // the next rule.
        const verdict = await this.evaluateConditions(cr, req, role);
        if (verdict === null) continue;

        // ── redact decision: allow the call, but mask matched fields ──────
        // Fires only when a data_classification pattern matched; otherwise
        // there is nothing to redact and the rule degrades to a plain allow.
        if (cr.decision === 'redact' && cr.compiledDataClass) {
          const { redactedArgs, matched } = redactDataClass(cr.compiledDataClass, req.args);
          if (matched.length > 0) {
            const elapsed = performance.now() - start;
            span.setAttribute('agentguard.policy.rule_id', cr.id);
            span.setAttribute('agentguard.policy.decision.allow', true);
            span.setAttribute('agentguard.policy.redacted_fields', matched.map((m) => m.field).join(','));
            span.setStatus({ code: SpanStatusCode.OK });
            return {
              allow: true,
              decisionId,
              ruleId: cr.id,
              reason: cr.reason ?? `redacted ${matched.map((m) => m.pattern).join(', ')} in ${matched.map((m) => m.field).join(', ')}`,
              latencyMs: elapsed,
              redactedArgs,
              severity: 'warning',
            };
          }
          // Nothing matched → plain allow, no substitution.
        }

        const elapsed = performance.now() - start;
        span.setAttribute('agentguard.policy.rule_id', cr.id);
        span.setAttribute('agentguard.policy.decision.allow', verdict === 'allow');
        span.setStatus({ code: SpanStatusCode.OK });

        return {
          allow: verdict === 'allow',
          decisionId,
          ruleId: cr.id,
          reason: cr.reason,
          latencyMs: elapsed,
        };
      }

      // No rule fired → default verdict.
      const elapsed = performance.now() - start;
      span.setAttribute('agentguard.policy.rule_id', '__default__');
      span.setAttribute('agentguard.policy.decision.allow', this.policy.default === 'allow');
      span.setStatus({ code: SpanStatusCode.OK });
      return {
        allow: this.policy.default === 'allow',
        decisionId,
        reason: 'default-deny',
        latencyMs: elapsed,
      };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private compileRule(rule: PolicyFile['rules'][number]): CompiledRule {
    // After schema transform, `rule.conditions` is always an array of
    // discriminated-union condition objects.
    const conditions = rule.conditions as unknown as Condition[];
    const out: CompiledRule = {
      id: rule.id,
      description: rule.description,
      toolNames: Array.isArray(rule.match.tool) ? rule.match.tool : [rule.match.tool],
      decision: rule.decision,
      reason: rule.reason,
      conditions,
    };
    if (rule.match.args) {
      out.argConstraints = { ...rule.match.args };
    }
    for (const c of conditions) {
      if (c.type === 'data_classification') {
        out.compiledDataClass = compileDataClass(c.config as DataClassConfig);
      }
    }
    return out;
  }

  private argsMatch(constraints: ArgConstraints | undefined, args: Record<string, unknown>): boolean {
    if (!constraints) return true;
    for (const [key, pattern] of Object.entries(constraints)) {
      const v = args[key];
      if (v === undefined) return false;
      if (!globMatch(String(v), pattern)) return false;
    }
    return true;
  }

  private async evaluateConditions(
    cr: CompiledRule,
    req: CheckRequest,
    role: string | undefined
  ): Promise<'allow' | 'deny' | null> {
    let verdict: 'allow' | 'deny' | null = null;

    for (const c of cr.conditions) {
      let step: 'allow' | 'deny' | null = null;
      switch (c.type) {
        case 'rbac': {
          step = evaluateRBAC(c.config as RBACConfig, role, req.tool);
          break;
        }
        case 'rate_limit': {
          const cfg = c.config as RateLimitConfig;
          const key = RateLimiter.makeKey(cfg.scope, req.agentId, req.tool);
          const ok = this.rateLimiter.check(key, cfg.max, RateLimiter.windowMs(cfg.window));
          step = ok ? null : 'deny';
          break;
        }
        case 'time_window': {
          step = evaluateTimeWindow(c.config as TimeWindowConfig);
          break;
        }
        case 'data_classification': {
          if (!cr.compiledDataClass) {
            step = null;
          } else {
            const m = evaluateDataClass(cr.compiledDataClass, req.args);
            step = m ? 'deny' : null;
          }
          break;
        }
      }
      if (step === null) continue;

      // First non-null condition sets the verdict; later conditions must agree
      // or we treat the rule as inapplicable.
      if (verdict === null) {
        verdict = step;
      } else if (verdict !== step) {
        // Conflicting conditions (e.g. RBAC says allow, rate_limit says deny).
        // The rule is skipped — log so operators can fix the policy.
        console.warn(
          `[agentguard] rule "${cr.id}" skipped: conditions conflict ` +
            `(verdict=${verdict}, condition=${c.type}→${step}). ` +
            `Fix the policy so conditions agree.`
        );
        return null;
      }
    }

    return verdict;
  }
}
