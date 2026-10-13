import { expect, test, type Page } from '@playwright/test';

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

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const sound = async (page: Page) => (await stored(page)).synths[0].synthParams;

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('a synth lane plays an imported sample: chosen, tuned and looped on the Osc tab, saved, and missed when it is gone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  const engine = synth.getByLabel('Synth engine', { exact: true });
  const sample = synth.getByLabel('Synth sample', { exact: true });

  // The sample engine with nothing chosen says so, and the oscillator's own controls stand down.
  await engine.selectOption('sample');
  await expect.poll(async () => (await sound(page)).engine).toBe('sample');
  await expect(sample).toHaveValue('');
  await expect(synth.locator('.synth-sample-note')).toContainText('Choose a sample');
  await expect(synth.getByLabel('Oscillator waveform', { exact: true })).toBeDisabled();
  await expect(synth.getByLabel('Oscillator 2 enabled', { exact: true })).toHaveCount(0);

  await synth.getByLabel('Import synth sample', { exact: true }).setInputFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(sample.locator('option:checked')).toHaveText('beep.wav');
  const sampleId = (await sound(page)).sample.id;
  expect(sampleId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(synth.locator('.synth-sample-note')).toHaveCount(0);
  expect((await stored(page)).synths[1].synthParams.sample?.id, 'only this lane changes').toBeUndefined();

  // The root is typed as a note, and the loop is a tick box.
  const root = synth.getByLabel('Sample root note value', { exact: true });
  await expect(root).toHaveValue('C4');
  await root.fill('A4');
  await root.press('Enter');
  await synth.getByLabel('Loop the sample', { exact: true }).check();
  await expect.poll(async () => { const now = (await sound(page)).sample; return [now.root, now.loop]; }).toEqual([69, true]);
  await expect(root).toHaveValue('A4');

  // It plays without complaint.
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Still there after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await expect(page.locator('.synth-controls-panel').first().getByLabel('Synth sample', { exact: true }).locator('option:checked')).toHaveText('beep.wav');

  // The sample is deleted from this browser: the lane says so and plays its oscillator.
  await more(page);
  await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
  await page.getByRole('button', { name: 'Delete sample beep.wav', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete sample beep.wav', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  const after = page.locator('.synth-controls-panel').first();
  await expect(after.getByLabel('Synth sample', { exact: true }).locator('option:checked')).toHaveText('Sample not on this device');
  await expect(after.locator('.synth-sample-note')).toContainText('not on this device');
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // None gives the sample up, and the analog engine brings the oscillators back.
  await after.getByLabel('Synth sample', { exact: true }).selectOption({ label: 'None' });
  await expect.poll(async () => 'id' in (await sound(page)).sample).toBe(false);
  await after.getByLabel('Synth engine', { exact: true }).selectOption('subtractive');
  await expect(after.getByLabel('Oscillator 2 enabled', { exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});
