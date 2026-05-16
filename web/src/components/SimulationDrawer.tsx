import type { SimPhase, SimulationState } from '../lib/useSimulation';
import { SCENARIOS } from '../lib/simulationScenarios';

const PHASE_LABELS: Record<SimPhase, string> = {
  'idle':      'idle',
  'waiting-a': 'opening room…',
  'waiting-b': 'peer B joining…',
  'ready':     'ready',
  'running':   'running',
  'done':      'done',
  'error':     'error',
};

const PHASE_COLOR: Record<SimPhase, string> = {
  'idle':      '#6b7280',
  'waiting-a': '#f59e0b',
  'waiting-b': '#f59e0b',
  'ready':     '#0a7739',
  'running':   '#2563eb',
  'done':      '#7c3aed',
  'error':     '#ba4705',
};

interface Props {
  open:    boolean;
  onClose: () => void;
  sim:     SimulationState;
}

export default function SimulationDrawer({ open, onClose, sim }: Props) {
  const { phase, activeScenario, stepIndex, errorMsg } = sim;

  const canStart   = phase === 'idle' &&
    sim.peerA.connectionState === 'connected' &&
    sim.peerB.connectionState === 'connected';
  const canRun     = phase === 'ready';
  const isRunning  = phase === 'running';
  const isDone     = phase === 'done';
  const isError    = phase === 'error';
  const isActive   = phase !== 'idle' && phase !== 'error';
  const needsReset = isActive || isDone || isError;

  const bothOffline =
    sim.peerA.connectionState === 'disconnected' &&
    sim.peerB.connectionState === 'disconnected';
  const anyOffline =
    sim.peerA.connectionState === 'disconnected' ||
    sim.peerB.connectionState === 'disconnected';

  return (
    <>
      <div className={`drawer-backdrop ${open ? 'visible' : ''}`} onClick={onClose} />

      <aside className={`drawer ${open ? 'open' : ''}`} data-testid="sim-drawer">

        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-title">
            <span className="drawer-icon">⊞</span>
            Simulation
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close drawer">✕</button>
        </div>

        {/* Phase status */}
        <div className="phase-row">
          <span className="phase-dot" style={{ background: PHASE_COLOR[phase] }} />
          <span className="phase-label" style={{ color: PHASE_COLOR[phase] }}>
            {PHASE_LABELS[phase]}
          </span>
          {isRunning && activeScenario && (
            <span className="phase-detail">
              {activeScenario.name} · step {stepIndex + 1}/{activeScenario.steps.length}
            </span>
          )}
          {isDone && activeScenario && (
            <span className="phase-detail">{activeScenario.name} complete</span>
          )}
        </div>

        {/* Error message */}
        {isError && errorMsg && (
          <div className="error-box">
            <span className="error-icon">⚠</span>
            <p className="error-text">{errorMsg}</p>
          </div>
        )}

        {/* Backend status */}
        {phase === 'idle' && (
          <div className="backend-status">
            <div className="backend-row">
              <span className="backend-dot" style={{
                background: sim.peerA.connectionState === 'connected' ? '#22c55e' : '#d1d5db'
              }} />
              <span className="backend-name">Peer A</span>
              <span className="backend-port">:9001</span>
              <span className="backend-state">{sim.peerA.connectionState}</span>
            </div>
            <div className="backend-row">
              <span className="backend-dot" style={{
                background: sim.peerB.connectionState === 'connected' ? '#22c55e' : '#d1d5db'
              }} />
              <span className="backend-name">Peer B</span>
              <span className="backend-port">:9002</span>
              <span className="backend-state">{sim.peerB.connectionState}</span>
            </div>
            {bothOffline && (
              <p className="backend-hint">
                Start both backends first:
                <code>cargo run --bin chat -- serve --ws-port 9001</code>
                <code>cargo run --bin chat -- serve --ws-port 9002</code>
              </p>
            )}
          </div>
        )}

        <div className="drawer-divider" />

        {/* Primary action */}
        {phase === 'idle' && anyOffline && (
          <button
            className="btn-secondary"
            onClick={() => { sim.peerA.reconnect(); sim.peerB.reconnect(); }}
            data-testid="sim-reconnect"
          >
            Reconnect Peers
          </button>
        )}
        {phase === 'idle' && (
          <button
            className="btn-primary"
            onClick={sim.startSim}
            disabled={!canStart}
            data-testid="sim-start"
          >
            Start Simulation
          </button>
        )}

        {isDone && (
          <button className="btn-secondary" onClick={sim.runAgain} data-testid="sim-run-again">
            Run Another Scenario
          </button>
        )}

        {needsReset && (
          <button className="btn-ghost" onClick={sim.reset} data-testid="sim-reset">
            Reset
          </button>
        )}

        <div className="drawer-divider" />

        {/* Scenario list */}
        <p className="section-label">Preset Scenarios</p>

        <ul className="scenario-list" data-testid="scenario-list">
          {SCENARIOS.map(scenario => {
            const isActive  = activeScenario?.id === scenario.id;
            const stepCount = scenario.steps.filter(s => 'peer' in s).length;
            return (
              <li
                key={scenario.id}
                className={`scenario-item ${isActive ? 'active' : ''}`}
                data-testid={`scenario-${scenario.id}`}
              >
                <div className="scenario-info">
                  <span className="scenario-name">{scenario.name}</span>
                  <span className="scenario-desc">{scenario.description}</span>
                  <span className="scenario-meta">{stepCount} messages</span>
                </div>
                <button
                  className="scenario-run-btn"
                  disabled={!canRun || isRunning}
                  onClick={() => sim.runScenario(scenario)}
                  data-testid={`run-${scenario.id}`}
                  aria-label={`Run ${scenario.name}`}
                >
                  {isActive && isRunning ? '…' : '▶'}
                </button>
              </li>
            );
          })}
        </ul>

      </aside>

      <style>{`
        .drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.12);
          z-index: 49;
          opacity: 0;
          pointer-events: none;
          transition: opacity var(--duration-base) var(--ease-standard);
        }
        .drawer-backdrop.visible {
          opacity: 1;
          pointer-events: auto;
        }

        .drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: 320px;
          background: var(--color-page);
          border-left: 1px solid var(--color-ink-hairline);
          box-shadow: -4px 0 24px rgba(0,0,0,0.08);
          z-index: 50;
          display: flex;
          flex-direction: column;
          gap: 0;
          transform: translateX(100%);
          transition: transform var(--duration-base) var(--ease-entrance);
          overflow-y: auto;
        }
        .drawer.open { transform: translateX(0); }

        /* Header */
        .drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px 14px;
          border-bottom: 1px solid var(--color-ink-hairline);
          flex-shrink: 0;
        }
        .drawer-title {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-semibold);
          color: var(--color-ink-primary);
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: 0.3px;
        }
        .drawer-icon { font-size: 14px; }
        .drawer-close {
          font-size: 14px;
          color: var(--color-ink-muted);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          border-radius: var(--radius-sm);
          transition: color var(--duration-fast) var(--ease-standard);
        }
        .drawer-close:hover { color: var(--color-ink-primary); }

        /* Phase status */
        .phase-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px 10px;
          flex-shrink: 0;
        }
        .phase-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .phase-label {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-semibold);
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .phase-detail {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-muted);
          margin-left: 2px;
        }

        /* Error box */
        .error-box {
          margin: 0 16px 8px;
          padding: 10px 12px;
          background: #fff8f5;
          border: 1px solid #ffd5c0;
          border-radius: var(--radius-md);
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .error-icon { color: #ba4705; font-size: 14px; flex-shrink: 0; margin-top: 1px; }
        .error-text {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: #ba4705;
          line-height: 1.5;
        }

        /* Backend status */
        .backend-status {
          padding: 0 20px 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex-shrink: 0;
        }
        .backend-row {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .backend-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .backend-name {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          color: var(--color-ink-primary);
          min-width: 42px;
        }
        .backend-port {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-muted);
        }
        .backend-state {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-subtle);
          margin-left: auto;
        }
        .backend-hint {
          margin-top: 6px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-ink-muted);
          line-height: 1.6;
        }
        .backend-hint code {
          display: block;
          background: var(--color-surface);
          border: 1px solid var(--color-ink-hairline);
          border-radius: var(--radius-sm);
          padding: 3px 7px;
          margin-top: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-ink-primary);
          word-break: break-all;
        }

        /* Divider */
        .drawer-divider {
          height: 1px;
          background: var(--color-ink-hairline);
          margin: 8px 0;
          flex-shrink: 0;
        }

        /* Buttons */
        .btn-primary, .btn-secondary, .btn-ghost {
          display: block;
          width: calc(100% - 32px);
          margin: 0 16px;
          padding: 9px 16px;
          border-radius: var(--radius-md);
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
          cursor: pointer;
          border: 1px solid transparent;
          text-align: center;
          transition: all var(--duration-fast) var(--ease-standard);
        }
        .btn-primary {
          background: var(--color-ink-primary);
          color: var(--color-ink-inverse);
          border-color: var(--color-ink-primary);
        }
        .btn-primary:hover:not(:disabled) { background: #2d2d2d; border-color: #2d2d2d; }
        .btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }
        .btn-secondary {
          background: var(--color-accent-green-bg);
          color: var(--color-accent-green);
          border-color: #a7f3c9;
        }
        .btn-secondary:hover:not(:disabled) { background: #dcfce7; }
        .btn-ghost {
          background: transparent;
          color: var(--color-ink-muted);
          border-color: var(--color-ink-hairline);
          margin-top: 6px;
        }
        .btn-ghost:hover { background: var(--color-surface); color: var(--color-ink-primary); }

        /* Section label */
        .section-label {
          padding: 8px 20px 6px;
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-semibold);
          color: var(--color-ink-muted);
          letter-spacing: 0.8px;
          text-transform: uppercase;
          flex-shrink: 0;
        }

        /* Scenario list */
        .scenario-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 12px 16px;
          flex-shrink: 0;
        }
        .scenario-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 10px;
          border-radius: var(--radius-md);
          border: 1px solid transparent;
          transition: all var(--duration-fast) var(--ease-standard);
        }
        .scenario-item:hover {
          background: var(--color-surface);
          border-color: var(--color-ink-hairline);
        }
        .scenario-item.active {
          background: #eff6ff;
          border-color: #bfdbfe;
        }
        .scenario-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .scenario-name {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
          color: var(--color-ink-primary);
        }
        .scenario-desc {
          font-family: var(--font-sans);
          font-size: 11px;
          color: var(--color-ink-muted);
          line-height: 1.4;
        }
        .scenario-meta {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--color-ink-subtle);
          margin-top: 1px;
        }
        .scenario-run-btn {
          width: 30px;
          height: 30px;
          border-radius: var(--radius-md);
          background: var(--color-ink-primary);
          color: var(--color-ink-inverse);
          border: none;
          cursor: pointer;
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all var(--duration-fast) var(--ease-standard);
        }
        .scenario-run-btn:disabled { opacity: 0.25; cursor: not-allowed; }
        .scenario-run-btn:not(:disabled):hover { background: #2d2d2d; }
      `}</style>
    </>
  );
}
