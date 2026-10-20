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

async function openAccount(page: Page) {
  await more(page);
  await page.getByRole('button', { name: /^(Sign in|Account: .+)$/ }).click();
  return page.getByRole('dialog', { name: 'Account', exact: true });
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
async function newProject(page: Page, name: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();
  const dialog = await projects(page);
  await dialog.getByRole('group').filter({ hasText: 'Open now' }).getByRole('button', { name: 'Rename', exact: true }).click();
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  await dialog.getByLabel('Project name', { exact: true }).press('Enter');
  // On a phone this button is in the top bar's sheet, which cannot be raised from under a dialog.
  if (!onPhone(page)) await expect(page.getByRole('button', { name: `Project: ${name}`, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
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

test('projects follow the account to a second browser, and edits and conflicts are handled', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();

  // Sign up. The project that was already here is not uploaded.
  let dialog = await openAccount(page);
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Projects not in your account', exact: true })).toContainText('1 project is only in this browser');
  await expect(dialog.getByRole('group', { name: 'Project sync', exact: true })).toContainText('0 in your account');
  await page.keyboard.press('Escape');

  let list = await projects(page);
  await expect(list.getByRole('group', { name: 'Project Untitled', exact: true })).toContainText('This browser only');
  await list.getByRole('button', { name: 'Add to Account', exact: true }).click();
  await expect(list.getByRole('group', { name: 'Project Untitled', exact: true })).toContainText('In your account');
  await page.keyboard.press('Escape');

  // A project made while signed in is uploaded without being asked.
  await newProject(page, 'Night Drive');
  await setTempo(page, '133');
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  await syncNow(page);

  // The same account in another browser.
  const phoneContext = await browser.newContext({ baseURL });
  const phone = await phoneContext.newPage();
  await phone.goto('./');
  await ready(phone);
  const phoneDialog = await openAccount(phone);
  await phoneDialog.getByLabel('Username', { exact: true }).fill('ian');
  await phoneDialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await phoneDialog.getByLabel('Password', { exact: true }).press('Enter');
  await expect(phoneDialog.getByRole('group', { name: 'Project sync', exact: true })).toContainText('2 in your account');
  await phone.keyboard.press('Escape');
  let phoneList = await projects(phone);
  // The account's Untitled arrived beside the phone's own as "Untitled 2": another project, with a row of its own.
  await expect(phoneList.getByRole('group')).toHaveCount(3);
  await expect(phoneList.getByRole('group', { name: 'Project Untitled 2', exact: true })).toHaveCount(1);
  await phoneList.getByRole('group', { name: 'Project Night Drive', exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(phone.locator('.tempo-led-value')).toHaveText('133');
  await expect(phone.getByRole('button', { name: 'Snare step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // An edit on the phone arrives in the project the first browser has open.
  await setTempo(phone, '90');
  await syncNow(phone);
  await syncNow(page);
  await expect(page.locator('.tempo-led-value')).toHaveText('90');
  await expect(page.locator('.app-alert')).toHaveCount(0);

  // Both edit before either syncs: both versions are kept.
  await setTempo(page, '100');
  await setTempo(phone, '150');
  await syncNow(page);
  await syncNow(phone);
  await expect(phone.getByRole('alert')).toContainText('also changed in another browser');
  await expect(phone.locator('.tempo-led-value'), 'the phone keeps what it was editing').toHaveText('150');
  await more(phone);
  await expect(phone.getByRole('button', { name: 'Project: Night Drive (this browser\'s version)', exact: true })).toBeVisible();
  await less(phone);
  await phone.getByRole('button', { name: 'Dismiss sync message', exact: true }).click();
  // Both versions are in the one row; the phone's own is open, so the account's is chosen from the list.
  phoneList = await projects(phone);
  const kept = phoneList.getByRole('group', { name: 'Project Night Drive', exact: true });
  await expect(kept.getByLabel('Version of Night Drive', { exact: true })).toHaveValue('Night Drive (this browser\'s version)');
  await kept.getByLabel('Version of Night Drive', { exact: true }).selectOption('Night Drive');
  await kept.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(phone.locator('.tempo-led-value')).toHaveText('100');

  // Deleting on the phone removes it from the account and from the first browser.
  phoneList = await projects(phone);
  await phoneList.getByRole('group', { name: 'Project Night Drive', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(phone.getByRole('dialog', { name: 'Delete this project?', exact: true })).toContainText('"Night Drive" from this browser and from your account');
  await phone.getByRole('dialog', { name: 'Delete this project?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(phoneList.getByRole('group', { name: 'Project Night Drive', exact: true })).toHaveCount(0);
  await phone.keyboard.press('Escape');
  await syncNow(phone);
  await syncNow(page);
  list = await projects(page);
  await expect(list.getByRole('group', { name: 'Project Night Drive', exact: true })).toHaveCount(0);
  await expect(list.getByRole('group', { name: 'Project Night Drive (this browser\'s version)', exact: true }), 'the copy kept from the conflict arrived too').toContainText('In your account');
  await page.keyboard.press('Escape');

  // Signing out leaves every project where it is.
  dialog = await openAccount(page);
  await dialog.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await page.keyboard.press('Escape');
  list = await projects(page);
  await expect(list.getByRole('group')).toHaveCount(2);
  await expect(list).not.toContainText('In your account');
  await phoneContext.close();
});

test('edits upload on their own a few seconds after they stop, and sync survives the server being away', async ({ page }, testInfo) => {
  const api = apiUrl(String(testInfo.project.use.baseURL));
  const dialog = await openAccount(page);
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Them All', exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Project sync', exact: true })).toContainText('1 in your account');
  await page.keyboard.press('Escape');

  const uploaded = page.waitForRequest(request => request.method() === 'PUT' && request.url().startsWith(`${api}/projects/`), { timeout: 15_000 });
  await setTempo(page, '77');
  expect((await uploaded).postDataJSON().project.project.tempo).toBe(77);

  await page.route(`${api}/**`, route => route.abort());
  await setTempo(page, '66');
  const offline = await openAccount(page);
  await offline.getByRole('button', { name: 'Sync Now', exact: true }).click();
  await expect(offline.getByRole('group', { name: 'Project sync', exact: true })).toContainText('Not synced');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tempo-led-value'), 'the app carries on').toHaveText('66');

  await page.unroute(`${api}/**`);
  const caughtUp = page.waitForRequest(request => request.method() === 'PUT' && request.url().startsWith(`${api}/projects/`), { timeout: 15_000 });
  await syncNow(page);
  expect((await caughtUp).postDataJSON().project.project.tempo).toBe(66);
});
