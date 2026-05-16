import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:       './tests',
  timeout:       90_000,
  expect:        { timeout: 20_000 },
  fullyParallel: false, // tests share the two backend processes
  retries:       0,
  reporter:      process.env.CI ? 'github' : 'html',

  use: {
    baseURL:    'http://localhost:4321',
    headless:   true,
    viewport:   { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video:      'on-first-retry',
  },

  // Astro dev server — reused if already running locally
  webServer: {
    command:             'cd ../web && npm run dev',
    url:                 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout:             60_000,
    stdout:              'pipe',
    stderr:              'pipe',
  },
});
