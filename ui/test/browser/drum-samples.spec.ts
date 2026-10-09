import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

// A tenth of a second of a loud 880 Hz tone as a 16-bit mono WAV file.
function toneWav(): Buffer {
  const rate = 22050, frames = rate / 10, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 880 * frame / rate) * 26000), 44 + frame * 2);
  return data;
}

async function exportWav(page: Page, path: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download WAV', exact: true }).click();
  await (await download).saveAs(path);
  return readFile(path);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a drum lane plays an imported sample, in playback and export, and falls back if the sample is gone', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  const sound = page.getByLabel('Snare sound', { exact: true });
  await expect(sound).toHaveValue('');
  const builtIn = await exportWav(page, testInfo.outputPath('built-in.wav'));

  await page.getByLabel('Import drum sample', { exact: true }).setInputFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(sound.locator('option:checked')).toHaveText('beep.wav');
  const sampleId = (await stored(page)).drumState.snare.sampleId;
  expect(sampleId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await stored(page)).drumState.kick.sampleId, 'only the chosen lane changes').toBeUndefined();

  // The export is rendered from the same engine as playback, so it shows the sample is used.
  await expect.poll(async () => (await exportWav(page, testInfo.outputPath('sampled.wav'))).equals(builtIn), { message: 'the export changes once the sample has loaded' }).toBe(false);
  const sampled = await readFile(testInfo.outputPath('sampled.wav'));
  expect((await exportWav(page, testInfo.outputPath('sampled-again.wav'))).equals(sampled), 'and is repeatable').toBe(true);

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Another lane can use the same sample, chosen from the list.
  await page.getByRole('button', { name: 'Clap step 9', exact: true }).click();
  await page.getByLabel('Clap sound', { exact: true }).selectOption({ label: 'beep.wav' });
  await expect.poll(async () => (await stored(page)).drumState.clap.sampleId).toBe(sampleId);
  await page.getByLabel('Clap sound', { exact: true }).selectOption({ label: 'Built-in' });
  await expect.poll(async () => 'sampleId' in (await stored(page)).drumState.clap).toBe(false);

  await page.reload();
  await page.getByRole('button', { name: 'Snare step 6', exact: true }).click();
  await expect(page.getByLabel('Snare sound', { exact: true }).locator('option:checked')).toHaveText('beep.wav');

  // The sample is deleted from this browser: the lane says so and plays its own sound.
  await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
  await page.getByRole('button', { name: 'Delete sample beep.wav', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete sample beep.wav', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Snare step 7', exact: true }).click();
  await expect(page.getByLabel('Snare sound', { exact: true }).locator('option:checked')).toHaveText('Sample not on this device');
  await expect(page.locator('.drum-strip').getByRole('status')).toContainText('not on this device');
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Stop All/ }).click();

  await page.getByLabel('Snare sound', { exact: true }).selectOption({ label: 'Built-in' });
  await expect.poll(async () => 'sampleId' in (await stored(page)).drumState.snare).toBe(false);
  await expect(page.locator('.drum-strip').getByRole('status')).toHaveCount(0);
  expect(errors).toEqual([]);
});
