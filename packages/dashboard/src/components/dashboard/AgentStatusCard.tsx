import { memo } from 'react';
import { ShieldCheck, Clock, AlertOctagon } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { AgentStatusDot } from '../ui/AgentStatusDot';
import { Badge } from '../ui/Badge';
import { shortenHash, formatRelative } from '../../lib/format';
import type { AgentStatus } from '../../lib/types';

interface AgentStatusCardProps {
  agent: AgentStatus;
  onSelect?: (id: string) => void;
  selected?: boolean;
}

export const AgentStatusCard = memo(function AgentStatusCard({
  agent,
  onSelect,
  selected,
}: AgentStatusCardProps): JSX.Element {
  const isBlocked = agent.state === 'blocked';
  return (
    <button
      type="button"
      onClick={() => onSelect?.(agent.agentId)}
      className={clsx(
        'w-full text-left transition-all',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md',
      )}
    >
      <Card
        hoverable
        className={clsx(
          'cursor-pointer',
          selected && 'ring-2 ring-primary border-primary',
        )}
      >
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AgentStatusDot state={agent.state} size={12} />
              <h3 className="font-mono text-base font-semibold text-text truncate">
                {agent.agentId}
              </h3>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={agent.role === 'guest' ? 'neutral' : 'info'} size="sm" outline>
                {agent.role}
              </Badge>
              <span className="text-xs text-text-muted flex items-center gap-1">
                <Clock size={11} />
                {formatRelative(agent.lastSeen)}
              </span>
            </div>
          </div>
          {isBlocked && <AlertOctagon size={20} className="text-error shrink-0" />}
          {!isBlocked && agent.blocksLastHour === 0 && (
            <ShieldCheck size={20} className="text-success shrink-0" />
          )}
        </div>

        <dl className="mt-md grid grid-cols-2 gap-md text-xs">
          <div>
            <dt className="text-text-muted">calls / 1h</dt>
            <dd className="font-mono text-lg font-semibold text-text">
              {agent.callsLastHour}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">blocks / 1h</dt>
            <dd
              className={clsx(
                'font-mono text-lg font-semibold',
                agent.blocksLastHour > 0 ? 'text-error' : 'text-text',
              )}
            >
              {agent.blocksLastHour}
            </dd>
          </div>
        </dl>

        <footer className="mt-md pt-sm border-t border-border font-mono text-[11px] text-text-muted flex justify-between">
          <span>state: {agent.state}</span>
          <span>{shortenHash(agent.agentId.padEnd(8, '0').slice(0, 8))}</span>
        </footer>
      </Card>
    </button>
  );
});

export default AgentStatusCard;