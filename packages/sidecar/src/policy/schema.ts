import { z } from 'zod';

/**
 * Policy file schema — mirrors `policies/agentguard.yaml`.
 * Validated on load. Anything not in this schema is rejected.
 */

// ─── Primitive atoms ────────────────────────────────────────────────────────

const RoleName = z.string().min(1);
const ToolName = z.string().min(1);

// Glob pattern: * is wildcard, otherwise literal match.
// Examples: "filesystem.delete_file", "*prod*", "*.log"
const GlobPattern = z.string().min(1);

/** A single arg match: { key: globPattern } */
const ArgMatch = z.record(GlobPattern);

// ─── Conditions (discriminated union by `type`) ────────────────────────────

const TimeWindowConfig = z.object({
  tz: z.string().min(1),
  allow: z
    .array(
      z.object({
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM expected'),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM expected'),
        weekdays: z
          .array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
          .optional(),
      })
    )
    .min(1),
  invert: z.boolean().optional(),
});

const DataClassPattern = z.object({
  name: z.string().min(1),
  regex: z.string().min(1).max(500),
});

const DataClassConfig = z.object({
  patterns: z.array(DataClassPattern).min(1),
  /** Dot-path args.* fields to scan. e.g. ["args.subject", "args.body"] */
  match_on: z.array(z.string().min(1)).min(1),
  /** Text substitution for redact decisions. Defaults to "[REDACTED:<name>]" per pattern. */
  replacement: z.string().optional(),
});

const RBACConfig = z.object({
  role: z.union([RoleName, z.array(RoleName).min(1)]),
  resource: z.string().min(1).optional(),
  action: z.enum(['allow', 'deny']),
});

const RateLimitConfig = z.object({
  max: z.number().int().positive(),
  window: z.enum(['1s', '1m', '5m', '1h']),
  scope: z.enum(['agent_tool', 'tool', 'agent']),
});

export const ConditionSchema = z.union([
  z.object({ type: z.literal('time_window'), config: TimeWindowConfig }),
  z.object({ type: z.literal('data_classification'), config: DataClassConfig }),
  z.object({ type: z.literal('rbac'), config: RBACConfig }),
  z.object({ type: z.literal('rate_limit'), config: RateLimitConfig }),
]);

// ─── Rules ──────────────────────────────────────────────────────────────────

const RuleMatch = z.object({
  tool: z.union([ToolName, z.array(ToolName).min(1)]),
  args: ArgMatch.optional(),
});

// Decision enum shared by rules; 'redact' = allow after masking matched fields.
const DecisionEnum = z.enum(['allow', 'deny', 'redact']);

/**
 * A single condition in raw form — `{ type: 'rbac', config: {...} }`.
 * For ergonomics we also accept the shorter YAML form
 * `{ rbac: {...} }` and infer the type from the key.
 */
const RawCondition = z.union([
  ConditionSchema,
  z
    .object({
      rbac: RBACConfig.optional(),
      rate_limit: RateLimitConfig.optional(),
      time_window: TimeWindowConfig.optional(),
      data_classification: DataClassConfig.optional(),
    })
    .transform((v, ctx) => {
      const entries = Object.entries(v).filter(([, x]) => x !== undefined) as Array<
        ['rbac' | 'rate_limit' | 'time_window' | 'data_classification', unknown]
      >;
      if (entries.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'condition block must contain exactly one of rbac/rate_limit/time_window/data_classification',
        });
        return z.NEVER;
      }
      const [type, config] = entries[0];
      return { type, config } as { type: string; config: unknown };
    }),
]);

export const RuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  match: RuleMatch,
  decision: DecisionEnum,
  reason: z.string().optional(),
  /**
   * Conditions may be either:
   *   - a single condition object (short form), OR
   *   - an array of condition objects (multi-condition form).
   * The short form is what `policies/agentguard.yaml` uses today; the array
   * form is the explicit form for AND-combined conditions.
   */
  conditions: z.union([
    RawCondition,
    z.array(RawCondition).min(1),
  ]),
}).transform((rule) => ({
  ...rule,
  conditions: Array.isArray(rule.conditions) ? rule.conditions : [rule.conditions],
}));

/**
 * Normalized rule shape: conditions is always an array.
 */
export type NormalizedRule = {
  id: string;
  description?: string;
  match: { tool: string | string[]; args?: Record<string, string> };
  decision: 'allow' | 'deny' | 'redact';
  reason?: string;
  conditions: Condition[];
};

// ─── Alerts ─────────────────────────────────────────────────────────────────

export const AlertSchema = z.object({
  on_decision: z.enum(['allow', 'deny']),
  severity: z.enum(['info', 'warning', 'critical']),
  webhook: z.string().optional(),
  rule_ids: z.array(z.string()).optional(),
});

// ─── Policy file ────────────────────────────────────────────────────────────

export const PolicyFileSchema = z.object({
  version: z.string(),
  default: z.enum(['allow', 'deny']),
  agents: z.record(z.string(), z.object({ role: z.string().min(1) })).optional(),
  rules: z.array(RuleSchema).min(1),
  alerts: z.array(AlertSchema).optional(),
});

// ─── HTTP API shapes ────────────────────────────────────────────────────────

export const CheckRequestSchema = z.object({
  agentId: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  /** Optional override; otherwise looked up via agents map */
  role: z.string().optional(),
});

export const DecisionSchema = z.object({
  allow: z.boolean(),
  decisionId: z.string(),
  reason: z.string().optional(),
  ruleId: z.string().optional(),
  latencyMs: z.number().nonnegative(),
  /** Present on redact decisions — the masked args the caller MUST substitute. */
  redactedArgs: z.record(z.unknown()).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
});

export type TimeWindowConfig = z.infer<typeof TimeWindowConfig>;
export type DataClassConfig = z.infer<typeof DataClassConfig>;
export type RBACConfig = z.infer<typeof RBACConfig>;
export type RateLimitConfig = z.infer<typeof RateLimitConfig>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type PolicyFile = z.infer<typeof PolicyFileSchema>;
export type CheckRequest = z.infer<typeof CheckRequestSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
