import { useState, useCallback } from 'react';
import { useRoomDirectory } from '../lib/useRoomDirectory';
import type { RoomEntry } from '../lib/useRoomDirectory';

interface RoomDirectoryProps {
  /** The WS port the current user's `chat serve` is running on — used for the Join URL. */
  joinPort: number;
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5)   return 'just now';
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function RoomRow({ entry, joinPort }: { entry: RoomEntry; joinPort: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(entry.ticket).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [entry.ticket]);

  const handleJoin = useCallback(() => {
    const params = new URLSearchParams({
      port:   String(joinPort),
      mode:   'serve',
      action: 'join',
      room:   entry.room,
      ticket: entry.ticket,
    });
    window.location.href = `/room?${params}`;
  }, [entry.room, entry.ticket, joinPort]);

  return (
    <div className="room-row">
      <div className="room-info">
        <span className="room-name-cell">{entry.room}</span>
        <span className="room-peer">{entry.peer_id.slice(0, 10)}…</span>
        <span className="room-time">{relativeTime(entry.opened_at)}</span>
      </div>
      <div className="room-actions">
        <button className="dir-btn dir-btn--copy" onClick={handleCopy}>
          {copied ? 'copied!' : 'copy ticket'}
        </button>
        <button className="dir-btn dir-btn--join" onClick={handleJoin}>
          Join →
        </button>
      </div>

      <style>{`
        .room-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid var(--color-ink-hairline);
        }
        .room-row:last-child { border-bottom: none; }
        .room-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
        .room-name-cell {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
          color: var(--color-ink-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100px;
        }
        .room-peer {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          white-space: nowrap;
        }
        .room-time {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: #bbbbbb;
          white-space: nowrap;
          margin-left: auto;
        }
        .room-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .dir-btn {
          height: 28px;
          padding: 0 10px;
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          border-radius: var(--radius-sm);
          border: 1px solid var(--color-ink-hairline);
          background: var(--color-page);
          cursor: pointer;
          white-space: nowrap;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .dir-btn--copy { color: var(--color-ink-muted); }
        .dir-btn--copy:hover { background: var(--color-surface); }
        .dir-btn--join {
          color: var(--color-accent-green);
          border-color: var(--color-accent-green);
          background: var(--color-accent-green-bg);
        }
        .dir-btn--join:hover { background: #d8f0e4; }
      `}</style>
    </div>
  );
}

export default function RoomDirectory({ joinPort }: RoomDirectoryProps) {
  const { rooms, registry } = useRoomDirectory();

  return (
    <div className="dir-wrapper">
      <div className="dir-header">
        <span className="dir-title">open rooms</span>
        <span className={`dir-dot${registry === 'up' ? ' dir-dot--up' : registry === 'connecting' ? ' dir-dot--connecting' : ''}`} />
      </div>

      <div className="dir-body">
        {registry === 'connecting' && (
          <p className="dir-empty">Looking for the registry…</p>
        )}
        {registry === 'down' && (
          <p className="dir-empty">
            Registry offline — run <code>cargo run --bin chat -- registry</code> once to enable room discovery.
            Rooms still work without it.
          </p>
        )}
        {registry === 'up' && rooms.length === 0 && (
          <p className="dir-empty">No rooms open yet. Create one above.</p>
        )}
        {rooms.map((entry, i) => (
          <RoomRow key={i} entry={entry} joinPort={joinPort} />
        ))}
      </div>

      <style>{`
        .dir-wrapper {
          margin-top: 32px;
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .dir-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-ink-hairline);
        }
        .dir-title {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          color: var(--color-ink-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .dir-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #dddddd;
          flex-shrink: 0;
        }
        .dir-dot--up { background: var(--color-accent-green); }
        .dir-dot--connecting { background: #f5a623; animation: dir-pulse 1.2s ease-in-out infinite; }
        @keyframes dir-pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .dir-body { padding: 0 16px; }
        .dir-empty {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          padding: 14px 0;
          margin: 0;
          line-height: 1.5;
        }
        .dir-empty code {
          font-family: var(--font-mono);
          background: var(--color-surface);
          border: 1px solid var(--color-ink-hairline);
          border-radius: 3px;
          padding: 1px 5px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
