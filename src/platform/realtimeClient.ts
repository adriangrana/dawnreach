import { getAuthToken } from './authToken';
import { getPlatformBaseUrl } from './apiClient';
import type { PlatformRealtimeEvent } from './types';

function websocketUrl(token: string) {
  const url = new URL(getPlatformBaseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.searchParams.set('token', token);
  return url.toString();
}

export class PlatformRealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: PlatformRealtimeEvent) => void>();

  subscribe(listener: (event: PlatformRealtimeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect() {
    const token = getAuthToken();
    if (!token) throw new Error('No hay una sesión autenticada para abrir realtime.');
    this.disconnect();
    const socket = new WebSocket(websocketUrl(token));
    this.socket = socket;
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as PlatformRealtimeEvent;
        for (const listener of this.listeners) listener(payload);
      } catch {
        // Ignore malformed transport payloads; authoritative state never comes from parsing failures.
      }
    });
    return socket;
  }

  send(type: string, data: Record<string, unknown> = {}) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, ...data }));
    return true;
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }
}

export const platformRealtime = new PlatformRealtimeClient();
