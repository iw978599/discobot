import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const sound = async (page: Page) => (await stored(page)).synths[0].synthParams;

test('a big instrument is fetched from this site only when a lane first uses it', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', request => { if (request.url().includes('/sounds/')) asked.push(new URL(request.url()).pathname.split('/sounds/')[1]); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
  expect(asked, 'nothing from sounds/ is fetched as the app opens').toEqual([]);

  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await synth.getByLabel('Synth engine', { exact: true }).selectOption('sample');
  const sample = synth.getByLabel('Synth sample', { exact: true });
  await expect(sample.locator('optgroup[label="Built in"] option')).toContainText(['Grand Piano (Kawai)', 'Grand Piano (Steinway B)', 'Pipe Organ', 'Tenor Sax', 'FM Piano', 'FM Piano 1', 'FM Clavisynth', 'Caveman Organ']);
  await sample.selectOption({ label: 'Piano' });
  await expect(synth.locator('.synth-sample-note')).toHaveCount(0);
  expect(asked).toEqual([]);

  await sample.selectOption({ label: 'Pipe Organ' });
  await expect.poll(async () => (await sound(page)).sample.wave).toBe('pipe-organ');
  await expect(synth.locator('.synth-sample-note')).toContainText('fetched the first time');
  await expect.poll(() => asked).toEqual(['pipe-organ.bin']);
  const file = await page.evaluate(async () => {
    const response = await fetch('sounds/pipe-organ.bin');
    return { status: response.status, sameSite: new URL(response.url).origin === location.origin, bytes: (await response.arrayBuffer()).byteLength };
  });
  expect(file.status).toBe(200);
  expect(file.sameSite).toBe(true);
  expect(file.bytes).toBeGreaterThan(100_000);
});
