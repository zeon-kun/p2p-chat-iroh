import { useEffect, useState, useCallback } from 'react';
import type { ChatMessage, NetworkEvent } from '../lib/useChatSocket';
import { peerName, peerColor, shortId } from '../lib/peerIdentity';

interface PeerModalProps {
  peerId:        string;
  messages:      ChatMessage[];
  networkEvents: NetworkEvent[];
  onClose:       () => void;
}

function formatTs(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmt(ms?: number | null) {
  if (ms == null) return '—';
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(1)}ms`;
}

export default function PeerModal({ peerId, messages, networkEvents, onClose }: PeerModalProps) {
  const [copied, setCopied] = useState(false);
  const { bg, fg, border } = peerColor(peerId);
  const name = peerName(peerId);

  // Peer-specific event data
  const peerUp   = networkEvents.find(e => e.type === 'peer_up'   && e.peer === peerId);
  const peerDown = networkEvents.find(e => e.type === 'peer_down' && e.peer === peerId);
  const msgCount = messages.filter(m => m.from === peerId).length;

  // Last path info: path_selected events whose short `remote` is a prefix of this peer id.
  const lastPath = [...networkEvents]
    .reverse()
    .find(e => e.type === 'path_selected' && e.remote && peerId.startsWith(e.remote));

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(peerId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [peerId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal>

        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-avatar" style={{ background: bg, color: fg, borderColor: border }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="modal-title-block">
            <div className="modal-name" style={{ color: fg }}>{name}</div>
            <div className="modal-subtitle">peer identity</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Body ── */}
        <div className="modal-body">

          {/* Peer ID */}
          <div className="modal-section">
            <div className="modal-label">peer id</div>
            <div className="modal-id-row">
              <code className="modal-id">{shortId(peerId)}···{peerId.slice(-8)}</code>
              <button className="copy-btn" onClick={handleCopy}>
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="modal-stats">
            <div className="modal-stat">
              <div className="modal-stat-val">{msgCount}</div>
              <div className="modal-stat-label">messages</div>
            </div>
            <div className="modal-stat">
              <div className="modal-stat-val">{peerUp ? formatTs(peerUp.ts) : '—'}</div>
              <div className="modal-stat-label">joined</div>
            </div>
            <div className="modal-stat">
              <div className="modal-stat-val">{peerDown ? formatTs(peerDown.ts) : 'active'}</div>
              <div className="modal-stat-label">left</div>
            </div>
          </div>

          {/* Last path */}
          {lastPath && (
            <div className="modal-section">
              <div className="modal-label">last path</div>
              <div className="modal-path-row">
                <span
                  className="modal-transport"
                  style={{
                    color: lastPath.transport === 'direct' ? '#0a7739' : '#1d4ed8',
                    background: lastPath.transport === 'direct' ? '#f0faf4' : '#eff6ff',
                    borderColor: lastPath.transport === 'direct' ? '#c6e8d4' : '#bfdbfe',
                  }}
                >
                  {lastPath.transport === 'direct' ? '⚡ direct' : '↗ relay'}
                </span>
                <span className="modal-addr">{lastPath.addr}</span>
                {lastPath.rtt_ms != null && (
                  <span className="modal-rtt">{fmt(lastPath.rtt_ms)}</span>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.18);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          backdrop-filter: blur(2px);
        }
        .modal-card {
          background: var(--color-page);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm), 0 8px 40px rgba(0,0,0,0.12);
          width: 360px;
          max-width: calc(100vw - 48px);
          overflow: hidden;
          animation: modal-in var(--duration-base) var(--ease-entrance);
        }
        @keyframes modal-in {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: none; }
        }

        /* Header */
        .modal-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 20px 20px 16px;
          border-bottom: 1px solid var(--color-ink-hairline);
        }
        .modal-avatar {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-full);
          border: 1px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 16px;
          font-weight: var(--fw-bold);
          flex-shrink: 0;
        }
        .modal-title-block { flex: 1; min-width: 0; }
        .modal-name {
          font-family: var(--font-mono);
          font-size: var(--text-base);
          font-weight: var(--fw-semibold);
        }
        .modal-subtitle {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          margin-top: 1px;
        }
        .modal-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          font-size: 12px;
          color: var(--color-ink-muted);
          background: var(--color-page);
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .modal-close:hover { background: var(--color-surface); }

        /* Body */
        .modal-body { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 16px; }

        .modal-section { display: flex; flex-direction: column; gap: 6px; }
        .modal-label {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .modal-id-row { display: flex; align-items: center; gap: 8px; }
        .modal-id {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          color: var(--color-ink-primary);
          background: var(--color-surface);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          padding: 4px 8px;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .copy-btn {
          height: 28px;
          padding: 0 10px;
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          color: var(--color-ink-primary);
          background: var(--color-page);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          cursor: pointer;
          white-space: nowrap;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .copy-btn:hover { background: var(--color-surface); }

        /* Stats */
        .modal-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          background: var(--color-ink-hairline);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .modal-stat {
          background: var(--color-page);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .modal-stat-val {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-semibold);
          color: var(--color-ink-primary);
        }
        .modal-stat-label {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
        }

        /* Path */
        .modal-path-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .modal-transport {
          display: inline-flex;
          align-items: center;
          height: 20px;
          padding: 0 8px;
          border-radius: var(--radius-full);
          border: 1px solid;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: var(--fw-medium);
          white-space: nowrap;
        }
        .modal-addr {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 160px;
        }
        .modal-rtt {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-muted);
          margin-left: auto;
        }
      `}</style>
    </div>
  );
}
