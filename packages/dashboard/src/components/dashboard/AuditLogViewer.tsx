import { useState, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, Filter, Download, RotateCcw } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { ViolationRow } from './ViolationRow';
import { SmartPagination } from '../ui/SmartPagination';
import { getAuditPage, mockAudit } from '../../lib/api';
import { useUiStore } from '../../lib/store';
import { exportCsv } from '../../lib/format';
import type { AuditEntry } from '../../lib/types';

const PAGE_SIZE = 50;

interface Page {
  items: AuditEntry[];
  nextCursor: number | null;
  total: number;
}

export function AuditLogViewer(): JSX.Element {
  const severity = useUiStore((s) => s.auditSeverity);
  const decision = useUiStore((s) => s.auditDecision);
  const search = useUiStore((s) => s.auditSearch);
  const setSeverity = useUiStore((s) => s.setAuditSeverity);
  const setDecision = useUiStore((s) => s.setAuditDecision);
  const setSearch = useUiStore((s) => s.setAuditSearch);
  const resetFilters = useUiStore((s) => s.resetFilters);

  const [localSearch, setLocalSearch] = useState(search);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Server-side cursor pagination: each page fetches PAGE_SIZE rows from
  // the sidecar using a cursor (the id of the last item in the previous page).
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery<Page>({
      queryKey: ['audit', 'paged'],
      initialPageParam: undefined as number | undefined,
      queryFn: async ({ pageParam }) => {
        const cursor = pageParam as number | undefined;
        try {
          return await getAuditPage(PAGE_SIZE, cursor);
        } catch {
          return {
            items: mockAudit.slice(0, PAGE_SIZE),
            nextCursor: null,
            total: mockAudit.length,
          };
        }
      },
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchInterval: 8000,
      staleTime: 3000,
    });

  const flat: AuditEntry[] = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return flat.filter((e) => {
      if (severity !== 'all' && e.severity !== severity) return false;
      if (decision !== 'all' && e.decision !== decision) return false;
      if (!term) return true;
      return (
        e.tool.toLowerCase().includes(term) ||
        e.agentId.toLowerCase().includes(term) ||
        (e.reason ?? '').toLowerCase().includes(term) ||
        (e.ruleId ?? '').toLowerCase().includes(term) ||
        e.id.toLowerCase().includes(term)
      );
    });
  }, [flat, severity, decision, search]);

  // Pagination over filtered results
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [severity, decision, search]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const exportFiltered = (): void => {
    exportCsv(
      `agentguard-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        agent: e.agentId,
        tool: e.tool,
        decision: e.decision,
        severity: e.severity,
        rule: e.ruleId ?? '',
        reason: e.reason ?? '',
        hash: e.hash,
        prevHash: e.prevHash,
      })),
    );
  };

  return (
    <Card>
      <header className="flex items-center justify-between gap-md flex-wrap mb-md">
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-primary" />
          <h2 className="text-base font-semibold">Audit Log</h2>
          <span className="text-xs text-text-muted font-mono">
            {filtered.length} / {flat.length} entries
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(localSearch);
            }}
            className="relative"
          >
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search tool, agent, rule…"
              className="h-9 w-64 pl-7 pr-2 rounded-md border border-border bg-surface text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search audit entries"
            />
          </form>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            className="h-9 px-2 rounded-md border border-border bg-surface text-sm"
            aria-label="Severity"
          >
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value as typeof decision)}
            className="h-9 px-2 rounded-md border border-border bg-surface text-sm"
            aria-label="Decision"
          >
            <option value="all">All decisions</option>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
            <option value="pending">Pending</option>
            <option value="error">Error</option>
          </select>
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            <RotateCcw size={14} />
            Reset
          </Button>
          <Button size="sm" variant="secondary" onClick={exportFiltered} disabled={filtered.length === 0}>
            <Download size={14} />
            Export CSV
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="block" height={48} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-xl text-text-muted text-sm">
          No audit entries match your filters.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {pageItems.map((e, i) => (
            <ViolationRow key={e.id} entry={e} defaultExpanded={i === 0 && page === 1} />
          ))}
        </ul>
      )}

      <div ref={sentinelRef} aria-hidden />

      {isFetchingNextPage && (
        <div className="mt-sm text-center text-xs text-text-muted">Loading more…</div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="mt-md pt-md border-t border-border flex justify-end">
          <SmartPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      <button
        type="button"
        onClick={() => refetch()}
        className="mt-sm text-xs text-text-muted hover:text-text"
      >
        Force refresh
      </button>
    </Card>
  );
}

export default AuditLogViewer;