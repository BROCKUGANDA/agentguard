import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Send,
  Shield,
  XCircle,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { formatRelative, formatExact } from '../lib/format';
import {
  getRecentAlerts,
  testFireAlert,
  mockAlerts,
  type AlertEntry,
  type TestFireBody,
} from '../lib/api';

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';

const severityTone = (s: AlertEntry['severity']): 'info' | 'warning' | 'critical' => s;
const statusBadge = (s: AlertEntry['delivery_status']) => {
  switch (s) {
    case 'delivered':
      return { tone: 'success' as const, label: 'Delivered', icon: CheckCircle2 };
    case 'failed':
      return { tone: 'error' as const, label: 'Failed', icon: XCircle };
    case 'pending':
      return { tone: 'warning' as const, label: 'Pending', icon: Clock };
  }
};

export function Alerts(): JSX.Element {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [testOpen, setTestOpen] = useState(false);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['alerts', severity],
    queryFn: () => getRecentAlerts(200, severity === 'all' ? undefined : { severity }),
    refetchInterval: 5000,
    placeholderData: mockAlerts, // graceful fallback
  });

  const alerts: AlertEntry[] = (query.data as AlertEntry[] | undefined) ?? mockAlerts;
  const counts = {
    delivered: alerts.filter((a) => a.delivery_status === 'delivered').length,
    failed: alerts.filter((a) => a.delivery_status === 'failed').length,
    pending: alerts.filter((a) => a.delivery_status === 'pending').length,
    critical: alerts.filter((a) => a.severity === 'critical').length,
  };

  const testFire = useMutation({
    mutationFn: (body: TestFireBody) => testFireAlert(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      setTestOpen(false);
    },
  });

  return (
    <div className="ag-page-enter">
      <Header
        title="Alerts"
        subtitle="Webhook deliveries, escalation history, and test-fire for incident response"
      />

      <main className="p-lg space-y-lg">
        {/* KPI strip */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-md">
          <KpiTile label="Delivered" value={counts.delivered} tone="success" icon={CheckCircle2} />
          <KpiTile label="Failed" value={counts.failed} tone="error" icon={XCircle} />
          <KpiTile label="Pending" value={counts.pending} tone="warning" icon={Clock} />
          <KpiTile label="Critical" value={counts.critical} tone="critical" icon={Shield} />
        </section>

        {/* Toolbar */}
        <Card className="flex flex-wrap items-center gap-md justify-between">
          <div className="flex items-center gap-sm">
            <span className="text-sm text-text-muted">Severity:</span>
            <FilterPill active={severity === 'all'} onClick={() => setSeverity('all')}>
              All
            </FilterPill>
            <FilterPill active={severity === 'critical'} onClick={() => setSeverity('critical')}>
              Critical
            </FilterPill>
            <FilterPill active={severity === 'warning'} onClick={() => setSeverity('warning')}>
              Warning
            </FilterPill>
            <FilterPill active={severity === 'info'} onClick={() => setSeverity('info')}>
              Info
            </FilterPill>
          </div>
          <div className="flex items-center gap-sm">
            <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['alerts'] })}>
              <RefreshCw size={14} className="mr-1" /> Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => setTestOpen(true)}>
              <Send size={14} className="mr-1" /> Test fire
            </Button>
          </div>
        </Card>

        {/* Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-muted border-b border-border">
                  <th className="text-left py-sm px-md font-medium">When</th>
                  <th className="text-left py-sm px-md font-medium">Severity</th>
                  <th className="text-left py-sm px-md font-medium">Rule</th>
                  <th className="text-left py-sm px-md font-medium">Agent</th>
                  <th className="text-left py-sm px-md font-medium">Tool</th>
                  <th className="text-left py-sm px-md font-medium">Status</th>
                  <th className="text-left py-sm px-md font-medium">Webhook</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading && alerts.length === 0 ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td colSpan={7} className="px-md py-md">
                        <Skeleton variant="block" height={20} />
                      </td>
                    </tr>
                  ))
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-md py-xl text-center text-text-muted">
                      No alerts in the selected window. Fire one with <kbd className="px-1 py-0.5 rounded bg-surface border border-border text-xs">Test fire</kbd>.
                    </td>
                  </tr>
                ) : (
                  alerts.map((a) => {
                    const sb = statusBadge(a.delivery_status);
                    const Icon = sb.icon;
                    return (
                      <tr key={a.id} className="border-b border-border hover:bg-bg/40 transition-colors">
                        <td className="py-sm px-md">
                          <div className="flex flex-col">
                            <span className="text-text">{formatRelative(a.ts)}</span>
                            <span className="text-xs text-text-muted font-mono">{formatExact(a.ts)}</span>
                          </div>
                        </td>
                        <td className="py-sm px-md">
                          <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                        </td>
                        <td className="py-sm px-md font-mono text-xs">
                          {a.rule_id ?? <span className="text-text-muted">—</span>}
                        </td>
                        <td className="py-sm px-md text-text">{a.agent_id}</td>
                        <td className="py-sm px-md font-mono text-xs">{a.tool}</td>
                        <td className="py-sm px-md">
                          <Badge tone={sb.tone}>
                            <Icon size={12} className="mr-1 inline-block" />
                            {sb.label}
                          </Badge>
                          {a.delivery_error && (
                            <div className="text-xs text-error mt-1 max-w-xs truncate" title={a.delivery_error}>
                              {a.delivery_error}
                            </div>
                          )}
                        </td>
                        <td className="py-sm px-md">
                          {a.webhook_url ? (
                            <a
                              href={a.webhook_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center text-xs text-secondary hover:underline font-mono"
                            >
                              <ExternalLink size={12} className="mr-1" />
                              {new URL(a.webhook_url).host}
                            </a>
                          ) : (
                            <span className="text-text-muted text-xs">none</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Inline policy reference */}
        <Card>
          <h3 className="text-base font-semibold text-text mb-sm flex items-center">
            <AlertTriangle size={16} className="text-warning mr-2" />
            Alert rules
          </h3>
          <p className="text-sm text-text-muted mb-md">
            Alerts are configured in <code className="font-mono text-xs">policies/agentguard.yaml</code> under the{' '}
            <code className="font-mono text-xs">alerts:</code> key. Each entry matches decisions by severity and optional{' '}
            <code className="font-mono text-xs">rule_ids</code>, then fires the webhook URL (with{' '}
            <code className="font-mono text-xs">${'{VAR}'}</code> env interpolation).
          </p>
          <pre className="text-xs font-mono bg-bg p-md rounded-md border border-border overflow-x-auto">
{`alerts:
  - on_decision: deny
    severity: critical
    webhook: "\${AGENTGUARD_SLACK_WEBHOOK}"
  - on_decision: deny
    severity: critical
    rule_ids: ["time-window-production-db", "pii-redact-email"]`}
          </pre>
        </Card>
      </main>

      <TestFireModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        onSubmit={(body) => testFire.mutate(body)}
        pending={testFire.isPending}
        error={testFire.error?.message}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: 'success' | 'error' | 'warning' | 'critical';
  icon: typeof CheckCircle2;
}): JSX.Element {
  const toneColor =
    tone === 'success'
      ? 'text-success'
      : tone === 'error'
      ? 'text-error'
      : tone === 'warning'
      ? 'text-warning'
      : 'text-primary';
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
          <div className={`text-3xl font-bold ${toneColor} mt-1`}>{value}</div>
        </div>
        <Icon size={28} className={toneColor} />
      </div>
    </Card>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-sm rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'bg-bg text-text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function TestFireModal({
  open,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: TestFireBody) => void;
  pending: boolean;
  error?: string;
}): JSX.Element {
  const [severity, setSeverity] = useState<'critical' | 'warning' | 'info'>('critical');
  const [webhook, setWebhook] = useState('');
  const [agentId, setAgentId] = useState('dashboard-test');
  const [ruleId, setRuleId] = useState('dashboard-test-fire');

  return (
    <Modal open={open} onClose={onClose} title="Fire a synthetic alert">
      <p className="text-sm text-text-muted mb-md">
        Synthesizes a deny decision and runs it through the dispatcher without staging a real policy violation.
        Useful for verifying your webhook is configured correctly.
      </p>
      <div className="space-y-md">
        <Field label="Severity">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as 'critical' | 'warning' | 'info')}
            className="w-full px-md py-sm rounded-md border border-border bg-surface text-text"
          >
            <option value="critical">critical</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
        </Field>
        <Field label="Webhook URL (overrides default)">
          <input
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
          />
        </Field>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Agent ID">
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
            />
          </Field>
          <Field label="Rule ID">
            <input
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              className="w-full px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
            />
          </Field>
        </div>
        {error && <div className="text-xs text-error bg-error/10 px-md py-sm rounded-md">{error}</div>}
      </div>
      <div className="flex justify-end gap-sm mt-lg">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            onSubmit({
              severity,
              webhook: webhook || undefined,
              agent_id: agentId,
              rule_id: ruleId,
              tool: 'dashboard.test-fire',
            })
          }
          disabled={pending}
        >
          {pending ? 'Firing…' : 'Fire alert'}
        </Button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-muted uppercase tracking-wide block mb-1">{label}</span>
      {children}
    </label>
  );
}

export default Alerts;