import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  Cpu,
  Database,
  Eye,
  Gauge,
  KeyRound,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  getTenantId,
  setTenantId,
  getTenants,
  getAdminToken,
  setAdminToken,
  type TenantInfo,
  type SidecarStatus,
  getHealth,
  subscribeSidecarStatus,
  reloadPolicies,
} from '../lib/api';
import { getSidecarStatus } from '../lib/api';
import { disconnectStream, connectStream } from '../lib/ws';

type ThemeMode = 'auto' | 'light' | 'dark';
type AnomalyMode = 'off' | 'low' | 'med' | 'high';

interface Preferences {
  theme: ThemeMode;
  density: 'comfortable' | 'compact';
  defaultPage: '/' | '/agents' | '/policies' | '/audit' | '/alerts' | '/settings';
  retentionDays: number;
  anomalySensitivity: AnomalyMode;
  sidecarUrl: string;
  wsUrl: string;
}

const DEFAULTS: Preferences = {
  theme: 'auto',
  density: 'comfortable',
  defaultPage: '/',
  retentionDays: 90,
  anomalySensitivity: 'med',
  sidecarUrl: 'http://localhost:9559',
  wsUrl: 'ws://localhost:9559/stream',
};

const STORAGE_KEY = 'agentguard.preferences';

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(p: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore quota errors
  }
}

export function Settings(): JSX.Element {
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [status, setStatus] = useState<SidecarStatus>(getSidecarStatus);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [healthResult, setHealthResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [tenantId, setTenantIdInput] = useState<string>(getTenantId());
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [tenantSavedAt, setTenantSavedAt] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState<string>(getAdminToken());
  const [tokenSavedAt, setTokenSavedAt] = useState<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    return subscribeSidecarStatus(setStatus);
  }, []);

  // Load the sidecar's known tenants (own header may auto-provision `default`).
  useEffect(() => {
    let cancelled = false;
    getTenants()
      .then((ts) => {
        if (!cancelled) setTenants(ts);
      })
      .catch(() => {
        /* sidecar may be down — the selector stays usable via manual input */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply theme to <html> element whenever preference changes.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'dark') root.classList.add('dark');
    else if (prefs.theme === 'light') root.classList.remove('dark');
    else root.classList.remove('dark'); // 'auto' = respect prefers-color-scheme via media query in CSS
  }, [prefs.theme]);

  const reload = useMutation({
    mutationFn: () => reloadPolicies(),
    onSuccess: () => setSavedAt(Date.now()),
  });

  const ping = useMutation({
    mutationFn: () => getHealth(),
    onSuccess: (h) =>
          setHealthResult({
            ok: h.ok,
            detail: `v${h.version} · ${h.audit_count ?? 0} audit · ${h.alert_count ?? 0} alerts (${h.alert_failures ?? 0} failed)`,
          }),
    onError: (e: Error) => setHealthResult({ ok: false, detail: e.message }),
  });

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs(next);
    setSavedAt(Date.now());
  }

  function reset(): void {
    setPrefs(DEFAULTS);
    savePrefs(DEFAULTS);
    setSavedAt(Date.now());
  }

  /** Switch the whole dashboard view to another tenant (persisted, no reload). */
  function switchTenant(id: string): void {
    setTenantId(id);
    setTenantIdInput(id);
    setTenantSavedAt(Date.now());
    // Cache-bust the live stream + all queries against the new tenant id
    // without a full page reload (preserves SPA state, avoids re-downloading JS).
    disconnectStream();
    qc.clear();
    connectStream(qc);
  }

  return (
    <div className="ag-page-enter">
      <Header
        title="Settings"
        subtitle="Connection, theme, retention, anomaly sensitivity"
        right={
          savedAt ? (
            <Badge tone="success">
              <CheckCircle2 size={12} className="mr-1 inline-block" />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </Badge>
          ) : undefined
        }
      />

      <main className="p-lg space-y-lg">
        {/* Connection */}
        <Card>
          <SectionTitle icon={Cpu}>Connection</SectionTitle>
          <p className="text-sm text-text-muted mb-md">
            Sidecar URL is used by the dashboard HTTP client. WebSocket URL receives live events. Changes persist in
            browser localStorage.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <Field label="Sidecar HTTP base URL">
              <input
                value={prefs.sidecarUrl}
                onChange={(e) => update('sidecarUrl', e.target.value)}
                className="w-full px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
                placeholder="http://localhost:9559"
              />
            </Field>
            <Field label="WebSocket URL">
              <input
                value={prefs.wsUrl}
                onChange={(e) => update('wsUrl', e.target.value)}
                className="w-full px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
                placeholder="ws://localhost:9559/stream"
              />
            </Field>
          </div>
          <div className="mt-md flex items-center gap-md flex-wrap">
            <Badge tone={status.reachable ? 'success' : 'error'}>
              {status.reachable ? (
                <CheckCircle2 size={12} className="mr-1 inline-block" />
              ) : (
                <XCircle size={12} className="mr-1 inline-block" />
              )}
              {status.reachable ? 'Reachable' : 'Unreachable'}
            </Badge>
            <Button size="sm" variant="secondary" onClick={() => ping.mutate()} disabled={ping.isPending}>
              {ping.isPending ? 'Pinging…' : 'Test connection'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => reload.mutate()} disabled={reload.isPending}>
              {reload.isPending ? 'Reloading…' : 'Reload policies'}
            </Button>
            {healthResult && (
              <span className={`text-xs ${healthResult.ok ? 'text-success' : 'text-error'}`}>
                {healthResult.ok ? '✓' : '✗'} {healthResult.detail}
              </span>
            )}
          </div>
        </Card>

        {/* Admin token */}
        <Card>
          <SectionTitle icon={KeyRound}>Admin token</SectionTitle>
          <p className="text-sm text-text-muted mb-md">
            Bearer token required by admin routes (verify chain, reload policies, alerts, test-fire) when the sidecar
            runs with <code className="font-mono text-xs">AGENTGUARD_ADMIN_TOKEN</code> set. Stored only in this
            browser&apos;s localStorage and sent as an Authorization header.
          </p>
          <div className="flex items-end gap-md flex-wrap">
            <Field label="AGENTGUARD_ADMIN_TOKEN">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-72 px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
                placeholder="(empty in dev)"
              />
            </Field>
            <Button
              size="sm"
              onClick={() => {
                setAdminToken(tokenInput);
                setTokenSavedAt(Date.now());
              }}
            >
              Save token
            </Button>
            {tokenSavedAt ? (
              <Badge tone="success">
                <CheckCircle2 size={12} className="mr-1 inline-block" />
                Saved
              </Badge>
            ) : undefined}
          </div>
        </Card>

        {/* Tenant */}
        <Card>
          <SectionTitle icon={Building2}>Tenant</SectionTitle>
          <p className="text-sm text-text-muted mb-md">
            Your whole view is scoped to one tenant: policy, audit chain, agents, KPIs and the live stream. Each tenant
            is isolated on the sidecar and auto-provisioned on first request (policy file + audit DB). Persisted in
            localStorage and sent as the <code className="font-mono text-xs">X-Tenant-Id</code> header.
          </p>
          <div className="flex items-end gap-md flex-wrap">
            <Field label="Active tenant id">
              <input
                value={tenantId}
                onChange={(e) => setTenantIdInput(e.target.value.trim().toLowerCase())}
                className="w-56 px-md py-sm rounded-md border border-border bg-surface text-text font-mono text-xs"
                placeholder="default"
              />
            </Field>
            <Button size="sm" onClick={() => switchTenant(tenantId)} disabled={!tenantId}>
              Switch tenant
            </Button>
            {tenantSavedAt ? (
              <Badge tone="success">
                <CheckCircle2 size={12} className="mr-1 inline-block" />
                Scoped to “{tenantId}”
              </Badge>
            ) : undefined}
          </div>
          {tenants.length > 0 ? (
            <div className="mt-md">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Known tenants</span>
              <div className="flex gap-sm flex-wrap mt-sm">
                {tenants.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => switchTenant(t.id)}
                    className={`px-sm py-xs rounded-md border text-xs transition-colors ${
                      t.id === tenantId
                        ? 'border-primary text-primary bg-primary/10'
                        : 'border-border text-text-muted hover:text-text'
                    }`}
                    title={`${t.rules} rules · ${t.audit_entries} audit entries`}
                  >
                    <span className="font-mono">{t.id}</span>
                    <span className="opacity-60 ml-1">· {t.audit_entries}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : undefined}
        </Card>

        {/* Appearance */}
        <Card>
          <SectionTitle icon={Eye}>Appearance</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <Field label="Theme">
              <div className="flex gap-sm">
                <ThemeButton active={prefs.theme === 'auto'} onClick={() => update('theme', 'auto')}>
                  <SettingsIcon size={14} className="mr-1" /> Auto
                </ThemeButton>
                <ThemeButton active={prefs.theme === 'light'} onClick={() => update('theme', 'light')}>
                  <Sun size={14} className="mr-1" /> Light
                </ThemeButton>
                <ThemeButton active={prefs.theme === 'dark'} onClick={() => update('theme', 'dark')}>
                  <Moon size={14} className="mr-1" /> Dark
                </ThemeButton>
              </div>
            </Field>
            <Field label="Density">
              <div className="flex gap-sm">
                <ThemeButton
                  active={prefs.density === 'comfortable'}
                  onClick={() => update('density', 'comfortable')}
                >
                  Comfortable
                </ThemeButton>
                <ThemeButton active={prefs.density === 'compact'} onClick={() => update('density', 'compact')}>
                  Compact
                </ThemeButton>
              </div>
            </Field>
            <Field label="Default landing page">
              <select
                value={prefs.defaultPage}
                onChange={(e) => update('defaultPage', e.target.value as Preferences['defaultPage'])}
                className="w-full px-md py-sm rounded-md border border-border bg-surface text-text"
              >
                <option value="/">Live feed</option>
                <option value="/agents">Agents</option>
                <option value="/policies">Policies</option>
                <option value="/audit">Audit</option>
                <option value="/alerts">Alerts</option>
              </select>
            </Field>
          </div>
        </Card>

        {/* Anomaly detection */}
        <Card>
          <SectionTitle icon={Gauge}>Anomaly detection (post-hackathon stretch)</SectionTitle>
          <p className="text-sm text-text-muted mb-md">
            Baseline behavioral model flags agent actions that deviate from typical patterns. Off disables detection;
            higher sensitivity flags more anomalies (more false positives).
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
            {(['off', 'low', 'med', 'high'] as AnomalyMode[]).map((level) => (
              <ThemeButton
                key={level}
                active={prefs.anomalySensitivity === level}
                onClick={() => update('anomalySensitivity', level)}
              >
                {level}
              </ThemeButton>
            ))}
          </div>
        </Card>

        {/* Retention */}
        <Card>
          <SectionTitle icon={Database}>Audit retention</SectionTitle>
          <p className="text-sm text-text-muted mb-md">
            How long audit rows are kept before purging. Set to 0 to disable auto-purging (keep forever).
          </p>
          <Field label="Days">
            <input
              type="number"
              min={0}
              max={3650}
              value={prefs.retentionDays}
              onChange={(e) => update('retentionDays', Math.max(0, Number(e.target.value) || 0))}
              className="w-32 px-md py-sm rounded-md border border-border bg-surface text-text font-mono"
            />
            <span className="ml-md text-sm text-text-muted">days</span>
          </Field>
        </Card>

        {/* Reset */}
        <Card>
          <SectionTitle icon={Trash2}>Reset</SectionTitle>
          <p className="text-sm text-text-muted mb-md">
            Discard local preferences and restore defaults. Does not affect sidecar state or audit log.
          </p>
          <Button variant="danger" onClick={reset}>
            <Trash2 size={14} className="mr-1" />
            Reset preferences
          </Button>
        </Card>

        {/* Build info */}
        <Card>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Build</h3>
          <dl className="mt-md text-xs grid grid-cols-2 gap-y-1 max-w-md">
            <dt className="text-text-muted">Dashboard</dt>
            <dd className="font-mono text-text">v0.1.0</dd>
            <dt className="text-text-muted">Sidecar</dt>
            <dd className="font-mono text-text">v0.1.0 (Fastify)</dd>
            <dt className="text-text-muted">Engine</dt>
            <dd className="font-mono text-text">YAML policy-as-code</dd>
            <dt className="text-text-muted">Audit</dt>
            <dd className="font-mono text-text">SHA-256 chained SQLite</dd>
          </dl>
        </Card>
      </main>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Cpu;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <h2 className="text-base font-semibold text-text mb-sm flex items-center">
      <Icon size={16} className="mr-2 text-primary" />
      {children}
    </h2>
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

function ThemeButton({
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
      className={`flex items-center px-md py-sm rounded-md text-sm transition-colors ${
        active ? 'bg-primary text-white' : 'bg-bg text-text-muted hover:text-text border border-border'
      }`}
    >
      {children}
    </button>
  );
}

export default Settings;