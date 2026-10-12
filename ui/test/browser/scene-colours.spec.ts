import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const song = (page: Page) => page.locator('.song-module');
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });
const picker = (page: Page) => song(page).getByLabel('Colour of the open scene', { exact: true });
const block = (page: Page, number: number, name: string) => song(page).getByRole('group', { name: `Song block ${number}: ${name}`, exact: true });
const band = (page: Page, name: string) => scene(page, name).evaluate(element => getComputedStyle(element).borderLeftColor);

test('a scene has a colour, shown on its chip and on its blocks in the song, and it is kept', async ({ page }) => {
  await expect(scene(page, 'Scene 1'), 'the scene a project starts with has no colour').not.toHaveAttribute('data-color');
  await expect(picker(page)).toHaveValue('');

  // A new scene comes with a colour of its own, so the song's shape can be read at once.
  await song(page).getByRole('button', { name: '+ Copy', exact: true }).click();
  await expect(scene(page, 'Scene 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(scene(page, 'Scene 2')).toHaveAttribute('data-color', 'red');
  await expect(picker(page)).toHaveValue('red');
  expect(await band(page, 'Scene 2'), 'the band is drawn in that colour').toBe('rgb(239, 68, 68)');
  await expect(scene(page, 'Scene 2'), 'the open scene is still lit').toHaveCSS('background-color', 'rgb(255, 176, 0)');

  await picker(page).selectOption('blue');
  await expect(scene(page, 'Scene 2')).toHaveAttribute('data-color', 'blue');
  await song(page).getByRole('button', { name: '+ Add Scene 2', exact: true }).click();
  await expect(block(page, 2, 'Scene 2')).toHaveAttribute('data-color', 'blue');
  await expect(block(page, 1, 'Scene 1')).not.toHaveAttribute('data-color');

  // The other scene can be given one too, and switching scenes does not lose either.
  await scene(page, 'Scene 1').click();
  await expect(picker(page)).toHaveValue('');
  await picker(page).selectOption('green');
  await expect(block(page, 1, 'Scene 1')).toHaveAttribute('data-color', 'green');
  await scene(page, 'Scene 2').click();
  await expect(picker(page)).toHaveValue('blue');

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expect(scene(page, 'Scene 1')).toHaveAttribute('data-color', 'green');
  await expect(scene(page, 'Scene 2')).toHaveAttribute('data-color', 'blue');

  await picker(page).selectOption('');
  await expect(scene(page, 'Scene 2'), 'None takes the colour away').not.toHaveAttribute('data-color');
});
