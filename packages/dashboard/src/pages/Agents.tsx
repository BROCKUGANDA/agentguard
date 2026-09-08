import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Search, Filter } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { AgentStatusCard } from '../components/dashboard/AgentStatusCard';
import { AgentDetailModal } from '../components/dashboard/AgentDetailModal';
import { getAgents, mockAgents } from '../lib/api';
import { useUiStore } from '../lib/store';
import type { AgentState, AgentStatus } from '../lib/types';

const STATE_FILTERS: Array<{ value: AgentState | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'idle', label: 'Idle' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'acting', label: 'Acting' },
  { value: 'blocked', label: 'Blocked' },
];

export function Agents(): JSX.Element {
  const { data, isLoading } = useQuery<AgentStatus[]>({
    queryKey: ['agents'],
    queryFn: () => getAgents().catch(() => mockAgents),
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const [stateFilter, setStateFilter] = useState<AgentState | 'all'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const filtered = useMemo(() => {
    const agents = data ?? mockAgents;
    const term = debouncedSearch.trim().toLowerCase();
    return agents.filter((a) => {
      if (stateFilter !== 'all' && a.state !== stateFilter) return false;
      if (!term) return true;
      return (
        a.agentId.toLowerCase().includes(term) ||
        a.role.toLowerCase().includes(term)
      );
    });
  }, [data, stateFilter, debouncedSearch]);

  const summary = useMemo(() => {
    const all = data ?? mockAgents;
    return {
      total: all.length,
      blocked: all.filter((a) => a.state === 'blocked').length,
      thinking: all.filter((a) => a.state === 'thinking' || a.state === 'acting').length,
      idle: all.filter((a) => a.state === 'idle').length,
    };
  }, [data]);

  return (
    <div className="ag-page-enter">
      <Header title="Agents" subtitle="Track every agent identity, role and live activity state" />

      <main className="p-lg space-y-lg">
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-md">
          <SummaryTile label="Total" value={summary.total} tone="primary" />
          <SummaryTile label="Active" value={summary.thinking} tone="info" />
          <SummaryTile label="Idle" value={summary.idle} tone="neutral" />
          <SummaryTile label="Blocked" value={summary.blocked} tone={summary.blocked > 0 ? 'error' : 'neutral'} />
        </section>

        <Card>
          <header className="flex flex-wrap items-center justify-between gap-md">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-primary" />
              <h2 className="text-base font-semibold">Fleet</h2>
              <span className="text-xs text-text-muted font-mono">
                {filtered.length} matched
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search agent or role…"
                  className="h-9 w-56 pl-7 pr-2 rounded-md border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-surface">
                <Filter size={12} className="text-text-muted ml-1.5" />
                {STATE_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStateFilter(f.value)}
                    className={`h-7 px-2.5 rounded-sm text-xs font-medium transition-colors ${
                      stateFilter === f.value
                        ? 'bg-primary text-white'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <Badge tone="info" size="sm" outline>
                {summary.total} known
              </Badge>
            </div>
          </header>
        </Card>

        <section
          aria-label="Agent status cards"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-md"
        >
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} variant="block" height={180} className="w-full" />
              ))
            : filtered.map((a) => (
                <AgentStatusCard
                  key={a.agentId}
                  agent={a}
                  selected={selectedAgentId === a.agentId}
                  onSelect={setSelectedAgentId}
                />
              ))}
          {!isLoading && filtered.length === 0 && (
            <div className="col-span-full text-center py-xl text-text-muted">
              No agents match your filters.
            </div>
          )}
        </section>
      </main>

      <AgentDetailModal
        agentId={selectedAgentId}
        onClose={() => setSelectedAgentId(null)}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'success' | 'error' | 'info' | 'neutral';
}): JSX.Element {
  const toneClass =
    tone === 'error'
      ? 'text-error'
      : tone === 'success'
        ? 'text-success'
        : tone === 'info'
          ? 'text-info'
          : tone === 'primary'
            ? 'text-primary'
            : 'text-text';
  return (
    <Card padded>
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-semibold font-mono ${toneClass}`}>{value}</div>
    </Card>
  );
}

export default Agents;