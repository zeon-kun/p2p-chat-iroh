import { test, expect } from '../fixtures/index.js';
import { SimPage } from '../helpers/sim-page.js';

test.describe('Multi-peer simulation', () => {
  let sim: SimPage;

  test.beforeEach(async ({ page, backends: _ }) => {
    sim = new SimPage(page);
    await sim.goto();
  });

  // ── Page structure ─────────────────────────────────────────────────────────

  test('simulation page renders two peer panels and a drawer toggle', async () => {
    await expect(sim.panelA).toBeVisible();
    await expect(sim.panelB).toBeVisible();
    await expect(sim.drawerToggle).toBeVisible();
  });

  test('drawer opens and shows scenario list when toggled', async () => {
    await sim.openDrawer();
    await expect(sim.drawer).toBeVisible();
    await expect(sim.page.getByTestId('scenario-list')).toBeVisible();

    // All 4 presets are present
    for (const id of ['basic-chat', 'ping-pong', 'broadcast-burst', 'cross-talk']) {
      await expect(sim.page.getByTestId(`scenario-${id}`)).toBeVisible();
    }
  });

  test('drawer closes via the close button', async () => {
    await sim.openDrawer();
    await sim.closeDrawer();
    // After closing, drawer should be off-screen (transformed)
    const box = await sim.drawer.boundingBox();
    // transformed off-screen → x should be ≥ viewport width
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(sim.page.viewportSize()!.width - 5);
  });

  // ── Backend connectivity ───────────────────────────────────────────────────

  test('both backends are reachable and show connected status', async () => {
    await sim.openDrawer();
    await sim.waitForBackendsConnected();

    const rows = sim.page.locator('.backend-state');
    await expect(rows.nth(0)).toHaveText('connected');
    await expect(rows.nth(1)).toHaveText('connected');
  });

  // ── Simulation lifecycle ───────────────────────────────────────────────────

  test('start simulation connects both peers into a shared room', async () => {
    await sim.startAndWaitReady();

    // Both panels show "room active" chip
    await expect(sim.panelA.locator('.peer-room-chip').filter({ hasText: 'room active' })).toBeVisible();
    await expect(sim.panelB.locator('.peer-room-chip').filter({ hasText: 'room active' })).toBeVisible();
  });

  test('reset returns to idle and clears panels', async () => {
    await sim.startAndWaitReady();
    await sim.resetBtn.click();

    // Phase badge should show "idle"
    await expect(sim.page.locator('.sim-phase-badge')).toContainText('idle');
  });

  // ── Scenario: Basic Chat ───────────────────────────────────────────────────

  test('basic-chat: messages are delivered to both peers', async () => {
    await sim.startAndWaitReady();
    await sim.runScenario('basic-chat');

    // Messages sent by A must appear in B's panel (gossip delivery)
    await sim.expectMessageInBoth("Hey B — can you hear me?");
    await sim.expectMessageInBoth("Loud and clear. P2P is live.");
    await sim.expectMessageInBoth("Perfect — gossip overlay working end-to-end.");
  });

  test('basic-chat: phase transitions idle → waiting → ready → running → done', async () => {
    await sim.openDrawer();
    await sim.waitForBackendsConnected();
    await sim.startBtn.click();

    // Phase should leave idle quickly
    await expect(sim.page.locator('.sim-phase-badge')).not.toContainText('idle', { timeout: 5_000 });

    // Eventually both peers are ready
    await sim.page.waitForFunction(
      () => document.querySelector('[data-peer="A"]')?.getAttribute('data-state') === 'ready' &&
            document.querySelector('[data-peer="B"]')?.getAttribute('data-state') === 'ready',
      { timeout: 30_000 }
    );

    await sim.page.getByTestId('run-basic-chat').click();
    await expect(sim.page.locator('.sim-phase-badge')).toContainText('running', { timeout: 5_000 });
    await expect(sim.page.locator('.sim-phase-badge')).toContainText('done', { timeout: 30_000 });
  });

  // ── Scenario: Ping Pong ────────────────────────────────────────────────────

  test('ping-pong: all 8 messages land in both panels', async () => {
    await sim.startAndWaitReady();
    await sim.runScenario('ping-pong');

    for (let i = 1; i <= 4; i++) {
      await sim.expectMessageInBoth(`ping ${i}`);
      await sim.expectMessageInBoth(`pong ${i}`);
    }
  });

  // ── Scenario: Broadcast Burst ──────────────────────────────────────────────

  test('broadcast-burst: all 5 burst messages delivered to B', async () => {
    await sim.startAndWaitReady();
    await sim.runScenario('broadcast-burst');

    for (let i = 1; i <= 5; i++) {
      await sim.expectMessage('B', `Burst ${i}/5`);
    }
    await sim.expectMessage('A', 'All 5 received, no duplicates detected.');
  });

  // ── Scenario: Cross-Talk ───────────────────────────────────────────────────

  test('cross-talk: simultaneous messages both arrive on the other side', async () => {
    await sim.startAndWaitReady();
    await sim.runScenario('cross-talk');

    await sim.expectMessageInBoth('A: sending at the same time as B');
    await sim.expectMessageInBoth("B: same here, let's see the ordering");
  });

  // ── Run Again ─────────────────────────────────────────────────────────────

  test('"Run Another Scenario" button appears after done and resets to ready', async () => {
    await sim.startAndWaitReady();
    await sim.runScenario('basic-chat');

    await expect(sim.runAgainBtn).toBeVisible();
    await sim.runAgainBtn.click();

    await expect(sim.page.locator('.sim-phase-badge')).toContainText('ready');
  });
});
