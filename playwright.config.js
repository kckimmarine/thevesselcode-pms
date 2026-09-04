/** TVC-PMS Playwright E2E — full UI tour + mobile 390px audit */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['./e2e/reporter/markdown-report.js'],
  ],
  use: {
    baseURL: process.env.TVC_E2E_BASE_URL || 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  webServer: {
    command: 'npx --yes serve . -l 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
