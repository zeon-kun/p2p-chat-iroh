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
  | 'conn_established'
  | 'room_ready'
  | 'room_joined'
  | 'room_left'
  | 'room_closed'
  | 'history_complete';

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
  // room_ready / room_joined
  ticket?:  string;
  peer_id?: string;
  room?:    string;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/** Why the WS connection closed. 'host' = the remote host shut down the room. */
export type ClosedReason = 'host' | 'unknown' | null;

interface UseChatSocketOptions {
  port:      number;
  /** 'serve' = UI-initiated room setup; omit for legacy CLI-initiated mode. */
  mode?:     string;
  /** 'open' | 'join' — action to send on connect in serve mode. */
  action?:   string;
  roomName?: string;
  ticket?:   string;
  onConnect?: () => void;
  onDisconnect?: (clean: boolean) => void;
}

interface UseChatSocketReturn {
  messages:        ChatMessage[];
  historyCount:    number;
  networkEvents:   NetworkEvent[];
  connectionState: ConnectionState;
  /**
   * 'idle'    — no room active (between rooms or after room_left)
   * 'pending' — room command sent, waiting for room_ready/room_joined
   * 'ready'   — room is set up, ticket/peer info available
   * 'closed'  — room was terminated by the host; terminal state
   */
  roomState:     'idle' | 'pending' | 'ready' | 'closed';
  /** The action for the current (or most recent) room ('open' | 'join' | null = idle). */
  currentAction: 'open' | 'join' | null;
  roomTicket:    string | null;
  roomPeerId:    string | null;
  /** Reason the WS closed (set when disconnected). */
  closedReason:  ClosedReason;
  send:          (body: string) => void;
  reconnect:     () => void;
  shutdownRoom:  () => void;
  /** Send a leave command; backend will respond with a room_left event. */
  leave:         () => void;
  /** Open a new room from the current WS connection (post-leave or initial idle). */
  openRoom:      (room: string) => void;
  /** Join an existing room from the current WS connection (post-leave or initial idle). */
  joinRoom:      (room: string, ticket: string) => void;
}

function nonceKey(nonce: number[]): string {
  return nonce.join(',');
}

export function useChatSocket({
  port, mode, action, roomName, ticket,
  onConnect, onDisconnect,
}: UseChatSocketOptions): UseChatSocketReturn {
  const serveMode = mode === 'serve';

  const [messages, setMessages]               = useState<ChatMessage[]>([]);
  const [historyCount, setHistoryCount]       = useState(0);
  const [networkEvents, setNetworkEvents]     = useState<NetworkEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [roomState, setRoomState]             = useState<'idle' | 'pending' | 'ready' | 'closed'>(serveMode ? 'pending' : 'ready');
  const [currentAction, setCurrentAction]     = useState<'open' | 'join' | null>(
    serveMode ? (action === 'join' ? 'join' : 'open') : null
  );
  const [roomTicket, setRoomTicket]           = useState<string | null>(null);
  const [roomPeerId, setRoomPeerId]           = useState<string | null>(null);
  const [closedReason, setClosedReason]       = useState<ClosedReason>(null);

  const wsRef        = useRef<WebSocket | null>(null);
  // seenNonces persists across reconnects within the same room so replayed
  // history frames are not shown as duplicates. Reset only on genuine new-room events.
  const seenNonces   = useRef<Set<string>>(new Set());
  const historyDone  = useRef(false);
  const historyBatch = useRef<ChatMessage[]>([]);
  // roomStateRef mirrors roomState for use inside ws callbacks without stale closure.
  const roomStateRef = useRef<'idle' | 'pending' | 'ready' | 'closed'>(serveMode ? 'pending' : 'ready');

  // Resets room-level state (messages, events, nonces) without touching the
  // history-burst refs. historyDone/historyBatch are managed by connect() (new
  // WS) and openRoom/joinRoom (mid-WS, no burst expected → immediately mark done).
  const resetRoom = useCallback(() => {
    seenNonces.current = new Set();
    setMessages([]);
    setHistoryCount(0);
    setNetworkEvents([]);
    setRoomTicket(null);
    setRoomPeerId(null);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    // Reset history-burst refs for the new WS connection.
    historyDone.current  = false;
    historyBatch.current = [];
    resetRoom();
    setConnectionState('connecting');
    setClosedReason(null);
    const initRoomState = serveMode ? 'pending' : 'ready';
    setRoomState(initRoomState);
    roomStateRef.current = initRoomState;
    setCurrentAction(serveMode ? (action === 'join' ? 'join' : 'open') : null);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState('connected');
      onConnect?.();

      if (serveMode && action === 'open') {
        ws.send(JSON.stringify({ cmd: 'open', room: roomName || 'default' }));
      } else if (serveMode && action === 'join') {
        ws.send(JSON.stringify({ cmd: 'join', room: roomName || 'default', ticket: ticket || '' }));
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      const parsed = JSON.parse(e.data);

      // Network event — has a `type` field; route to networkEvents.
      if (parsed.type) {
        const ev: NetworkEvent = {
          ...parsed,
          ts: parsed.ts ?? Date.now(),
        };

        // history_complete sentinel: flush the buffered history batch → mark done.
        if (ev.type === 'history_complete') {
          const batch = historyBatch.current;
          historyBatch.current = [];
          historyDone.current  = true;
          setHistoryCount(batch.length);
          setMessages(batch);
          return; // don't push into networkEvents
        }

        setNetworkEvents(prev => [...prev.slice(-299), ev]);

        if (ev.type === 'room_ready') {
          setRoomTicket(ev.ticket ?? null);
          setRoomPeerId(ev.peer_id ?? null);
          setRoomState('ready');
          roomStateRef.current = 'ready';
        } else if (ev.type === 'room_joined') {
          setRoomPeerId(ev.peer_id ?? null);
          setRoomState('ready');
          roomStateRef.current = 'ready';
        } else if (ev.type === 'room_left') {
          // Ignore room_left if room_closed already fired — the backend emits both
          // when a joiner's recv_loop terminates due to receiving a RoomClosed gossip
          // frame, and room_left must not override the terminal 'closed' state.
          if (roomStateRef.current === 'closed') return;
          resetRoom();
          setRoomTicket(null);
          setRoomPeerId(null);
          setCurrentAction(null);
          setRoomState('idle');
          roomStateRef.current = 'idle';
        } else if (ev.type === 'room_closed') {
          resetRoom();
          setRoomTicket(null);
          setRoomPeerId(null);
          setCurrentAction(null);
          setRoomState('closed');
          roomStateRef.current = 'closed';
        }
        return;
      }

      const msg: ChatMessage = parsed;
      const key = nonceKey(msg.nonce);

      if (seenNonces.current.has(key)) return;
      seenNonces.current.add(key);

      if (!historyDone.current) {
        historyBatch.current.push(msg);
      } else {
        setMessages(prev => [...prev, msg]);
      }
    };

    ws.onclose = (e: CloseEvent) => {
      setConnectionState('disconnected');
      // If the room was closed by the host (room_closed event already received),
      // mark that reason so the UI can suppress the futile Reconnect button.
      const reason: ClosedReason =
        roomStateRef.current === 'closed' ? 'host' :
        (roomStateRef.current === 'ready' || roomStateRef.current === 'pending') ? 'unknown' :
        null;
      setClosedReason(reason);
      onDisconnect?.(e.wasClean);
    };

    ws.onerror = () => {
      setConnectionState('disconnected');
    };
  }, [port, mode, action, roomName, ticket, serveMode, onConnect, onDisconnect, resetRoom]);

  useEffect(() => {
    connect();
    return () => {
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

  const shutdownRoom = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Mark closed before sending so that when ws.onclose fires (after the backend
      // exits), closedReason='host' is set correctly and no Reconnect button appears.
      setRoomState('closed');
      roomStateRef.current = 'closed';
      wsRef.current.send(JSON.stringify({ cmd: 'shutdown' }));
    }
  }, []);

  const leave = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ cmd: 'leave' }));
    }
  }, []);

  const openRoom = useCallback((room: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    resetRoom();
    // Mid-WS room switch: no history burst expected (history_complete was sent once
    // at connection time). Mark done immediately so live messages are shown directly.
    historyDone.current  = true;
    historyBatch.current = [];
    setRoomTicket(null);
    setRoomPeerId(null);
    setCurrentAction('open');
    const next = 'pending' as const;
    setRoomState(next);
    roomStateRef.current = next;
    wsRef.current.send(JSON.stringify({ cmd: 'open', room }));
  }, [resetRoom]);

  const joinRoom = useCallback((room: string, ticket: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    resetRoom();
    // Same reasoning as openRoom — no history burst on mid-WS room switch.
    historyDone.current  = true;
    historyBatch.current = [];
    setRoomTicket(null);
    setRoomPeerId(null);
    setCurrentAction('join');
    const next = 'pending' as const;
    setRoomState(next);
    roomStateRef.current = next;
    wsRef.current.send(JSON.stringify({ cmd: 'join', room: room || 'default', ticket }));
  }, [resetRoom]);

  return {
    messages, historyCount, networkEvents, connectionState,
    roomState, currentAction, roomTicket, roomPeerId, closedReason,
    send, reconnect: connect, shutdownRoom, leave, openRoom, joinRoom,
  };
}
