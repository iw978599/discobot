import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('Swing on a lane is a switch that is saved, kept on reload and undone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const swing = lane.getByRole('button', { name: 'Synth 1 swing', exact: true });

  await expect(swing).toHaveAttribute('aria-pressed', 'false');
  expect('swing' in (await stored(page)).synths[0]).toBe(false);

  await swing.click();
  await expect(swing).toHaveAttribute('aria-pressed', 'true');
  expect((await stored(page)).synths[0].swing).toBe(true);

  await page.reload();
  await expect(swing).toHaveAttribute('aria-pressed', 'true');

  await swing.click();
  await expect(swing).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(swing).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
