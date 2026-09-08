import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { AuditEntryModal } from './AuditEntryModal';
import { getRecentAudit, mockAudit } from '../../lib/api';
import { shortenHash } from '../../lib/format';
import { decisionToTone } from '../ui/Badge';
import type { AuditEntry } from '../../lib/types';

interface LiveFeedProps {
  limit?: number;
  compact?: boolean;
}

function LoadingSkeleton({ limit }: { limit: number }): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: limit }).map((_, i) => (
        <Skeleton key={i} variant="block" height={48} className="w-full" />
      ))}
    </div>
  );
}

export function LiveFeed({ limit = 8, compact = false }: LiveFeedProps): JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery<AuditEntry[]>({
    queryKey: ['audit', 'recent', limit],
    queryFn: () => getRecentAudit(limit).catch(() => mockAudit.slice(0, limit)),
    refetchInterval: 5000,
    staleTime: 1500,
  });

  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const items = (data ?? mockAudit.slice(0, limit));

  return (
    <Card className="flex flex-col h-full">
      <header className="flex items-center justify-between mb-md">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          <h2 className="text-base font-semibold">Live Feed</h2>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-xs text-text-muted hover:text-text"
          aria-label="Refresh feed"
        >
          refresh
        </button>
      </header>

      {isLoading ? (
        <LoadingSkeleton limit={limit} />
      ) : isError && !data ? (
        <div className="flex items-center gap-2 text-warning text-sm py-md">
          <ShieldAlert size={16} />
          <span>Using fallback data — sidecar unreachable</span>
        </div>
      ) : null}

      <ul className="space-y-1.5 -mx-sm">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center gap-3 px-sm py-1.5 rounded-md hover:bg-border/30 transition-colors cursor-pointer"
            onClick={() => setSelected(entry)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(entry); }}
          >
            <Badge tone={decisionToTone(entry.decision)} size="sm">
              {entry.decision.toUpperCase()}
            </Badge>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-muted truncate">
                  {entry.agentId}
                </span>
                <span className="text-text-muted text-xs">·</span>
                <span className="font-mono text-xs text-text truncate">
                  {entry.tool}
                </span>
              </div>
              {!compact && entry.reason && (
                <div className="text-xs text-text-muted truncate mt-0.5">{entry.reason}</div>
              )}
            </div>
            <div className="flex items-center gap-2 text-text-muted shrink-0">
              <Clock size={12} />
              <span className="font-mono text-[11px]">
                {shortenHash(entry.hash)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <AuditEntryModal entry={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

export default LiveFeed;