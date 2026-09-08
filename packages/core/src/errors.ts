/**
 * AgentGuard error hierarchy.
 *
 * All errors carry a stable {@link decisionId} (when one was issued by the
 * sidecar) so callers can correlate a thrown error with an audit log entry.
 */

export interface AgentGuardErrorMeta {
  /** ID returned by the sidecar for the decision that produced this error. */
  decisionId?: string;
  /** Policy identifier (e.g. the OPA policy path) that made the decision. */
  policy?: string;
  /** HTTP / network status when relevant. */
  status?: number;
}

/**
 * Base class for every error raised by AgentGuard. Consumers can catch this
 * to handle *any* AgentGuard failure uniformly while still narrowing on the
 * concrete subclass for more specific behaviour.
 */
export class AgentGuardError extends Error {
  readonly decisionId: string | undefined;
  readonly policy: string | undefined;
  readonly status: number | undefined;
  /** Original cause (network error, validation error, etc.). */
  override readonly cause?: unknown;

  constructor(
    message: string,
    meta: AgentGuardErrorMeta = {},
    options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.decisionId = meta.decisionId;
    this.policy = meta.policy;
    this.status = meta.status;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    // Maintain a clean prototype chain across the extends Error boundary.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the sidecar returns an `allow: false` decision. The original
 * tool call was *not* executed — the caller's downstream code must see this
 * as a hard failure.
 */
export class AgentGuardBlockedError extends AgentGuardError {
  readonly decision: import('./types.js').PolicyDecision | undefined;

  constructor(
    message: string,
    decision?: import('./types.js').PolicyDecision,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      decision
        ? { decisionId: decision.decisionId, policy: decision.policy, status: 403 }
        : {},
      options,
    );
    this.decision = decision;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the sidecar is unreachable (network error, timeout, non-2xx
 * response with no parseable body). When `failClosed=false` the policy client
 * will instead swallow the error and emit a synthetic `allow` with
 * `policy: 'fail-open'`; this exception is only thrown in fail-closed mode.
 */
export class AgentGuardUnreachableError extends AgentGuardError {
  constructor(
    message: string,
    meta: AgentGuardErrorMeta = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, { ...meta, status: meta.status ?? 503 }, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}