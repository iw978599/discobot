import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const glide = async (page: Page) => (await stored(page)).synths[0].synthParams.portamento;
const amp = async (page: Page) => {
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Amp', exact: true }).first().click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the glide can follow the tempo, keep to held keys and go at the same speed, each kept and each undone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await amp(page);
  const panel = page.locator('.synth-controls-panel').first();
  const sync = panel.getByLabel('Glide sync', { exact: true });
  const fingered = panel.getByLabel('Glide only from held keys', { exact: true });
  const speed = panel.getByLabel('Glide at the same speed', { exact: true });
  await expect(sync).toBeDisabled();
  await panel.getByLabel('Portamento enabled', { exact: true }).check();
  await expect(sync).toHaveValue('off');
  await expect(fingered).not.toBeChecked();
  await expect(speed).not.toBeChecked();

  await sync.selectOption('1/16');
  await fingered.check();
  await speed.check();
  await expect.poll(() => glide(page)).toMatchObject({ enabled: true, sync: '1/16', fingered: true, speed: true });
  await expect(panel.getByLabel('Glide value', { exact: true })).toBeDisabled();

  await page.reload();
  await amp(page);
  await expect(page.locator('.synth-controls-panel').first().getByLabel('Glide sync', { exact: true })).toHaveValue('1/16');

  // Back off: the sync is stored as nothing again, and the switches as off.
  const again = page.locator('.synth-controls-panel').first();
  await again.getByLabel('Glide sync', { exact: true }).selectOption('off');
  await again.getByLabel('Glide only from held keys', { exact: true }).uncheck();
  await again.getByLabel('Glide at the same speed', { exact: true }).uncheck();
  await expect.poll(async () => 'sync' in (await glide(page))).toBe(false);
  await expect.poll(() => glide(page)).toMatchObject({ fingered: false, speed: false });
  expect(errors).toEqual([]);
});
