import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const ties = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('discobot_midi_ties_v1') || '[]'));
const emit = (page: Page, data: number[]) => page.evaluate(bytes => (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi(bytes), data);
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
// On a phone the MIDI button is in the top bar's sheet.
const openMidi = async (page: Page) => {
  if (onPhone(page) && !await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'More controls', exact: true }).click();
  await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    const input = { id: 'test-controller', name: 'Test controller', state: 'connected', onmidimessage: null as null | ((event: { data: Uint8Array }) => void) };
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
    (window as unknown as { emitMidi: (data: number[]) => void }).emitMidi = data => input.onmidimessage?.({ data: new Uint8Array(data) });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
});

test('a knob on a controller is tied to a parameter by Learn, moves it over its whole range, and can be untied', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openMidi(page);
  await page.getByLabel('MIDI input device').selectOption('test-controller');
  const parameter = page.getByLabel('Parameter to tie to a knob', { exact: true });
  await expect(parameter).toHaveValue('lane:open:cutoff');
  const tied = page.getByRole('list', { name: 'Knobs tied to parameters', exact: true });
  await expect(tied).toHaveCount(0);

  // An untied knob does nothing.
  const before = (await stored(page)).synths[0].synthParams.filter.frequency;
  await emit(page, [0xb0, 21, 0]);
  expect((await stored(page)).synths[0].synthParams.filter.frequency).toBe(before);

  // Learn, then the first knob turned is the one.
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.locator('.midi-learn-status')).toContainText('Turn a knob on the controller for The open lane: Cutoff');
  await emit(page, [0xb0, 21, 64]);
  await expect(tied.getByRole('listitem')).toHaveText([/Knob 21 on channel 1.*The open lane: Cutoff/]);
  await expect(page.locator('.midi-learn-status')).toHaveText('');
  expect(await ties(page)).toEqual([{ channel: 1, controller: 21, target: 'lane:open:cutoff' }]);

  // The knob's whole travel is the parameter's whole range, on the lane that is open.
  await emit(page, [0xb0, 21, 127]);
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.filter.frequency).toBe(20000);
  await emit(page, [0xb0, 21, 0]);
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.filter.frequency).toBe(20);
  expect((await stored(page)).synths[1].synthParams.filter.frequency, 'only the open lane').toBe(before);
  // Another knob, and the same knob on another channel, are not it.
  await emit(page, [0xb0, 22, 127]);
  await emit(page, [0xb1, 21, 127]);
  expect((await stored(page)).synths[0].synthParams.filter.frequency).toBe(20);

  // A second tie, to an effect, and both are kept for the next visit.
  await parameter.selectOption('fx:delay.feedback');
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await emit(page, [0xb0, 22, 0]);
  await expect(tied.getByRole('listitem')).toHaveCount(2);
  await emit(page, [0xb0, 22, 127]);
  await expect.poll(async () => (await stored(page)).effectsLoop.delay.feedback).toBeCloseTo(0.95, 2);
  await page.keyboard.press('Escape');
  await page.reload();
  await openMidi(page);
  await page.getByLabel('MIDI input device').selectOption('test-controller');
  await expect(page.getByRole('list', { name: 'Knobs tied to parameters', exact: true }).getByRole('listitem')).toHaveCount(2);

  // Untied, the knob does nothing again.
  await page.getByRole('button', { name: 'Untie The open lane: Cutoff', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Knobs tied to parameters', exact: true }).getByRole('listitem')).toHaveCount(1);
  await emit(page, [0xb0, 21, 127]);
  expect((await stored(page)).synths[0].synthParams.filter.frequency).toBe(20);

  // Learn can be called off.
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await emit(page, [0xb0, 40, 10]);
  expect(await ties(page)).toHaveLength(1);
  expect(errors).toEqual([]);
});
