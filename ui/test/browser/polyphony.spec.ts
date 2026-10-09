import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the piano roll builds chords and long notes, and they are saved, undone and played', async ({ page }, testInfo) => {
  const lane = page.locator('.synth-module').first();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });

  for (const note of ['C3', 'E3', 'G3']) await cell(note, 1).click();
  for (const note of ['C3', 'E3', 'G3']) await expect(cell(note, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(lane.getByRole('button', { name: 'Select step 1 C3 E3 G3', exact: true })).toContainText('C3+2');

  // A different chord on another step leaves the first alone.
  await cell('D3', 5).click();
  await cell('A3', 5).click();
  await expect(lane.getByRole('button', { name: 'Select step 5 D3 A3', exact: true })).toBeVisible();
  await expect(cell('E3', 1)).toHaveAttribute('aria-pressed', 'true');

  // Taking one note out of a chord keeps the rest.
  await cell('E3', 1).click();
  await expect(cell('E3', 1)).toHaveAttribute('aria-pressed', 'false');
  await expect(lane.getByRole('button', { name: 'Select step 1 C3 G3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell('E3', 1)).toHaveAttribute('aria-pressed', 'true');

  // Step 1 lasts four steps: the roll and the step row both show it running on.
  await cell('C3', 1).focus();
  await lane.getByRole('button', { name: 'Select step 1 C3 E3 G3', exact: true }).click();
  await lane.getByRole('button', { name: 'Select step 1 C3 E3 G3', exact: true }).click();
  await expect(lane.getByRole('button', { name: 'Select step 1', exact: true }), 'clicking a selected step still clears it, chord and all').toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await lane.getByRole('button', { name: 'Select step 1 C3 E3 G3', exact: true }).click();
  await lane.getByLabel('Step 1 note length', { exact: true }).selectOption('4');
  await expect(cell('G3', 3)).toHaveClass(/held/);
  await expect(cell('G3', 5)).not.toHaveClass(/held/);
  await expect(lane.getByRole('button', { name: 'Select step 2', exact: true })).toHaveClass(/held/);

  const saved = (await stored(page)).synths[0].pattern.steps;
  expect(saved[0]).toMatchObject({ active: true, note: 'C3', notes: ['E3', 'G3'], length: 4 });
  expect(saved[4]).toMatchObject({ active: true, note: 'D3', notes: ['A3'] });

  await page.reload();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  for (const note of ['C3', 'E3', 'G3']) await expect(cell(note, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell('C3', 4)).toHaveClass(/held/);

  // It plays without errors, and the whole chord reaches the synth.
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);

  // Dragging along a row still paints one note per step. This is a mouse gesture, so desktop only.
  if (testInfo.project.name !== 'chromium') return;
  await cell('C4', 9).scrollIntoViewIfNeeded();
  const from = await cell('C4', 9).boundingBox(), to = await cell('C4', 12).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();
  for (const step of [9, 10, 11, 12]) await expect(cell('C4', step)).toHaveAttribute('aria-pressed', 'true');
});
