import { useEffect, useRef } from 'react';
import type { NetworkEvent } from '../lib/useChatSocket';
import { peerName } from '../lib/peerIdentity';

interface NetworkTraceProps {
  events: NetworkEvent[];
  open:   boolean;
}

function fmt(ms?: number | null) {
  if (ms == null) return '';
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(1)}ms`;
}

function shortUrl(url?: string) {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
}

function formatTime(ts?: number) {
  if (!ts) return '–';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type RowMeta = { label: string; arrow: string; color: string; detail: string };

function rowMeta(ev: NetworkEvent): RowMeta {
  switch (ev.type) {
    case 'msg_sent':
      return { label: 'SEND', arrow: '↑', color: '#0a7739',
        detail: `→ gossip [${ev.from?.slice(0, 8) ?? ''}]` };
    case 'msg_recv':
      return { label: 'RECV', arrow: '↓', color: '#2563eb',
        detail: `← gossip [${ev.from?.slice(0, 8) ?? ''}]` };
    case 'peer_up':
      return { label: 'PEER UP', arrow: '●', color: '#7c3aed',
        detail: `${peerName(ev.peer ?? '')} joined` };
    case 'peer_down':
      return { label: 'PEER OFF', arrow: '○', color: '#ba4705',
        detail: `${peerName(ev.peer ?? '')} left` };

    case 'net_report': {
      const best = ev.relay_latencies?.reduce(
        (min, l) => (l.ms < min ? l.ms : min), Infinity
      );
      const rttStr = best != null && isFinite(best) ? ` ${best}ms` : '';
      return { label: 'NET RPT', arrow: '↻', color: '#0369a1',
        detail: `relay${rttStr}${ev.udp_v4 ? ' · udp✓' : ''}` };
    }
    case 'relay_pong':
      return { label: 'PING', arrow: '⇌', color: '#0369a1',
        detail: `relay pong ${fmt(ev.rtt_ms)}` };
    case 'stun_scheduled':
      return { label: 'STUN', arrow: '⏱', color: '#6b7280',
        detail: `next check in ${ev.in_secs}s` };
    case 'relay_connected':
      return { label: 'RELAY', arrow: '⚓', color: '#7c3aed',
        detail: `${shortUrl(ev.url)}${ev.home ? ' (home)' : ''}` };
    case 'path_selected': {
      const isDirect = ev.transport === 'direct';
      return {
        label: isDirect ? 'DIRECT' : 'RELAY',
        arrow: isDirect ? '⚡' : '↗',
        color: isDirect ? '#0a7739' : '#1d4ed8',
        detail: `path→${ev.transport} ${ev.addr ?? ''}${ev.rtt_ms != null ? ` ${fmt(ev.rtt_ms)}` : ''}`,
      };
    }
    case 'conn_established':
      return { label: 'CONN', arrow: '⊞', color: '#7c3aed',
        detail: `${ev.side ?? ''} ${ev.remote?.slice(0, 8) ?? ''}` };
    default:
      return { label: (ev as NetworkEvent).type.toUpperCase(), arrow: '·', color: '#999', detail: '' };
  }
}

export default function NetworkTrace({ events, open }: NetworkTraceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, open]);

  return (
    <div className={`trace-panel ${open ? 'trace-panel--open' : ''}`}>
      <div className="trace-header">
        <span className="trace-title">Network Trace</span>
        <span className="trace-subtitle">peer → relay → gossip</span>
      </div>

      <div className="trace-body">
        {events.length === 0 && (
          <>
            <div className="trace-empty">Waiting for network events…</div>
            <div className="flow-diagram">
              <div className="flow-node">You</div>
              <div className="flow-arrow">→ relay →</div>
              <div className="flow-node">Gossip</div>
              <div className="flow-arrow">→ relay →</div>
              <div className="flow-node">Peer B</div>
            </div>
          </>
        )}

        {events.map((ev, i) => {
          const { label, arrow, color, detail } = rowMeta(ev);
          return (
            <div key={i} className="trace-row">
              <span className="trace-arrow" style={{ color }}>{arrow}</span>
              <span className="trace-tag"  style={{ color }}>{label}</span>
              <span className="trace-desc">{detail}</span>
              <span className="trace-ts">{formatTime(ev.ts)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <style>{`
        .trace-panel {
          width: 0;
          overflow: hidden;
          border-left: 1px solid var(--color-ink-hairline);
          background: #fafafa;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          transition: width var(--duration-base) var(--ease-entrance);
        }
        .trace-panel--open { width: 300px; }

        .trace-header {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          border-bottom: 1px solid var(--color-ink-hairline);
          flex-shrink: 0;
        }
        .trace-title {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-ink-primary);
        }
        .trace-subtitle {
          font-family: var(--font-mono);
          font-size: 10px;
          color: #bbbbbb;
          letter-spacing: 0.5px;
        }

        .trace-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .trace-body::-webkit-scrollbar { width: 3px; }
        .trace-body::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 2px; }

        .trace-empty {
          font-family: var(--font-mono);
          font-size: 11px;
          color: #cccccc;
          padding: 8px 16px;
        }

        .flow-diagram {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 12px 16px 20px;
          border-bottom: 1px solid var(--color-ink-hairline);
          margin-bottom: 8px;
        }
        .flow-node {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 500;
          color: var(--color-ink-primary);
          background: var(--color-page);
          border: 1px solid var(--color-ink-hairline);
          border-radius: 4px;
          padding: 2px 8px;
          white-space: nowrap;
        }
        .flow-arrow {
          font-family: var(--font-mono);
          font-size: 10px;
          color: #bbbbbb;
          white-space: nowrap;
        }

        .trace-row {
          display: grid;
          grid-template-columns: 16px 52px 1fr auto;
          align-items: center;
          gap: 6px;
          padding: 3px 16px;
          font-family: var(--font-mono);
          font-size: 11px;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .trace-row:hover { background: rgba(0,0,0,0.03); }
        .trace-arrow { font-size: 13px; text-align: center; }
        .trace-tag { font-weight: 500; font-size: 10px; letter-spacing: 0.3px; }
        .trace-desc { color: var(--color-ink-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .trace-ts { color: #bbbbbb; font-size: 10px; white-space: nowrap; }
      `}</style>
    </div>
  );
}
