import { expect, test, type Locator, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
// Which steps of Synth 1 hold which note, as "step:note", counted from 1.
const laneNotes = async (page: Page) => ((await stored(page)).synths[0].pattern.steps as Array<{ active: boolean; note?: string }>)
  .flatMap((step, index) => (step.active ? [`${index + 1}:${step.note}`] : []));
const drumSteps = async (page: Page, drum: string) => ((await stored(page)).drumState[drum].steps as boolean[]).flatMap((on, index) => (on ? [index + 1] : []));

async function copyBar(unit: Locator, item: string) {
  await unit.getByRole('button', { name: /^Copy bar/ }).click();
  await unit.getByRole('menuitem', { name: item, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeAttached();
});

test('a bar of a lane is copied over another, or over every other, and Undo takes it back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.locator('.synth-module').first();
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });
  const bar = (number: number) => lane.getByRole('button', { name: `Synth 1 bar ${number}`, exact: true });
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();

  // A pattern of one bar has nowhere to copy to.
  await expect(lane.getByRole('button', { name: /^Copy bar/ })).toHaveCount(0);
  await lane.getByLabel('Synth 1 bars', { exact: true }).selectOption('4');
  await cell('C3', 1).click();
  await cell('E3', 5).click();
  await expect.poll(() => laneNotes(page)).toEqual(['1:C3', '5:E3']);

  // The menu offers every other bar, and all of them at once.
  await lane.getByRole('button', { name: /^Copy bar/ }).click();
  await expect(lane.getByRole('menuitem')).toHaveText(['To bar 2', 'To bar 3', 'To bar 4', 'To every bar']);
  await lane.getByRole('menuitem', { name: 'To bar 3', exact: true }).click();
  await expect.poll(() => laneNotes(page)).toEqual(['1:C3', '5:E3', '33:C3', '37:E3']);
  await bar(3).click();
  await expect(cell('C3', 33)).toHaveAttribute('aria-pressed', 'true');

  // One Undo takes the whole bar back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => laneNotes(page)).toEqual(['1:C3', '5:E3']);

  // The bar on show is the one that is copied, and it replaces what the others had.
  await expect(bar(3)).toHaveAttribute('aria-pressed', 'true');
  await cell('G3', 35).click();
  await copyBar(lane, 'To every bar');
  await expect.poll(() => laneNotes(page)).toEqual(['3:G3', '19:G3', '35:G3', '51:G3']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => laneNotes(page)).toEqual(['1:C3', '5:E3', '35:G3']);
  expect(errors).toEqual([]);
});

test('a bar of the drum grid is copied with every drum in it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const drumsUnit = page.getByRole('region', { name: 'Drums module', exact: true });
  await expect(drumsUnit.getByRole('button', { name: /^Copy bar/ })).toHaveCount(0);

  // Two bars alike, then a snare and one more kick in the second only.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await drumsUnit.getByLabel('Drum bars', { exact: true }).selectOption('2');
  await drumsUnit.getByRole('button', { name: 'Drum bar 2', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 21', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 27', exact: true }).click();
  await expect.poll(() => drumSteps(page, 'kick')).toEqual([1, 17, 27]);

  // With two bars there is one place to copy to.
  await drumsUnit.getByRole('button', { name: /^Copy bar/ }).click();
  await expect(drumsUnit.getByRole('menuitem')).toHaveText(['To bar 1']);
  await drumsUnit.getByRole('menuitem', { name: 'To bar 1', exact: true }).click();
  await expect.poll(() => drumSteps(page, 'kick')).toEqual([1, 11, 17, 27]);
  expect(await drumSteps(page, 'snare')).toEqual([5, 21]);
  await drumsUnit.getByRole('button', { name: 'Drum bar 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => drumSteps(page, 'kick')).toEqual([1, 17, 27]);
  expect(await drumSteps(page, 'snare')).toEqual([21]);
  expect(errors).toEqual([]);
});
