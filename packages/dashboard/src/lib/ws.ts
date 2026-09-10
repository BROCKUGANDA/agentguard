/**
 * WebSocket client — connects to the sidecar stream and dispatches
 * TanStack Query invalidations so the UI re-fetches when fresh data arrives.
 */

import type { QueryClient } from '@tanstack/react-query';
import { getTenantId } from './api';

function wsUrl(): string {
  // Settings page override (same key as the HTTP client).
  try {
    const raw = localStorage.getItem('agentguard.preferences');
    if (raw) {
      const prefs = JSON.parse(raw) as { wsUrl?: string };
      if (prefs.wsUrl && prefs.wsUrl.trim().length > 0) {
        const url = new URL(prefs.wsUrl.trim());
        url.searchParams.set('tenant', getTenantId());
        return url.toString();
      }
    }
  } catch {
    /* fall through */
  }
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const v = env?.VITE_WS_URL;
  // Explicit override wins. Otherwise derive from the page origin so the
  // stream works in the container (launcher proxies /stream) and in any
  // remote deployment without hardcoding localhost.
  const base =
    v && v.length > 0
      ? v
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/stream`;
  // WS upgrades can't carry headers from the browser — the sidecar accepts the
  // tenant via ?tenant= instead (see /stream in server.ts).
  const url = new URL(base);
  url.searchParams.set('tenant', getTenantId());
  return url.toString();
}

export interface StreamConnection {
  socket: WebSocket | null;
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  lastEventAt: string | null;
  reconnectAttempts: number;
}

const state: StreamConnection = {
  socket: null,
  status: 'idle',
  lastEventAt: null,
  reconnectAttempts: 0,
};

const listeners = new Set<(s: StreamConnection) => void>();
function notify(): void {
  listeners.forEach((fn) => fn({ ...state }));
}

export function subscribeStream(fn: (s: StreamConnection) => void): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getStreamState(): StreamConnection {
  return { ...state };
}

let queryClient: QueryClient | null = null;
let reconnectTimer: number | null = null;
let stopped = false;

export function connectStream(qc: QueryClient): void {
  queryClient = qc;
  stopped = false;
  openSocket();
}

export function disconnectStream(): void {
  stopped = true;
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (state.socket) {
    try {
      state.socket.close();
    } catch {
      /* ignore */
    }
    state.socket = null;
  }
  state.status = 'closed';
  notify();
}

function scheduleReconnect(): void {
  if (stopped) return;
  if (reconnectTimer != null) return;
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(state.reconnectAttempts, 5));
  state.reconnectAttempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function openSocket(): void {
  if (stopped) return;
  state.status = 'connecting';
  notify();
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl());
  } catch (err) {
    state.status = 'error';
    notify();
    scheduleReconnect();
    void err;
    return;
  }
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.status = 'open';
    state.reconnectAttempts = 0;
    notify();
  });

  socket.addEventListener('message', (ev) => {
    state.lastEventAt = new Date().toISOString();
    notify();
    if (!queryClient) return;
    try {
      const msg = JSON.parse(ev.data as string) as { type?: string };
      switch (msg.type) {
        case 'audit':
          queryClient.invalidateQueries({ queryKey: ['audit'] });
          queryClient.invalidateQueries({ queryKey: ['kpis'] });
          break;
        case 'agent':
          queryClient.invalidateQueries({ queryKey: ['agents'] });
          break;
        case 'policy':
          queryClient.invalidateQueries({ queryKey: ['policies'] });
          break;
        case 'heartbeat':
        default:
          break;
      }
    } catch {
      // Ignore malformed frames; keep the socket alive.
    }
  });

  socket.addEventListener('error', () => {
    state.status = 'error';
    notify();
  });

  socket.addEventListener('close', () => {
    state.status = 'closed';
    state.socket = null;
    notify();
    scheduleReconnect();
  });
}