import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests. On macOS run `npx playwright install chromium` once.
 * CHROME_PATH can point to any Chromium binary (used in CI/sandboxed environments).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL || 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: process.env.CHROME_PATH ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    },
    trace: 'off',
  },
  webServer: process.env.E2E_URL
    ? undefined
    : {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
