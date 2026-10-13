import { expect, test, type Page } from '@playwright/test';

type Step = { active: boolean; note?: string; notes?: string[] };
const GENERAL_MIDI = { kick: 36, snare: 38, openHH: 46, closedHH: 42, ride: 50, crash: 49, snare2: 45, clap: 39 };
const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const kept = (page: Page, key: string) => page.evaluate(name => JSON.parse(localStorage.getItem(name) || 'null'), key);
const emit = (page: Page, device: string, data: number[]) => page.evaluate(([id, bytes]) => (window as unknown as { emitMidi: (id: string, data: number[]) => void }).emitMidi(id as string, bytes as number[]), [device, data] as const);
const played = async (page: Page, lane: number) => ((await stored(page)).synths[lane].pattern.steps as Step[]).filter(step => step.active).flatMap(step => [step.note, ...(step.notes ?? [])]);
const hits = async (page: Page, drum: string) => ((await stored(page)).drumState[drum].steps as boolean[]).filter(Boolean).length;
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
// On a phone the MIDI button is in the top bar's sheet.
const openMidi = async (page: Page) => {
  if (onPhone(page) && !await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'More controls', exact: true }).click();
  await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
};
// A page with these MIDI inputs, each a pair of id and name; emitMidi(id, bytes) plays one.
const start = async (page: Page, inputs: Array<[string, string]>) => {
  await page.addInitScript(list => {
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    const made = list.map(([id, name]) => ({ id, name, state: 'connected', onmidimessage: null as null | ((event: { data: Uint8Array }) => void) }));
    const access = { inputs: new Map(made.map(input => [input.id, input])), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
    (window as unknown as { emitMidi: (id: string, data: number[]) => void }).emitMidi = (id, data) => made.find(input => input.id === id)?.onmidimessage?.({ data: new Uint8Array(data) });
  }, inputs);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
};
const TWO: Array<[string, string]> = [['keys-id', 'Test keys'], ['pads-id', 'Test pads']];
// The song running slowly in record mode, so a note played now is written on a step.
const record = async (page: Page) => {
  await page.getByRole('button', { name: 'record', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('60');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(500);
};
const stop = (page: Page) => page.getByRole('button', { name: /Stop All/ }).click();

test('a drum is given a pad by Learn, which takes the note from the drum that had it, and Reset pads puts the usual notes back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page, TWO);
  await openMidi(page);
  const pads = page.getByRole('list', { name: 'The note each drum\'s pad sends', exact: true }).getByRole('listitem');
  await expect(pads).toHaveText([/^Kick36 \(C2\)/, /^Snare38 \(D2\)/, /^Clap39 \(D#2\)/, /^Closed Hat42 \(F#2\)/, /^Open Hat46 \(A#2\)/, /^Low Tom45 \(A2\)/, /^High Tom50 \(D3\)/, /^Cymbal49 \(C#3\)/]);
  const reset = page.getByRole('button', { name: 'Reset pads', exact: true });
  await expect(reset).toBeDisabled();
  expect(await kept(page, 'discobot_midi_pads_v1')).toBeNull();

  // One Learn waits at a time, a pad's or a knob's.
  const status = page.locator('.midi-pad-status');
  await page.getByRole('button', { name: 'Learn a pad for Clap', exact: true }).click();
  await expect(status).toHaveText('Hit a pad on the controller for Clap.');
  await expect(page.getByRole('button', { name: 'Learn a pad for Kick', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeDisabled();
  // A knob is not a pad, and the pad hit next is the one.
  await emit(page, 'pads-id', [0xb9, 21, 64]);
  await expect(status).toHaveText('Hit a pad on the controller for Clap.');
  await emit(page, 'pads-id', [0x99, 36, 100]);
  await expect(status).toHaveText('');
  await expect(pads.nth(2)).toHaveText(/^Clap36 \(C2\)/);
  await expect(pads.nth(0), 'the kick had that note').toHaveText(/^Kicknone/);
  expect(await kept(page, 'discobot_midi_pads_v1')).toEqual({ ...GENERAL_MIDI, kick: null, clap: 36 });
  expect(await kept(page, 'discobot_midi_ties_v1'), 'the knob was tied to nothing').toBeNull();
  await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeEnabled();

  // Played while the song records, the pad is the clap. Its old note is no drum, and neither is
  // the note beside the kick's, since the kick has none.
  await record(page);
  await emit(page, 'pads-id', [0x99, 36, 100]);
  await emit(page, 'pads-id', [0x99, 39, 100]);
  await emit(page, 'pads-id', [0x99, 35, 100]);
  await stop(page);
  expect(await hits(page, 'clap')).toBe(1);
  expect(await hits(page, 'kick')).toBe(0);
  for (const other of ['snare', 'closedHH', 'openHH', 'snare2', 'ride', 'crash']) expect(await hits(page, other), other).toBe(0);

  // Kept for the next visit. A Learn can be called off; a knob's Learn stops the pads' buttons.
  await page.reload();
  await openMidi(page);
  await expect(pads.nth(2)).toHaveText(/^Clap36 \(C2\)/);
  await page.getByRole('button', { name: 'Learn a pad for Snare', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel learning a pad for Snare', exact: true }).click();
  await emit(page, 'pads-id', [0x99, 60, 100]);
  await expect(pads.nth(1)).toHaveText(/^Snare38 \(D2\)/);
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Learn a pad for Snare', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Learn a pad for Snare', exact: true })).toBeEnabled();

  await reset.click();
  await expect(pads.nth(0)).toHaveText(/^Kick36 \(C2\)/);
  await expect(pads.nth(2)).toHaveText(/^Clap39 \(D#2\)/);
  await expect(reset).toBeDisabled();
  expect(await kept(page, 'discobot_midi_pads_v1')).toEqual(GENERAL_MIDI);
  await record(page);
  await emit(page, 'pads-id', [0x99, 36, 100]);
  await stop(page);
  expect(await hits(page, 'kick'), 'the kick has its note back').toBe(1);
  expect(await hits(page, 'clap')).toBe(1);
  expect(errors).toEqual([]);
});

test('with two devices each is sent somewhere of its own: one to a lane, the other to the drums', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page, TWO);
  await openMidi(page);
  const keys = page.getByLabel('Where Test keys is sent', { exact: true });
  const padsTo = page.getByLabel('Where Test pads is sent', { exact: true });
  await expect(keys).toHaveValue('default');
  await expect(padsTo).toHaveValue('default');
  await expect(keys.locator('option')).toHaveText(['As set above', 'The open lane', 'Synth 1', 'Synth 2', 'Synth 3', 'Drums', 'Off']);

  await keys.selectOption('synth:2');
  await padsTo.selectOption('drums');
  expect(await kept(page, 'discobot_midi_devices_v1')).toEqual({ 'Test keys': 'synth:2', 'Test pads': 'drums' });

  // The keyboard plays Synth 2 on any channel; the lane chosen above hears none of it.
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await emit(page, 'keys-id', [0x94, 60, 100]);
  await expect.poll(() => played(page, 1)).toEqual(['C4']);
  expect(await played(page, 0)).toEqual([]);

  // While the song records: every note from the pads is a pad, whatever its channel, and a note
  // from the keyboard on the pads' channel is still a note for its lane.
  await record(page);
  await emit(page, 'pads-id', [0x90, 38, 100]);
  await emit(page, 'keys-id', [0x99, 36, 100]);
  await stop(page);
  expect(await hits(page, 'snare')).toBe(1);
  expect(await hits(page, 'kick'), 'the keyboard is not pads').toBe(0);
  expect(await played(page, 1)).toContain('C2');
  expect(await played(page, 0)).toEqual([]);
  expect(await played(page, 2)).toEqual([]);

  // Kept for the next visit by the device's name. Off is ignored; back as it was, the device's
  // notes go to the lane chosen above again.
  await page.reload();
  await openMidi(page);
  await expect(keys).toHaveValue('synth:2');
  await expect(padsTo).toHaveValue('drums');
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await padsTo.selectOption('off');
  await emit(page, 'pads-id', [0x90, 62, 100]);
  await keys.selectOption('open');
  await emit(page, 'keys-id', [0x94, 64, 100]);
  await expect.poll(() => played(page, 0)).toEqual(['E4']);
  await padsTo.selectOption('default');
  expect(await kept(page, 'discobot_midi_devices_v1')).toEqual({ 'Test keys': 'open' });
  // Long enough after the last note that this one is not taken for part of its chord.
  await page.waitForTimeout(300);
  await emit(page, 'pads-id', [0x90, 62, 100]);
  await expect.poll(() => played(page, 0)).toEqual(['E4', 'D4']);
  expect(await hits(page, 'snare')).toBe(1);
  expect(errors).toEqual([]);
});

test('one device alone is as it was: no list of devices, its channel for the lane and channel 10 for the drums', async ({ page }) => {
  await start(page, [['only-id', 'Test controller']]);
  await openMidi(page);
  await expect(page.getByRole('list', { name: 'The note each drum\'s pad sends', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Where each MIDI device is sent', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await emit(page, 'only-id', [0x94, 60, 100]);
  await emit(page, 'only-id', [0x99, 36, 100]);
  await emit(page, 'only-id', [0x90, 62, 100]);
  await expect.poll(() => played(page, 0)).toEqual(['D4']);
  expect(await played(page, 1)).toEqual([]);
  expect(await kept(page, 'discobot_midi_devices_v1')).toBeNull();
});
