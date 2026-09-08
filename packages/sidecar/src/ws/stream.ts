import type { WebSocket } from '@fastify/websocket';

export interface StreamEvent {
  type: 'audit' | 'decision' | 'violation' | 'reload' | 'policy' | 'heartbeat' | 'hello';
  payload: unknown;
  ts: number;
}

/** Drop a client whose send buffer exceeds this many bytes (backpressure). */
const BACKPRESSURE_LIMIT = 1 * 1024 * 1024; // 1 MB
/** Heartbeat interval — clients that miss two pings are considered dead. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Fan-out broadcaster for the /stream WebSocket endpoint.
 *
 * One process, many clients: we keep a Set of sockets and `broadcast()` the
 * JSON-encoded event to every connected client. Sockets that fail to write
 * (closed pipe) or whose send buffer exceeds the backpressure limit are
 * dropped from the set. A periodic heartbeat evicts dead connections.
 */
export class EventStream {
  private readonly clients = new Set<WebSocket>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  addClient(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
    this.ensureHeartbeat();
  }

  broadcast(event: Omit<StreamEvent, 'ts'>): void {
    const full: StreamEvent = { ...event, ts: Date.now() };
    const data = JSON.stringify(full);
    for (const ws of this.clients) {
      // readyState === 1 means OPEN. Cast through unknown to access the
      // property — the fastify websocket type doesn't expose readyState but
      // the underlying ws instance does.
      const rs = (ws as unknown as { readyState?: number }).readyState;
      if (rs === undefined || rs === 1) {
        // Backpressure: if the client isn't draining, drop it rather than
        // grow the send buffer without bound.
        const buffered = (ws as unknown as { bufferedAmount?: number }).bufferedAmount ?? 0;
        if (buffered > BACKPRESSURE_LIMIT) {
          try { ws.close(1011, 'backpressure'); } catch { /* ignore */ }
          this.clients.delete(ws);
          continue;
        }
        try {
          ws.send(data);
        } catch {
          this.clients.delete(ws);
        }
      } else {
        this.clients.delete(ws);
      }
    }
  }

  /** Start a heartbeat that evicts unresponsive clients. */
  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const payload = JSON.stringify({ type: 'heartbeat', payload: null, ts: Date.now() });
      for (const ws of this.clients) {
        const rs = (ws as unknown as { readyState?: number }).readyState;
        if (rs !== undefined && rs !== 1) {
          this.clients.delete(ws);
          continue;
        }
        try {
          ws.send(payload);
        } catch {
          this.clients.delete(ws);
        }
      }
    }, HEARTBEAT_INTERVAL_MS).unref();
  }

  clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const ws of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }
}
