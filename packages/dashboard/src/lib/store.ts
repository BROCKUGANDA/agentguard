/**
 * Client state (UI selections, filters) — Zustand store.
 * Server state lives in TanStack Query (api.ts) and ws.ts.
 */

import { create } from 'zustand';

export type AuditSeverityFilter = 'all' | 'info' | 'warning' | 'critical';
export type AuditDecisionFilter = 'all' | 'allow' | 'deny' | 'pending' | 'error';

interface FilterState {
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;

  auditSeverity: AuditSeverityFilter;
  setAuditSeverity: (s: AuditSeverityFilter) => void;

  auditDecision: AuditDecisionFilter;
  setAuditDecision: (d: AuditDecisionFilter) => void;

  auditSearch: string;
  setAuditSearch: (s: string) => void;

  resetFilters: () => void;
}

export const useUiStore = create<FilterState>((set) => ({
  selectedAgentId: null,
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  auditSeverity: 'all',
  setAuditSeverity: (s) => set({ auditSeverity: s }),

  auditDecision: 'all',
  setAuditDecision: (d) => set({ auditDecision: d }),

  auditSearch: '',
  setAuditSearch: (s) => set({ auditSearch: s }),

  resetFilters: () =>
    set({
      selectedAgentId: null,
      auditSeverity: 'all',
      auditDecision: 'all',
      auditSearch: '',
    }),
}));