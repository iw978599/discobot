import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const sent = (page: Page) => page.evaluate(() => (window as unknown as { midiSent: Array<{ data: number[]; at?: number }> }).midiSent);
const openMidi = (page: Page) => page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
const closeMidi = (page: Page) => page.getByRole('button', { name: 'Close MIDI and samples', exact: true }).click();

test('the sequencer plays a MIDI output: notes on a channel per lane, drums on ten, and clock', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const log: Array<{ data: number[]; at?: number }> = [];
    (window as unknown as { midiSent: typeof log }).midiSent = log;
    const output = { id: 'test-synth', name: 'Test synth', state: 'connected', send: (data: number[], at?: number) => { log.push({ data: Array.from(data), at }); } };
    const access = { inputs: new Map(), outputs: new Map([[output.id, output]]), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C4 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();

  // Nothing is sent until an output is chosen.
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(await sent(page)).toEqual([]);

  await openMidi(page);
  await expect(page.getByLabel('Send notes to MIDI output', { exact: true })).toBeDisabled();
  await page.getByLabel('MIDI output device', { exact: true }).selectOption('test-synth');
  await expect(page.getByLabel('Send notes to MIDI output', { exact: true })).toBeChecked();
  await closeMidi(page);
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Stop All/ }).click();
  let log = await sent(page);
  const on = (channel: number, note: number) => log.filter(message => message.data[0] === (0x90 | (channel - 1)) && message.data[1] === note);
  expect(on(1, 60).length, 'the lane\'s C4 on channel 1').toBeGreaterThan(0);
  expect(on(10, 36).length, 'the kick on channel 10').toBeGreaterThan(0);
  expect(log.some(message => message.data[0] === 0x80 && message.data[1] === 60), 'with its note-off').toBe(true);
  expect(on(1, 60)[0].at, 'time-stamped, not sent late').toBeGreaterThan(0);
  expect(log.some(message => message.data[0] === 0xf8 || message.data[0] === 0xfa), 'no clock unless asked').toBe(false);
  expect(log.some(message => message.data[0] === 0xb0 && message.data[1] === 123), 'stopping silences the device').toBe(true);

  // With clock on: a start, 24 pulses to a quarter note, and a stop.
  await page.evaluate(() => { (window as unknown as { midiSent: unknown[] }).midiSent.length = 0; });
  await openMidi(page);
  await page.getByLabel('Send clock to MIDI output', { exact: true }).check();
  await page.getByLabel('Send notes to MIDI output', { exact: true }).uncheck();
  await closeMidi(page);
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: /Stop All/ }).click();
  log = await sent(page);
  const kinds = log.map(message => message.data[0]);
  expect(kinds[0], 'start comes first').toBe(0xfa);
  expect(kinds.filter(kind => kind === 0xfa).length).toBe(1);
  expect(kinds[kinds.length - 1], 'stop comes last').toBe(0xfc);
  const pulses = log.filter(message => message.data[0] === 0xf8).map(message => message.at!);
  expect(pulses.length).toBeGreaterThan(24);
  // 120 BPM: a quarter note is 500 ms, so 24 pulses apart is 500 ms.
  expect(Math.abs(pulses[24] - pulses[0] - 500), 'pulses are evenly spaced').toBeLessThan(2);
  expect(kinds.some(kind => (kind & 0xf0) === 0x90), 'notes are off').toBe(false);
  expect(errors).toEqual([]);
});

test('a MIDI file of several bars imports at its full length', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  const lane = page.locator('.synth-module').first();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C4 step 1', exact: true }).click();
  await lane.getByLabel('Synth 1 bars', { exact: true }).selectOption('2');
  await page.getByRole('region', { name: 'Drums module', exact: true }).getByLabel('Drum bars', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  const before = await stored(page);
  expect(before.synths[0].pattern.steps.length).toBe(32);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export MIDI', exact: true }).click();
  const path = testInfo.outputPath('two-bars.mid');
  await (await download).saveAs(path);

  // Back to one empty bar, then bring the file in.
  await lane.getByLabel('Synth 1 bars', { exact: true }).selectOption('1');
  await page.getByRole('region', { name: 'Drums module', exact: true }).getByLabel('Drum bars', { exact: true }).selectOption('1');
  await page.locator('input[type="file"][accept=".mid,.midi"]').setInputFiles({ name: 'two-bars.mid', mimeType: 'audio/midi', buffer: await readFile(path) });
  const dialog = page.getByRole('dialog', { name: 'Import MIDI', exact: true });
  await expect(dialog).toContainText('Length: 2 bars');
  await dialog.getByRole('button', { name: 'Apply All', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(lane.getByLabel('Synth 1 bars', { exact: true })).toHaveValue('2');
  const after = await stored(page);
  expect(after.synths[0].pattern.bars).toBe(2);
  expect(after.synths[0].pattern.steps.map((step: { active: boolean }) => step.active)).toEqual(before.synths[0].pattern.steps.map((step: { active: boolean }) => step.active));
  expect(after.drumState.kick.steps).toEqual(before.drumState.kick.steps);
  expect(after.drumState.kick.steps.length).toBe(32);
});
