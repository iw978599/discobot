import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const buildDirectory = `../.playwright-build-${port}`;
mkdirSync('.playwright-runtime', { recursive: true });
process.env.TMPDIR = resolve('.playwright-runtime');

export default defineConfig({
  testDir: './ui/test/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/discobot/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build --workspace=ui -- --outDir ${buildDirectory} --emptyOutDir && npm run preview --workspace=ui -- --outDir ${buildDirectory} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/discobot/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
