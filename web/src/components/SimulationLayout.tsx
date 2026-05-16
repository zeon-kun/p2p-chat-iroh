import { useState } from 'react';
import { useSimulation } from '../lib/useSimulation';
import SimulationPeer from './SimulationPeer';
import SimulationDrawer from './SimulationDrawer';

export default function SimulationLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sim = useSimulation(9001, 9002);

  const automating = sim.phase === 'running';

  const phaseColor =
    sim.phase === 'ready' || sim.phase === 'done' ? '#0a7739' :
    sim.phase === 'running'   ? '#2563eb' :
    sim.phase === 'error'     ? '#ba4705' :
    sim.phase === 'waiting-a' || sim.phase === 'waiting-b' ? '#f59e0b' :
    '#9ca3af';

  return (
    <div className="sim-layout">

      {/* Top bar */}
      <header className="sim-topbar">
        <div className="sim-topbar-left">
          <a href="/" className="sim-back">← back</a>
          <span className="sim-topbar-title">Multi-Peer Simulation</span>
          <span className="sim-phase-badge" style={{ color: phaseColor }}>
            <span className="sim-phase-dot" style={{ background: phaseColor }} />
            {sim.phase}
          </span>
        </div>
        <button
          className={`sim-drawer-toggle ${drawerOpen ? 'active' : ''}`}
          onClick={() => setDrawerOpen(v => !v)}
          data-testid="sim-drawer-toggle"
          aria-label="Toggle scenario drawer"
        >
          <span className="toggle-icon">⊞</span>
          Scenarios
        </button>
      </header>

      {/* Two-panel split */}
      <div className="sim-panels">
        <div className="sim-panel" data-peer="A" data-state={sim.peerA.roomState}>
          <SimulationPeer peer="A" data={sim.peerA} automating={automating} />
        </div>

        <div className="sim-divider" />

        <div className="sim-panel" data-peer="B" data-state={sim.peerB.roomState}>
          <SimulationPeer peer="B" data={sim.peerB} automating={automating} />
        </div>
      </div>

      {/* Floating drawer */}
      <SimulationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sim={sim}
      />

      <style>{`
        .sim-layout {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          background: var(--color-page);
        }

        /* Top bar */
        .sim-topbar {
          height: 48px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          border-bottom: 1px solid var(--color-ink-hairline);
          background: var(--color-page);
          gap: 16px;
        }
        .sim-topbar-left {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }
        .sim-back {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--color-ink-muted);
          text-decoration: none;
          transition: color var(--duration-fast) var(--ease-standard);
          white-space: nowrap;
        }
        .sim-back:hover { color: var(--color-ink-primary); }
        .sim-topbar-title {
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-semibold);
          color: var(--color-ink-primary);
          white-space: nowrap;
        }
        .sim-phase-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          font-weight: var(--fw-medium);
          letter-spacing: 0.4px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .sim-phase-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        /* Drawer toggle button */
        .sim-drawer-toggle {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 0 14px;
          height: 32px;
          border-radius: var(--radius-md);
          border: 1px solid var(--color-ink-hairline);
          background: var(--color-surface);
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
          color: var(--color-ink-secondary);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          transition: all var(--duration-fast) var(--ease-standard);
        }
        .sim-drawer-toggle:hover,
        .sim-drawer-toggle.active {
          background: var(--color-ink-primary);
          color: var(--color-ink-inverse);
          border-color: var(--color-ink-primary);
        }
        .toggle-icon { font-size: 13px; }

        /* Two-panel split */
        .sim-panels {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        .sim-panel {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .sim-divider {
          width: 1px;
          background: var(--color-ink-hairline);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
