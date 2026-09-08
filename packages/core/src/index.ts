/**
 * @agentguard/core — public API.
 *
 * Import everything you need from here:
 *
 *   import { wrapMCP, guardedAgent, AgentGuardBlockedError } from '@agentguard/core';
 */

export { wrapMCP } from './wrapMCP.js';
export { wrapCallTool } from './wrapCallTool.js';
export { guardedAgent } from './agent-guard.js';
export type { GuardedAgent, GuardedAgentOptions, GuardMCP } from './agent-guard.js';
export type { CallToolFn, WrapCallToolOptions } from './wrapCallTool.js';

export { HttpPolicyClient, createHttpPolicyClient } from './policy-client.js';

export {
  AgentGuardError,
  AgentGuardBlockedError,
  AgentGuardUnreachableError,
} from './errors.js';
export type { AgentGuardErrorMeta } from './errors.js';

export type {
  PolicyCheckRequest,
  PolicyClient,
  PolicyDecision,
  OnDecision,
  WrapOptions,
  MCPHandle,
} from './types.js';