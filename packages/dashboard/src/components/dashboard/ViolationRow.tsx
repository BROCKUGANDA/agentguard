import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Badge, decisionToTone, severityToTone } from '../ui/Badge';
import { shortenHash, formatRelative } from '../../lib/format';
import type { AuditEntry } from '../../lib/types';

interface ViolationRowProps {
  entry: AuditEntry;
  defaultExpanded?: boolean;
}

export function ViolationRow({ entry, defaultExpanded = false }: ViolationRowProps): JSX.Element {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <li className="border border-border rounded-md bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-md py-sm text-left hover:bg-border/30 transition-colors rounded-md"
        aria-expanded={open}
      >
        <span className="text-text-muted shrink-0">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Badge tone={decisionToTone(entry.decision)} size="sm">
          {entry.decision}
        </Badge>
        <Badge tone={severityToTone(entry.severity)} size="sm" outline>
          {entry.severity}
        </Badge>
        <span className="font-mono text-xs text-text truncate">{entry.tool}</span>
        <span className="text-text-muted text-xs hidden sm:inline">·</span>
        <span className="font-mono text-xs text-text-muted truncate hidden sm:inline">
          {entry.agentId}
        </span>
        <span className="ml-auto text-[11px] text-text-muted shrink-0">
          {formatRelative(entry.timestamp)}
        </span>
      </button>
      {open && (
        <div className={clsx('px-md pb-sm pt-1 border-t border-border space-y-1.5 text-xs')}>
          {entry.reason && (
            <div>
              <span className="text-text-muted">Reason: </span>
              <span className="text-text">{entry.reason}</span>
            </div>
          )}
          {entry.ruleId && (
            <div>
              <span className="text-text-muted">Rule: </span>
              <span className="font-mono text-text">{entry.ruleId}</span>
            </div>
          )}
          {entry.args && Object.keys(entry.args).length > 0 && (
            <div>
              <div className="text-text-muted">Args</div>
              <pre className="font-mono text-[11px] bg-bg border border-border rounded-md p-sm overflow-x-auto">
                {JSON.stringify(entry.args, null, 2)}
              </pre>
            </div>
          )}
          <div className="flex items-center gap-4 font-mono text-[11px] text-text-muted">
            <span>id: {entry.id}</span>
            <span>hash: {shortenHash(entry.hash)}</span>
            <span>prev: {shortenHash(entry.prevHash)}</span>
          </div>
        </div>
      )}
    </li>
  );
}

export default ViolationRow;