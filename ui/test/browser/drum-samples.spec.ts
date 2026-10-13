import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide
// screen; `less` puts it away again after something that leaves it up.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
const less = async (page: Page) => {
  if (await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close more controls', exact: true }).click();
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
  await exportAs(page, 'Scene WAV');
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
  await more(page);
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

test('a saved project file carries its samples to a browser that has never had them', async ({ page, browser, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  const builtIn = await exportWav(page, testInfo.outputPath('built-in.wav'));
  await page.getByLabel('Import drum sample', { exact: true }).setInputFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(page.getByLabel('Snare sound', { exact: true }).locator('option:checked')).toHaveText('beep.wav');
  await expect.poll(async () => (await exportWav(page, testInfo.outputPath('sampled.wav'))).equals(builtIn), { message: 'the export changes once the sample has loaded' }).toBe(false);
  const sampled = await readFile(testInfo.outputPath('sampled.wav'));
  const sampleId = (await stored(page)).drumState.snare.sampleId;

  const download = page.waitForEvent('download');
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export Project', exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^discobot-project-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath('project.json');
  await saved.saveAs(path);
  const file = JSON.parse(await readFile(path, 'utf8'));
  expect(file.samples.map((sample: { id: string; name: string; type: string }) => [sample.id, sample.name, sample.type])).toEqual([[sampleId, 'beep.wav', 'audio/wav']]);
  expect(Buffer.from(file.samples[0].data, 'base64').equals(toneWav()), 'the file holds the audio as it was imported').toBe(true);
  expect('samples' in file.project).toBe(false);
  await expect(page.locator('.app-alert')).toHaveCount(0);
  // The audio went into the file and nowhere else in this browser's project storage.
  const kept = await page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), Object.values({ ...localStorage }).join('')));
  expect(kept.includes(file.samples[0].data.slice(0, 80))).toBe(false);

  // Another browser: empty storage, no samples.
  const otherContext = await browser.newContext({ baseURL, acceptDownloads: true });
  const other = await otherContext.newPage();
  other.on('pageerror', error => errors.push(error.message));
  await other.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await other.goto('./');
  await expect(other.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();

  // First the same project without its audio, as a file from before this would be: the lane falls back.
  const { samples: _audio, ...bare } = file;
  const importFile = other.locator('input[aria-label="Import project file"]');
  await importFile.setInputFiles({ name: 'bare.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bare)) });
  await expect(other.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await other.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await expect(other.getByLabel('Snare sound', { exact: true }).locator('option:checked')).toHaveText('Sample not on this device');
  await expect(other.locator('.drum-strip').getByRole('status')).toContainText('not on this device');
  await expect.poll(async () => (await exportWav(other, testInfo.outputPath('other-missing.wav'))).equals(builtIn), { message: 'without the audio the built-in snare plays' }).toBe(true);

  // Then the saved file. The lane that was missing its sample now has it, under the same id.
  await importFile.setInputFiles(path);
  await more(other);
  await expect(other.getByRole('button', { name: /^Project: .* 3$/ })).toBeVisible();
  await less(other);
  await expect(other.locator('.app-alert')).toHaveCount(0);
  await other.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await expect(other.getByLabel('Snare sound', { exact: true }).locator('option:checked')).toHaveText('beep.wav');
  await expect(other.locator('.drum-strip').getByRole('status')).toHaveCount(0);
  expect((await stored(other)).drumState.snare.sampleId).toBe(sampleId);
  await expect.poll(async () => (await exportWav(other, testInfo.outputPath('other-sampled.wav'))).equals(sampled), { message: 'the export plays the sample that came in the file' }).toBe(true);

  await other.getByRole('button', { name: /Play All/ }).click();
  await other.waitForTimeout(700);
  await other.getByRole('button', { name: /Stop All/ }).click();

  // Importing it again adds a project, not a second copy of the sample.
  await importFile.setInputFiles(path);
  await more(other);
  await expect(other.getByRole('button', { name: /^Project: .* 4$/ })).toBeVisible();
  await less(other);
  await more(other);
  await other.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Delete sample beep.wav', exact: true })).toHaveCount(1);
  await other.keyboard.press('Escape');

  // A file whose audio is not audio still opens, says so, and the lane plays its own sound.
  await more(other);
  await other.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
  await other.getByRole('button', { name: 'Delete sample beep.wav', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Delete sample beep.wav', exact: true })).toHaveCount(0);
  await other.keyboard.press('Escape');
  // A sample already decoded stays in memory until the page is loaded again.
  await other.reload();
  await expect(other.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await importFile.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...file, samples: [{ ...file.samples[0], data: 'not audio at all!' }] })) });
  await more(other);
  await expect(other.getByRole('button', { name: /^Project: .* 5$/ })).toBeVisible();
  await less(other);
  await expect(other.locator('.app-alert').filter({ hasText: 'one of its samples could not be read' })).toBeVisible();
  await other.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(other.locator('.drum-strip').getByRole('status')).toContainText('not on this device');
  await otherContext.close();
  expect(errors).toEqual([]);
});

test('a kit of sample files is put on the lanes in one go, matched by name and corrected by hand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const wav = (name: string) => ({ name, mimeType: 'audio/wav', buffer: toneWav() });
  const kit = page.getByLabel('Import drum kit files', { exact: true });
  const dialog = page.getByRole('dialog', { name: 'Import a drum kit', exact: true });
  const fileFor = (lane: string) => dialog.getByLabel(`File for ${lane}`, { exact: true });

  // Nothing to import: a message, and no dialog.
  await kit.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a drum') });
  await expect(page.locator('.app-alert').filter({ hasText: 'None of those files are audio' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();

  await kit.setInputFiles([
    wav('Linn Kick 2.wav'), wav('Linn Kick 1.wav'), wav('DMX_Snare.wav'), wav('707 HH Closed.wav'), wav('HHOpen.wav'), wav('Tom Lo.wav'), wav('Cowbell.wav'),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a drum') },
  ]);
  const guesses = { Kick: 'Linn Kick 1.wav', Snare: 'DMX_Snare.wav', Clap: 'Leave as it is', 'Closed Hat': '707 HH Closed.wav', 'Open Hat': 'HHOpen.wav', 'Low Tom': 'Tom Lo.wav', 'High Tom': 'Leave as it is', Cymbal: 'Leave as it is' };
  for (const [lane, file] of Object.entries(guesses)) await expect(fileFor(lane).locator('option:checked'), lane).toHaveText(file);
  await expect(fileFor('Kick').locator('option'), 'only the audio files are on offer').toHaveCount(8);
  expect((await stored(page)).drumState.kick.sampleId, 'nothing changes until the choices are confirmed').toBeUndefined();

  // The guesses can be changed: the other kick, the cowbell on the clap lane, and the snare left alone.
  await fileFor('Kick').selectOption({ label: 'Linn Kick 2.wav' });
  await fileFor('Clap').selectOption({ label: 'Cowbell.wav' });
  await fileFor('Snare').selectOption({ label: 'Leave as it is' });
  await dialog.getByRole('button', { name: 'Use These Sounds', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const drums = (await stored(page)).drumState as Record<string, { sampleId?: string }>;
  expect(Object.keys(drums).filter(lane => drums[lane].sampleId).sort()).toEqual(['clap', 'closedHH', 'kick', 'openHH', 'snare2']);
  expect(new Set(Object.values(drums).map(lane => lane.sampleId).filter(Boolean)).size, 'each lane has its own sample').toBe(5);
  await expect(page.getByLabel('Kick sound', { exact: true }).locator('option:checked')).toHaveText('Linn Kick 2.wav');
  await page.getByRole('button', { name: 'Select Clap', exact: true }).click();
  await expect(page.getByLabel('Clap sound', { exact: true }).locator('option:checked')).toHaveText('Cowbell.wav');
  await page.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await expect(page.getByLabel('Snare sound', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Snare sound', { exact: true }).locator('option', { hasText: 'DMX_Snare.wav' }), 'a file left off every lane is not kept').toHaveCount(0);

  // Closing the dialog changes nothing.
  await kit.setInputFiles([wav('Crash.wav')]);
  await expect(fileFor('Cymbal').locator('option:checked')).toHaveText('Crash.wav');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await stored(page)).drumState.crash.sampleId).toBeUndefined();
  expect(errors).toEqual([]);
});
