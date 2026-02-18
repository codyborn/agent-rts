import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1, // Serial — tests share a dev server
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npm run dev -- --port 3000',
    port: 3000,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
