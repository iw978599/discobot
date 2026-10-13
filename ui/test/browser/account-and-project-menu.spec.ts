import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const apiUrl = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}`;
const narrow = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 720;

// "Red" without naming the shade, so the colours can be renamed or tuned without this test.
const isReddish = async (locator: Locator) => {
  const [r, g, b] = (await locator.evaluate(element => getComputedStyle(element).color)).match(/\d+(\.\d+)?/g)!.map(Number);
  return r > 180 && r > g + 60 && r > b + 60;
};

// The menu's rows in order, with a bar where a line is drawn between groups.
const rows = (menu: Locator) => menu.evaluate(list => [...list.children].map(child => child.getAttribute('role') === 'separator' ? '|' : (child.textContent || '').trim()));

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the Project menu is in three groups with Reset All apart, and Export is a dialog of two choices', async ({ page }) => {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Project', exact: true });
  await expect(menu.getByRole('menuitem')).toHaveCount(11);
  expect(await rows(menu)).toEqual([
    'New Project', 'All Projects', 'Save a Copy', 'Version History',
    '|', 'Share Link', 'Export Project', 'Import Project', 'Import MIDI',
    '|', 'Add Guest Instrument', 'Kids Mode',
    '|', 'Reset All',
  ]);
  expect(await isReddish(menu.getByRole('menuitem', { name: 'Reset All', exact: true }))).toBe(true);
  expect(await isReddish(menu.getByRole('menuitem', { name: 'New Project', exact: true }))).toBe(false);

  // A phone has no hover, so each row's explanation is its second line; a desktop keeps it as a hint.
  const hint = await menu.getByRole('menuitem', { name: 'Version History', exact: true }).evaluate(item => ({
    title: item.getAttribute('title'), line: getComputedStyle(item, '::after').content,
  }));
  expect(hint.title).toBeTruthy();
  expect(hint.line).toBe(narrow(page) ? `"${hint.title}"` : 'none');

  // Tab walks the rows and passes the lines without stopping on them.
  await menu.getByRole('menuitem', { name: 'Version History', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('menuitem', { name: 'Share Link', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Project ▾', exact: true })).toBeFocused();

  // Export is a dialog of two choices: what, and as what.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exports = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(exports.getByRole('group', { name: 'What', exact: true }).getByRole('radio')).toHaveCount(2);
  await expect(exports.getByRole('group', { name: 'As', exact: true }).getByRole('radio')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(exports).toHaveCount(0);
});

test('a menu row still does its job from its group', async ({ page }) => {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'All Projects', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Projects', exact: true })).toBeVisible();
});

test('the signed-in account dialog has no amber Sign Out, owner tools under their own heading, Delete Account last in red', async ({ page }) => {
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Account', exact: true });
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();

  const owner = dialog.getByRole('region', { name: 'Owner tools', exact: true });
  await expect(owner).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Invite codes', exact: true })).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  await expect(owner).toContainText('Only you, as the owner');

  await expect(dialog.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
  await expect(dialog.locator('.rack-btn.go'), 'no amber main button when signed in').toHaveCount(0);

  const del = dialog.getByRole('button', { name: 'Delete Account', exact: true });
  expect(await isReddish(del)).toBe(true);
  const ownerBox = await owner.boundingBox(), delBox = await del.boundingBox();
  expect(delBox!.y, 'Delete Account is below the owner tools').toBeGreaterThan(ownerBox!.y + ownerBox!.height - 1);
  // Nothing else follows it in the dialog.
  expect(await dialog.getByRole('button').last().evaluate(button => button.textContent)).toBe('Delete Account');

  await del.click();
  await expect(dialog.getByRole('button', { name: 'Delete My Account', exact: true })).toBeVisible();
});
