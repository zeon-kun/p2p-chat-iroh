import { useEffect, useRef } from 'react';
import type { ChatMessage, NetworkEvent } from '../lib/useChatSocket';
import { peerName, peerColor } from '../lib/peerIdentity';

interface MessageListProps {
  messages:     ChatMessage[];
  historyCount: number;
  peerEvents:   NetworkEvent[];
  onPeerClick:  (id: string) => void;
}

type StreamItem =
  | { kind: 'message'; msg: ChatMessage; _ts: number }
  | { kind: 'pill'; ev: NetworkEvent; _ts: number };

function formatTime(ts?: number) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function nonceNum(nonce: number[]): number {
  // Collapse nonce to a single comparable number for stable sort tiebreaking.
  return nonce.reduce((acc, b) => acc * 256 + b, 0) % 2 ** 32;
}

function buildStream(msgs: ChatMessage[], peerEvts: NetworkEvent[]): StreamItem[] {
  const items: StreamItem[] = [
    ...msgs.map(msg => ({ kind: 'message' as const, msg, _ts: msg.ts })),
    ...peerEvts.map(ev => ({ kind: 'pill' as const, ev, _ts: ev.ts ?? 0 })),
  ];
  // Stable sort: primary ts, secondary nonce (messages) or 0 (pills).
  items.sort((a, b) => {
    const dt = a._ts - b._ts;
    if (dt !== 0) return dt;
    const aNonce = a.kind === 'message' ? nonceNum(a.msg.nonce) : 0;
    const bNonce = b.kind === 'message' ? nonceNum(b.msg.nonce) : 0;
    return aNonce - bNonce;
  });
  return items;
}

function PeerBadge({ id, onClick }: { id: string; onClick: () => void }) {
  const { bg, fg, border } = peerColor(id);
  return (
    <button
      className="peer-badge"
      onClick={onClick}
      title={id}
      style={{ background: bg, color: fg, borderColor: border }}
    >
      {peerName(id)}
    </button>
  );
}

function SystemPill({ ev }: { ev: NetworkEvent }) {
  const isPeerUp = ev.type === 'peer_up';
  const peerId   = ev.peer ?? '';
  const name     = peerName(peerId);
  const { fg }   = peerColor(peerId);
  return (
    <div className="system-pill-row">
      <div className="system-pill-line" />
      <div className="system-pill" style={{ color: fg }}>
        <span className="system-pill-icon">{isPeerUp ? '⊕' : '⊝'}</span>
        <span className="system-pill-name">{name}</span>
        <span className="system-pill-action">{isPeerUp ? 'joined' : 'left'}</span>
        {ev.ts && <span className="system-pill-ts">{formatTime(ev.ts)}</span>}
      </div>
      <div className="system-pill-line" />
    </div>
  );
}

function MessageItem({
  msg,
  onPeerClick,
}: {
  msg: ChatMessage;
  onPeerClick: (id: string) => void;
}) {
  return (
    <div className="msg">
      <div className="msg-meta">
        <PeerBadge id={msg.from} onClick={() => onPeerClick(msg.from)} />
        <span className="timestamp">{formatTime(msg.ts)}</span>
      </div>
      <p className="msg-body">{msg.body}</p>
    </div>
  );
}

export default function MessageList({ messages, historyCount, peerEvents, onPeerClick }: MessageListProps) {
  const bottomRef    = useRef<HTMLDivElement>(null);
  const listRef      = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
  };

  useEffect(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, peerEvents]);

  // Clamp historyCount in case it exceeds messages.length (e.g. stale state).
  const clampedHistory = Math.min(historyCount, messages.length);
  const historyMsgs    = messages.slice(0, clampedHistory);
  const liveMsgs       = messages.slice(clampedHistory);
  const historyTs   = historyMsgs[historyMsgs.length - 1]?.ts ?? 0;

  const historyPeerEvts = peerEvents.filter(e => clampedHistory > 0 && (e.ts ?? 0) <= historyTs);
  const livePeerEvts    = peerEvents.filter(e => !historyPeerEvts.includes(e));

  const historyStream = buildStream(historyMsgs, historyPeerEvts);
  const liveStream    = buildStream(liveMsgs, livePeerEvts);

  const isEmpty = messages.length === 0 && peerEvents.length === 0;

  return (
    <div className="message-list" ref={listRef} onScroll={handleScroll}>
      <div aria-hidden className="dot-grid" />
      <div className="messages">
        {isEmpty && (
          <div className="empty-state">Waiting for messages…</div>
        )}

        {historyStream.map((item, i) =>
          item.kind === 'message'
            ? <MessageItem key={`h-msg-${i}`} msg={item.msg} onPeerClick={onPeerClick} />
            : <SystemPill key={`h-pill-${i}`} ev={item.ev} />
        )}

        {clampedHistory > 0 && liveMsgs.length + livePeerEvts.length > 0 && (
          <div className="divider" role="separator">
            <div className="divider-line" />
            <span className="divider-chip">live</span>
            <div className="divider-line" />
          </div>
        )}

        {liveStream.map((item, i) =>
          item.kind === 'message'
            ? <MessageItem key={`l-msg-${i}`} msg={item.msg} onPeerClick={onPeerClick} />
            : <SystemPill key={`l-pill-${i}`} ev={item.ev} />
        )}

        <div ref={bottomRef} />
      </div>

      <style>{`
        .message-list {
          flex: 1;
          overflow-y: auto;
          position: relative;
          background: var(--color-page);
        }
        .message-list::-webkit-scrollbar { width: 4px; }
        .message-list::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }

        .messages {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 24px 32px 32px;
          min-height: 100%;
          z-index: 1;
          position: relative;
        }

        .empty-state {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          color: #cccccc;
          text-align: center;
          padding-top: 40px;
        }

        /* ── Message row ─────────────────────────── */
        .msg { display: flex; flex-direction: column; gap: 3px; }
        .msg-meta { display: flex; align-items: center; gap: 8px; }
        .peer-badge {
          display: inline-flex;
          align-items: center;
          height: 20px;
          padding: 0 8px;
          border-radius: var(--radius-full);
          border: 1px solid;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: var(--fw-medium);
          letter-spacing: 0.2px;
          cursor: pointer;
          line-height: 1;
          transition: opacity var(--duration-fast) var(--ease-standard),
                      box-shadow var(--duration-fast) var(--ease-standard);
        }
        .peer-badge:hover { opacity: 0.8; box-shadow: 0 0 0 2px rgba(0,0,0,0.08); }
        .timestamp { font-family: var(--font-mono); font-size: var(--text-xs); color: #bbbbbb; }
        .msg-body {
          font-size: var(--text-base);
          font-weight: var(--fw-regular);
          color: var(--color-ink-primary);
          line-height: 1.6;
        }

        /* ── System join/leave pills ─────────────── */
        .system-pill-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: -8px 0;
        }
        .system-pill-line { flex: 1; height: 1px; background: var(--color-ink-hairline); }
        .system-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          border-radius: var(--radius-full);
          background: var(--color-surface);
          border: 1px solid var(--color-ink-hairline);
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .system-pill-icon { font-size: 12px; }
        .system-pill-name { font-weight: var(--fw-medium); }
        .system-pill-action { color: var(--color-ink-muted); }
        .system-pill-ts { color: #bbbbbb; margin-left: 4px; }

        /* ── History/live divider ────────────────── */
        .divider { display: flex; align-items: center; gap: 12px; }
        .divider-line { flex: 1; height: 1px; background: #e8e8e8; }
        .divider-chip {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-accent-green);
          background: var(--color-accent-green-bg);
          padding: 3px 10px;
          border-radius: var(--radius-full);
        }
      `}</style>
    </div>
  );
}
