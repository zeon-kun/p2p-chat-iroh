import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  from:  string;
  body:  string;
  ts:    number;
  nonce: number[];
}

export type NetworkEventKind =
  | 'peer_up'
  | 'peer_down'
  | 'msg_sent'
  | 'msg_recv'
  | 'net_report'
  | 'relay_pong'
  | 'stun_scheduled'
  | 'relay_connected'
  | 'path_selected'
  | 'conn_established';

export interface RelayLatency {
  probe: string;
  url:   string;
  ms:    number;
}

export interface NetworkEvent {
  type: NetworkEventKind;
  ts?:  number;
  // peer_up / peer_down
  peer?: string;
  // msg_sent / msg_recv
  from?: string;
  // net_report
  preferred_relay?:  string;
  relay_latencies?:  RelayLatency[];
  udp_v4?:           boolean;
  udp_v6?:           boolean;
  captive_portal?:   boolean | null;
  // relay_pong / path_selected
  rtt_ms?: number;
  // stun_scheduled
  in_secs?: number;
  // relay_connected
  url?:  string;
  home?: boolean;
  // path_selected
  transport?: string;
  addr?:      string;
  remote?:    string;
  // conn_established
  side?: string;
  alpn?: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface UseChatSocketOptions {
  port: number;
  onConnect?: () => void;
  onDisconnect?: (clean: boolean) => void;
}

interface UseChatSocketReturn {
  messages:        ChatMessage[];
  historyCount:    number;
  networkEvents:   NetworkEvent[];
  connectionState: ConnectionState;
  send:            (body: string) => void;
  reconnect:       () => void;
}

function nonceKey(nonce: number[]): string {
  return nonce.join(',');
}

export function useChatSocket({ port, onConnect, onDisconnect }: UseChatSocketOptions): UseChatSocketReturn {
  const [messages, setMessages]               = useState<ChatMessage[]>([]);
  const [historyCount, setHistoryCount]       = useState(0);
  const [networkEvents, setNetworkEvents]     = useState<NetworkEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  const wsRef        = useRef<WebSocket | null>(null);
  const seenNonces   = useRef<Set<string>>(new Set());
  const historyDone  = useRef(false);
  const historyBatch = useRef<ChatMessage[]>([]);
  const flushTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    seenNonces.current   = new Set();
    historyDone.current  = false;
    historyBatch.current = [];
    setMessages([]);
    setHistoryCount(0);
    setNetworkEvents([]);
    setConnectionState('connecting');

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState('connected');
      onConnect?.();
    };

    ws.onmessage = (e: MessageEvent) => {
      const parsed = JSON.parse(e.data);

      // Network event — has a `type` field; route to networkEvents.
      if (parsed.type) {
        const ev: NetworkEvent = {
          ...parsed,
          // Stamp client-side ts if backend didn't send one (e.g. older peer events).
          ts: parsed.ts ?? Date.now(),
        };
        setNetworkEvents(prev => [...prev.slice(-299), ev]);
        return;
      }

      const msg: ChatMessage = parsed;
      const key = nonceKey(msg.nonce);

      if (seenNonces.current.has(key)) return;
      seenNonces.current.add(key);

      if (!historyDone.current) {
        historyBatch.current.push(msg);
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          const batch = historyBatch.current;
          historyBatch.current = [];
          historyDone.current  = true;
          setHistoryCount(batch.length);
          setMessages(batch);
        }, 80);
      } else {
        setMessages(prev => [...prev, msg]);
      }
    };

    ws.onclose = (e: CloseEvent) => {
      setConnectionState('disconnected');
      onDisconnect?.(e.wasClean);
    };

    ws.onerror = () => {
      setConnectionState('disconnected');
    };
  }, [port, onConnect, onDisconnect]);

  useEffect(() => {
    connect();
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((body: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(body);
    }
  }, []);

  return { messages, historyCount, networkEvents, connectionState, send, reconnect: connect };
}
