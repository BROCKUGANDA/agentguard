import { describe, it, expect, vi } from 'vitest';
import { EventStream } from '../src/ws/stream.js';

function makeMockSocket(opts: { readyState?: number; bufferedAmount?: number } = {}) {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    readyState: opts.readyState ?? 1,
    bufferedAmount: opts.bufferedAmount ?? 0,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(fn);
    }),
    emit: (event: string, ...args: unknown[]) => {
      (listeners[event] ?? []).forEach((fn) => fn(...args));
    },
  };
}

describe('EventStream', () => {
  it('addClient increases clientCount', () => {
    const stream = new EventStream();
    const ws = makeMockSocket();
    stream.addClient(ws as never);
    expect(stream.clientCount()).toBe(1);
    stream.close();
  });

  it('broadcast sends JSON to all connected clients', () => {
    const stream = new EventStream();
    const a = makeMockSocket();
    const b = makeMockSocket();
    stream.addClient(a as never);
    stream.addClient(b as never);
    stream.broadcast({ type: 'audit', payload: { x: 1 } });
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(a.send.mock.calls[0][0] as string);
    expect(sent.type).toBe('audit');
    expect(sent.payload).toEqual({ x: 1 });
    expect(typeof sent.ts).toBe('number');
    stream.close();
  });

  it('removes client on close event', () => {
    const stream = new EventStream();
    const ws = makeMockSocket();
    stream.addClient(ws as never);
    expect(stream.clientCount()).toBe(1);
    ws.emit('close');
    expect(stream.clientCount()).toBe(0);
    stream.close();
  });

  it('removes client on error event', () => {
    const stream = new EventStream();
    const ws = makeMockSocket();
    stream.addClient(ws as never);
    ws.emit('error');
    expect(stream.clientCount()).toBe(0);
    stream.close();
  });

  it('drops clients whose send buffer exceeds backpressure limit', () => {
    const stream = new EventStream();
    const ws = makeMockSocket({ bufferedAmount: 2 * 1024 * 1024 });
    stream.addClient(ws as never);
    stream.broadcast({ type: 'audit', payload: null });
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalled();
    expect(stream.clientCount()).toBe(0);
    stream.close();
  });

  it('skips clients that are not in OPEN readyState', () => {
    const stream = new EventStream();
    const ws = makeMockSocket({ readyState: 3 });
    stream.addClient(ws as never);
    stream.broadcast({ type: 'audit', payload: null });
    expect(ws.send).not.toHaveBeenCalled();
    expect(stream.clientCount()).toBe(0);
    stream.close();
  });

  it('close() clears all clients and stops heartbeat', () => {
    const stream = new EventStream();
    const a = makeMockSocket();
    const b = makeMockSocket();
    stream.addClient(a as never);
    stream.addClient(b as never);
    stream.close();
    expect(stream.clientCount()).toBe(0);
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
  });

  it('close() is idempotent', () => {
    const stream = new EventStream();
    stream.close();
    stream.close();
    expect(stream.clientCount()).toBe(0);
  });

  it('broadcast with no clients is a no-op', () => {
    const stream = new EventStream();
    stream.broadcast({ type: 'audit', payload: null });
    expect(stream.clientCount()).toBe(0);
    stream.close();
  });
});