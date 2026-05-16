import { useState, useCallback } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import NetworkTrace from './NetworkTrace';
import type { useChatSocket } from '../lib/useChatSocket';

const PEER_COLORS = {
  A: { accent: '#0a7739', accentBg: '#f0faf4', label: 'Peer A', port: 9001 },
  B: { accent: '#2563eb', accentBg: '#eff6ff', label: 'Peer B', port: 9002 },
} as const;

interface SimulationPeerProps {
  peer:       'A' | 'B';
  data:       ReturnType<typeof useChatSocket>;
  automating: boolean;
}

function StatusDot({ state }: { state: string }) {
  const color =
    state === 'connected'  ? '#22c55e' :
    state === 'connecting' ? '#f59e0b' : '#d1d5db';
  const label =
    state === 'connected'  ? 'connected' :
    state === 'connecting' ? 'connecting' : 'offline';
  return (
    <span className="status-dot-wrap" title={label}>
      <span className="status-dot" style={{ background: color }} />
      <span className="status-label">{label}</span>
    </span>
  );
}

export default function SimulationPeer({ peer, data, automating }: SimulationPeerProps) {
  const { accent, accentBg, label } = PEER_COLORS[peer];
  const [traceOpen, setTraceOpen] = useState(false);

  const peerEvents = data.networkEvents.filter(
    e => e.type === 'peer_up' || e.type === 'peer_down'
  );

  const handleSend = useCallback((body: string) => {
    data.send(body);
  }, [data.send]);

  const isInputDisabled = automating || data.connectionState !== 'connected' || data.roomState !== 'ready';

  return (
    <div className="sim-peer">
      {/* ── Header ── */}
      <div className="peer-header" style={{ borderTopColor: accent, background: accentBg }}>
        <div className="peer-identity">
          <span className="peer-label" style={{ color: accent }}>{label}</span>
          <StatusDot state={data.connectionState} />
        </div>
        <div className="peer-meta">
          {data.roomPeerId && (
            <span className="peer-id-chip" title={data.roomPeerId}>
              {data.roomPeerId.slice(0, 10)}…
            </span>
          )}
          {data.roomState === 'ready' && (
            <span className="peer-room-chip" style={{ color: accent }}>room active</span>
          )}
          {data.roomState === 'pending' && (
            <span className="peer-room-chip pending">connecting…</span>
          )}
          <button
            className={`trace-toggle ${traceOpen ? 'trace-toggle--active' : ''}`}
            onClick={() => setTraceOpen(v => !v)}
            title={traceOpen ? 'Hide event log' : 'Show event log'}
            aria-label="Toggle event log"
          >
            ⋯
          </button>
        </div>
      </div>

      {/* ── Body: messages + trace panel ── */}
      <div className="peer-body">
        <div className="peer-messages">
          <MessageList
            messages={data.messages}
            historyCount={data.historyCount}
            peerEvents={peerEvents}
            onPeerClick={() => {}}
          />
          <MessageInput onSend={handleSend} disabled={isInputDisabled} />
        </div>

        <NetworkTrace events={data.networkEvents} open={traceOpen} />
      </div>

      <style>{`
        .sim-peer {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-page);
          overflow: hidden;
        }

        .peer-header {
          flex-shrink: 0;
          border-top: 3px solid transparent;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--color-ink-hairline);
        }

        .peer-identity {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .peer-label {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-semibold);
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .status-dot-wrap {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-label {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-muted);
        }

        .peer-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .peer-id-chip {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-ink-muted);
          background: var(--color-surface);
          border: 1px solid var(--color-ink-hairline);
          padding: 1px 7px;
          border-radius: var(--radius-full);
        }
        .peer-room-chip {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: var(--fw-medium);
          background: var(--color-surface);
          border: 1px solid var(--color-ink-hairline);
          padding: 1px 7px;
          border-radius: var(--radius-full);
        }
        .peer-room-chip.pending { color: var(--color-ink-muted); }

        .trace-toggle {
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          font-size: 13px;
          color: var(--color-ink-muted);
          background: var(--color-page);
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-standard),
                      color var(--duration-fast) var(--ease-standard);
        }
        .trace-toggle:hover { background: var(--color-surface); }
        .trace-toggle--active {
          background: var(--color-surface);
          color: var(--color-ink-primary);
          border-color: #c0c0c0;
        }

        /* Body: messages col + trace panel side by side */
        .peer-body {
          flex: 1;
          display: flex;
          flex-direction: row;
          overflow: hidden;
          min-height: 0;
        }
        .peer-messages {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
