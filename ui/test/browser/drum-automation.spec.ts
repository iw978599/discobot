import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 1059 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

// Export is a dialog: what (the scene or the song), as what, then Export. It is closed at once and
// the file goes on being made, so the caller waits for the download.
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

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
// The Snare's automated tune as stored, or null for none.
const tune = async (page: Page): Promise<Array<number | null> | null> => (await stored(page)).drumState.snare.stepAutomation?.tune ?? null;
const set = (list: Array<number | null> | null) => (list ?? []).flatMap((value, index) => (value === null ? [] : [index + 1]));

const drums = (page: Page) => page.locator('[data-unit="drums"]');
const cell = (page: Page, step: number) => drums(page).getByRole('slider', { name: `Snare Tune automation, step ${step}`, exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
  await drums(page).getByRole('button', { name: 'Select Snare', exact: true }).click();
  await drums(page).getByLabel('Snare automation parameter', { exact: true }).selectOption('tune');
});

test('a drum\'s tune drawn on a step is stored, undone, kept over a reload, copied with its bar and heard in an export', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(drums(page).getByRole('slider', { name: /^Snare Tune automation, step/ })).toHaveCount(16);

  // A value drawn from the keyboard (End is the top of the knob's range) is kept beside the steps.
  await cell(page, 3).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => set(await tune(page))).toEqual([3]);
  expect((await tune(page))![2]).toBe(1);
  expect((await stored(page)).drumState.snare.settings.tune, 'the drum\'s own tune is left alone').not.toBe(1);

  // One Undo takes it away, and nothing is left stored.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => tune(page)).toBeNull();
  await cell(page, 3).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => set(await tune(page))).toEqual([3]);

  // It survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
  await drums(page).getByRole('button', { name: 'Select Snare', exact: true }).click();
  await drums(page).getByLabel('Snare automation parameter', { exact: true }).selectOption('tune');
  await expect.poll(async () => set(await tune(page))).toEqual([3]);
  await expect(cell(page, 3)).toHaveAttribute('aria-valuenow', '1');

  // Copy bar copies it with the steps.
  await drums(page).getByLabel('Drum bars', { exact: true }).selectOption('2');
  await expect.poll(async () => set(await tune(page))).toEqual([3, 19]);
  await drums(page).getByRole('button', { name: 'Clear this automation', exact: true }).click();
  await expect.poll(() => tune(page)).toBeNull();
  await drums(page).getByLabel('Drum bars', { exact: true }).selectOption('1');
  await cell(page, 3).focus();
  await page.keyboard.press('End');
  await drums(page).getByLabel('Drum bars', { exact: true }).selectOption('2');
  await drums(page).getByRole('button', { name: /^Copy bar/ }).click();
  await page.getByRole('menuitem', { name: 'To bar 2', exact: true }).click();
  await expect.poll(async () => set(await tune(page))).toEqual([3, 19]);
  await drums(page).getByLabel('Drum bars', { exact: true }).selectOption('1');
  await expect.poll(async () => set(await tune(page))).toEqual([3]);

  // A Scene WAV with the Snare struck on the automated step differs from one without it, and
  // takes the same shape back when the automation is cleared.
  await drums(page).getByRole('button', { name: 'Snare step 3', exact: true }).click();
  await drums(page).getByRole('button', { name: 'Clear this automation', exact: true }).click();
  await expect.poll(() => tune(page)).toBeNull();
  const plain = await exportWav(page, testInfo.outputPath('plain.wav'));
  await cell(page, 3).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => set(await tune(page))).toEqual([3]);
  const tuned = await exportWav(page, testInfo.outputPath('tuned.wav'));
  expect(same(plain, tuned), 'the tuned hit sounds different').toBe(false);
  await drums(page).getByRole('button', { name: 'Clear this automation', exact: true }).click();
  await expect.poll(() => tune(page)).toBeNull();
  expect(same(plain, await exportWav(page, testInfo.outputPath('cleared.wav'))), 'without it the render is the plain one').toBe(true);

  expect(errors).toEqual([]);
});
