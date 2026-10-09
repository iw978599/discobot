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

test('a note is stretched by dragging its end, and can start between steps', async ({ page }, testInfo) => {
  const lane = page.locator('.synth-module').first();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });
  const centre = async (note: string, step: number) => { const box = (await cell(note, step).boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };

  await cell('C3', 1).click();
  await cell('E3', 1).click();
  const handle = cell('C3', 1).locator('.piano-roll-resize');
  await expect(handle).toBeVisible();

  // Dragging is a mouse gesture here; touch has the Note length menu, checked below.
  if (testInfo.project.name === 'chromium') {
    const from = (await handle.boundingBox())!, to = await centre('C3', 4);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await expect(lane.getByLabel('Step 1 note length', { exact: true })).toHaveValue('4');
    for (const note of ['C3', 'E3']) await expect(cell(note, 4), 'the whole chord is stretched').toHaveClass(/held/);
    await expect(cell('C3', 1), 'stretching did not paint or erase anything').toHaveAttribute('aria-pressed', 'true');
    await expect(cell('C3', 4), 'the handle moves to the new end').toHaveCount(1);
    await expect(cell('C3', 4).locator('.piano-roll-resize')).toBeVisible();

    // And back again, from the new end.
    const end = (await cell('C3', 4).locator('.piano-roll-resize').boundingBox())!, back = await centre('C3', 2);
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
    await page.mouse.down();
    await page.mouse.move(back.x, back.y, { steps: 10 });
    await page.mouse.up();
    await expect(lane.getByLabel('Step 1 note length', { exact: true })).toHaveValue('2');
    await expect(cell('C3', 3)).not.toHaveClass(/held/);
    expect((await stored(page)).synths[0].pattern.steps[0]).toMatchObject({ note: 'C3', notes: ['E3'], length: 2 });
  }

  // Alt+click starts a note halfway to the next step.
  await cell('G3', 5).click({ modifiers: ['Alt'] });
  await expect(cell('G3', 5)).toHaveClass(/late/);
  await expect(lane.getByLabel('Step 5 timing', { exact: true })).toHaveValue('0.5');
  expect((await stored(page)).synths[0].pattern.steps[4]).toMatchObject({ active: true, note: 'G3', offset: 0.5 });

  // The step's own controls: timing, chance, repeats.
  await lane.getByLabel('Step 5 timing', { exact: true }).selectOption({ label: '¼ step late' });
  await lane.getByLabel('Step 5 chance', { exact: true }).fill('0.5');
  await lane.getByLabel('Step 5 repeats', { exact: true }).selectOption('3');
  await expect(lane.getByRole('button', { name: 'Select step 5 G3', exact: true })).toHaveClass(/chance/);
  await expect(lane.getByRole('button', { name: 'Select step 5 G3', exact: true })).toContainText('×3');
  expect((await stored(page)).synths[0].pattern.steps[4]).toMatchObject({ note: 'G3', offset: 0.25, probability: 0.5, ratchet: 3 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect('ratchet' in (await stored(page)).synths[0].pattern.steps[4], 'undo takes back the last change').toBe(false);
  // Undo can drop the selection; pick the step again if so.
  if (!(await lane.getByLabel('Step 5 timing', { exact: true }).isVisible())) await lane.getByRole('button', { name: 'Select step 5 G3', exact: true }).click();

  await lane.getByLabel('Step 5 timing', { exact: true }).selectOption({ label: 'On the step' });
  await expect(cell('G3', 5)).not.toHaveClass(/late/);
  expect('offset' in (await stored(page)).synths[0].pattern.steps[4]).toBe(false);

  await page.reload();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await lane.getByRole('button', { name: 'Select step 5 G3', exact: true }).click();
  await expect(lane.getByLabel('Step 5 chance', { exact: true })).toHaveValue('0.5');

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);
});

test('the delay can follow the tempo', async ({ page }) => {
  const sync = page.getByLabel('Delay sync', { exact: true });
  await expect(sync).toHaveValue('off');
  await sync.selectOption('1/8d');
  expect((await stored(page)).effectsLoop.delay.sync).toBe('1/8d');
  await expect(page.getByLabel('Time value', { exact: true }).first(), 'the Time knob shows the note value').toHaveValue('1/8d');
  await page.reload();
  await expect(page.getByLabel('Delay sync', { exact: true })).toHaveValue('1/8d');
  await page.getByLabel('Delay sync', { exact: true }).selectOption('off');
  expect('sync' in (await stored(page)).effectsLoop.delay).toBe(false);
});
