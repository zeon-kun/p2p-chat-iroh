import { useState, useCallback } from 'react';
import { useChatSocket } from '../lib/useChatSocket';
import TicketBanner from './TicketBanner';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import NetworkTrace from './NetworkTrace';
import PeerModal from './PeerModal';

function getParams() {
  if (typeof window === 'undefined') return { port: 9001, mode: 'open', room: 'default', ticket: '' };
  const p = new URLSearchParams(window.location.search);
  return {
    port:   parseInt(p.get('port') ?? '9001', 10),
    mode:   p.get('mode') ?? 'open',
    room:   p.get('room') ?? 'default',
    ticket: p.get('ticket') ?? '',
  };
}

export default function ChatRoom() {
  const { port, mode, room, ticket } = getParams();
  const [reconnecting, setReconnecting] = useState(false);
  const [traceOpen, setTraceOpen]       = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);

  const handleDisconnect = useCallback((clean: boolean) => {
    if (!clean) setReconnecting(false);
  }, []);

  const { messages, historyCount, networkEvents, connectionState, send, reconnect } = useChatSocket({
    port,
    onDisconnect: handleDisconnect,
  });

  const isConnected    = connectionState === 'connected';
  const isDisconnected = connectionState === 'disconnected';

  const showTicketBanner = mode === 'open';
  const hasTicketString  = mode === 'join' && ticket.length > 0;

  const peerEvents = networkEvents.filter(
    e => e.type === 'peer_up' || e.type === 'peer_down'
  );

  return (
    <div className="shell">

      {/* ── Nav ── */}
      <header className="nav">
        <div className="nav-left">
          <a href="/" className="logo">
            <span className="logo-name">iroh</span>
            <span className="logo-product">chat</span>
          </a>
          <span className="nav-sep">/</span>
          <span className="room-name">{room}</span>
        </div>
        <div className="nav-right">
          <div className={`conn-pill conn-pill--${connectionState}`}>
            <span className="conn-dot" />
            <span className="conn-label">{connectionState}</span>
          </div>
          <button
            className={`overflow-btn${traceOpen ? ' overflow-btn--active' : ''}`}
            title="Network trace"
            onClick={() => setTraceOpen(v => !v)}
          >⋯</button>
        </div>
      </header>

      {/* ── Disconnected banner ── */}
      {isDisconnected && (
        <div className="alert-banner alert-banner--error">
          <span>Server disconnected (Close 1001).</span>
          <button className="alert-action" onClick={reconnect}>Reconnect</button>
        </div>
      )}

      {/* ── Ticket banner — open mode only ── */}
      {showTicketBanner && !isDisconnected && (
        <div className="alert-banner alert-banner--info">
          <div className="alert-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span className="alert-text">
              Share the ticket from your terminal with Peer B to let them join.
            </span>
          </div>
        </div>
      )}

      {/* ── Join mode: show the ticket that was used ── */}
      {hasTicketString && !isDisconnected && (
        <TicketBanner ticket={ticket} />
      )}

      {/* ── Main: messages + trace panel side-by-side ── */}
      <div className="main-area">
        <div className="messages-col">
          <MessageList
            messages={messages}
            historyCount={historyCount}
            peerEvents={peerEvents}
            onPeerClick={setSelectedPeer}
          />
          <MessageInput onSend={send} disabled={!isConnected} />
        </div>
        <NetworkTrace events={networkEvents} open={traceOpen} />
      </div>

      {/* ── Peer detail modal ── */}
      {selectedPeer && (
        <PeerModal
          peerId={selectedPeer}
          messages={messages}
          networkEvents={networkEvents}
          onClose={() => setSelectedPeer(null)}
        />
      )}

      <style>{`
        .shell { height:100vh; display:flex; flex-direction:column; background:var(--color-page); overflow:hidden; }
        .main-area { flex:1; display:flex; flex-direction:row; overflow:hidden; min-height:0; }
        .messages-col { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; }

        /* Nav */
        .nav {
          height:var(--nav-height); display:flex; align-items:center; justify-content:space-between;
          padding:0 32px; border-bottom:1px solid var(--color-ink-hairline);
          flex-shrink:0; background:var(--color-page);
        }
        .nav-left  { display:flex; align-items:center; gap:10px; }
        .nav-right { display:flex; align-items:center; gap:12px; }
        .logo { display:flex; align-items:center; gap:8px; text-decoration:none; }
        .logo-name { font-family:var(--font-sans); font-size:16px; font-weight:var(--fw-bold); letter-spacing:-0.4px; color:var(--color-ink-primary); }
        .logo-product { font-family:var(--font-mono); font-size:12px; color:var(--color-ink-subtle); }
        .nav-sep { font-family:var(--font-mono); font-size:13px; color:#cccccc; }
        .room-name { font-family:var(--font-mono); font-size:13px; color:var(--color-ink-muted); }

        /* Connection pill */
        .conn-pill {
          display:flex; align-items:center; gap:6px;
          padding:5px 14px; border-radius:var(--radius-full);
          font-family:var(--font-sans); font-size:var(--text-sm); font-weight:var(--fw-medium);
          text-transform:lowercase;
        }
        .conn-pill--connected    { background:var(--color-accent-green-pill); color:var(--color-accent-green); }
        .conn-pill--connecting   { background:#f5f5f5; color:var(--color-ink-muted); }
        .conn-pill--disconnected { background:#fff0ec; color:#ba4705; }
        .conn-dot { width:8px; height:8px; border-radius:50%; background:currentColor; flex-shrink:0; }

        .overflow-btn {
          width:28px; height:28px; display:flex; align-items:center; justify-content:center;
          border:1px solid var(--color-ink-hairline); border-radius:var(--radius-sm);
          font-size:14px; color:var(--color-ink-muted); background:var(--color-page); cursor:pointer;
          transition:background var(--duration-fast) var(--ease-standard);
        }
        .overflow-btn:hover { background:var(--color-surface); }
        .overflow-btn--active { background:var(--color-surface); color:var(--color-ink-primary); border-color:#c0c0c0; }

        /* Alert banners */
        .alert-banner {
          display:flex; align-items:center; justify-content:space-between;
          padding:0 32px; height:40px; flex-shrink:0; gap:12px;
          font-family:var(--font-mono); font-size:var(--text-sm);
        }
        .alert-banner--error {
          background:#fff8f5; border-bottom:1px solid #ffd5c0;
          border-left:3px solid #ba4705; color:#ba4705;
        }
        .alert-banner--info {
          background:var(--color-accent-green-bg); border-bottom:1px solid #c6e8d4;
          border-left:3px solid var(--color-accent-green); color:var(--color-accent-green);
        }
        .alert-left { display:flex; align-items:center; gap:10px; }
        .alert-text { line-height:1.4; }
        .alert-action {
          padding:3px 12px; border-radius:var(--radius-sm); border:1px solid currentColor;
          background:transparent; font-family:var(--font-mono); font-size:var(--text-sm);
          font-weight:var(--fw-medium); color:inherit; cursor:pointer; white-space:nowrap;
          transition:background var(--duration-fast) var(--ease-standard);
        }
        .alert-action:hover { background:rgba(0,0,0,0.06); }
      `}</style>
    </div>
  );
}
