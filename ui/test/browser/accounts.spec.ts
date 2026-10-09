import { expect, test, type Page } from '@playwright/test';

const SESSION_KEY = 'discobot_session_v1';
const PASSWORD = 'correct horse battery';
const apiUrl = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}`;

async function openAccount(page: Page) {
  await page.getByRole('button', { name: /^(Sign in|Account: .+)$/ }).click();
  return page.getByRole('dialog', { name: 'Account', exact: true });
}

async function keepRecoveryCode(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Account', exact: true });
  const shown = dialog.getByLabel('Your new recovery code', { exact: true });
  await expect(shown).toHaveText(/^(\w{5}-){4}\w{5}$/);
  const code = (await shown.textContent()) || '';
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog, 'the code cannot be dismissed by accident').toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  return code;
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the owner creates an account, invites a friend, and both can get back in', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const apiRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith(apiUrl(baseURL))) apiRequests.push(new URL(request.url()).pathname); });

  let dialog = await openAccount(page);
  await expect(dialog).toContainText('No email address, no name');
  expect(apiRequests, 'looking at the sign-in form contacts nobody').toEqual([]);

  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill('password123');
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByRole('button', { name: 'Create Account', exact: true }).last().click();
  await expect(dialog.getByRole('alert')).toContainText('too easy to guess');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Password', { exact: true }).press('Enter');
  const ownerCode = await keepRecoveryCode(page);

  await expect(dialog).toContainText('Signed in as Ian');
  await expect(page.getByRole('button', { name: 'Account: Ian', exact: true })).toBeVisible();
  const stored = await page.evaluate(key => localStorage.getItem(key) || '', SESSION_KEY);
  expect(stored, 'the browser keeps a session token, never the password or the recovery code').not.toContain(PASSWORD);
  expect(stored).not.toContain(ownerCode);

  await dialog.getByRole('button', { name: 'New Invite Code', exact: true }).click();
  const inviteRow = dialog.getByRole('group', { name: /^Invite / });
  await expect(inviteRow).toContainText('Not used yet');
  const invite = (await inviteRow.locator('strong').textContent()) || '';
  expect(invite).toMatch(/^(\w{5}-){2}\w{5}$/);

  // A friend, in a browser of their own.
  const friendContext = await browser.newContext({ baseURL });
  const friend = await friendContext.newPage();
  await friend.goto('./');
  const friendDialog = await openAccount(friend);
  await friendDialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await friendDialog.getByLabel('Username', { exact: true }).fill('ian');
  await friendDialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await friendDialog.getByLabel('Invite code', { exact: true }).fill(invite);
  await friendDialog.getByLabel('Invite code', { exact: true }).press('Enter');
  await expect(friendDialog.getByRole('alert')).toContainText('taken');
  await friendDialog.getByLabel('Username', { exact: true }).fill('Disco_Dana');
  await friendDialog.getByLabel('Invite code', { exact: true }).press('Enter');
  const friendCode = await keepRecoveryCode(friend);
  await expect(friendDialog).toContainText('Signed in as Disco_Dana');
  await expect(friendDialog.getByRole('button', { name: 'New Invite Code', exact: true }), 'members cannot make invites').toHaveCount(0);

  // The friend forgets the password and uses the recovery code.
  await friendDialog.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await friendDialog.getByLabel('Username', { exact: true }).fill('disco_dana');
  await friendDialog.getByLabel('Password', { exact: true }).fill('not the right password');
  await friendDialog.getByLabel('Password', { exact: true }).press('Enter');
  await expect(friendDialog.getByRole('alert')).toContainText('username or password is not right');
  await friendDialog.getByRole('tab', { name: 'Forgot Password', exact: true }).click();
  await friendDialog.getByLabel('Recovery code', { exact: true }).fill(friendCode.toLowerCase());
  await friendDialog.getByLabel('New password', { exact: true }).fill('a brand new passphrase');
  await friendDialog.getByLabel('New password', { exact: true }).press('Enter');
  expect(await keepRecoveryCode(friend), 'recovering hands out a fresh code').not.toBe(friendCode);
  await expect(friendDialog).toContainText('Signed in as Disco_Dana');
  await friend.reload();
  await expect(friend.getByRole('button', { name: 'Account: Disco_Dana', exact: true }), 'a reload stays signed in').toBeVisible();

  // The owner sees the invite was used, then removes the friend.
  await page.keyboard.press('Escape');
  dialog = await openAccount(page);
  await expect(dialog.getByRole('group', { name: /^Invite / })).toContainText('by Disco_Dana');
  page.once('dialog', confirm => { void confirm.accept(); });
  await dialog.getByRole('group', { name: 'Member Disco_Dana', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog.getByRole('group', { name: 'Member Disco_Dana', exact: true })).toHaveCount(0);
  await openAccount(friend);
  await expect(friend.getByRole('button', { name: 'Sign in', exact: true }), 'a removed account is signed out the next time it is checked').toBeVisible();
  await friendContext.close();

  // Change password, then delete the account.
  await dialog.getByRole('button', { name: 'Change Password', exact: true }).click();
  await dialog.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('New password', { exact: true }).fill('a much longer password');
  await dialog.getByLabel('New password', { exact: true }).press('Enter');
  await expect(dialog.getByRole('status')).toContainText('Password changed');
  await dialog.getByRole('button', { name: 'Delete Account', exact: true }).click();
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Delete My Account', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('password is not right');
  await dialog.getByLabel('Password', { exact: true }).fill('a much longer password');
  await dialog.getByRole('button', { name: 'Delete My Account', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Sign In', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), SESSION_KEY)).toBeNull();
  await expect(page.getByRole('button', { name: /^Project: / }), 'the projects in this browser are untouched').toBeVisible();
});

test('a signed-out visit never contacts the account server, and the app works when it is down', async ({ page }, testInfo) => {
  const api = apiUrl(String(testInfo.project.use.baseURL));
  const apiRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith(api)) apiRequests.push(request.url()); });
  await page.reload();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(apiRequests).toEqual([]);

  await page.route(`${api}/**`, route => route.abort());
  const dialog = await openAccount(page);
  await dialog.getByLabel('Username', { exact: true }).fill('ian');
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Password', { exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('could not be reached');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
