import { useState } from 'react';

interface TicketBannerProps {
  ticket: string;
}

export default function TicketBanner({ ticket }: TicketBannerProps) {
  const [visible, setVisible]   = useState(true);
  const [copied,  setCopied]    = useState(false);

  if (!visible) return null;

  const truncated = ticket.length > 16
    ? `${ticket.slice(0, 8)}···${ticket.slice(-4)}`
    : ticket;

  async function handleCopy() {
    await navigator.clipboard.writeText(ticket);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="banner">
      <div className="banner-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a7739" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <span className="ticket-string" title={ticket}>{truncated}</span>
      </div>
      <div className="banner-right">
        <button className="copy-btn" onClick={handleCopy} aria-label="Copy ticket">
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button className="dismiss-btn" onClick={() => setVisible(false)} aria-label="Dismiss">×</button>
      </div>

      <style>{`
        .banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: var(--banner-height);
          padding: 0 24px;
          background: var(--color-accent-green-bg);
          border-bottom: 1px solid #c6e8d4;
          border-left: 3px solid var(--color-accent-green);
          flex-shrink: 0;
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ticket-string {
          font-family: var(--font-mono);
          font-size: var(--text-base);
          color: var(--color-ink-primary);
          letter-spacing: 0.2px;
        }
        .banner-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .copy-btn {
          height: 28px;
          padding: 0 12px;
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
          color: var(--color-ink-primary);
          background: var(--color-page);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .copy-btn:hover { background: var(--color-surface); }
        .dismiss-btn {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          color: #666666;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          line-height: 1;
          transition: background var(--duration-fast) var(--ease-standard);
        }
        .dismiss-btn:hover { background: rgba(0,0,0,0.06); }
      `}</style>
    </div>
  );
}
