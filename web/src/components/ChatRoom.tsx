import { useState, useCallback, useEffect } from 'react';
import { useChatSocket } from '../lib/useChatSocket';
import TicketBanner from './TicketBanner';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import NetworkTrace from './NetworkTrace';
import PeerModal from './PeerModal';
import ConnectingOverlay from './ConnectingOverlay';

function getParams() {
  if (typeof window === 'undefined') {
    return { port: 9001, mode: 'open', action: 'open', room: 'default', ticket: '' };
  }
  const p = new URLSearchParams(window.location.search);
  return {
    port:   parseInt(p.get('port') ?? '9001', 10),
    mode:   p.get('mode') ?? 'open',
    action: p.get('action') ?? 'open',
    room:   p.get('room') ?? 'default',
    ticket: p.get('ticket') ?? '',
  };
}

export default function ChatRoom() {
  const { port, mode, action, room, ticket } = getParams();
  const [traceOpen, setTraceOpen]       = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const handleDisconnect = useCallback((_clean: boolean) => {}, []);

  const {
    messages, historyCount, networkEvents, connectionState,
    roomState, currentAction, roomTicket, roomPeerId, closedReason,
    send, reconnect, shutdownRoom, leave, openRoom, joinRoom,
  } = useChatSocket({
    port,
    mode:     mode === 'serve' ? 'serve' : undefined,
    action:   mode === 'serve' ? action  : undefined,
    roomName: mode === 'serve' ? room    : undefined,
    ticket:   mode === 'serve' ? ticket  : undefined,
    onDisconnect: handleDisconnect,
  });

  const isConnected    = connectionState === 'connected';
  const isDisconnected = connectionState === 'disconnected';
  const isServeMode    = mode === 'serve';
  const isHost         = isServeMode && currentAction === 'open' && overlayDismissed;
  const isRoomClosed   = roomState === 'closed';

  // When the backend leaves a room, reset the overlay so it re-appears.
  useEffect(() => {
    if (roomState === 'idle') setOverlayDismissed(false);
  }, [roomState]);

  // Show overlay while room is not yet set up, after room_left (idle), or before user enters.
  // Never show overlay when the room is closed — we show a dedicated terminal card instead.
  const showOverlay = isServeMode && !isRoomClosed && (
    roomState === 'idle' ||
    (roomState === 'pending' && !overlayDismissed) ||
    (roomState === 'ready' && !overlayDismissed)
  );

  // In legacy open mode, use ticket from WS room_ready event if available.
  const effectiveTicket = roomTicket ?? (mode === 'join' ? ticket : null);

  const showTicketBanner = !isServeMode && mode === 'open' && !isDisconnected;
  const hasTicketString  = !isServeMode && mode === 'join' && ticket.length > 0;


  const peerEvents = networkEvents.filter(
    e => e.type === 'peer_up' || e.type === 'peer_down'
  );

  const roomLabel = (roomState === 'idle' || roomState === 'closed') ? roomState : (room || (roomTicket ? 'serve' : 'default'));

  return (
    <div className="shell">

      {/* ── Connecting overlay (serve mode only) ── */}
      {showOverlay && (
        <ConnectingOverlay
          action={currentAction}
          roomState={roomState}
          roomTicket={roomTicket}
          roomPeerId={roomPeerId}
          networkEvents={networkEvents}
          connectionState={connectionState}
          onEnterChat={() => setOverlayDismissed(true)}
          shutdownRoom={shutdownRoom}
          onOpenRoom={openRoom}
          onJoinRoom={joinRoom}
        />
      )}

      {/* ── Nav ── */}
      <header className="nav">
        <div className="nav-left">
          <a href="/" className="logo">
            <span className="logo-name">iroh</span>
            <span className="logo-product">chat</span>
          </a>
          <span className="nav-sep">/</span>
          <span className="room-name">{roomLabel}</span>
        </div>
        <div className="nav-right">
          <div className={`conn-pill conn-pill--${connectionState}`}>
            <span className="conn-dot" />
            <span className="conn-label">{connectionState}</span>
          </div>
          {isServeMode && overlayDismissed && (
            <>
              {isHost && (
                <button
                  className="shutdown-btn"
                  title="Shutdown room"
                  onClick={() => { shutdownRoom(); window.location.href = '/'; }}
                >Shutdown</button>
              )}
              <button
                className="leave-btn"
                title="Leave room"
                onClick={leave}
              >Leave</button>
            </>
          )}
          <button
            className={`overflow-btn${traceOpen ? ' overflow-btn--active' : ''}`}
            title="Network trace"
            onClick={() => setTraceOpen(v => !v)}
          >⋯</button>
        </div>
      </header>

      {/* ── Room-closed terminal card (host shut down the room) ── */}
      {isRoomClosed && (
        <div className="room-closed-card">
          <p className="room-closed-msg">This room was closed by the host.</p>
          <a href="/" className="room-closed-btn">Back to start</a>
        </div>
      )}

      {/* ── Disconnected banner ── */}
      {isDisconnected && !isRoomClosed && (
        <div className="alert-banner alert-banner--error">
          <span>
            {closedReason === 'host' ? 'Room closed — the host has shut down.' : 'Server disconnected.'}
          </span>
          {closedReason !== 'host' && (
            <button className="alert-action" onClick={reconnect}>Reconnect</button>
          )}
          {closedReason === 'host' && (
            <a href="/" className="alert-action" style={{ textDecoration: 'none' }}>Back to start</a>
          )}
        </div>
      )}

      {/* ── Ticket banner — open mode (legacy CLI): ticket from room_ready or terminal ── */}
      {showTicketBanner && (
        <div className="alert-banner alert-banner--info">
          <div className="alert-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            {effectiveTicket ? (
              <span className="alert-text alert-ticket">{effectiveTicket.slice(0, 32)}…</span>
            ) : (
              <span className="alert-text">Share the ticket from your terminal with Peer B to let them join.</span>
            )}
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
          <MessageInput onSend={send} disabled={!isConnected || isRoomClosed} />
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
        .shutdown-btn {
          height:28px; padding:0 10px;
          border:1px solid #ffd5c0; border-radius:var(--radius-sm);
          font-family:var(--font-mono); font-size:var(--text-xs); font-weight:var(--fw-medium);
          color:#ba4705; background:transparent; cursor:pointer;
          transition:background var(--duration-fast) var(--ease-standard);
        }
        .shutdown-btn:hover { background:#fff8f5; }
        .leave-btn {
          height:28px; padding:0 10px;
          border:1px solid var(--color-ink-hairline); border-radius:var(--radius-sm);
          font-family:var(--font-mono); font-size:var(--text-xs); font-weight:var(--fw-medium);
          color:var(--color-ink-muted); background:transparent; cursor:pointer;
          transition:background var(--duration-fast) var(--ease-standard);
        }
        .leave-btn:hover { background:var(--color-surface); }

        /* Room-closed terminal card */
        .room-closed-card {
          display:flex; align-items:center; justify-content:center; gap:16px;
          padding:0 32px; height:48px; flex-shrink:0;
          background:#fff8f5; border-bottom:1px solid #ffd5c0;
          border-left:3px solid #ba4705;
        }
        .room-closed-msg {
          font-family:var(--font-mono); font-size:var(--text-sm);
          color:#ba4705; margin:0;
        }
        .room-closed-btn {
          padding:3px 12px; border-radius:var(--radius-sm); border:1px solid #ba4705;
          font-family:var(--font-mono); font-size:var(--text-sm); font-weight:var(--fw-medium);
          color:#ba4705; cursor:pointer; white-space:nowrap;
          transition:background var(--duration-fast) var(--ease-standard);
        }
        .room-closed-btn:hover { background:rgba(186,71,5,0.08); }

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
        .alert-ticket { font-size:11px; letter-spacing:0.3px; }
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
