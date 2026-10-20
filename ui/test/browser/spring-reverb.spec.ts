import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

// Export is a dialog: what (the scene or the song), as what, then Export. It is closed at once and
// the file goes on being made, so the caller waits for the download as it did with the menu.
async function exportAs(page: Page, item: string) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: item.startsWith('Song') ? 'The whole song' : 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: item === 'Loop WAV' ? 'Seamless loop' : item === 'Stems' ? 'Stems' : item.endsWith('MIDI') ? 'MIDI' : 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

async function edit(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}

// An edit reaches the arrangement a moment after the control changes, so the export waits for it.
async function exportWav(page: Page, path: string) {
  await page.waitForTimeout(250);
  const download = page.waitForEvent('download');
  await exportAs(page, 'Scene WAV');
  await (await download).saveAs(path);
  return readFile(path);
}

// The browser's offline renderer can round a handful of samples differently from one run to the
// next, by the smallest step a WAV file has. Anything more than that is a real difference.
function same(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 44; i + 1 < a.length; i += 2) {
    const gap = Math.abs(a.readInt16LE(i) - b.readInt16LE(i));
    if (gap > 2 || (gap > 0 && ++differing > 40)) return false;
  }
  return true;
}

// How loud a stretch of a 16-bit stereo WAV at 44.1 kHz is, in the file's own steps.
function loudness(wav: Buffer, from: number, to: number) {
  let sum = 0, count = 0;
  for (let i = 44 + Math.round(from * 44100) * 4; i + 1 < Math.min(wav.length, 44 + Math.round(to * 44100) * 4); i += 2) {
    sum += wav.readInt16LE(i) ** 2;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}
const decibels = (ratio: number) => 20 * Math.log10(ratio);

const effects = (page: Page) => page.locator('.effects-unit');
const kind = (page: Page) => effects(page).getByLabel('Reverb kind', { exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

// The Spring (roadmap 15): a third reverb, a guitar amplifier's spring tank, with a preset of its own.
test('the Spring is a reverb to choose, kept across a reload, set by its preset, and an export with it rings and repeats', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(kind(page).locator('option')).toHaveText(['Room', 'Hall', 'Spring']);
  await kind(page).selectOption({ label: 'Spring' });
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.kind).toBe('spring');
  await page.reload();
  await expect(kind(page)).toHaveValue('spring');

  await kind(page).selectOption({ label: 'Room' });
  await effects(page).getByRole('button', { name: 'Reverb presets', exact: true }).click();
  await effects(page).getByRole('menu', { name: 'Reverb presets', exact: true }).getByRole('menuitem', { name: 'Spring style', exact: true }).click();
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb).toMatchObject({ enabled: true, kind: 'spring', decay: 2, damping: 0.35 });

  // One kick into the Spring alone, against the same kick into the Hall.
  const unit = page.locator('[data-unit="drums"]');
  const take = (name: string) => exportWav(page, testInfo.outputPath(`${name}.wav`));
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await effects(page).getByLabel('Delay enabled', { exact: true }).uncheck();
  await effects(page).getByLabel('Drive enabled', { exact: true }).uncheck();
  await unit.getByRole('button', { name: 'Sends', exact: true }).click();
  await edit(unit.getByLabel('Rev Send value', { exact: true }), '100%');
  const spring = await take('spring');
  expect(same(await take('spring-again'), spring), 'renders the same every time').toBe(true);
  expect(loudness(spring, 0.6, 1.2), 'it rings on after the kick').toBeGreaterThan(5);
  await kind(page).selectOption({ label: 'Hall' });
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.kind).toBe('hall');
  expect(same(await take('hall'), spring), 'the Spring is not the Hall').toBe(false);
  expect(errors).toEqual([]);
});
