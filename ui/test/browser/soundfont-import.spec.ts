import { expect, test, type Page } from '@playwright/test';
import { INSTRUMENT, MODES, SAMPLE_ID, buildSoundFont, keys } from '../helpers/soundFontFile.ts';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const sound = async (page: Page) => (await stored(page)).synths[0].synthParams;

// A SoundFont with two instruments, each of one looped recording, built here so no file is needed.
function twoInstruments(): Buffer {
  const wave = (step: number) => Array.from({ length: 4000 }, (_, i) => Math.round(9000 * Math.sin(i / step)));
  return Buffer.from(buildSoundFont({
    name: 'Two instruments',
    samples: [{ name: 'a', data: wave(8), rate: 22050, pitch: 60, loop: [1000, 3000] }, { name: 'b', data: wave(4), rate: 22050, pitch: 72, loop: [1000, 3000] }],
    instruments: [{ name: 'Organ', zones: [{ gens: [keys(0, 127), [MODES, 1], [SAMPLE_ID, 0]] }] }, { name: 'Strings', zones: [{ gens: [keys(0, 127), [MODES, 1], [SAMPLE_ID, 1]] }] }],
    presets: [{ name: 'Organ', bank: 0, program: 16, zones: [{ gens: [[INSTRUMENT, 0]] }] }, { name: 'Strings', bank: 0, program: 48, zones: [{ gens: [[INSTRUMENT, 1]] }] }],
  }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('an instrument of a SoundFont becomes the lane\'s sample, chosen from the font, looped, and kept as an instrument', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await synth.getByLabel('Synth engine', { exact: true }).selectOption('sample');
  const sample = synth.getByLabel('Synth sample', { exact: true });
  await expect(sample.locator('option', { hasText: 'Import a SoundFont…' })).toHaveCount(1);

  // A font with two instruments asks which.
  await synth.getByLabel('Import SoundFont', { exact: true }).setInputFiles({ name: 'two.sf2', mimeType: 'application/octet-stream', buffer: twoInstruments() });
  const dialog = page.getByRole('dialog', { name: 'Import a SoundFont instrument', exact: true });
  await expect(dialog).toContainText('Two instruments has 2 instruments');
  await expect(dialog.getByLabel('SoundFont instrument', { exact: true }).locator('option')).toHaveText(['0:16 Organ', '0:48 Strings']);
  await dialog.getByLabel('SoundFont instrument', { exact: true }).selectOption({ label: '0:48 Strings' });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect(sample.locator('option:checked')).toHaveText('Strings.instrument');
  const chosen = await sound(page);
  expect(chosen.sample.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(chosen.sample.loop, 'its recordings go round their own loops').toBe(true);
  const kept = await page.evaluate(id => new Promise<string | undefined>((resolve) => {
    const request = indexedDB.open('discobot-samples', 1);
    request.onsuccess = () => {
      const read = request.result.transaction('samples').objectStore('samples').get(id);
      read.onsuccess = () => resolve(read.result?.type);
    };
  }), chosen.sample.id);
  expect(kept).toBe('application/x-discobot-instrument');

  // A file that is not a SoundFont is turned away, and says so.
  await synth.getByLabel('Import SoundFont', { exact: true }).setInputFiles({ name: 'not.sf2', mimeType: 'application/octet-stream', buffer: Buffer.from('not a soundfont') });
  await expect(page.getByRole('alert')).toContainText('not a SoundFont this app can read');
  expect(errors).toEqual([]);
});
