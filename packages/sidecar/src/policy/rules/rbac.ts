import type { RBACConfig } from '../schema.js';

/**
 * Pure RBAC check.
 *
 * - `role` may be a single string or an array (any-of).
 * - `resource` is matched by literal equality against the caller-provided resource.
 *   We treat "no resource constraint on the config" as "always matches the role".
 *
 * Returns:
 *   - 'allow' if the rule's action is 'allow' and the role matches.
 *   - 'deny'  if the rule's action is 'deny'  and the role matches.
 *   - null    if the role does not match this rule (engine should keep walking rules).
 */
export function evaluateRBAC(
  cond: RBACConfig,
  role: string | undefined,
  resource: string
): 'allow' | 'deny' | null {
  // Resource gate — if the rule names a resource and we don't match, no decision.
  if (cond.resource !== undefined && cond.resource !== resource) {
    return null;
  }

  // Role gate — if no caller role is provided, this rule can't fire.
  if (role === undefined) {
    return null;
  }

  const roles = Array.isArray(cond.role) ? cond.role : [cond.role];
  if (!roles.includes(role)) {
    return null;
  }

  return cond.action;
}
