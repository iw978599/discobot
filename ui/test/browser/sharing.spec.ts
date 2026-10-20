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
const seen = () => {
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  localStorage.setItem('discobot_walkthrough_v1', 'seen');
};

async function openAccount(page: Page) {
  await more(page);
  await page.getByRole('button', { name: /^(Sign in|Account: .+)$/ }).click();
  return page.getByRole('dialog', { name: 'Account', exact: true });
}
async function signUp(page: Page, username: string, invite: string) {
  const dialog = await openAccount(page);
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill(username);
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Invite code', { exact: true }).fill(invite);
  await dialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toContainText(`Signed in as ${username}`);
  return dialog;
}
async function syncNow(page: Page) {
  const dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Sync Now', exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Project sync', exact: true })).toContainText('Up to date');
  await page.keyboard.press('Escape');
}
async function projects(page: Page) {
  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  return page.getByRole('dialog', { name: 'Projects', exact: true });
}
async function setTempo(page: Page, bpm: string) {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill(bpm);
  await page.locator('.tempo-led-input').press('Enter');
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(seen);
  await page.goto('./');
  await ready(page);
});

test('two people work on one project together or in turns, and it ends when the owner says so', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Ian owns the site and invites Dana.
  const account = await signUp(page, 'Ian', 'browser-test-owner');
  await account.getByRole('button', { name: 'New Invite Code', exact: true }).click();
  const invite = (await account.getByRole('group', { name: /^Invite / }).locator('strong').textContent()) || '';
  await page.keyboard.press('Escape');
  const danaContext = await browser.newContext({ baseURL });
  const dana = await danaContext.newPage();
  await dana.addInitScript(seen);
  await dana.goto('./');
  await ready(dana);
  await signUp(dana, 'Dana', invite);
  await dana.keyboard.press('Escape');

  // Ian makes a song and shares it. A username nobody has is refused, and says so.
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();
  let list = await projects(page);
  await list.getByRole('group').filter({ hasText: 'Open now' }).getByRole('button', { name: 'Rename', exact: true }).click();
  await list.getByLabel('Project name', { exact: true }).fill('Night Drive');
  await list.getByLabel('Project name', { exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await setTempo(page, '133');
  await syncNow(page);
  list = await projects(page);
  const mine = list.getByRole('group', { name: 'Project Night Drive', exact: true });
  await mine.getByRole('button', { name: 'Share', exact: true }).click();
  const sharing = list.getByRole('group', { name: 'Share Night Drive', exact: true });
  await expect(sharing).toContainText('Not shared with anyone yet');
  await expect(sharing).toContainText('both versions are kept');
  await sharing.getByLabel('Username to share with', { exact: true }).fill('nobody-here');
  await sharing.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sharing.getByRole('alert')).toContainText('No account has that username');
  await sharing.getByLabel('Username to share with', { exact: true }).fill('dana');
  await sharing.getByLabel('Username to share with', { exact: true }).press('Enter');
  await expect(sharing.getByRole('group', { name: 'Shared with Dana', exact: true })).toBeVisible();
  await expect(mine).toContainText('Shared with 1');
  await page.keyboard.press('Escape');
  // Ian's browser learns from the account that the project is shared, and opens its live session.
  await syncNow(page);

  // Dana is offered it. It is not in her browser until she opens it.
  await syncNow(dana);
  let hers = await projects(dana);
  await expect(hers.getByRole('group', { name: 'Project Night Drive', exact: true })).toHaveCount(0);
  const offer = hers.getByRole('group', { name: 'Shared project Night Drive', exact: true });
  await expect(offer).toContainText('From Ian');
  await offer.getByRole('button', { name: 'Open', exact: true }).click();
  await more(dana);
  await expect(dana.getByRole('button', { name: 'Project: Night Drive', exact: true })).toBeVisible();
  await less(dana);
  await expect(dana.locator('.tempo-led-value')).toHaveText('133');
  hers = await projects(dana);
  await expect(hers.getByRole('group', { name: 'Project Night Drive', exact: true })).toContainText('Shared by Ian');
  await expect(hers.getByRole('group', { name: 'Shared project Night Drive', exact: true })).toHaveCount(0);
  await expect(hers.getByRole('group', { name: 'Project Night Drive', exact: true }).getByRole('button', { name: 'Share', exact: true }), 'it is not hers to share on').toHaveCount(0);
  await dana.keyboard.press('Escape');

  // Both have it open, so they are in a live session: an edit reaches the other at once, with no sync.
  await setTempo(dana, '90');
  await expect(page.locator('.tempo-led-value')).toHaveText('90', { timeout: 10_000 });
  await setTempo(page, '95');
  await expect(dana.locator('.tempo-led-value')).toHaveText('95', { timeout: 10_000 });
  // Dana presses Play and the music plays for Ian too: at once if his browser has its audio on, or
  // when he presses Play himself, which listens along rather than starting it over. His Stop stops both.
  await dana.locator('.play-all-button').click();
  await expect(dana.locator('.play-all-button')).toHaveClass(/playing/);
  const listen = page.getByRole('status').filter({ hasText: 'Dana is playing in this live session' });
  await expect(page.locator('.play-all-button.playing').or(listen).first()).toBeVisible({ timeout: 10_000 });
  if (await listen.isVisible()) await page.locator('.play-all-button').click();
  await expect(page.locator('.play-all-button')).toHaveClass(/playing/, { timeout: 10_000 });
  await expect(listen).toHaveCount(0);
  await page.locator('.play-all-button').click();
  await expect(dana.locator('.play-all-button')).not.toHaveClass(/playing/, { timeout: 10_000 });
  await expect(page.locator('.play-all-button')).not.toHaveClass(/playing/);
  // Ian was there first, so his browser saves it, and nothing is kept twice.
  await syncNow(dana);
  await syncNow(page);
  list = await projects(page);
  await expect(list.getByRole('group', { name: 'Project Night Drive', exact: true })).not.toContainText('Last saved by Dana');
  await expect(list.getByRole('group', { name: /this browser's version/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Ian moves to another project, and Dana takes a turn alone. Ian's browser gets it and says whose save it was.
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();
  await setTempo(dana, '100');
  await syncNow(dana);
  await syncNow(page);
  await expect(page.getByRole('status').filter({ hasText: 'Dana saved “Night Drive”' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss sharing message', exact: true }).click();
  list = await projects(dana);
  await expect(list.getByRole('group', { name: /this browser's version/ }), 'her turn did not split the project').toHaveCount(0);
  await dana.keyboard.press('Escape');
  list = await projects(page);
  await expect(list.getByRole('group', { name: 'Project Night Drive', exact: true })).toContainText('Last saved by Dana');

  // Ian opens it again and joins Dana in the session. Then he stops sharing, and Dana keeps her copy as her own.
  await list.getByRole('group', { name: 'Project Night Drive', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.tempo-led-value')).toHaveText('100');
  await setTempo(page, '110');
  await expect(dana.locator('.tempo-led-value')).toHaveText('110', { timeout: 10_000 });
  list = await projects(page);
  await list.getByRole('group', { name: 'Project Night Drive', exact: true }).getByRole('button', { name: 'Share', exact: true }).click();
  await list.getByRole('group', { name: 'Shared with Dana', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(list.getByRole('group', { name: 'Share Night Drive', exact: true })).toContainText('Not shared with anyone yet');
  await page.keyboard.press('Escape');
  await syncNow(dana);
  await expect(dana.getByRole('status').filter({ hasText: 'no longer shared with you' })).toBeVisible();
  hers = await projects(dana);
  await expect(hers.getByRole('group', { name: 'Project Night Drive', exact: true })).toContainText('This browser only');
  await expect(dana.locator('.tempo-led-value'), 'her copy is still open').toHaveText('110');

  expect(errors).toEqual([]);
  await danaContext.close();
});
