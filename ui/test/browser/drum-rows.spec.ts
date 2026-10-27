import { expect, test, type Page } from '@playwright/test';

// Rows after the eight drums (docs/DRUM_ROWS_PLAN.md, stage 1): added under the grid, given a
// recording to play, edited as any row is, saved, and taken away again.

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the desktop rack; the rows are the same markup on a phone');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('a row is added under the eight drums, plays the recording chosen for it, and is taken away again', async ({ page }) => {
  const drums = page.getByRole('region', { name: 'Drums module', exact: true });
  await expect(button(page, 'Select Row 9'), 'eight rows to begin with').toHaveCount(0);

  await button(page, '+ Row').click();
  await expect(button(page, 'Select Row 9')).toBeVisible();
  await expect(button(page, 'Select Row 9'), 'and it is the row chosen').toHaveAttribute('aria-pressed', 'true');
  await drums.getByLabel('Row 9 voice', { exact: true }).selectOption('cowbell');
  await expect(button(page, 'Select Row 9'), 'its name is the recording it plays').toHaveText('Cowbell');
  await button(page, 'Row 9 step 1').click();
  await expect(button(page, 'Row 9 step 1')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const row = (await stored(page)).drumState.extra1;
    return [row?.steps[0], row?.settings.percType];
  }).toEqual([true, 'cowbell']);

  await drums.getByLabel('Row 9 voice', { exact: true }).selectOption('cymbal:splash');
  await expect(button(page, 'Select Row 9')).toHaveText('Splash');
  await expect.poll(async () => {
    const settings = (await stored(page)).drumState.extra1.settings;
    return ['percType' in settings, settings.cymbalType];
  }, 'a cymbal in place of the percussion').toEqual([false, 'splash']);

  // The mixer has a strip for it, after the eight, named as the grid names its controls.
  const mixer = page.getByRole('region', { name: 'Mixer module', exact: true });
  await mixer.getByLabel('Mixer Row 9 volume value', { exact: true }).fill('40%');
  await mixer.getByLabel('Mixer Row 9 volume value', { exact: true }).press('Enter');
  await expect.poll(async () => (await stored(page)).drumState.extra1.settings.volume).toBeCloseTo(0.4, 2);
  await button(page, 'Mixer Row 9 mute').click();
  await expect(button(page, 'Mute Row 9'), 'and its mute is the grid\'s').toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Mixer Row 9 mute').click();

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Stop All/ }).click();

  await button(page, 'Remove Row').click();
  await expect(button(page, 'Select Row 9')).toHaveCount(0);
  await expect(button(page, 'Select Kick'), 'the kick is chosen again').toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => 'extra1' in (await stored(page)).drumState).toBe(false);
  await button(page, 'Undo').click();
  await expect(button(page, 'Row 9 step 1'), 'undo brings the row back, steps and all').toHaveAttribute('aria-pressed', 'true');

  // Eight can be added, and no more.
  for (let added = 1; added < 8; added++) await button(page, '+ Row').click();
  await expect(button(page, 'Select Row 16')).toBeVisible();
  await expect(button(page, '+ Row')).toHaveCount(0);
});

function toneWav(): Buffer {
  const rate = 22050, frames = rate / 10, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 660 * frame / rate) * 20000), 44 + frame * 2);
  return data;
}

// Stage 3: a kit's files that match none of the eight drums go on rows of their own.
test('Import Kit puts the files no drum is given on new rows, each named after its file', async ({ page }) => {
  const wav = (name: string) => ({ name, mimeType: 'audio/wav', buffer: toneWav() });
  const dialog = page.getByRole('dialog', { name: 'Import a drum kit', exact: true });
  await page.getByLabel('Import drum kit files', { exact: true }).setInputFiles([wav('Kick.wav'), wav('Gong.wav'), wav('Woodblock.wav')]);
  await expect(dialog.getByLabel('File for Kick', { exact: true }).locator('option:checked')).toHaveText('Kick.wav');
  const gong = dialog.getByRole('switch', { name: 'A new row for Gong.wav', exact: true });
  const wood = dialog.getByRole('switch', { name: 'A new row for Woodblock.wav', exact: true });
  await expect(gong, 'a file on no lane is given a row to begin with').toHaveAttribute('aria-checked', 'true');
  await wood.click();
  await expect(wood).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('button', { name: 'Use These Sounds', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(button(page, 'Select Row 9'), 'the row shows the file it plays').toContainText('Gong');
  await expect(button(page, 'Select Row 10'), 'and the file left out has none').toHaveCount(0);
  await expect.poll(async () => {
    const { drumState } = await stored(page);
    return [Boolean(drumState.kick.sampleId), Boolean(drumState.extra1?.sampleId)];
  }).toEqual([true, true]);
});
