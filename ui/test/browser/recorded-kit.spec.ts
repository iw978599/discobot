import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 1059 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

async function exportScene(page: Page, path: string) {
  await page.waitForTimeout(250);
  const download = page.waitForEvent('download');
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await (await download).saveAs(path);
  return readFile(path);
}

const loudness = (wav: Buffer, from: number, to: number) => {
  let sum = 0, count = 0;
  for (let i = 44 + Math.round(from * 44100) * 4; i + 1 < Math.min(wav.length, 44 + Math.round(to * 44100) * 4); i += 2) {
    sum += wav.readInt16LE(i) ** 2;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the Recorded kit is a choice in the kit menu, plays recordings, and its knob is Decay', async ({ page }, info) => {
  const kits = page.getByLabel('Drum kit', { exact: true });
  await expect(kits.locator('option')).toContainText(['Recorded']);
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  const synthesized = await exportScene(page, info.outputPath('synthesized.wav'));
  await kits.selectOption('recorded');
  await expect(kits).toHaveValue('recorded');
  await page.getByRole('button', { name: 'Select Kick', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Kick Decay', exact: true })).toBeVisible();
  const recorded = await exportScene(page, info.outputPath('recorded.wav'));
  expect(recorded.equals(synthesized)).toBe(false);
  expect(loudness(recorded, 0, 0.3)).toBeGreaterThan(200);
  expect(loudness(recorded, 0.45, 0.75)).toBeGreaterThan(100);
  await kits.selectOption('clean-analog');
  await expect(page.getByRole('slider', { name: 'Kick Punch', exact: true })).toBeVisible();
});

test('a lane can be another percussion instrument in any kit, and the choice is stored only when made', async ({ page }, info) => {
  const stored = () => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), 'discobot_browser_project_v1');
  await page.getByRole('button', { name: 'Select Clap', exact: true }).click();
  const voice = page.getByLabel('Clap voice', { exact: true });
  await expect(voice.locator('option')).toHaveText(['Clap', 'Tambourine', 'Shaker', 'Cowbell']);
  expect((await stored()).drumState.clap.settings.percType).toBeUndefined();
  await page.getByRole('button', { name: 'Clap step 1', exact: true }).click();
  const own = await exportScene(page, info.outputPath('clap.wav'));
  await voice.selectOption('cowbell');
  await expect.poll(async () => (await stored()).drumState.clap.settings.percType).toBe('cowbell');
  const cowbell = await exportScene(page, info.outputPath('cowbell.wav'));
  expect(cowbell.equals(own)).toBe(false);
  expect(loudness(cowbell, 0, 0.3)).toBeGreaterThan(200);
  await voice.selectOption('default');
  await expect.poll(async () => (await stored()).drumState.clap.settings.percType).toBeUndefined();
  await page.getByRole('button', { name: 'Select Kick', exact: true }).click();
  await expect(page.getByLabel('Kick voice', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Select Low Tom', exact: true }).click();
  await expect(page.getByLabel('Low Tom voice', { exact: true }).locator('option')).toHaveText(['Low Tom', 'Conga']);
});
