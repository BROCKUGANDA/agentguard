import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FileText, RefreshCw, Copy, Check } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, decisionToTone } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { PolicyEvaluator } from '../ui/PolicyEvaluator';
import { getPolicies, reloadPolicies, mockPolicy } from '../../lib/api';
import { useToast } from '../ui/Toast';
import type { PolicySet } from '../../lib/types';
import { formatRelative } from '../../lib/format';

interface PolicyViewerProps {
  showHistory?: boolean;
}

function YamlFallback(): string {
  return `# AgentGuard policy — demo configuration\nversion: "1"\ndefault: deny\nrules:\n  - id: rbac-developer-allow\n    decision: allow\n  - id: pii-redact-email\n    decision: deny\n`;
}

export function PolicyViewer({ showHistory = true }: PolicyViewerProps): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<PolicySet>({
    queryKey: ['policies', 'current'],
    queryFn: () => getPolicies().catch(() => mockPolicy),
    refetchInterval: 30000,
  });

  const reloadMut = useMutation({
    mutationFn: () => reloadPolicies(),
    onSuccess: (fresh) => {
      qc.setQueryData(['policies', 'current'], fresh);
      toast.success('Policies reloaded', `v${fresh.version} · ${fresh.rules.length} rules`);
    },
    onError: (err: Error) =>
      toast.error('Policy reload failed', err.message),
  });

  const policy = data ?? mockPolicy;
  const denyRatio = useMemo(() => {
    if (policy.rules.length === 0) return 0;
    const deny = policy.rules.filter((r) => r.decision === 'deny').length;
    return deny / policy.rules.length;
  }, [policy]);

  const selectedRule = useMemo(
    () => policy.rules.find((r) => r.id === selectedRuleId) ?? null,
    [policy, selectedRuleId],
  );

  const yamlText = policy.source ?? YamlFallback();

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(yamlText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.info('Copied', 'Policy YAML copied to clipboard');
    } catch {
      toast.error('Copy failed', 'Clipboard unavailable');
    }
  };

  return (
    <div className="grid gap-md lg:grid-cols-3">
      <Card className="lg:col-span-1 flex flex-col">
        <header className="flex items-center justify-between mb-md">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <h2 className="text-base font-semibold">Policy Set</h2>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={reloadMut.isPending}
            onClick={() => reloadMut.mutate()}
          >
            <RefreshCw size={14} />
            Reload
          </Button>
        </header>

        <div className="flex items-center gap-md mb-md">
          <PolicyEvaluator
            policyName={`v${policy.version}`}
            value={1}
            denyRatio={denyRatio}
            detail={`${policy.rules.length} rules · ${denyRatio > 0.5 ? 'strict' : 'balanced'}`}
          />
          <dl className="text-xs space-y-1 flex-1 min-w-0">
            <div className="flex justify-between">
              <dt className="text-text-muted">Default</dt>
              <dd>
                <Badge tone={decisionToTone(policy.default)} size="sm">
                  {policy.default}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Version</dt>
              <dd className="font-mono">{policy.version}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Updated</dt>
              <dd className="font-mono">{formatRelative(policy.updatedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Agents</dt>
              <dd className="font-mono">{Object.keys(policy.agents).length}</dd>
            </div>
          </dl>
        </div>

        {isLoading ? (
          <Skeleton variant="block" height={120} />
        ) : (
          <ul className="space-y-1.5 flex-1 overflow-auto">
            {policy.rules.map((rule) => (
              <li key={rule.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRuleId(rule.id)}
                  className={`w-full text-left rounded-md border px-sm py-2 transition-colors ${
                    selectedRuleId === rule.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-surface hover:bg-border/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={decisionToTone(rule.decision)} size="sm">
                      {rule.decision}
                    </Badge>
                    <span className="font-mono text-xs text-text truncate">
                      {rule.id}
                    </span>
                  </div>
                  {rule.description && (
                    <div className="text-[11px] text-text-muted mt-1 line-clamp-2">
                      {rule.description}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {isError && !data && (
          <div className="mt-md text-xs text-warning">Using fallback policy data</div>
        )}
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-md text-xs text-text-muted hover:text-text self-start"
        >
          Refresh
        </button>
      </Card>

      <Card className="lg:col-span-2 flex flex-col min-h-[400px]">
        <header className="flex items-center justify-between mb-md">
          <div>
            <h2 className="text-base font-semibold">
              {selectedRule ? `Rule · ${selectedRule.id}` : 'YAML Source'}
            </h2>
            {selectedRule?.description && (
              <p className="text-xs text-text-muted mt-0.5">{selectedRule.description}</p>
            )}
          </div>
          {!selectedRule && (
            <Button size="sm" variant="ghost" onClick={onCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </header>

        {selectedRule ? (
          <div className="space-y-3 text-sm flex-1">
            <Field label="ID" value={selectedRule.id} mono />
            <Field
              label="Decision"
              value={
                <Badge tone={decisionToTone(selectedRule.decision)} size="sm">
                  {selectedRule.decision}
                </Badge>
              }
            />
            <Field
              label="Tool"
              value={
                Array.isArray(selectedRule.tool)
                  ? selectedRule.tool.join(', ')
                  : selectedRule.tool ?? '*'
              }
              mono
            />
            {selectedRule.reason && (
              <Field label="Reason" value={selectedRule.reason} />
            )}
          </div>
        ) : (
          <pre className="font-mono text-xs bg-bg border border-border rounded-md p-md overflow-auto flex-1 max-h-[520px] leading-5">
            {yamlText}
          </pre>
        )}

        {showHistory && (
          <section className="mt-md pt-md border-t border-border">
            <h3 className="text-xs uppercase tracking-wider text-text-muted mb-sm">
              Version history
            </h3>
            <ul className="space-y-1 text-xs">
              <li className="flex items-center justify-between">
                <span className="font-mono">v{policy.version} (current)</span>
                <span className="text-text-muted">{formatRelative(policy.updatedAt)}</span>
              </li>
              <li className="flex items-center justify-between text-text-muted">
                <span className="font-mono">v0 (initial)</span>
                <span>system bootstrap</span>
              </li>
            </ul>
          </section>
        )}
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start gap-md">
      <span className="w-24 shrink-0 text-text-muted text-xs uppercase tracking-wider pt-0.5">
        {label}
      </span>
      <span className={mono ? 'font-mono text-text' : 'text-text'}>{value}</span>
    </div>
  );
}

export default PolicyViewer;