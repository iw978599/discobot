import { expect, test, type Page } from '@playwright/test';

// Swing templates, spreading hits along a drum, the list of keyboard shortcuts and the colour schemes.

const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 1059 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
async function menu(page: Page, item: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await ready(page);
});

test('a swing template sets the swing and its grid, and the menu says which is set', async ({ page }) => {
  const drums = page.locator('[data-unit="drums"]');
  const template = drums.getByRole('button', { name: 'Swing template', exact: true });
  const swing = drums.getByRole('slider', { name: 'Swing', exact: true });
  await expect(template).toHaveText('Straight ▾');

  await template.click();
  await page.getByRole('menuitem', { name: '16ths 58%', exact: true }).click();
  await expect(swing).toHaveAttribute('aria-valuenow', '0.16');
  await expect(template).toHaveText('16ths 58% ▾');
  await expect.poll(async () => (await stored(page)).drumSwing).toBe(0.16);
  expect('drumSwingGrid' in await stored(page), 'sixteenths store nothing new').toBe(false);

  await template.click();
  await page.getByRole('menuitem', { name: '8ths shuffle', exact: true }).click();
  await expect(template).toHaveText('8ths shuffle ▾');
  await expect.poll(async () => (await stored(page)).drumSwingGrid).toBe(8);

  // Turned by hand, the swing keeps its grid and is no template.
  await page.getByLabel('Swing value', { exact: true }).fill('20%');
  await page.getByLabel('Swing value', { exact: true }).press('Enter');
  await expect(template).toHaveText('8ths, own ▾');

  await page.reload();
  await ready(page);
  await expect(template).toHaveText('8ths, own ▾');
  await expect(swing).toHaveAttribute('aria-valuenow', '0.2');
});

test('Spread puts so many hits along the selected drum, as evenly as the bar allows', async ({ page }) => {
  const drums = page.locator('[data-unit="drums"]');
  await drums.getByRole('button', { name: 'Kick step 3', exact: true }).click();
  await drums.getByRole('button', { name: 'Spread hits along Kick', exact: true }).click();
  await page.getByRole('menuitem', { name: '3 hits', exact: true }).click();
  const on: number[] = [];
  for (let step = 1; step <= 16; step++) {
    if (await drums.getByRole('button', { name: `Kick step ${step}`, exact: true }).getAttribute('aria-pressed') === 'true') on.push(step);
  }
  expect(on, 'three in sixteen, the hit on step 3 gone').toEqual([1, 7, 12]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(drums.getByRole('button', { name: 'Kick step 3', exact: true }), 'one Undo takes the whole spread back').toHaveAttribute('aria-pressed', 'true');
  await expect(drums.getByRole('button', { name: 'Kick step 7', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('Shift + ? shows every shortcut, and a search keeps the ones that match', async ({ page }) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Search shortcuts', { exact: true })).toBeFocused();
  const all = Number((await dialog.getByRole('status').textContent())?.match(/\d+/)?.[0]);
  expect(all).toBeGreaterThan(20);
  await dialog.getByLabel('Search shortcuts', { exact: true }).fill('undo');
  await expect(dialog.getByRole('status')).toHaveText(`1 of ${all} shortcuts`);
  await expect(dialog.locator('.shortcut-row')).toHaveCount(1);
  await expect(dialog.locator('.shortcut-row kbd')).toHaveText(['Ctrl', 'Z']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Help has a way to it too, for a screen with no keyboard.
  await more(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('button', { name: 'Keyboard Shortcuts', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'How to use Discobot', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test('a colour scheme is shown at once, kept in this browser, and Studio is the rack as it was', async ({ page }) => {
  const background = () => page.locator('.rack-page').evaluate(element => getComputedStyle(element).backgroundColor);
  const studio = await background();
  expect(await page.evaluate(() => document.documentElement.dataset.scheme ?? null)).toBe(null);

  await menu(page, 'Colour Scheme');
  const dialog = page.getByRole('dialog', { name: 'Colour Scheme', exact: true });
  await expect(dialog.getByRole('radio', { name: /^Studio/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /^Daylight/ }).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.scheme)).toBe('daylight');
  expect(await background()).toBe('rgb(196, 200, 203)');
  // Each choice's sample is in its own colours, whatever the page is in.
  const sample = (id: string) => dialog.locator(`[data-sample="${id}"] i`).nth(1).evaluate(element => getComputedStyle(element).backgroundColor);
  expect(await sample('studio')).toBe('rgb(255, 176, 0)');
  expect(await sample('midnight')).toBe('rgb(76, 195, 255)');
  await page.keyboard.press('Escape');

  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.dataset.scheme), 'kept after a reload').toBe('daylight');
  expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'))).toBe('#c4c8cb');

  await menu(page, 'Colour Scheme');
  await dialog.getByRole('radio', { name: /^Studio/ }).check();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.scheme ?? null)).toBe(null);
  expect(await background(), 'back to the rack as it was').toBe(studio);
});
