import { ShieldCheck, ShieldAlert, Clock, Hash, User, Wrench, FileText } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { formatRelative, formatExact, shortenHash } from '../../lib/format';
import { decisionToTone } from '../ui/Badge';
import type { AuditEntry } from '../../lib/types';

interface AuditEntryModalProps {
  entry: AuditEntry | null;
  onClose: () => void;
}

export function AuditEntryModal({ entry, onClose }: AuditEntryModalProps): JSX.Element | null {
  if (!entry) return null;

  const argsJson = entry.args ? JSON.stringify(entry.args, null, 2) : null;

  return (
    <Modal open={entry != null} onClose={onClose} size="lg">
      <div className="space-y-lg">
        <div className="flex items-start justify-between gap-md">
          <div>
            <div className="flex items-center gap-2">
              {entry.decision === 'allow' ? (
                <ShieldCheck size={20} className="text-success" />
              ) : (
                <ShieldAlert size={20} className="text-error" />
              )}
              <Badge tone={decisionToTone(entry.decision)} size="sm">
                {entry.decision.toUpperCase()}
              </Badge>
              <Badge tone={entry.severity} size="sm" outline>
                {entry.severity}
              </Badge>
            </div>
            <h2 className="mt-2 font-mono text-lg font-semibold text-text">{entry.tool}</h2>
          </div>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          <DetailRow icon={<User size={14} className="text-text-muted" />} label="Agent">
            <span className="font-mono text-text">{entry.agentId}</span>
          </DetailRow>
          <DetailRow icon={<Wrench size={14} className="text-text-muted" />} label="Tool">
            <span className="font-mono text-text">{entry.tool}</span>
          </DetailRow>
          <DetailRow icon={<FileText size={14} className="text-text-muted" />} label="Rule">
            <span className="font-mono text-text">{entry.ruleId ?? '—'}</span>
          </DetailRow>
          <DetailRow icon={<Clock size={14} className="text-text-muted" />} label="When">
            <div className="flex flex-col">
              <span className="text-text">{formatRelative(entry.timestamp)}</span>
              <span className="font-mono text-xs text-text-muted">{formatExact(entry.timestamp)}</span>
            </div>
          </DetailRow>
          <DetailRow icon={<Hash size={14} className="text-text-muted" />} label="Entry hash">
            <span className="font-mono text-xs text-text">{shortenHash(entry.hash)}</span>
          </DetailRow>
          <DetailRow icon={<Hash size={14} className="text-text-muted" />} label="Previous hash">
            <span className="font-mono text-xs text-text-muted">{shortenHash(entry.prevHash)}</span>
          </DetailRow>
        </section>

        {entry.reason && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Reason</h3>
            <p className="text-sm text-text bg-bg/40 rounded-md p-md border border-border">
              {entry.reason}
            </p>
          </div>
        )}

        {argsJson && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Arguments</h3>
            <pre className="text-xs font-mono bg-bg p-md rounded-md border border-border overflow-x-auto max-h-64 overflow-y-auto">
              {argsJson}
            </pre>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-md py-sm rounded-md border border-border text-sm text-text hover:bg-border/40 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export default AuditEntryModal;