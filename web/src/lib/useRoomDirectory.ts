import { useState, useEffect, useRef } from 'react';

const REGISTRY_PORT      = 9000;
const RECONNECT_MIN_MS   = 3_000;
const RECONNECT_MAX_MS   = 30_000;

export type RegistryState = 'connecting' | 'up' | 'down';

export interface RoomEntry {
  room:      string;
  ticket:    string;
  peer_id:   string;
  opened_at: number;
}

function registryWsUrl(): string {
  if (typeof window === 'undefined') return `ws://127.0.0.1:${REGISTRY_PORT}`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host  = window.location.hostname || '127.0.0.1';
  return `${proto}://${host}:${REGISTRY_PORT}`;
}

export function useRoomDirectory() {
  const [rooms,    setRooms]    = useState<RoomEntry[]>([]);
  const [registry, setRegistry] = useState<RegistryState>('connecting');
  const wsRef      = useRef<WebSocket | null>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef   = useRef(RECONNECT_MIN_MS);

  useEffect(() => {
    let dead = false;

    function connect() {
      if (dead) return;
      setRegistry('connecting');
      const ws = new WebSocket(registryWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        delayRef.current = RECONNECT_MIN_MS; // reset backoff on success
        setRegistry('up');
        ws.send(JSON.stringify({ role: 'subscribe' }));
      };

      ws.onmessage = (e: MessageEvent) => {
        try {
          const list: RoomEntry[] = JSON.parse(e.data);
          if (Array.isArray(list)) setRooms(list);
        } catch {}
      };

      ws.onclose = () => {
        setRegistry('down');
        setRooms([]); // clear stale rooms so they don't appear "live" while offline
        if (!dead) {
          const delay = delayRef.current;
          delayRef.current = Math.min(delay * 1.5, RECONNECT_MAX_MS);
          timerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close(); // triggers onclose → reconnect
      };
    }

    connect();

    return () => {
      dead = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  return { rooms, registry };
}
