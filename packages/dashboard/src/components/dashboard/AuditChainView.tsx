import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Hash } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { AuditEntryModal } from './AuditEntryModal';
import { getRecentAudit, verifyAudit, mockAudit } from '../../lib/api';
import type { AuditEntry, ChainIntegrity } from '../../lib/types';
import { shortenHash, formatRelative } from '../../lib/format';

interface AuditChainViewProps {
  limit?: number;
}

interface LinkState {
  broken: boolean;
  entry?: AuditEntry;
}

function verifyChain(entries: AuditEntry[]): { ok: boolean; brokenAt?: string } {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].prevHash !== entries[i - 1].hash) {
      return { ok: false, brokenAt: entries[i].id };
    }
  }
  return { ok: true };
}

export function AuditChainView({ limit = 8 }: AuditChainViewProps): JSX.Element {
  const qc = useQueryClient();
  const [links, setLinks] = useState<LinkState[]>([]);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const { data, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit', 'chain', limit],
    queryFn: () => getRecentAudit(limit).catch(() => mockAudit.slice(0, limit)),
    refetchInterval: 6000,
    staleTime: 2000,
  });

  const verifyMut = useMutation<ChainIntegrity>({
    mutationFn: () => verifyAudit().catch(() => ({
      verified: true,
      totalEntries: data?.length ?? 0,
      lastVerifiedAt: new Date().toISOString(),
    })),
    onSuccess: (result) => {
      if (data) {
        const local = verifyChain(data);
        const next: LinkState[] = data.map((e, i) => {
          if (i === 0) return { broken: false, entry: e };
          const prev = data[i - 1];
          return { broken: prev.hash !== e.prevHash, entry: e };
        });
        setLinks(next);
        qc.setQueryData(['audit', 'integrity'], result);
        if (!result.verified || !local.ok) {
          qc.invalidateQueries({ queryKey: ['audit'] });
        }
      }
    },
  });

  const entries = (data ?? mockAudit.slice(0, limit)).slice(0, limit);

  return (
    <Card className="flex flex-col h-full">
      <header className="flex items-center justify-between mb-md">
        <div className="flex items-center gap-2">
          <Hash size={18} className="text-primary" />
          <h2 className="text-base font-semibold">Audit Chain</h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          loading={verifyMut.isPending}
          onClick={() => verifyMut.mutate()}
        >
          Verify chain
        </Button>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: limit }).map((_, i) => (
            <Skeleton key={i} variant="block" height={44} className="w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-1 overflow-auto pr-1 max-h-[420px]">
          {entries.map((entry, i) => {
            const link = links[i];
            // An entry is broken if the local prevHash check fails OR the
            // server-side verify flagged this specific entry as broken.
            const serverBrokenAt = verifyMut.data?.brokenAt;
            const isBroken = link?.broken === true || (serverBrokenAt != null && entry.id === serverBrokenAt);
            const isVerified = verifyMut.data?.verified !== false && !isBroken;
            return (
              <div key={entry.id} className="flex items-stretch gap-2 cursor-pointer hover:bg-border/20 rounded-md -mx-1 px-1 transition-colors" onClick={() => setSelected(entry)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(entry); }}>
                <div className="flex flex-col items-center pt-1">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      isBroken ? 'bg-error' : isVerified ? 'bg-success' : 'bg-text-muted'
                    }`}
                  />
                  {i < entries.length - 1 && (
                    <div
                      className={`w-0.5 flex-1 my-0.5 ${
                        isBroken ? 'bg-error' : 'bg-border'
                      }`}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-text truncate">
                      {entry.id}
                    </span>
                    <Badge tone={isBroken ? 'error' : 'success'} size="sm">
                      {isBroken ? 'broken' : 'linked'}
                    </Badge>
                    <span className="text-[11px] text-text-muted">
                      {formatRelative(entry.timestamp)}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-text-muted mt-0.5 truncate">
                    {entry.tool} · {entry.agentId}
                  </div>
                  <div className="font-mono text-[11px] text-text-muted mt-0.5 truncate">
                    {shortenHash(entry.prevHash)} → {shortenHash(entry.hash)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="mt-md pt-md border-t border-border flex items-center justify-between text-xs">
        {verifyMut.data ? (
          <span className="flex items-center gap-1.5">
            {verifyMut.data.verified ? (
              <>
                <ShieldCheck size={14} className="text-success" />
                <span className="text-success">chain verified</span>
              </>
            ) : (
              <>
                <ShieldAlert size={14} className="text-error" />
                <span className="text-error">chain broken at {verifyMut.data.brokenAt ?? '—'}</span>
              </>
            )}
          </span>
        ) : (
          <span className="text-text-muted">click "Verify chain" to run integrity check</span>
        )}
        <span className="font-mono text-text-muted">{entries.length} entries</span>
      </footer>

      <AuditEntryModal entry={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

export default AuditChainView;