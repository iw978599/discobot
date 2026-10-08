import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './ui/test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/discobot/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build:ui && npm run preview --workspace=ui -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/discobot/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
