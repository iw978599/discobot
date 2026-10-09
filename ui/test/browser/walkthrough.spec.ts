import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const SEEN_KEY = 'discobot_walkthrough_v1';
const apiUrl = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}`;

// Each stop's title, and the first thing it lights up.
const STOPS = [
  ['Play and tempo', '.tempo-display-group'],
  ['Scenes and song', '.song-module'],
  ['A lane\'s steps', '.synth-module[aria-label="Synth 1 module"] .step-row'],
  ['The sound editor', '.synth-controls-panel'],
  ['The drum grid', '.drum-grid'],
  ['Effects', '.effects-unit'],
  ['Project and Export', '.transport .rack-menu'],
  ['Your account', '.account-button'],
  ['Help', '.transport [aria-label="Help"]'],
] as const;

const accountDialog = (page: Page) => page.getByRole('dialog', { name: 'Account', exact: true });
const tourCard = (page: Page) => page.getByRole('dialog', { name: 'Walkthrough', exact: true });

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a new account is walked round the rack once, and the walkthrough can be seen again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const dialog = accountDialog(page), tour = tourCard(page), spot = page.locator('.tour-spot');
  const account = page.getByRole('button', { name: 'Account: Ian', exact: true });
  const view = page.viewportSize()!;

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await expect(tour, 'not before the recovery code has been kept').toHaveCount(0);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();

  // The account dialog gives way to the walkthrough.
  await expect(dialog).toHaveCount(0);
  await expect(tour).toBeVisible();
  await expect(tour.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), SEEN_KEY), 'this browser has now had it').not.toBeNull();

  // Every stop: the card and the part it is about are both on screen, and the card is not over that part's corner.
  for (const [index, [title, target]] of STOPS.entries()) {
    await expect(tour.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(tour).toContainText(`Step ${index + 1} of ${STOPS.length}`);
    await expect(tour.getByRole('button', { name: index === STOPS.length - 1 ? 'Done' : 'Next', exact: true }), 'the way on has the keyboard').toBeFocused();
    const card = (await tour.boundingBox())!, lit = (await spot.boundingBox())!, part = (await page.locator(target).first().boundingBox())!;
    expect(card.x, title).toBeGreaterThanOrEqual(0);
    expect(card.y, title).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width, title).toBeLessThanOrEqual(view.width + 1);
    expect(card.y + card.height, title).toBeLessThanOrEqual(view.height + 1);
    expect(part.x, title).toBeGreaterThanOrEqual(0);
    expect(part.x, title).toBeLessThan(view.width);
    expect(part.y, title).toBeGreaterThanOrEqual(0);
    expect(part.y, title).toBeLessThan(view.height);
    expect(Math.abs(lit.x - part.x), `${title}: the light is on its part`).toBeLessThan(8);
    expect(part.x >= card.x && part.x < card.x + card.width && part.y >= card.y && part.y < card.y + card.height, `${title}: the card does not cover it`).toBe(false);
    if (index === STOPS.length - 1) break;
    // By the button and by the keyboard, turn about.
    if (index % 2 === 0) await tour.getByRole('button', { name: 'Next', exact: true }).click();
    else await page.keyboard.press('ArrowRight');
  }
  await expect(tour.getByRole('button', { name: 'Skip', exact: true }), 'nothing left to skip').toHaveCount(0);

  // Back works, Tab stays on the card, and nothing under the shade can be pressed.
  await page.keyboard.press('ArrowLeft');
  await expect(tour.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  for (let presses = 0; presses < 5; presses++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="Walkthrough"]') !== null)).toBe(true);
  }
  await page.mouse.click(view.width / 2, 20);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await tour.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(tour).toHaveCount(0);
  await expect(spot).toHaveCount(0);
  await expect(account, 'the keyboard goes back where it was').toBeFocused();

  // It can be seen again from the account, and left with Skip or Escape.
  await account.click();
  await expect(dialog).toContainText('Signed in as Ian');
  await dialog.getByRole('button', { name: 'Show the Walkthrough', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tour.getByRole('heading', { name: 'Play and tempo', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(tour).toHaveCount(0);
  await account.click();
  await dialog.getByRole('button', { name: 'Show the Walkthrough', exact: true }).click();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);

  // A recovery code that does not come from a new account is not followed by it, even in a browser that never had it.
  await page.evaluate(key => localStorage.removeItem(key), SEEN_KEY);
  await account.click();
  await dialog.getByRole('button', { name: 'New Recovery Code', exact: true }).click();
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Show New Code', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toContainText('Signed in as Ian');
  await expect(tour).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a browser that has had the walkthrough is not shown it for a second account', async ({ page }) => {
  await page.evaluate(key => localStorage.setItem(key, 'seen'), SEEN_KEY);
  const dialog = accountDialog(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toContainText('Signed in as Ian');
  await expect(tourCard(page)).toHaveCount(0);
});
