import { expect, test, type Locator, type Page } from '@playwright/test';

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
async function signUp(page: Page, username: string, invite: string, opened?: Locator) {
  const dialog = opened ?? await openAccount(page);
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
async function liveSetup(page: Page) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start Live Session', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'More controls', exact: true })).toHaveCount(0);
  return page.getByRole('dialog', { name: 'Start Live Session', exact: true });
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

test('live setup explains sign-in, returns from Account and restores menu focus', async ({ page }) => {
  const setup = await liveSetup(page);
  await expect(setup).toContainText('Untitled');
  await expect(setup).toContainText('Everyone needs an account');
  await expect(setup.getByLabel('Username to share with', { exact: true })).toHaveCount(0);
  await setup.getByRole('button', { name: 'Sign In', exact: true }).click();
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  await expect(account).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(account).toHaveCount(0);
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Sign In', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole('button', { name: onPhone(page) ? 'More controls' : 'Project ▾', exact: true })).toBeFocused();
  await liveSetup(page);
  await setup.getByRole('button', { name: 'Sign In', exact: true }).click();
  await signUp(page, 'Host', 'browser-test-owner', account);
  await page.keyboard.press('Escape');
  await expect(setup.getByRole('button', { name: 'Account', exact: true })).toBeFocused();
  await expect(setup.getByRole('button', { name: 'Add to Account and Continue', exact: true })).toBeVisible();
});

test('live setup explains a browser without WebSocket support without offering upload or invitations', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'WebSocket', { configurable: true, value: undefined }); });
  await page.reload();
  await ready(page);
  const setup = await liveSetup(page);
  await expect(setup).toContainText('WebSocket connections are not supported');
  await expect(setup.getByRole('button', { name: 'Sign In', exact: true })).toHaveCount(0);
  await expect(setup.getByLabel('Username to share with', { exact: true })).toHaveCount(0);
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
  let list = await projects(page);
  await list.getByRole('group').filter({ hasText: 'Open now' }).getByRole('button', { name: 'Rename', exact: true }).click();
  await list.getByLabel('Project name', { exact: true }).fill('Night Drive');
  await list.getByLabel('Project name', { exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await setTempo(page, '133');
  let refuseLive = true;
  let connections = 0;
  await page.routeWebSocket(/\/live\//, socket => {
    connections++;
    if (refuseLive) socket.close();
    else socket.connectToServer();
  });
  let setup = await liveSetup(page);
  await expect(setup).toContainText('Night Drive');
  await expect(setup).toContainText('First save this project to your account');
  const projectsUrl = `${apiUrl(baseURL)}/projects`;
  await page.route(projectsUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable.' }) }));
  await setup.getByRole('button', { name: 'Add to Account and Continue', exact: true }).click();
  await expect(setup.getByRole('alert')).toBeVisible();
  await expect(setup.getByLabel('Username to share with', { exact: true })).toHaveCount(0);
  await page.unroute(projectsUrl);
  await setup.getByRole('button', { name: 'Add to Account and Continue', exact: true }).click();
  const sharing = setup.getByRole('group', { name: 'Share Night Drive', exact: true });
  await expect(sharing).toContainText('Not shared with anyone yet');
  await expect(sharing).toContainText('both versions are kept');
  await expect(page.locator('.tempo-led-value'), 'saving to the account preserves current edits').toHaveText('133');
  await sharing.getByLabel('Username to share with', { exact: true }).fill('nobody-here');
  await sharing.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sharing.getByRole('alert')).toContainText('No account has that username');
  await sharing.getByLabel('Username to share with', { exact: true }).fill('dana');
  await sharing.getByLabel('Username to share with', { exact: true }).press('Enter');
  await expect(sharing.getByRole('group', { name: 'Shared with Dana', exact: true })).toBeVisible();
  await expect(setup).toContainText('Shared with you');
  await expect(setup.getByRole('status').first()).toContainText('unavailable or disconnected', { timeout: 10_000 });
  refuseLive = false;
  await setup.getByRole('button', { name: 'Retry Connection', exact: true }).click();
  await expect(setup).toContainText('Waiting for collaborators', { timeout: 10_000 });
  const connected = connections;
  await page.keyboard.press('Escape');
  await expect(page.locator('.live-people')).toContainText('Waiting for collaborators');
  setup = await liveSetup(page);
  await expect(setup.getByRole('group', { name: 'Shared with Dana', exact: true })).toBeVisible();
  await expect(setup).toContainText('Waiting for collaborators');
  expect(connections).toBe(connected);
  await page.keyboard.press('Escape');

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
  // Each sees who else is in the session, and where on the rack they last were.
  await expect(page.locator('.live-people')).toContainText('In this live session with Dana');
  await expect(dana.locator('.live-people')).toContainText('Ian');
  setup = await liveSetup(dana);
  await expect(setup).toContainText('Shared by Ian');
  await expect(setup.getByLabel('Username to share with', { exact: true })).toHaveCount(0);
  await expect(setup.getByRole('status')).toContainText('Ian');
  await dana.keyboard.press('Escape');
  await dana.locator('[data-unit="drums"] button').first().focus();
  await expect(page.locator('.rack [data-unit="drums"]')).toHaveAttribute('data-present-names', 'Dana', { timeout: 10_000 });
  // What the others play is heard here, snapped to the next step while the music plays unless this
  // browser turns that off. It starts on.
  const snap = page.getByRole('button', { name: 'Snap their notes to the beat', exact: true });
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await snap.click();
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
