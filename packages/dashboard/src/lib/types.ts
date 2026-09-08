/**
 * AgentGuard domain types — shared shapes mirroring the sidecar API.
 * Pure browser code; no imports from @agentguard/core or @agentguard/sidecar.
 */

export type Decision = 'allow' | 'deny' | 'pending' | 'error';

export type Severity = 'info' | 'warning' | 'critical';

export type AgentState = 'idle' | 'thinking' | 'acting' | 'blocked';

export interface AuditEntry {
  id: string;
  timestamp: string;       // ISO-8601
  agentId: string;
  tool: string;
  decision: Decision;
  reason?: string;
  ruleId?: string;
  severity: Severity;
  args?: Record<string, unknown>;
  hash: string;            // SHA-256 of entry
  prevHash: string;        // chain link
}

export interface AgentStatus {
  agentId: string;
  role: string;
  state: AgentState;
  lastSeen: string;
  callsLastHour: number;
  blocksLastHour: number;
}

export interface PolicyRule {
  id: string;
  description?: string;
  decision: Decision;
  tool?: string | string[];
  reason?: string;
}

export interface PolicySet {
  version: string;
  default: Decision;
  rules: PolicyRule[];
  agents: Record<string, { role: string }>;
  source?: string;        // raw YAML on the wire
  updatedAt?: string;
}

export interface ChainIntegrity {
  verified: boolean;
  totalEntries: number;
  lastVerifiedAt: string;
  brokenAt?: string;       // entry ID where the chain first broke
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  uptime?: number;
  rules_loaded?: number;
  audit_count?: number;
  alert_count?: number;
  alert_failures?: number;
  policies?: { version: string; ruleCount: number };
  audit?: { entries: number; lastEntryAt: string };
}

export interface KpiSummary {
  allowed: number;
  blocked: number;
  pending: number;
  avgLatencyMs: number;
  chainIntegrity: ChainIntegrity;
}

export interface WsEvent {
  type: 'audit' | 'agent' | 'policy' | 'heartbeat';
  payload: unknown;
}