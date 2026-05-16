import { useState, useCallback, useRef, useEffect } from 'react';
import type { NetworkEvent } from '../lib/useChatSocket';

interface ConnectingOverlayProps {
  /** null = idle (no room), 'open' | 'join' = in-flight or established. */
  action:          'open' | 'join' | null;
  roomState:       'idle' | 'pending' | 'ready' | 'closed';
  roomTicket:      string | null;
  roomPeerId:      string | null;
  networkEvents:   NetworkEvent[];
  connectionState: 'connecting' | 'connected' | 'disconnected';
  onEnterChat:     () => void;
  shutdownRoom:    () => void;
  onOpenRoom:      (room: string) => void;
  onJoinRoom:      (room: string, ticket: string) => void;
}

function shortUrl(url?: string) {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
}

function evLabel(ev: NetworkEvent): string | null {
  switch (ev.type) {
    case 'relay_connected': return `relay connected → ${shortUrl(ev.url)}${ev.home ? ' (home)' : ''}`;
    case 'stun_scheduled':  return `STUN check in ${ev.in_secs}s`;
    case 'relay_pong':      return `relay pong ${ev.rtt_ms != null ? `${ev.rtt_ms.toFixed(1)}ms` : ''}`;
    case 'net_report': {
      const best = ev.relay_latencies?.reduce((m, l) => l.ms < m ? l.ms : m, Infinity);
      return `net_report${best != null && isFinite(best) ? ` · best relay ${best}ms` : ''}${ev.udp_v4 ? ' · udp ✓' : ''}`;
    }
    case 'path_selected': return `path → ${ev.transport} ${ev.addr ?? ''}${ev.rtt_ms != null ? ` ${ev.rtt_ms.toFixed(1)}ms` : ''}`;
    case 'conn_established': return `QUIC connected (${ev.side})`;
    case 'room_ready':  return null;
    case 'room_joined': return null;
    default:            return null;
  }
}

function evColor(type: string): string {
  if (type === 'relay_connected' || type === 'conn_established') return '#7c3aed';
  if (type === 'relay_pong' || type === 'net_report' || type === 'path_selected') return '#1d4ed8';
  if (type === 'stun_scheduled') return '#6b7280';
  return '#888';
}

// Pending room-setup times out after 12 s if no ready event arrives.
const PENDING_TIMEOUT_MS = 12_000;

export default function ConnectingOverlay({
  action, roomState, roomTicket, roomPeerId, networkEvents, connectionState,
  onEnterChat, shutdownRoom, onOpenRoom, onJoinRoom,
}: ConnectingOverlayProps) {
  const [copied, setCopied]         = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [idleMode, setIdleMode]     = useState<'pick' | 'open' | 'join'>('pick');
  const [idleRoom, setIdleRoom]     = useState('');
  const [idleTicket, setIdleTicket] = useState('');
  const [timedOut, setTimedOut]     = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset idle form when we leave idle state.
  useEffect(() => {
    if (roomState !== 'idle') {
      setIdleMode('pick');
      setIdleRoom('');
      setIdleTicket('');
    }
  }, [roomState]);

  // 12 s timeout while pending: show error + retry UI.
  useEffect(() => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    setTimedOut(false);
    if (roomState === 'pending' && connectionState === 'connected') {
      pendingTimer.current = setTimeout(() => setTimedOut(true), PENDING_TIMEOUT_MS);
    }
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [roomState, connectionState]);

  const handleCopy = useCallback(() => {
    if (!roomTicket) return;
    navigator.clipboard.writeText(roomTicket).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 1800);
    });
  }, [roomTicket]);

  // Scroll event list to bottom on new events.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [networkEvents]);

  const visibleEvents = networkEvents.filter(ev => evLabel(ev) !== null).slice(-20);
  const isReady = roomState === 'ready';
  const isIdle  = roomState === 'idle';
  const isDisconnected = connectionState === 'disconnected';

  const statusText = isIdle
    ? 'Choose your next move'
    : isDisconnected
    ? 'Connection lost'
    : timedOut
    ? "Couldn't set up the room"
    : connectionState === 'connecting'
    ? 'Connecting to backend…'
    : isReady
    ? (action === 'open' ? 'Room ready' : 'Joined room')
    : (action === 'open' ? 'Setting up room…' : 'Connecting to peers…');

  return (
    <div className="overlay">
      <div className="overlay-card">

        {/* Status header */}
        <div className="ov-header">
          <div className={`ov-status-dot${isReady ? ' ov-status-dot--ready' : ''}`} />
          <div className="ov-status-text">{statusText}</div>
        </div>

        {/* Idle state: pick next action */}
        {isIdle && (
          <div className="ov-idle-section">
            {idleMode === 'pick' && (
              <div className="ov-idle-pick">
                <button className="ov-idle-btn" onClick={() => setIdleMode('open')}>Open New Room</button>
                <button className="ov-idle-btn ov-idle-btn--secondary" onClick={() => setIdleMode('join')}>Join Existing Room</button>
              </div>
            )}
            {idleMode === 'open' && (
              <div className="ov-idle-form">
                <div className="ov-section-label">room name</div>
                <input
                  className="ov-idle-input"
                  type="text"
                  value={idleRoom}
                  onChange={e => setIdleRoom(e.target.value)}
                  placeholder="default"
                  autoFocus
                />
                <div className="ov-idle-actions">
                  <button className="ov-enter-btn" onClick={() => onOpenRoom(idleRoom || 'default')}>
                    Open Room →
                  </button>
                  <button className="ov-back-btn" onClick={() => setIdleMode('pick')}>← back</button>
                </div>
              </div>
            )}
            {idleMode === 'join' && (
              <div className="ov-idle-form">
                <div className="ov-section-label">ticket</div>
                <input
                  className="ov-idle-input ov-idle-input--mono"
                  type="text"
                  value={idleTicket}
                  onChange={e => setIdleTicket(e.target.value)}
                  placeholder="Paste ticket…"
                  autoFocus
                />
                <div className="ov-idle-actions">
                  <button
                    className="ov-enter-btn"
                    disabled={!idleTicket.trim()}
                    onClick={() => onJoinRoom('default', idleTicket.trim())}
                  >
                    Join Room →
                  </button>
                  <button className="ov-back-btn" onClick={() => setIdleMode('pick')}>← back</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Disconnected recovery (only when not idle — idle has its own form) */}
        {!isIdle && isDisconnected && (
          <div className="ov-error-section">
            <a href="/" className="ov-enter-btn" style={{ textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Back to start
            </a>
          </div>
        )}

        {/* Pending timeout error — show retry + back options */}
        {timedOut && !isDisconnected && roomState === 'pending' && (
          <div className="ov-error-section">
            <p className="ov-error-msg">
              {action === 'join'
                ? 'Could not connect to the room. Check the ticket and try again.'
                : 'Room setup is taking too long. Try again or go back.'}
            </p>
            <div className="ov-idle-actions">
              <button
                className="ov-enter-btn"
                onClick={() => {
                  setTimedOut(false);
                  if (action === 'open') onOpenRoom(idleRoom || 'default');
                  else if (action === 'join') onJoinRoom('default', idleTicket.trim());
                }}
              >
                Try again
              </button>
              <a href="/" className="ov-back-btn" style={{ textDecoration: 'none', display: 'block' }}>← Back to start</a>
            </div>
          </div>
        )}

        {/* Ticket display (open mode, room ready) */}
        {isReady && action === 'open' && roomTicket && (
          <div className="ov-ticket-section">
            <div className="ov-section-label">ticket — share with peer B</div>
            <div className="ov-ticket-row">
              <code className="ov-ticket">{roomTicket}</code>
              <button className="ov-copy-btn" onClick={handleCopy}>
                {copyFailed ? 'copy failed' : copied ? 'copied!' : 'copy'}
              </button>
            </div>
          </div>
        )}

        {/* Ticket missing warning (open mode, room ready but no ticket) */}
        {isReady && action === 'open' && !roomTicket && (
          <div className="ov-ticket-section">
            <div className="ov-section-label">ticket</div>
            <p className="ov-error-msg">No ticket received — check the backend logs.</p>
          </div>
        )}

        {/* Peer ID */}
        {isReady && roomPeerId && (
          <div className="ov-peerid-section">
            <div className="ov-section-label">your peer id</div>
            <code className="ov-peerid">{roomPeerId}</code>
          </div>
        )}

        {/* Live network events — hidden in idle state */}
        <div className="ov-events" style={isIdle ? { display: 'none' } : undefined}>
          <div className="ov-section-label ov-events-label">network trace</div>
          <div className="ov-event-list">
            {visibleEvents.length === 0 && (
              <div className="ov-event-empty">Waiting for events…</div>
            )}
            {visibleEvents.map((ev, i) => (
              <div key={i} className="ov-event-row">
                <span className="ov-event-dot" style={{ background: evColor(ev.type) }} />
                <span className="ov-event-label" style={{ color: evColor(ev.type) }}>
                  {ev.type.replace(/_/g, ' ')}
                </span>
                <span className="ov-event-detail">{evLabel(ev)?.replace(/^[^ ]+ /, '')}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Enter chat + (host-only) shutdown */}
        {isReady && (
          <div className="ov-footer">
            <button className="ov-enter-btn" onClick={onEnterChat}>
              Enter Chat →
            </button>
            {action === 'open' && (
              <button className="ov-shutdown-btn" onClick={() => { shutdownRoom(); window.location.href = '/'; }}>
                Shutdown Room
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: var(--color-page);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
        }

        .overlay-card {
          width: 480px;
          max-width: calc(100vw - 48px);
          background: var(--color-page);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm), 0 8px 40px rgba(0,0,0,0.08);
          display: flex;
          flex-direction: column;
          gap: 0;
          overflow: hidden;
        }

        .ov-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 24px 24px 20px;
          border-bottom: 1px solid var(--color-ink-hairline);
        }

        .ov-status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #e0e0e0;
          flex-shrink: 0;
          animation: pulse 1.4s ease-in-out infinite;
        }
        .ov-status-dot--ready {
          background: var(--color-accent-green);
          animation: none;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }

        .ov-status-text {
          font-family: var(--font-mono);
          font-size: var(--text-base);
          font-weight: var(--fw-medium);
          color: var(--color-ink-primary);
        }

        .ov-section-label {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .ov-ticket-section {
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--color-ink-hairline);
          background: var(--color-accent-green-bg);
        }

        .ov-ticket-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ov-ticket {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-ink-primary);
          background: var(--color-page);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          padding: 8px 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          word-break: break-all;
          min-width: 0;
        }

        .ov-copy-btn {
          height: 32px;
          padding: 0 14px;
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          color: var(--color-accent-green);
          background: var(--color-page);
          border: 1px solid var(--color-accent-green);
          border-radius: var(--radius-sm);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .ov-copy-btn:hover { background: var(--color-accent-green-bg); }

        .ov-peerid-section {
          padding: 16px 24px;
          border-bottom: 1px solid var(--color-ink-hairline);
        }

        .ov-peerid {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-secondary);
          word-break: break-all;
        }

        .ov-events {
          padding: 16px 24px 20px;
          border-bottom: 1px solid var(--color-ink-hairline);
        }
        .ov-events-label { margin-bottom: 10px; }

        .ov-event-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 180px;
          overflow-y: auto;
        }
        .ov-event-list::-webkit-scrollbar { width: 2px; }
        .ov-event-list::-webkit-scrollbar-thumb { background: #e0e0e0; }

        .ov-event-empty {
          font-family: var(--font-mono);
          font-size: 11px;
          color: #cccccc;
        }

        .ov-event-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-mono);
          font-size: 11px;
        }

        .ov-event-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .ov-event-label {
          font-weight: 500;
          font-size: 10px;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }

        .ov-event-detail {
          color: var(--color-ink-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ov-footer {
          margin: 16px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          animation: fade-in 0.3s ease;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        .ov-enter-btn {
          height: 40px;
          background: var(--color-ink-primary);
          color: var(--color-ink-inverse);
          font-family: var(--font-sans);
          font-size: var(--text-base);
          font-weight: var(--fw-semibold);
          border-radius: var(--radius-lg);
          border: none;
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .ov-enter-btn:hover { background: #2d2d2d; }
        .ov-enter-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .ov-shutdown-btn {
          height: 34px;
          background: transparent;
          color: #ba4705;
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
          border-radius: var(--radius-md);
          border: 1px solid #ffd5c0;
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .ov-shutdown-btn:hover { background: #fff8f5; }

        /* Error / recovery section */
        .ov-error-section {
          padding: 16px 24px;
          border-bottom: 1px solid var(--color-ink-hairline);
        }
        .ov-error-msg {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: #ba4705;
          margin: 0 0 12px;
          line-height: 1.5;
        }

        /* Idle-state styles */
        .ov-idle-section {
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--color-ink-hairline);
        }
        .ov-idle-pick {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ov-idle-btn {
          height: 40px;
          border-radius: var(--radius-lg);
          font-family: var(--font-sans);
          font-size: var(--text-base);
          font-weight: var(--fw-semibold);
          border: none;
          cursor: pointer;
          background: var(--color-ink-primary);
          color: var(--color-ink-inverse);
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .ov-idle-btn:hover { background: #2d2d2d; }
        .ov-idle-btn--secondary {
          background: transparent;
          color: var(--color-ink-muted);
          border: 1px solid var(--color-ink-hairline);
          font-weight: var(--fw-medium);
        }
        .ov-idle-btn--secondary:hover { background: var(--color-surface); }
        .ov-idle-form { display: flex; flex-direction: column; gap: 8px; }
        .ov-idle-input {
          height: 36px;
          padding: 0 12px;
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-md);
          font-size: var(--text-base);
          font-family: var(--font-sans);
          background: #fafafa;
          color: var(--color-ink-primary);
          outline: none;
        }
        .ov-idle-input:focus { border-color: var(--color-ink-primary); background: var(--color-page); }
        .ov-idle-input--mono { font-family: var(--font-mono); font-size: var(--text-sm); }
        .ov-idle-input::placeholder { color: #c0c0c0; }
        .ov-idle-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
        .ov-back-btn {
          height: 28px;
          background: transparent;
          border: none;
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          cursor: pointer;
          text-align: left;
        }
        .ov-back-btn:hover { color: var(--color-ink-muted); }
      `}</style>
    </div>
  );
}
