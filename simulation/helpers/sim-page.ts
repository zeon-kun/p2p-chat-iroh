import type { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for the /simulation page.
 *
 * Handles navigation, drawer interaction, and per-peer assertions.
 */
export class SimPage {
  readonly page:         Page;
  readonly drawerToggle: Locator;
  readonly drawer:       Locator;
  readonly startBtn:     Locator;
  readonly resetBtn:     Locator;
  readonly runAgainBtn:  Locator;
  readonly panelA:       Locator;
  readonly panelB:       Locator;

  constructor(page: Page) {
    this.page         = page;
    this.drawerToggle = page.getByTestId('sim-drawer-toggle');
    this.drawer       = page.getByTestId('sim-drawer');
    this.startBtn     = page.getByTestId('sim-start');
    this.resetBtn     = page.getByTestId('sim-reset');
    this.runAgainBtn  = page.getByTestId('sim-run-again');
    this.panelA       = page.locator('[data-peer="A"]');
    this.panelB       = page.locator('[data-peer="B"]');
  }

  async goto() {
    await this.page.goto('/simulation');
    await this.page.waitForLoadState('networkidle');
  }

  async openDrawer() {
    await this.drawerToggle.click();
    await this.drawer.waitFor({ state: 'visible' });
  }

  async closeDrawer() {
    const closeBtn = this.drawer.locator('button[aria-label="Close drawer"]');
    await closeBtn.click();
  }

  /** Wait for both backend WS connections to be in connected state. */
  async waitForBackendsConnected(timeoutMs = 15_000) {
    await this.page.waitForFunction(
      () => {
        // The phase status in the topbar changes from idle → something else
        // once start is clicked; but for pre-start we just check the badge text.
        // Simpler: wait for both "connected" strings in backend status rows.
        return document.querySelectorAll('.backend-row .backend-state').length === 2 &&
          [...document.querySelectorAll('.backend-row .backend-state')]
            .every(el => el.textContent?.trim() === 'connected');
      },
      { timeout: timeoutMs }
    );
  }

  /** Click "Start Simulation" and wait for both peers to be ready. */
  async startAndWaitReady(timeoutMs = 30_000) {
    await this.openDrawer();
    await this.waitForBackendsConnected();
    await this.startBtn.click();

    // Wait until phase === 'ready'
    await this.page.waitForFunction(
      () => document.querySelector('[data-peer="A"]')?.getAttribute('data-state') === 'ready' &&
            document.querySelector('[data-peer="B"]')?.getAttribute('data-state') === 'ready',
      { timeout: timeoutMs }
    );
  }

  /** Run a preset scenario by ID and wait for it to finish. */
  async runScenario(scenarioId: string, timeoutMs = 60_000) {
    const runBtn = this.page.getByTestId(`run-${scenarioId}`);
    await runBtn.click();

    // Wait until phase leaves 'running'
    await this.page.waitForFunction(
      () => {
        const badge = document.querySelector('.sim-phase-badge');
        const text  = badge?.textContent ?? '';
        return !text.includes('running');
      },
      { timeout: timeoutMs }
    );
  }

  /** Assert that a peer panel contains a given message. */
  async expectMessage(peer: 'A' | 'B', text: string) {
    const panel = peer === 'A' ? this.panelA : this.panelB;
    await panel.locator('.msg-body').filter({ hasText: text }).waitFor({ state: 'visible' });
  }

  /** Assert that both panels contain the same message (gossip delivery). */
  async expectMessageInBoth(text: string) {
    await this.expectMessage('A', text);
    await this.expectMessage('B', text);
  }
}
