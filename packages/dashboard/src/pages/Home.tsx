import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Clock, Activity, Users, Hash, AlertTriangle } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { KPICard } from '../components/dashboard/KPICard';
import { LiveFeed } from '../components/dashboard/LiveFeed';
import { AuditChainView } from '../components/dashboard/AuditChainView';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { getHealth, getKpis, getAgents, getSidecarStatus, mockHealth, mockKpis, mockAgents } from '../lib/api';
import type { HealthInfo, KpiSummary, AgentStatus } from '../lib/types';
import { useEffect, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStreamState, subscribeStream } from '../lib/ws';

export function Home(): JSX.Element {
  const navigate = useNavigate();
  const [usingMock, setUsingMock] = useState(false);
  const { data: health } = useQuery<HealthInfo>({
    queryKey: ['health'],
    queryFn: () =>
      getHealth().catch(() => {
        setUsingMock(true);
        return mockHealth;
      }),
    refetchInterval: 10_000,
    staleTime: 5000,
  });

  const { data: kpis } = useQuery<KpiSummary>({
    queryKey: ['kpis'],
    queryFn: () =>
      getKpis().catch(() => {
        setUsingMock(true);
        return mockKpis;
      }),
    refetchInterval: 6000,
    staleTime: 3000,
  });

  const { data: agents } = useQuery<AgentStatus[]>({
    queryKey: ['agents'],
    queryFn: () =>
      getAgents().catch(() => {
        setUsingMock(true);
        return mockAgents;
      }),
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeStream(forceUpdate), []);
  const stream = getStreamState();

  // Prefer real data when the sidecar is reachable; only fall back to mocks
  // for initial render so the layout doesn't jump.
  const h = health ?? mockHealth;
  const k = kpis ?? mockKpis;
  const showMockBanner = usingMock && !getSidecarStatus().reachable;

  return (
    <div className="ag-page-enter">
      <Header
        title="Live Operations"
        subtitle="Real-time view of every agent decision across your fleet"
      />

      <main className="p-lg space-y-lg">
        {showMockBanner && (
          <div
            role="status"
            className="flex items-center gap-sm rounded-md border border-warning/40 bg-warning/10 text-warning-foreground px-md py-sm text-sm"
          >
            <AlertTriangle size={16} className="text-warning shrink-0" />
            Sidecar is unreachable — KPIs below are sample data, not live traffic.
          </div>
        )}
        <section
          aria-label="Key Performance Indicators"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md"
        >
          <KPICard
            label="Allowed (1h)"
            value={k.allowed}
            tone="success"
            icon={<ShieldCheck size={20} />}
            loading={!kpis && !health}
          />
          <KPICard
            label="Blocked (1h)"
            value={k.blocked}
            tone={k.blocked > 0 ? 'error' : 'neutral'}
            icon={<ShieldAlert size={20} />}
            loading={!kpis && !health}
          />
          <KPICard
            label="Avg latency"
            value={`${k.avgLatencyMs.toFixed(1)} ms`}
            tone="info"
            icon={<Clock size={20} />}
            loading={!kpis && !health}
          />
          <KPICard
            label="Chain integrity"
            value={k.chainIntegrity.verified ? 'OK' : 'BROKEN'}
            tone={k.chainIntegrity.verified ? 'success' : 'error'}
            icon={<Hash size={20} />}
            loading={!kpis && !health}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-md">
          <div className="lg:col-span-2">
            <LiveFeed limit={10} />
          </div>
          <div>
            <AuditChainView limit={8} />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-md">
          <Card>
            <header className="flex items-center gap-2 mb-sm">
              <Activity size={18} className="text-primary" />
              <h3 className="text-sm font-semibold">System</h3>
            </header>
            {!health ? (
              <Skeleton variant="block" height={80} />
            ) : (
              <dl className="text-xs space-y-1.5">
                <Row label="Version" value={<span className="font-mono">{h.version}</span>} />
                <Row label="Uptime" value={<span className="font-mono">{h.uptime != null ? `${Math.round(h.uptime / 60)} min` : '—'}</span>} />
                <Row label="Policy rules" value={<span className="font-mono">{h.policies?.ruleCount ?? '—'}</span>} />
                <Row label="Audit entries" value={<span className="font-mono">{h.audit?.entries ?? h.audit_count ?? '—'}</span>} />
              </dl>
            )}
          </Card>
          <Card>
            <header className="flex items-center gap-2 mb-sm">
              <Users size={18} className="text-primary" />
              <h3 className="text-sm font-semibold">Active agents</h3>
            </header>
            <ul className="text-xs space-y-1">
              {(agents ?? mockAgents).slice(0, 4).map((a) => (
                <li
                  key={a.agentId}
                  className="flex items-center justify-between cursor-pointer hover:text-primary transition-colors"
                  onClick={() => navigate('/agents')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate('/agents'); }}
                >
                  <span className="font-mono text-text">{a.agentId}</span>
                  <span className="text-text-muted">{a.role}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <header className="flex items-center gap-2 mb-sm">
              <Hash size={18} className="text-primary" />
              <h3 className="text-sm font-semibold">Stream</h3>
            </header>
            <dl className="text-xs space-y-1.5">
              <Row label="Status" value={<span className="font-mono">{stream.status}</span>} />
              <Row
                label="Last event"
                value={
                  <span className="font-mono">
                    {stream.lastEventAt ? new Date(stream.lastEventAt).toLocaleTimeString() : '—'}
                  </span>
                }
              />
              <Row
                label="Reconnects"
                value={<span className="font-mono">{stream.reconnectAttempts}</span>}
              />
            </dl>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default Home;