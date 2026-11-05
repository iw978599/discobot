import { expect, test, type Page } from '@playwright/test';

// The desk layout on a phone (docs/DESK_LAYOUT_PLAN.md, stage 5): the song as a strip, the tracks as a list and
// the dock as a sheet raised from the bottom, in place of the bar of units. Phone width only; the wide
// arrangement is covered by desk-frame, desk-overview and desk-song.

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'the sheet is the phone arrangement; the wide desk has its own specs');
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

const tracks = (page: Page) => page.getByRole('navigation', { name: 'Tracks', exact: true });
const header = (page: Page, name: string) => tracks(page).getByRole('button', { name: `Show ${name} in the dock`, exact: true });
const cell = (page: Page, name: string) => page.getByRole('button', { name: `Overview ${name}`, exact: true });
const unit = (page: Page, name: string) => page.locator(`[data-unit="${name}"]`);
const sheet = (page: Page) => page.getByRole('tablist', { name: 'Sheet', exact: true });
const noteAt = async (page: Page, lane: number, step: number) => (await stored(page)).synths[lane].pattern.steps[step].note;
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('the track list replaces the bar of units, and nothing scrolls sideways', async ({ page }) => {
  await open(page);
  await expect(page.locator('.unit-bar'), 'the bar of units is not shown').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show Synth 1', exact: true })).toHaveCount(0);
  for (const name of ['Synth 1', 'Synth 2', 'Synth 3', 'Drums']) await expect(header(page, name)).toBeVisible();
  await expect(sheet(page), 'the sheet starts put away').toHaveCount(0);
  for (const name of ['synth-1', 'synth-2', 'synth-3', 'drums', 'mixer', 'effects']) await expect(unit(page, name), `${name} stays mounted`).toBeHidden();
  await expect(unit(page, 'song'), 'the song is the strip under the top bar').toBeVisible();
  expect(await sideways(page)).toBe(true);
});

test('a lane\'s cells wrap eight to a row and are a finger wide', async ({ page }) => {
  await open(page);
  const first = await cell(page, 'Synth 1 step 1').boundingBox();
  const eighth = await cell(page, 'Synth 1 step 8').boundingBox();
  const ninth = await cell(page, 'Synth 1 step 9').boundingBox();
  expect(first && eighth && ninth).toBeTruthy();
  expect(eighth!.y, 'step 8 ends the first row').toBeCloseTo(first!.y, 0);
  expect(ninth!.y, 'step 9 starts the second').toBeGreaterThan(first!.y + 20);
  expect(first!.width).toBeGreaterThanOrEqual(32);
  expect(first!.height).toBeGreaterThanOrEqual(32);
});

test('a tap on a cell adds a step and a second tap takes it away', async ({ page }) => {
  await open(page);
  const step = cell(page, 'Synth 2 step 5');
  await expect(step).toHaveAttribute('aria-pressed', 'false');
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => noteAt(page, 1, 4)).toBeTruthy();
  await expect(sheet(page), 'a cell does not raise the sheet').toHaveCount(0);
  await step.click();
  await expect(step).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => noteAt(page, 1, 4)).toBeFalsy();
});

test('a header raises the sheet with that track, the mixer is a tab, and Escape puts it away', async ({ page }) => {
  await open(page);
  await header(page, 'Synth 2').click();
  await expect(sheet(page)).toBeVisible();
  await expect(unit(page, 'synth-2'), 'the track is on the sheet').toBeVisible();
  await expect(unit(page, 'synth-1'), 'the others are hidden, not taken away').toBeHidden();
  await expect(unit(page, 'synth-1')).toHaveCount(1);
  await expect(sheet(page).getByRole('tab', { selected: true })).toBeFocused();
  expect(await sideways(page)).toBe(true);

  await sheet(page).getByRole('tab', { name: 'Mixer', exact: true }).click();
  await expect(unit(page, 'mixer')).toBeVisible();
  await expect(unit(page, 'synth-2')).toBeHidden();
  expect(await sideways(page), 'the mixer slides inside the sheet').toBe(true);

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(unit(page, 'mixer')).toBeHidden();
  await expect(header(page, 'Synth 2'), 'focus goes back to the header that raised it').toBeFocused();
});

test('Close puts the sheet away and the drums can be raised too', async ({ page }) => {
  await open(page);
  await header(page, 'Drums').click();
  await expect(unit(page, 'drums')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(header(page, 'Drums')).toBeFocused();
});

test('the handle steps the sheet between its sizes, which this browser keeps, and the rows stay reachable at the peek', async ({ page }) => {
  await open(page);
  await header(page, 'Synth 1').click();
  const handle = page.getByRole('separator', { name: 'Sheet height', exact: true });
  await expect(handle).toHaveAttribute('aria-valuetext', 'half');
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(handle).toHaveAttribute('aria-valuetext', 'full');
  expect(await page.evaluate(() => localStorage.getItem('discobot_desk_sheet_v1'))).toBe('full');
  const full = Number(await handle.getAttribute('aria-valuenow'));
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuetext', 'peek');
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(full);
  await cell(page, 'Synth 3 step 1').click({ trial: true });
  await expect(unit(page, 'synth-1')).toBeVisible();
});

test('the Patterns and Song switch is on the phone too, and the song scrolls inside its region', async ({ page }) => {
  await open(page);
  const view = page.getByRole('radiogroup', { name: 'Desk view', exact: true });
  await view.getByRole('radio', { name: 'Song', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Song entries', exact: true })).toBeVisible();
  expect(await sideways(page)).toBe(true);
  await view.getByRole('radio', { name: 'Patterns', exact: true }).click();
  await expect(cell(page, 'Synth 1 step 1')).toBeVisible();
});

test('with the desk off, the phone still has its bar of units', async ({ page }) => {
  await open(page, 'rack');
  await expect(page.locator('.unit-bar')).toBeVisible();
  await expect(tracks(page)).toHaveCount(0);
});
