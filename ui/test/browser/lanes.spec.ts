import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a project starts with three lanes and can have two more, added one at a time', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const id of [1, 2, 3]) await expect(page.getByRole('region', { name: `Synth ${id} module`, exact: true })).toBeVisible();
  const add = page.getByRole('region', { name: 'Add a lane', exact: true });
  await expect(add).toContainText('Synth 4');

  await add.getByRole('button', { name: 'Add Lane +', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Synth 4 module', exact: true })).toBeVisible();
  await expect(add).toContainText('Synth 5');
  await add.getByRole('button', { name: 'Add Lane +', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Synth 5 module', exact: true })).toBeVisible();
  await expect(add, 'five is the most').toHaveCount(0);
  await expect.poll(async () => (await stored(page)).synths.map((lane: { synthId: number }) => lane.synthId).sort()).toEqual([1, 2, 3, 4, 5]);

  // Removed, the fifth lane leaves no empty place: the Add Lane unit offers it again.
  await page.getByRole('button', { name: 'Synth 5', exact: true }).click();
  await page.getByRole('region', { name: 'Synth 5 module', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Synth 5', exact: true })).toHaveCount(0);
  await expect(add).toContainText('Synth 5');
  expect(errors).toEqual([]);
});

test('a lane can be named, and is called by its name until the name is cleared', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 2 module', exact: true });
  await page.getByRole('button', { name: 'Synth 2', exact: true }).click();
  const field = lane.getByLabel('Synth 2 name', { exact: true });
  await field.fill('  Big   bass ');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Big bass', exact: true }), 'the name plate says it').toBeVisible();
  await expect.poll(async () => (await stored(page)).synths.find((entry: { synthId: number }) => entry.synthId === 2).name).toBe('Big bass');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Big bass', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Big bass', exact: true }).click();
  await field.fill('');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Synth 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Big bass', exact: true }), 'one Undo brings the name back').toBeVisible();
  expect(errors).toEqual([]);
});
