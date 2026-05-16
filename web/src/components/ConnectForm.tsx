import { useState } from 'react';

type Mode = 'open' | 'join';

export default function ConnectForm() {
  const [mode,   setMode]   = useState<Mode>('open');
  const [port,   setPort]   = useState('');
  const [room,   setRoom]   = useState('');
  const [ticket, setTicket] = useState('');

  const defaultPort = mode === 'open' ? '9001' : '9002';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolvedPort = parseInt(port || defaultPort, 10);
    const params = new URLSearchParams({
      port: String(resolvedPort),
      mode,
      room: room || 'default',
    });
    if (mode === 'join' && ticket.trim()) params.set('ticket', ticket.trim());
    window.location.href = `/room?${params}`;
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Segmented tab */}
      <div className="tab-wrapper">
        <button type="button" className={`tab-btn ${mode === 'open' ? 'active' : ''}`} onClick={() => setMode('open')}>
          Open Room
        </button>
        <button type="button" className={`tab-btn ${mode === 'join' ? 'active' : ''}`} onClick={() => setMode('join')}>
          Join Room
        </button>
      </div>

      {/* Join-only: ticket */}
      {mode === 'join' && (
        <div className="field">
          <label className="field-label">Ticket</label>
          <input
            className="field-input field-input--mono"
            type="text"
            value={ticket}
            onChange={e => setTicket(e.target.value)}
            placeholder="Paste ticket from peer A…"
            required
            autoFocus
          />
        </div>
      )}

      {/* Port */}
      <div className="field">
        <label className="field-label">WebSocket Port</label>
        <input
          className="field-input field-input--mono"
          type="number"
          value={port}
          onChange={e => setPort(e.target.value)}
          placeholder={defaultPort}
          min={1024}
          max={65535}
        />
      </div>

      {/* Room name — open only */}
      {mode === 'open' && (
        <div className="field">
          <label className="field-label">Room Name</label>
          <input
            className="field-input field-input--mono"
            type="text"
            value={room}
            onChange={e => setRoom(e.target.value)}
            placeholder="default"
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button type="submit" className="btn-primary">
          {mode === 'open' ? 'Open Room' : 'Join Room'}
        </button>
        <p className="hint-text">
          {mode === 'open'
            ? 'Start the backend first — ticket prints to your terminal.'
            : 'Run the backend with the ticket from peer A.'}
        </p>
      </div>

      <style>{`
        .tab-wrapper { display:flex; background:#f2f2f2; border-radius:8px; padding:4px; gap:4px; }
        .tab-btn {
          flex:1; padding:8px 0; border-radius:6px;
          font-family:var(--font-sans); font-size:var(--text-base); font-weight:var(--fw-medium);
          color:#888888; background:transparent; border:none; cursor:pointer;
          transition:all var(--duration-fast) var(--ease-standard);
        }
        .tab-btn.active { background:#ffffff; color:var(--color-ink-primary); font-weight:var(--fw-semibold); box-shadow:var(--shadow-sm); }
        .field { display:flex; flex-direction:column; gap:6px; }
        .field-label { font-family:var(--font-mono); font-size:var(--text-sm); font-weight:var(--fw-medium); letter-spacing:0.4px; color:#555555; }
        .field-input {
          height:40px; padding:0 16px;
          border:1px solid var(--color-ink-hairline); border-radius:var(--radius-md);
          background:#fafafa; font-size:var(--text-base); color:var(--color-ink-primary);
          font-family:var(--font-sans); outline:none;
          transition:border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
        }
        .field-input--mono { font-family:var(--font-mono); }
        .field-input:focus { border-color:var(--color-ink-primary); background:var(--color-page); }
        .field-input::placeholder { color:#c0c0c0; }
        .btn-primary {
          height:40px; width:100%; background:var(--color-ink-primary); color:var(--color-ink-inverse);
          font-family:var(--font-sans); font-size:var(--text-base); font-weight:var(--fw-semibold);
          border-radius:var(--radius-lg); border:none; cursor:pointer;
          transition:background var(--duration-fast) var(--ease-standard);
        }
        .btn-primary:hover { background:#2d2d2d; }
        .hint-text { font-family:var(--font-mono); font-size:var(--text-sm); color:#888888; text-align:center; line-height:1.5; }
      `}</style>
    </form>
  );
}
