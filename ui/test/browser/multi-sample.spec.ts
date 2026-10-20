import { expect, test, type Page } from '@playwright/test';

// Several recordings made into one instrument for a lane (roadmap 22): each file's note guessed from
// its name and shown to be changed, nothing kept until Import, and then one instrument on the lane.

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const sound = async (page: Page) => (await stored(page)).synths[0].synthParams;
const sampleCount = (page: Page) => page.evaluate(() => new Promise<number>((resolve) => {
  const request = indexedDB.open('discobot-samples', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('samples', { keyPath: 'id' });
  request.onsuccess = () => {
    const count = request.result.transaction('samples').objectStore('samples').count();
    count.onsuccess = () => resolve(count.result);
  };
}));

function toneWav(hz: number): Buffer {
  const rate = 22050, frames = rate / 10, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * frame / rate) * 26000), 44 + frame * 2);
  return data;
}
const wav = (name: string, hz: number) => ({ name, mimeType: 'audio/wav', buffer: toneWav(hz) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('several recordings become one instrument on the lane, each at the note its name says or the one chosen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await synth.getByLabel('Synth engine', { exact: true }).selectOption('sample');
  const sample = synth.getByLabel('Synth sample', { exact: true });
  await expect(sample.locator('option', { hasText: 'Import several recordings…' })).toHaveCount(1);
  const before = await sampleCount(page);

  await synth.getByLabel('Import several recordings', { exact: true }).setInputFiles([wav('Flute C4.wav', 261.6), wav('Flute C5.wav', 523.3), wav('Flute breath.wav', 392)]);
  const dialog = page.getByRole('dialog', { name: 'Import several recordings', exact: true });
  await expect(dialog.getByLabel('Instrument name', { exact: true })).toHaveValue('Flute');
  await expect(dialog.getByLabel('Note of Flute C4.wav', { exact: true }).locator('option:checked')).toHaveText('C4');
  await expect(dialog.getByLabel('Note of Flute C5.wav', { exact: true }).locator('option:checked')).toHaveText('C5');
  // A name that says no note waits for one, and two of one note are not allowed.
  const go = dialog.getByRole('button', { name: 'Import', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('1 recording needs a note.');
  await expect(go).toBeDisabled();
  await dialog.getByLabel('Note of Flute breath.wav', { exact: true }).selectOption({ label: 'C4' });
  await expect(dialog.getByRole('status')).toHaveText('Two recordings have the same note.');
  await expect(go).toBeDisabled();
  expect(await sampleCount(page), 'nothing is kept before Import').toBe(before);
  await dialog.getByLabel('Note of Flute breath.wav', { exact: true }).selectOption({ label: 'G4' });
  await expect(go).toBeEnabled();
  await go.click();
  await expect(dialog).toHaveCount(0);

  await expect(sample.locator('option:checked')).toHaveText('Flute.instrument');
  const chosen = await sound(page);
  expect(chosen.sample.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(await sampleCount(page), 'one instrument, not three samples').toBe(before + 1);

  // Cancel keeps nothing.
  await synth.getByLabel('Import several recordings', { exact: true }).setInputFiles([wav('Bell A4.wav', 440)]);
  await page.getByRole('dialog', { name: 'Import several recordings', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await sampleCount(page)).toBe(before + 1);
  expect((await sound(page)).sample.id).toBe(chosen.sample.id);
  expect(errors).toEqual([]);
});
