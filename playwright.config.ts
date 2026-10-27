import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const uiPort = process.env.VRCNEXT_UI_PORT || '5173';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 6000 },
  reporter: [['list']],
  outputDir: process.env.VRCNEXT_UI_OUTPUT_DIR || `test-results/ui-${uiPort}`,
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    browserName: 'chromium',
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'portrait',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'landscape',
      use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${uiPort} --strictPort`,
    url: `http://127.0.0.1:${uiPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
