import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

async function exportWav(page: Page, item: string, path: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await (await download).saveAs(path);
  return readFile(path);
}
// Seconds of audio in a 16-bit stereo WAV at 44.1 kHz.
const seconds = (wav: Buffer) => (wav.length - 44) / (44100 * 4);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a lane and the drums can be several bars long, are edited a bar at a time, and play and export at full length', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.locator('.synth-module').first();
  const drumsUnit = page.getByRole('region', { name: 'Drums module', exact: true });
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });

  // One bar first. Making it two bars repeats it, ready to vary.
  await cell('C3', 1).click();
  await lane.getByLabel('Synth 1 bars', { exact: true }).selectOption('2');
  await expect(lane.getByRole('button', { name: 'Synth 1 bar 2', exact: true })).toBeVisible();
  await expect(cell('C3', 1), 'bar 1 is still on show').toHaveAttribute('aria-pressed', 'true');
  await expect(cell('C3', 17)).toHaveCount(0);

  await lane.getByRole('button', { name: 'Synth 1 bar 2', exact: true }).click();
  await expect(cell('C3', 17), 'the second bar starts as a copy of the first').toHaveAttribute('aria-pressed', 'true');
  await expect(cell('C3', 1)).toHaveCount(0);
  await cell('E3', 21).click();
  await expect(lane.getByRole('button', { name: 'Select step 21 E3', exact: true })).toBeVisible();
  await expect(lane.getByRole('button', { name: 'Select step 5', exact: true }), 'the step row shows the same bar').toHaveCount(0);

  // The drums: two bars as well, with a snare only in the second.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await drumsUnit.getByLabel('Drum bars', { exact: true }).selectOption('2');
  await drumsUnit.getByRole('button', { name: 'Drum bar 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 17', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Snare step 21', exact: true }).click();
  await drumsUnit.getByRole('button', { name: 'Drum bar 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'false');

  const saved = await stored(page);
  expect(saved.synths[0].pattern.bars).toBe(2);
  expect(saved.synths[0].pattern.steps).toHaveLength(32);
  expect(saved.synths[0].pattern.steps[20]).toMatchObject({ active: true, note: 'E3' });
  expect(saved.synths[0].pattern.steps[4].active).toBe(false);
  expect(saved.drumState.kick.steps).toHaveLength(32);
  expect([saved.drumState.snare.steps[4], saved.drumState.snare.steps[20]]).toEqual([false, true]);
  await expect(page.getByRole('region', { name: 'Song module', exact: true })).toContainText('2 bars');

  // At 240 BPM a bar is one second. Playback reaches the second bar and comes back round.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('240');
  await page.locator('.tempo-led-input').press('Enter');
  await drumsUnit.getByRole('button', { name: 'Follow', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  const drumBar = (bar: number) => drumsUnit.getByRole('button', { name: `Drum bar ${bar}`, exact: true });
  await expect(drumBar(2)).toHaveClass(/playing/);
  await expect(drumBar(2), 'the view follows the playhead').toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Snare step 21', exact: true })).toBeVisible();
  await expect(drumBar(1)).toHaveClass(/playing/);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Exports cover both bars.
  const full = await exportWav(page, 'Download WAV', testInfo.outputPath('two-bars.wav'));
  expect(seconds(full), 'two one-second bars and a tail').toBeGreaterThan(2.9);
  const loop = await exportWav(page, 'Loop WAV', testInfo.outputPath('two-bar-loop.wav'));
  expect(seconds(loop), 'a loop is exactly the pattern').toBeCloseTo(2, 3);

  // It all survives a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await expect(lane.getByLabel('Synth 1 bars', { exact: true })).toHaveValue('2');
  await expect(drumsUnit.getByLabel('Drum bars', { exact: true })).toHaveValue('2');
  await lane.getByRole('button', { name: 'Synth 1 bar 2', exact: true }).click();
  await expect(cell('E3', 21)).toHaveAttribute('aria-pressed', 'true');

  // Back to one bar keeps the first; undo brings the second back.
  await lane.getByLabel('Synth 1 bars', { exact: true }).selectOption('1');
  await expect(lane.getByRole('button', { name: 'Synth 1 bar 2', exact: true })).toHaveCount(0);
  await expect(cell('C3', 1)).toHaveAttribute('aria-pressed', 'true');
  expect((await stored(page)).synths[0].pattern.steps).toHaveLength(16);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(lane.getByLabel('Synth 1 bars', { exact: true })).toHaveValue('2');
  expect((await stored(page)).synths[0].pattern.steps[20]).toMatchObject({ active: true, note: 'E3' });

  // A one-bar lane loops against the two-bar drums: the lane's lone note is in every bar of the export.
  await lane.getByLabel('Synth 1 bars', { exact: true }).selectOption('1');
  expect(seconds(await exportWav(page, 'Loop WAV', testInfo.outputPath('mixed-loop.wav'))), 'the drums still make it two bars').toBeCloseTo(2, 3);
  expect(errors).toEqual([]);
});
