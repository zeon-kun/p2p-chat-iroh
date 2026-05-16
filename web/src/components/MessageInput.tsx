import { useState, useRef } from 'react';

interface MessageInputProps {
  onSend:   (body: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState('');
  const inputRef          = useRef<HTMLInputElement>(null);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="input-bar">
      <div className="input-wrap">
        <input
          ref={inputRef}
          className="input-field"
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Disconnected…' : 'Type a message…'}
          disabled={disabled}
          aria-label="Message input"
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          {/* Arrow up icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/>
            <polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </div>

      <style>{`
        .input-bar {
          height: var(--input-height);
          padding: 0 24px;
          display: flex;
          align-items: center;
          border-top: 1px solid var(--color-ink-hairline);
          background: var(--color-page);
          flex-shrink: 0;
        }
        .input-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0;
          background: #f5f5f5;
          border-radius: var(--radius-lg);
          padding: 0 8px 0 16px;
          height: 40px;
          transition: box-shadow var(--duration-fast) var(--ease-standard);
        }
        .input-wrap:focus-within {
          box-shadow: 0 0 0 2px rgba(10,119,57,0.2);
        }
        .input-field {
          flex: 1;
          height: 100%;
          background: transparent;
          border: none;
          outline: none;
          font-family: var(--font-sans);
          font-size: var(--text-base);
          color: var(--color-ink-primary);
        }
        .input-field::placeholder { color: #c0c0c0; }
        .input-field:disabled { cursor: not-allowed; }
        .send-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-ink-primary);
          color: var(--color-ink-inverse);
          border-radius: var(--radius-md);
          border: none;
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--duration-fast) var(--ease-standard),
                      opacity var(--duration-fast) var(--ease-standard);
        }
        .send-btn:disabled { opacity: 0.3; cursor: default; }
        .send-btn:not(:disabled):hover { background: #2d2d2d; }
      `}</style>
    </div>
  );
}
