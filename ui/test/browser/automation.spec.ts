import { expect, test, type Locator, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
// Synth 1's automation of one parameter as stored, or null for none.
const values = async (page: Page, key = 'cutoff'): Promise<Array<number | null> | null> => (await stored(page)).synths[0].pattern.automation?.[key] ?? null;
const set = (list: Array<number | null> | null) => (list ?? []).flatMap((value, index) => (value === null ? [] : [index + 1]));

const lane = (page: Page) => page.getByRole('region', { name: 'Synth 1 module', exact: true });
const cell = (page: Page, step: number, label = 'Cutoff') => lane(page).getByRole('slider', { name: `${label} automation, step ${step}`, exact: true });
const step = (page: Page, number: number) => lane(page).getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) });
const choose = (page: Page, key: string) => lane(page).getByLabel('Synth 1 automation parameter', { exact: true }).selectOption(key);

// A stroke across the strip with the pointer, from low in one step's bar to high in another's.
async function stroke(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const start = (await from.boundingBox())!, end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height * 0.1, { steps: 12 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
});

test('a sweep drawn under the steps is stored, undone, kept over a reload, cleared, and reached from the keyboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(lane(page).getByRole('button', { name: 'Record automation', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(lane(page).getByRole('slider', { name: /automation, step/ }), 'nothing to draw on until a parameter is chosen').toHaveCount(0);
  await choose(page, 'cutoff');
  await expect(lane(page).getByRole('slider', { name: /^Cutoff automation, step/ })).toHaveCount(16);

  // Every bar stands under its step, at either width.
  for (let number = 1; number <= 16; number++) {
    const bar = (await cell(page, number).boundingBox())!, above = (await step(page, number).boundingBox())!;
    expect(Math.abs(bar.x - above.x), `step ${number} lines up`).toBeLessThan(1.5);
    expect(Math.abs(bar.width - above.width), `step ${number} is as wide`).toBeLessThan(1.5);
    expect(bar.y, `step ${number} is under its step`).toBeGreaterThan(above.y);
  }

  await stroke(page, cell(page, 1), cell(page, 8));
  await expect.poll(async () => set(await values(page))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  const sweep = (await values(page))!;
  expect(sweep[7]!, 'it rises along the stroke').toBeGreaterThan(sweep[0]! * 4);
  expect((await stored(page)).scenes[0].laneAutomation?.[1]?.cutoff ?? sweep, 'kept in the scene with the steps').toEqual(sweep);
  await expect(lane(page).locator('.rack-knobs .knob-automated'), 'the lane\'s cutoff knob says it is automated').toHaveCount(1);
  await expect(lane(page).getByRole('slider', { name: 'Synth 1 cutoff', exact: true })).toHaveAttribute('aria-valuetext', /automated/);

  // The whole stroke is one undo step.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => values(page)).toBeNull();
  await expect(lane(page).locator('.knob-automated')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => values(page)).toEqual(sweep);

  await page.reload();
  await expect(cell(page, 8), 'after a reload the automated parameter is on show by itself').toHaveAttribute('aria-valuenow', String(sweep[7]));
  expect(await values(page)).toEqual(sweep);

  // The keyboard: up and down change a step, Home and End are the range's ends, Delete takes it away,
  // left and right move along the steps.
  await cell(page, 12).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await values(page))![11]).toBe(20000);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await values(page))![11]).toBeLessThan(20000);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await values(page))![11]).toBe(20);
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 13)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cell(page, 12)).toBeFocused();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await values(page))![11]).toBeNull();
  await expect(cell(page, 12)).toHaveAttribute('aria-valuetext', /^No value/);

  // Erase rubs out what is drawn across; Clear takes the parameter's automation away, and Undo brings it back.
  await lane(page).getByRole('button', { name: 'Erase automation steps', exact: true }).click();
  await stroke(page, cell(page, 1), cell(page, 2));
  await expect.poll(async () => set(await values(page))).toEqual([3, 4, 5, 6, 7, 8]);
  await lane(page).getByRole('button', { name: 'Clear this automation', exact: true }).click();
  await expect.poll(() => values(page)).toBeNull();
  await expect(lane(page).getByRole('button', { name: 'Clear this automation', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => set(await values(page))).toEqual([3, 4, 5, 6, 7, 8]);
  expect(errors).toEqual([]);
});

test('more bars, a bar copied and finer steps carry the automation with the steps', async ({ page }) => {
  await choose(page, 'level');
  await cell(page, 1, 'Level').focus();
  await page.keyboard.press('End');
  await cell(page, 5, 'Level').focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => set(await values(page, 'level'))).toEqual([1, 5]);

  await lane(page).getByLabel('Synth 1 bars', { exact: true }).selectOption('2');
  await expect.poll(async () => set(await values(page, 'level')), 'a longer pattern repeats it').toEqual([1, 5, 17, 21]);
  await lane(page).getByRole('button', { name: 'Synth 1 bar 2', exact: true }).click();
  await expect(cell(page, 17, 'Level')).toHaveAttribute('aria-valuenow', '2');
  for (const number of [17, 21]) { await cell(page, number, 'Level').focus(); await page.keyboard.press('Delete'); }
  await expect.poll(async () => set(await values(page, 'level'))).toEqual([1, 5]);

  await lane(page).getByRole('button', { name: 'Synth 1 bar 1', exact: true }).click();
  await lane(page).getByRole('button', { name: /^Copy bar/ }).click();
  await lane(page).getByRole('menuitem', { name: 'To bar 2', exact: true }).click();
  await expect.poll(async () => set(await values(page, 'level')), 'a bar copied brings its automation').toEqual([1, 5, 17, 21]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => set(await values(page, 'level'))).toEqual([1, 5]);

  await lane(page).getByLabel('Synth 1 bars', { exact: true }).selectOption('1');
  await expect.poll(async () => (await values(page, 'level'))?.length).toBe(16);
  await lane(page).getByLabel('Sequence length', { exact: true }).selectOption('32');
  await expect.poll(async () => set(await values(page, 'level')), 'each bar keeps its values from its start').toEqual([1, 5]);
  expect((await values(page, 'level'))!.length).toBe(32);
});

test('with Auto on, a knob turned while the song plays is written along the pattern as one undo step, and the sound is left alone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const auto = lane(page).getByRole('button', { name: 'Record automation', exact: true });
  const knob = lane(page).getByLabel('Synth 1 cutoff value', { exact: true });
  const turn = async (value: string) => { await knob.fill(value); await knob.press('Enter'); };
  // A slow tempo: a step lasts a quarter of a second.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('60');
  await page.locator('.tempo-led-input').press('Enter');

  // Stopped, Auto writes nothing: the knob changes the sound.
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await turn('3000');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.filter.frequency).toBe(3000);
  expect(await values(page)).toBeNull();

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(600);
  await turn('5000');
  await expect.poll(async () => set(await values(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  await turn('800');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Stop All/ }).click();

  const pass = (await values(page))!;
  const written = pass.filter((value): value is number => value !== null);
  expect(written.length, `several steps are written: ${pass}`).toBeGreaterThanOrEqual(4);
  expect(written).toContain(5000);
  expect(written).toContain(800);
  expect((await stored(page)).synths[0].synthParams.filter.frequency, 'the sound itself keeps its own cutoff').toBe(3000);
  await expect(lane(page).getByLabel('Synth 1 automation parameter', { exact: true })).toHaveValue('cutoff');

  // The whole pass is one undo step, and it leaves the sound as it was.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => values(page)).toBeNull();
  expect((await stored(page)).synths[0].synthParams.filter.frequency).toBe(3000);

  // Auto off: a knob turned while playing changes the sound as it always did.
  await auto.click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(400);
  await turn('1200');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.filter.frequency).toBe(1200);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(await values(page)).toBeNull();
  expect(errors).toEqual([]);
});
