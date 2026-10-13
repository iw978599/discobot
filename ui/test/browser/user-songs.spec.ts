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

async function menu(page: Page, item: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function nameOpenProject(page: Page, name: string) {
  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await projects.locator('.rack-list-row.current').getByRole('button', { name: 'Rename', exact: true }).click();
  await projects.getByLabel('Project name', { exact: true }).fill(name);
  await projects.getByLabel('Project name', { exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await more(page);
  await expect(page.getByRole('button', { name: `Project: ${name}`, exact: true })).toBeVisible();
  await less(page);
}

async function publishOpenProject(page: Page) {
  await menu(page, 'Share Link');
  const share = page.getByRole('dialog', { name: 'Share this song', exact: true });
  await share.getByRole('button', { name: 'Publish and Get a Short Link', exact: true }).click();
  await expect(share.getByLabel('Short link', { exact: true })).toHaveValue(/#s=[a-z0-9]{10}$/);
  const own = await share.getByLabel('Your songs page', { exact: true }).inputValue();
  await page.keyboard.press('Escape');
  return own;
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a person\'s page lists the songs they have published, for anyone with its link', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const api = apiUrl(baseURL);

  await more(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const account = page.getByRole('dialog', { name: 'Account', exact: true });
  await account.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await account.getByLabel('Username', { exact: true }).fill('Ian');
  await account.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await account.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await account.getByLabel('Invite code', { exact: true }).press('Enter');
  await account.getByRole('checkbox').check();
  await account.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('Escape');

  await nameOpenProject(page, 'Friday Night');
  const own = await publishOpenProject(page);
  expect(own, 'the link to your own page is where publishing is').toMatch(/\/discobot\/#u=Ian$/);
  await menu(page, 'New Project');
  await more(page);
  await expect(page.getByRole('button', { name: 'Project: Friday Night', exact: true })).toHaveCount(0);
  await less(page);
  await nameOpenProject(page, 'Sunday Morning');
  expect(await publishOpenProject(page)).toBe(own);

  // Someone with no account, in a browser that has never seen the site.
  const visitorContext = await browser.newContext({ baseURL });
  const visitor = await visitorContext.newPage();
  const asked: string[] = [];
  visitor.on('request', request => { if (request.url().startsWith(api)) asked.push(new URL(request.url()).pathname); });
  await visitor.goto(own);
  const list = visitor.getByRole('main', { name: 'Published songs', exact: true });
  await expect(list.getByRole('heading', { name: 'Ian', exact: true })).toBeVisible();
  await expect(list.getByRole('link')).toHaveText([/^Sunday Morning\s*Updated /, /^Friday Night\s*Updated /]);
  expect(asked, 'the page asks the server for this person\'s songs and nothing else').toEqual(['/users/Ian/songs']);

  // Each song opens its own page, and the name there leads back.
  await list.getByRole('link', { name: /Friday Night/ }).click();
  const song = visitor.getByRole('main', { name: 'Shared song', exact: true });
  await expect(song.getByRole('heading', { name: 'Friday Night', exact: true })).toBeVisible();
  await expect(song).toContainText('A song by Ian');
  await song.getByRole('link', { name: 'Ian', exact: true }).click();
  await expect(list.getByRole('link')).toHaveCount(2);
  expect(new URL(visitor.url()).hash).toBe('#u=Ian');

  // An unpublished song leaves the list.
  await menu(page, 'Share Link');
  const share = page.getByRole('dialog', { name: 'Share this song', exact: true });
  await share.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(share.getByRole('button', { name: 'Publish and Get a Short Link', exact: true })).toBeVisible();
  await visitor.reload();
  await expect(list.getByRole('link')).toHaveText([/^Friday Night/]);

  // A name nobody has reads the same as a person with nothing published.
  await visitor.goto(own.replace('#u=Ian', '#u=Nobody_Here'));
  await expect(list.getByRole('heading', { name: 'Nobody_Here', exact: true })).toBeVisible();
  await expect(list.getByRole('status')).toContainText('no published songs under this name');
  await expect(list.getByRole('link')).toHaveCount(0);
  await visitorContext.close();
});

test('a person\'s page says so when the server is down or does not have such pages yet', async ({ page }, testInfo) => {
  const api = apiUrl(String(testInfo.project.use.baseURL));
  const list = page.getByRole('main', { name: 'Published songs', exact: true });

  await page.route(`${api}/**`, route => route.abort());
  await page.goto('./#u=Disco_Dana');
  await expect(list.getByRole('heading', { name: 'Disco_Dana', exact: true })).toBeVisible();
  await expect(list.getByRole('alert')).toContainText('could not be reached');
  await page.unroute(`${api}/**`);
  await list.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(list.getByRole('status')).toContainText('no published songs under this name');

  // The site is published before the API is deployed, and the older server has no such route.
  await page.route(`${api}/users/**`, route => route.fulfill({
    status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Not found.' }),
  }));
  await page.reload();
  await expect(list.getByRole('alert')).toContainText('not available here yet');
  await expect(list.getByRole('button', { name: 'Try Again', exact: true })).toHaveCount(0);

  // A link that names nothing asks the server nothing.
  await page.unroute(`${api}/users/**`);
  const asked: string[] = [];
  page.on('request', request => { if (request.url().startsWith(api)) asked.push(request.url()); });
  await page.goto('./#u=not a name');
  await expect(list.getByRole('status')).toContainText('does not hold a username');
  expect(asked).toEqual([]);

  await list.getByRole('button', { name: 'Go to Discobot', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await more(page);
  await expect(page.getByRole('button', { name: /^Project: / })).toBeVisible();
  await less(page);
  expect(new URL(page.url()).hash).toBe('');
});
