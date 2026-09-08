import { useEffect, useState } from 'react';
import { Shield, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { getStreamState, subscribeStream } from '../../lib/ws';
import { subscribeSidecarStatus } from '../../lib/api';

interface HeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function Header({ title, subtitle, right }: HeaderProps): JSX.Element {
  const [wsState, setWsState] = useState(getStreamState());
  const [sidecar, setSidecar] = useState<{ reachable: boolean; lastError?: string }>({
    reachable: true,
  });

  useEffect(() => subscribeStream(setWsState), []);
  useEffect(() =>
    subscribeSidecarStatus((s) =>
      setSidecar({ reachable: s.reachable, lastError: s.lastError }),
    ),
  );

  const wsOnline = wsState.status === 'open';

  return (
    <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-border">
      <div className="flex items-center justify-between gap-md px-lg h-14">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text truncate flex items-center gap-2">
            <Shield size={18} className="text-primary" />
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-text-muted truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={sidecar.reachable ? 'success' : 'error'} outline>
            {sidecar.reachable ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
                Sidecar
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-error inline-block" />
                Sidecar unreachable
              </>
            )}
          </Badge>
          <Badge tone={wsOnline ? 'info' : 'neutral'} outline>
            {wsOnline ? (
              <>
                <Wifi size={12} />
                Stream live
              </>
            ) : (
              <>
                <WifiOff size={12} />
                Stream {wsState.status}
                {wsState.reconnectAttempts > 0 ? ` (retry ${wsState.reconnectAttempts})` : ''}
              </>
            )}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.reload()}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={14} />
            <span className="sr-only">Refresh</span>
          </Button>
          {right}
        </div>
      </div>
      {!sidecar.reachable && (
        <div className={clsx('px-lg py-1.5 text-xs bg-warning/15 text-warning border-t border-warning/30')}>
          Showing cached data — sidecar unreachable{sidecar.lastError ? ` (${sidecar.lastError})` : ''}.
        </div>
      )}
    </header>
  );
}

export default Header;