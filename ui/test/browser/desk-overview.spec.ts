import { expect, test, type Page } from '@playwright/test';

// The desk's overview grid (docs/DESK_LAYOUT_PLAN.md, stage 3): every track's pattern for the open scene
// in a row beside its header, editable. Wide screens only; stage 5 does the phone.

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the overview is the wide arrangement; stage 5 covers phones');
});

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

async function open(page: Page, layout: 'desk' | 'rack' = 'desk') {
  await page.addInitScript((choice) => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    localStorage.setItem('discobot_layout_v1', choice);
  }, layout);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
}

const cell = (page: Page, name: string) => page.getByRole('button', { name: `Overview ${name}`, exact: true });
const unit = (page: Page, name: string) => page.locator(`[data-unit="${name}"]`);
const noteAt = async (page: Page, lane: number, step: number) => (await stored(page)).synths[lane].pattern.steps[step].note;

test('a click on a lane cell adds a step and a second click takes it away', async ({ page }) => {
  await open(page);
  const step = cell(page, 'Synth 2 step 5');
  await expect(step).toHaveAttribute('aria-pressed', 'false');
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => noteAt(page, 1, 4)).toBeTruthy();
  await expect(unit(page, 'synth-2'), 'the track is shown in the dock').toBeVisible();
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => noteAt(page, 1, 4)).toBeFalsy();
});

test('Shift+click selects a lane step without changing it', async ({ page }) => {
  await open(page);
  await cell(page, 'Synth 2 step 5').click({ modifiers: ['Shift'] });
  await expect(cell(page, 'Synth 2 step 5')).toHaveAttribute('aria-pressed', 'false');
  await expect(unit(page, 'synth-2').getByLabel('Step 5 note length', { exact: true }), 'the step controls of the lane name that step').toBeVisible();
  expect(await noteAt(page, 1, 4)).toBeFalsy();
  await expect(cell(page, 'Synth 2 step 5')).toHaveClass(/selected/);
});

test('the drums fold open into their rows, and a drum cell edits or selects like the drum grid', async ({ page }) => {
  await open(page);
  const fold = page.getByRole('button', { name: 'Drum rows', exact: true });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(cell(page, 'Kick step 5'), 'folded, there is one line').toHaveCount(0);
  await expect(cell(page, 'Drums step 5')).toBeVisible();
  await cell(page, 'Drums step 5').click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  expect((await stored(page)).drumState.kick.steps[4], 'opening the fold changes nothing').toBeFalsy();
  await expect(cell(page, 'Kick step 5')).toBeVisible();
  await expect(cell(page, 'Closed Hat step 5')).toBeVisible();

  await cell(page, 'Kick step 5').click();
  await expect(cell(page, 'Kick step 5')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stored(page)).drumState.kick.steps[4]).toBe(true);
  await expect(cell(page, 'Drums step 5'), 'the combined line is shown only while folded').toHaveCount(0);

  await cell(page, 'Kick step 9').click({ modifiers: ['Shift'] });
  expect((await stored(page)).drumState.kick.steps[8], 'Shift+click adds no hit').toBeFalsy();
  await cell(page, 'Kick step 5').click({ modifiers: ['Shift'] });
  expect((await stored(page)).drumState.kick.steps[4], 'and keeps a hit').toBe(true);
  await expect(page.getByRole('region', { name: 'Drums module', exact: true }).getByText('Step 5', { exact: true }), 'the drum controls in the dock name the step').toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Drum rows', exact: true }), 'the fold is kept').toHaveAttribute('aria-expanded', 'true');
});

test('a lane shorter than the scene repeats, faded, and a repeat edits the step it repeats', async ({ page }) => {
  await open(page);
  await page.getByLabel('Synth 1 bars', { exact: true }).selectOption('2');
  const repeat = cell(page, 'Synth 2 step 5 repeat 2');
  await expect(repeat).toBeVisible();
  await expect(repeat).toHaveClass(/ghost/);
  await expect(cell(page, 'Synth 1 step 5'), 'the two-bar lane has no repeats').toBeVisible();
  await expect(page.getByRole('button', { name: /^Overview Synth 1 step \d+ repeat/ })).toHaveCount(0);
  await repeat.click();
  await expect(cell(page, 'Synth 2 step 5')).toHaveAttribute('aria-pressed', 'true');
  await expect(repeat).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => noteAt(page, 1, 4)).toBeTruthy();
});

test('each row is one Tab stop, the arrows walk it, and Enter edits', async ({ page }) => {
  await open(page);
  const row = page.getByRole('group', { name: 'Overview Synth 2', exact: true });
  await expect(row.locator('.desk-cell[tabindex="0"]')).toHaveCount(1);
  await cell(page, 'Synth 2 step 1').focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 'Synth 2 step 2')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Synth 2 step 2')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('group', { name: 'Overview Synth 3', exact: true }).locator('.desk-cell:focus')).toHaveCount(1);
  await page.keyboard.press('Shift+Enter');
  expect(await noteAt(page, 2, 1), 'Shift+Enter only selects').toBeFalsy();
});

test('the playing step is lit on the overview', async ({ page }) => {
  await open(page);
  await expect(page.locator('.desk-cell.now'), 'nothing is lit before playing').toHaveCount(0);
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect.poll(() => page.locator('.desk-cells .desk-cell.now').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.desk-cell.now')).toHaveCount(0);
});

test('with the desk off there is no overview', async ({ page }) => {
  await open(page, 'rack');
  await expect(page.locator('.desk-cell, .desk-grid, .desk-ruler')).toHaveCount(0);
});

test('a drum\'s automation shows in the overview: a mark on the folded line and a strip under the open drum', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Show Drums in the dock', exact: true }).click();
  const drums = unit(page, 'drums');
  await drums.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await drums.getByLabel('Snare automation parameter', { exact: true }).selectOption('tune');
  await drums.getByRole('slider', { name: 'Snare Tune automation, step 3', exact: true }).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await stored(page)).drumState.snare.stepAutomation?.tune?.[2]).toBe(1);

  // Folded, the step is marked on the one line; the steps without automation are not.
  await expect(cell(page, 'Drums step 3')).toHaveClass(/\bauto\b/);
  await expect(cell(page, 'Drums step 4')).not.toHaveClass(/\bauto\b/);

  // Open, the Snare has a strip for its tune, with a bar on step 3 alone; the Kick has none.
  await page.getByRole('button', { name: 'Drum rows', exact: true }).click();
  const strip = page.getByRole('button', { name: 'Snare Tune automation, 1 of 16 steps set. Show it in the dock', exact: true });
  await expect(strip).toBeVisible();
  await expect(strip.locator('i.set')).toHaveCount(1);
  await expect(strip.locator('i').nth(2)).toHaveClass(/\bset\b/);
  await expect(page.getByRole('button', { name: /^Kick .* automation, / })).toHaveCount(0);

  // Pressing it shows the drums in the dock, and clearing the automation takes the strip away.
  await strip.click();
  await expect(drums).toBeVisible();
  await drums.getByRole('button', { name: 'Clear this automation', exact: true }).click();
  await expect(strip).toHaveCount(0);
});
