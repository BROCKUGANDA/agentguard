import { useEffect, useState } from 'react';
import { subscribeStream, getStreamState } from '../lib/ws';
import { subscribeSidecarStatus } from '../lib/api';

/**
 * Global banner shown when the live stream or sidecar is disconnected.
 * Renders nothing when everything is healthy.
 */
export function ConnectionBanner(): JSX.Element | null {
  const [streamDown, setStreamDown] = useState(false);
  const [sidecarDown, setSidecarDown] = useState(false);

  useEffect(() => {
    return subscribeStream((s) => {
      setStreamDown(s.status !== 'open' && s.status !== 'idle' && s.status !== 'connecting');
    });
  }, []);

  useEffect(() => {
    return subscribeSidecarStatus((s) => {
      setSidecarDown(!s.reachable);
    });
  }, []);

  // Don't show on first load before we've connected.
  const stream = getStreamState();
  if (stream.status === 'idle') return null;
  if (!streamDown && !sidecarDown) return null;

  const message = sidecarDown
    ? 'Sidecar unreachable — showing cached data. Retrying…'
    : 'Live stream disconnected — reconnecting…';

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[60] bg-warning/90 text-warning-foreground text-sm text-center py-1.5 px-md font-medium"
    >
      {message}
    </div>
  );
}

export default ConnectionBanner;