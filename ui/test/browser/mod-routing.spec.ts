import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);
const routes = async (page: Page) => (await stored(page)).synths[0].synthParams.modMatrix;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('a route sends a source to a destination by an amount, is saved, and can be taken away', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'LFO', exact: true }).first().click();
  const source = (row: number) => synth.getByLabel(`Route ${row} source`, { exact: true });
  const destination = (row: number) => synth.getByLabel(`Route ${row} destination`, { exact: true });
  const amount = (row: number) => synth.getByLabel(`Route ${row} amount value`, { exact: true });

  // Nothing is routed to begin with. There is one row, for the first route; the next comes once it is used.
  await expect(source(1)).toHaveValue('');
  await expect(source(1)).toBeEnabled();
  await expect(destination(1)).toBeDisabled();
  await expect(source(2)).toHaveCount(0);
  expect(await routes(page)).toEqual([]);

  await source(1).selectOption('velocity');
  await expect.poll(() => routes(page)).toEqual([{ source: 'velocity', destination: 'filter', depth: 0.5 }]);
  await expect(destination(1)).toBeEnabled();
  await expect(source(2), 'the next row opens').toBeEnabled();

  await destination(1).selectOption('pan');
  await amount(1).fill('-40');
  await amount(1).press('Enter');
  await expect.poll(() => routes(page)).toEqual([{ source: 'velocity', destination: 'pan', depth: -0.4 }]);
  await expect(amount(1)).toHaveValue('-40%');

  await source(2).selectOption('random');
  await destination(2).selectOption('osc2Pitch');
  await expect.poll(async () => (await routes(page)).length).toBe(2);

  // It is still there after the page is loaded again.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'LFO', exact: true }).first().click();
  await expect(source(1)).toHaveValue('velocity');
  await expect(destination(2)).toHaveValue('osc2Pitch');

  // The dash takes a route away, and the one after it moves up.
  await source(1).selectOption('');
  await expect.poll(() => routes(page)).toEqual([{ source: 'random', destination: 'osc2Pitch', depth: 0.5 }]);
  await expect(source(1)).toHaveValue('random');
  await expect(source(2)).toHaveValue('');
});

test('each LFO\'s own target and depth are in the routing list, and a sound has up to eight routes', async ({ page }) => {
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'LFO', exact: true }).first().click();
  const own = synth.getByRole('group', { name: 'LFO 1\'s own route', exact: true });
  await expect(own.getByLabel('LFO 1 target', { exact: true })).toBeVisible();
  await expect(synth.getByRole('group', { name: 'LFO 2\'s own route', exact: true }).getByLabel('LFO 2 target', { exact: true })).toBeVisible();

  const source = (row: number) => synth.getByLabel(`Route ${row} source`, { exact: true });
  for (let row = 1; row <= 8; row++) {
    await source(row).selectOption(row % 2 ? 'velocity' : 'key');
    await expect.poll(async () => (await routes(page)).length).toBe(row);
  }
  await expect(source(9), 'no ninth').toHaveCount(0);
  await expect(synth.locator('.synth-route:not(.synth-route-lfo)')).toHaveCount(8);
});
