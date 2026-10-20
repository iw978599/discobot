import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const songPlate = (page: Page) => page.locator('[data-unit="song"] .song-row .rack-plate');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a scene can play at a tempo of its own: kept, counted in the song\'s length, and given back to the song\'s when emptied', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const tempo = page.getByLabel('Tempo of the open scene', { exact: true });
  await expect(tempo).toHaveValue('');
  await expect(tempo).toHaveAttribute('placeholder', '120');
  await expect(songPlate(page)).toContainText('1 bar · 0:02');

  // Half the tempo: the one bar of 4/4 takes twice as long.
  await tempo.fill('60');
  await tempo.press('Enter');
  await expect.poll(async () => (await stored(page)).scenes[0].tempo).toBe(60);
  await expect(songPlate(page)).toContainText('1 bar · 0:04');
  expect((await stored(page)).tempo, 'the song\'s own tempo is left as it was').toBe(120);

  await page.reload();
  await expect(page.getByLabel('Tempo of the open scene', { exact: true })).toHaveValue('60');

  // Emptied, the scene plays at the song's tempo again.
  await page.getByLabel('Tempo of the open scene', { exact: true }).fill('');
  await page.getByLabel('Tempo of the open scene', { exact: true }).press('Enter');
  await expect.poll(async () => 'tempo' in (await stored(page)).scenes[0]).toBe(false);
  await expect(songPlate(page)).toContainText('1 bar · 0:02');
  expect(errors).toEqual([]);
});
