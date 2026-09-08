import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Clock, Activity, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { AgentStatusDot } from '../ui/AgentStatusDot';
import { getAuditByAgent, getAgents } from '../../lib/api';
import { formatRelative, formatExact, shortenHash } from '../../lib/format';
import { decisionToTone } from '../ui/Badge';
import type { AgentStatus, AuditEntry } from '../../lib/types';

interface AgentDetailModalProps {
  agentId: string | null;
  onClose: () => void;
}

export function AgentDetailModal({ agentId, onClose }: AgentDetailModalProps): JSX.Element | null {
  const open = agentId != null;

  const { data: agents } = useQuery<AgentStatus[]>({
    queryKey: ['agents'],
    queryFn: () => getAgents(),
    enabled: open,
  });

  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit', 'by-agent', agentId],
    queryFn: () => getAuditByAgent(agentId!),
    enabled: open && agentId != null,
  });

  if (!open || !agentId) return null;

  const agent = (agents ?? []).find((a) => a.agentId === agentId);
  const recent = entries ?? [];
  const allowed = recent.filter((e) => e.decision === 'allow').length;
  const blocked = recent.filter((e) => e.decision === 'deny').length;

  return (
    <Modal open={open} onClose={onClose} size="xl">
      <div className="space-y-lg">
        <div className="flex items-start justify-between gap-md">
          <div>
            <div className="flex items-center gap-2">
              <AgentStatusDot state={agent?.state ?? 'idle'} size={14} />
              <h2 className="font-mono text-xl font-semibold text-text">{agentId}</h2>
            </div>
            <div className="mt-1 flex items-center gap-2">
              {agent && (
                <Badge tone={agent.role === 'guest' ? 'neutral' : 'info'} size="sm" outline>
                  {agent.role}
                </Badge>
              )}
              {agent && (
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <Clock size={11} />
                  {formatRelative(agent.lastSeen)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-border/60 hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-md">
          <StatTile
            label="Calls / 1h"
            value={agent?.callsLastHour ?? '—'}
            icon={<Activity size={16} className="text-primary" />}
          />
          <StatTile
            label="Blocks / 1h"
            value={agent?.blocksLastHour ?? '—'}
            icon={<ShieldAlert size={16} className="text-error" />}
          />
          <StatTile
            label="Allowed (recent)"
            value={allowed}
            icon={<ShieldCheck size={16} className="text-success" />}
          />
          <StatTile
            label="Blocked (recent)"
            value={blocked}
            icon={<ShieldAlert size={16} className="text-error" />}
          />
        </section>

        <div>
          <h3 className="text-sm font-semibold text-text mb-sm">Recent activity</h3>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="block" height={44} className="w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="text-center py-xl text-text-muted text-sm">
              No audit entries for this agent yet.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-xs text-text-muted border-b border-border">
                    <th className="text-left py-sm px-md font-medium">When</th>
                    <th className="text-left py-sm px-md font-medium">Decision</th>
                    <th className="text-left py-sm px-md font-medium">Tool</th>
                    <th className="text-left py-sm px-md font-medium">Rule</th>
                    <th className="text-left py-sm px-md font-medium">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-bg/40">
                      <td className="py-sm px-md">
                        <div className="flex flex-col">
                          <span className="text-text text-xs">{formatRelative(e.timestamp)}</span>
                          <span className="text-text-muted font-mono text-[10px]">
                            {formatExact(e.timestamp)}
                          </span>
                        </div>
                      </td>
                      <td className="py-sm px-md">
                        <Badge tone={decisionToTone(e.decision)} size="sm">
                          {e.decision}
                        </Badge>
                      </td>
                      <td className="py-sm px-md font-mono text-xs text-text">{e.tool}</td>
                      <td className="py-sm px-md font-mono text-xs text-text-muted">
                        {e.ruleId ?? '—'}
                      </td>
                      <td className="py-sm px-md font-mono text-[10px] text-text-muted">
                        {shortenHash(e.hash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border p-md bg-bg/30">
      <div className="flex items-center gap-1 text-xs text-text-muted uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold font-mono text-text">{value}</div>
    </div>
  );
}

export default AgentDetailModal;