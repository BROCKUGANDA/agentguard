/**
 * Sidecar API client — pure browser code.
 * Endpoints mirror packages/sidecar/src/http/server.ts.
 */

import type {
  AgentStatus,
  AuditEntry,
  ChainIntegrity,
  HealthInfo,
  KpiSummary,
  PolicySet,
} from './types';

// Default points at the locally-running sidecar. Override via Vite env (VITE_SIDECAR_URL).
const DEFAULT_BASE = '/api';

// ─── Tenant scoping ─────────────────────────────────────────────────────────
// The dashboard's entire view (audit, agents, KPIs, policies, alerts, stream)
// is scoped to one tenant id, persisted in localStorage and sent to the sidecar
// as the `X-Tenant-Id` header. Each tenant has its own policy file + audit DB.
const TENANT_STORAGE_KEY = 'agentguard.tenant';
const TOKEN_STORAGE_KEY = 'agentguard.admin-token';

export function getTenantId(): string {
  try {
    const v = localStorage.getItem(TENANT_STORAGE_KEY);
    return v && v.trim().length > 0 ? v.trim().toLowerCase() : 'default';
  } catch {
    return 'default';
  }
}

export function setTenantId(id: string): void {
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, id.trim().toLowerCase());
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Admin token (AGENTGUARD_ADMIN_TOKEN on the sidecar). Stored locally and
 * attached as a Bearer header on admin routes (verify / policies reload /
 * alerts). When unset those routes still work against a dev sidecar that
 * has no token configured.
 */
export function getAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token.trim().length > 0) localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore quota errors */
  }
}

function baseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const v = env?.VITE_SIDECAR_URL;
  if (v && v.length > 0) return v.replace(/\/$/, '');
  return DEFAULT_BASE;
}

export interface SidecarStatus {
  reachable: boolean;
  lastError?: string;
}

const status: SidecarStatus = { reachable: true };
const listeners = new Set<(s: SidecarStatus) => void>();

export function getSidecarStatus(): SidecarStatus {
  return status;
}

export function subscribeSidecarStatus(fn: (s: SidecarStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function setStatus(next: SidecarStatus): void {
  Object.assign(status, next);
  listeners.forEach((fn) => fn(status));
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const token = getAdminToken();
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': getTenantId(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    setStatus({ reachable: true });
    return (await res.json()) as T;
  } catch (err) {
    setStatus({ reachable: false, lastError: (err as Error).message });
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getHealth(): Promise<HealthInfo> {
  return request<HealthInfo>('/health');
}

export interface TenantInfo {
  id: string;
  provisioned: boolean;
  rules: number;
  audit_entries: number;
  created_at: string | null;
}

export async function getTenants(): Promise<TenantInfo[]> {
  return request<TenantInfo[]>('/tenants');
}

export async function getRecentAudit(limit = 50): Promise<AuditEntry[]> {
  return request<AuditEntry[]>(`/audit/recent?limit=${encodeURIComponent(String(limit))}`);
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: number | null;
  total: number;
}

export async function getAuditPage(limit = 50, cursor?: number): Promise<AuditPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) params.set('cursor', String(cursor));
  return request<AuditPage>(`/audit/recent?${params.toString()}`);
}

export async function getAuditByAgent(agentId: string, since?: string): Promise<AuditEntry[]> {
  const params = new URLSearchParams({ agentId });
  if (since) params.set('since', since);
  return request<AuditEntry[]>(`/audit/by-agent?${params.toString()}`);
}

export async function verifyAudit(): Promise<ChainIntegrity> {
  return request<ChainIntegrity>('/audit/verify', { method: 'POST' });
}

export async function getPolicies(): Promise<PolicySet> {
  return request<PolicySet>('/policies');
}

export async function reloadPolicies(): Promise<PolicySet> {
  return request<PolicySet>('/policies/reload', { method: 'POST' });
}

export async function getAgents(): Promise<AgentStatus[]> {
  return request<AgentStatus[]>('/agents');
}

export async function getKpis(): Promise<KpiSummary> {
  return request<KpiSummary>('/kpis');
}

// ─── Alerts ──────────────────────────────────────────────────────────────

export interface AlertEntry {
  id: number;
  ts: number;
  decision_id: string;
  rule_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  agent_id: string;
  tool: string;
  reason: string | null;
  webhook_url: string | null;
  delivery_status: 'pending' | 'delivered' | 'failed';
  delivery_error: string | null;
  delivered_at: number | null;
}

export async function getRecentAlerts(
  limit = 100,
  filter?: { severity?: string; rule_id?: string }
): Promise<AlertEntry[]> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (filter?.severity) params.set('severity', filter.severity);
  if (filter?.rule_id) params.set('rule_id', filter.rule_id);
  return request<AlertEntry[]>(`/alerts/recent?${params.toString()}`);
}

export interface TestFireBody {
  severity?: 'info' | 'warning' | 'critical';
  webhook?: string;
  rule_id?: string;
  agent_id?: string;
  tool?: string;
}

export async function testFireAlert(body: TestFireBody): Promise<{ ok: boolean; decision: { decisionId: string } }> {
  return request('/alerts/test-fire', { method: 'POST', body: JSON.stringify(body) });
}

// ─── Mock fallback data ────────────────────────────────────────────────
// Used when the sidecar is unreachable so the dashboard still renders.
import type { AgentStatus as _AgentStatus } from './types';

export const mockAudit: AuditEntry[] = [
  {
    id: 'a-001',
    timestamp: new Date(Date.now() - 1000 * 12).toISOString(),
    agentId: 'demo-agent',
    tool: 'filesystem.read_file',
    decision: 'allow',
    ruleId: 'rbac-developer-allow',
    severity: 'info',
    args: { path: '/srv/data/report.csv' },
    hash: '9f2c…e1',
    prevHash: '0000…00',
  },
  {
    id: 'a-002',
    timestamp: new Date(Date.now() - 1000 * 28).toISOString(),
    agentId: 'researcher',
    tool: 'filesystem.read_file',
    decision: 'deny',
    ruleId: 'rbac-guest-cannot-read-secrets',
    reason: 'guest role denied access to secrets',
    severity: 'critical',
    args: { path: '/secrets/api-keys.json' },
    hash: '3a81…0c',
    prevHash: '9f2c…e1',
  },
  {
    id: 'a-003',
    timestamp: new Date(Date.now() - 1000 * 41).toISOString(),
    agentId: 'demo-agent',
    tool: 'email.send',
    decision: 'deny',
    ruleId: 'pii-redact-email',
    reason: 'PII detected in email payload',
    severity: 'critical',
    args: { to: 'partner@acme.io', subject: 'Invoice 4242-4242-4242-4242' },
    hash: '71cd…42',
    prevHash: '3a81…0c',
  },
  {
    id: 'a-004',
    timestamp: new Date(Date.now() - 1000 * 55).toISOString(),
    agentId: 'writer',
    tool: 'filesystem.write_file',
    decision: 'allow',
    ruleId: 'rbac-developer-allow',
    severity: 'info',
    args: { path: '/srv/data/draft.md', content: '# Draft' },
    hash: 'b20a…ff',
    prevHash: '71cd…42',
  },
  {
    id: 'a-005',
    timestamp: new Date(Date.now() - 1000 * 70).toISOString(),
    agentId: 'demo-agent',
    tool: 'filesystem.delete_file',
    decision: 'deny',
    ruleId: 'time-window-production-db',
    reason: 'Production DB delete blocked outside 09:00-17:00 UTC',
    severity: 'warning',
    args: { path: '/srv/prod/db.sqlite' },
    hash: '5e12aa',
    prevHash: 'b20aff',
  },
  {
    id: 'a-006',
    timestamp: new Date(Date.now() - 1000 * 90).toISOString(),
    agentId: 'researcher',
    tool: 'filesystem.read_file',
    decision: 'deny',
    ruleId: 'rate-limit-read-file',
    reason: 'Rate limit exceeded (30/min)',
    severity: 'warning',
    args: { path: '/srv/data/index.json' },
    hash: 'cc44…90',
    prevHash: '5e12…aa',
  },
];

export const mockAgents: _AgentStatus[] = [
  {
    agentId: 'demo-agent',
    role: 'developer',
    state: 'acting',
    lastSeen: new Date(Date.now() - 1000 * 3).toISOString(),
    callsLastHour: 142,
    blocksLastHour: 2,
  },
  {
    agentId: 'researcher',
    role: 'reader',
    state: 'thinking',
    lastSeen: new Date(Date.now() - 1000 * 8).toISOString(),
    callsLastHour: 28,
    blocksLastHour: 5,
  },
  {
    agentId: 'writer',
    role: 'developer',
    state: 'idle',
    lastSeen: new Date(Date.now() - 1000 * 60).toISOString(),
    callsLastHour: 14,
    blocksLastHour: 0,
  },
  {
    agentId: 'guest-bot',
    role: 'guest',
    state: 'blocked',
    lastSeen: new Date(Date.now() - 1000 * 4).toISOString(),
    callsLastHour: 9,
    blocksLastHour: 9,
  },
];

export const mockPolicy: PolicySet = {
  version: '1',
  default: 'deny',
  rules: [
    {
      id: 'time-window-production-db',
      description: 'Production DB access only during business hours UTC',
      decision: 'deny',
      tool: 'filesystem.delete_file',
      reason: 'Production DB delete blocked outside 09:00–17:00 UTC',
    },
    {
      id: 'pii-redact-email',
      description: 'Block emails containing SSN / credit-card / email-as-data',
      decision: 'deny',
      tool: 'email.send',
      reason: 'PII detected in email payload',
    },
    {
      id: 'rbac-guest-cannot-read-secrets',
      description: 'guest role cannot read files under /secrets',
      decision: 'deny',
      tool: 'filesystem.read_file',
      reason: 'guest role denied access to secrets',
    },
    {
      id: 'rate-limit-read-file',
      description: 'Read at most 30/min per agent',
      decision: 'deny',
      tool: 'filesystem.read_file',
      reason: 'Rate limit exceeded (30/min)',
    },
    {
      id: 'rbac-developer-allow',
      description: 'developer role can read+write most files',
      decision: 'allow',
      tool: ['filesystem.read_file', 'filesystem.write_file'],
    },
  ],
  agents: {
    '*': { role: 'guest' },
    'demo-agent': { role: 'developer' },
    researcher: { role: 'reader' },
    writer: { role: 'developer' },
  },
  updatedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
};

export const mockKpis: KpiSummary = {
  allowed: 184,
  blocked: 12,
  pending: 3,
  avgLatencyMs: 7.4,
  chainIntegrity: {
    verified: true,
    totalEntries: 199,
    lastVerifiedAt: new Date(Date.now() - 1000 * 30).toISOString(),
  },
};

export const mockHealth: HealthInfo = {
  ok: true,
  version: '0.1.0',
  uptime: 3600 * 4 + 120,
  policies: { version: '1', ruleCount: mockPolicy.rules.length },
  audit: { entries: 199, lastEntryAt: new Date(Date.now() - 1000 * 3).toISOString() },
};

export const mockAlerts: AlertEntry[] = [
  {
    id: 1,
    ts: Date.now() - 1000 * 60 * 2,
    decision_id: 'mock-dec-1',
    rule_id: 'time-window-production-db',
    severity: 'critical',
    agent_id: 'demo-agent',
    tool: 'filesystem.delete_file',
    reason: 'Production DB delete blocked outside 09:00–17:00 UTC',
    webhook_url: 'https://hooks.slack.com/services/T000/B000/MOCK',
    delivery_status: 'delivered',
    delivery_error: null,
    delivered_at: Date.now() - 1000 * 60 * 2 + 250,
  },
  {
    id: 2,
    ts: Date.now() - 1000 * 60 * 14,
    decision_id: 'mock-dec-2',
    rule_id: 'pii-redact-email',
    severity: 'critical',
    agent_id: 'demo-agent',
    tool: 'email.send',
    reason: 'PII detected in email payload',
    webhook_url: 'https://hooks.slack.com/services/T000/B000/MOCK',
    delivery_status: 'delivered',
    delivery_error: null,
    delivered_at: Date.now() - 1000 * 60 * 14 + 180,
  },
  {
    id: 3,
    ts: Date.now() - 1000 * 60 * 32,
    decision_id: 'mock-dec-3',
    rule_id: 'github-merge-requires-admin',
    severity: 'warning',
    agent_id: 'researcher',
    tool: 'github.merge_pull_request',
    reason: 'Only admins can merge PRs',
    webhook_url: 'https://hooks.slack.com/services/T000/B000/MOCK',
    delivery_status: 'failed',
    delivery_error: 'HTTP 403: inactive_webhook',
    delivered_at: null,
  },
  {
    id: 4,
    ts: Date.now() - 1000 * 60 * 58,
    decision_id: 'mock-dec-4',
    rule_id: 'rate-limit-read-file',
    severity: 'warning',
    agent_id: 'researcher',
    tool: 'filesystem.read_file',
    reason: 'Rate limit exceeded (30/min)',
    webhook_url: null,
    delivery_status: 'pending',
    delivery_error: null,
    delivered_at: null,
  },
];