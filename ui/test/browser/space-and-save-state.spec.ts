import { expect, test, type Page } from '@playwright/test';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide
// screen; `less` puts it away again after something that leaves it up.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
const less = async (page: Page) => {
  if (await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close more controls', exact: true }).click();
};

const PASSWORD = 'correct horse battery';
const apiUrl = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}`;
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
const narrow = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 720;
const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

async function setTempo(page: Page, bpm: number) {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill(String(bpm));
  await page.locator('.tempo-led-input').press('Enter');
}

// The word beside the project's name. On a phone it is not on the bar, which is full, but in the
// Projects dialog, so the check opens that and waits there.
async function expectWord(page: Page, text: string | RegExp) {
  if (!narrow(page)) {
    const word = page.locator('.transport .save-state');
    await expect(word).toHaveAttribute('role', 'status');
    await expect(word).toContainText(text);
    return;
  }
  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  const word = dialog.locator('.save-state');
  await expect(word).toHaveAttribute('role', 'status');
  await expect(word).toContainText(text);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await ready(page);
});

test('Space plays and stops, and leaves a focused button, a field and a dialog to themselves', async ({ page }) => {
  const play = page.getByRole('button', { name: /Play All/ });
  await expect(play).toHaveAttribute('title', /Space/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Stop All/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();

  // A focused button is pressed by Space and nothing else happens.
  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await more(page);
  await mute.focus();
  await page.keyboard.press('Space');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
  await less(page);

  // A field keeps the key.
  await page.locator('.tempo-led').click();
  const field = page.locator('.tempo-led-input');
  await field.press('Space');
  await expect(field).toBeFocused();
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
  await field.press('Escape');

  // A dialog keeps it, even with nothing focused inside it.
  await more(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'How to use Discobot', exact: true });
  await expect(help).toContainText('Space');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  // Back on the page, Space plays again.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Stop All/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
});

test('the letters still play notes while Space plays and stops', async ({ page }) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('KeyA');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Stop All/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
});

test('the project says it is saved, and says so when another tab has taken over', async ({ page, context }) => {
  await expectWord(page, 'Saved in this browser');
  if (narrow(page)) await expect(page.locator('.transport .save-state')).toHaveCount(0);

  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await expect.poll(async () => (await stored(page)).drumState?.kick?.steps?.[0]).toBe(true);
  await expectWord(page, 'Saved in this browser');

  const before = await page.getByRole('button', { name: /Play All/ }).boundingBox();

  const other = await context.newPage();
  await other.goto('./');
  await ready(other);
  await setTempo(other, 150);
  await expect.poll(async () => (await stored(other)).tempo).toBe(150);

  await expectWord(page, 'Not saving: another tab has this project');
  // The bar does not move when the word changes.
  const during = await page.getByRole('button', { name: /Play All/ }).boundingBox();
  expect(during?.x).toBe(before?.x);
  expect(during?.y).toBe(before?.y);

  await page.getByRole('alert').filter({ hasText: 'changed in another tab' }).getByRole('button', { name: "Keep this tab's version", exact: true }).click();
  await expectWord(page, 'Saved in this browser');
});

test('signed in, the word tells the account from this browser only', async ({ page }) => {
  test.setTimeout(90_000);
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await more(page);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  await account.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await account.getByLabel('Username', { exact: true }).fill('Ian');
  await account.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await account.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await account.getByLabel('Invite code', { exact: true }).press('Enter');
  await account.getByRole('checkbox').check();
  await account.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(account.getByRole('group', { name: 'Projects not in your account', exact: true })).toContainText('1 project is only in this browser');
  await page.keyboard.press('Escape');
  await expect(account).toHaveCount(0);

  // The project that was here before signing in is not the account's.
  await expectWord(page, 'Saved in this browser only, not in your account');

  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  const list = page.getByRole('dialog', { name: 'Projects', exact: true });
  await list.getByRole('button', { name: 'Add to Account', exact: true }).click();
  await expect(list.getByRole('group', { name: 'Project Untitled', exact: true })).toContainText('In your account');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expectWord(page, 'Saved and in your account');

  // An edit is saved here first, and reaches the account a moment later.
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  await expect.poll(async () => (await stored(page)).drumState?.snare?.steps?.[4]).toBe(true);
  await expectWord(page, 'Saved and in your account');
});
