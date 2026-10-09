import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const apiUrl = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}`;

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a published song has a short link that anyone can open, update keeps the link, and unpublish ends it', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);

  // Signed out, there is only the long link.
  await menu(page, 'Share Link');
  let share = page.getByRole('dialog', { name: 'Share this song', exact: true });
  await expect(share).toContainText('Sign in to publish');
  const long = await share.getByLabel('Share link', { exact: true }).inputValue();
  await page.keyboard.press('Escape');

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

  await page.getByRole('button', { name: /^Project: / }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await projects.getByRole('button', { name: 'Rename', exact: true }).click();
  await projects.getByLabel('Project name', { exact: true }).fill('Friday Night');
  await projects.getByLabel('Project name', { exact: true }).press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('140');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();

  await menu(page, 'Share Link');
  share = page.getByRole('dialog', { name: 'Share this song', exact: true });
  await expect(share).toContainText('under your username, Ian');
  await share.getByRole('button', { name: 'Publish and Get a Short Link', exact: true }).click();
  const short = await share.getByLabel('Short link', { exact: true }).inputValue();
  expect(short).toMatch(/\/discobot\/#s=[a-z0-9]{10}$/);
  expect(short.length, 'short enough to paste anywhere').toBeLessThan(60);
  expect(long.length).toBeGreaterThan(short.length * 10);

  // Someone with no account, in a browser that has never seen the site.
  const visitorContext = await browser.newContext({ baseURL });
  const visitor = await visitorContext.newPage();
  await visitor.goto(short);
  const song = visitor.getByRole('main', { name: 'Shared song', exact: true });
  await expect(song.getByRole('heading', { name: 'Friday Night', exact: true })).toBeVisible();
  await expect(song).toContainText('A song by Ian');
  await expect(song).toContainText('140 BPM');
  await song.getByRole('button', { name: /Listen/ }).click();
  await expect(song.locator('audio')).toBeVisible({ timeout: 20_000 });
  await song.getByRole('button', { name: 'Open a Copy to Edit', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Project: Friday Night', exact: true })).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(visitor.url()).hash).toBe('');

  // Updating keeps the link and changes what it plays.
  await page.keyboard.press('Escape');
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('99');
  await page.locator('.tempo-led-input').press('Enter');
  await menu(page, 'Share Link');
  share = page.getByRole('dialog', { name: 'Share this song', exact: true });
  await expect(share.getByLabel('Short link', { exact: true }), 'the dialog remembers the song is published').toHaveValue(short);
  await visitor.goto(short);
  await visitor.reload();
  await expect(visitor.getByRole('main', { name: 'Shared song', exact: true })).toContainText('140 BPM');
  await share.getByRole('button', { name: 'Update Published Song', exact: true }).click();
  await expect(share.getByRole('status')).toContainText('now matches');
  await expect(share.getByLabel('Short link', { exact: true })).toHaveValue(short);
  await visitor.reload();
  await expect(visitor.getByRole('main', { name: 'Shared song', exact: true })).toContainText('99 BPM');

  // Unpublishing ends the link, with an explanation for whoever opens it.
  await share.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(share.getByRole('button', { name: 'Publish and Get a Short Link', exact: true })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: 'This link could not be opened', exact: true })).toBeVisible();
  await expect(visitor.getByRole('alert')).toContainText('may have been unpublished');
  await visitor.getByRole('button', { name: 'Go to Discobot', exact: true }).click();
  await expect(visitor.getByRole('button', { name: 'Project: Friday Night', exact: true }), 'the copy they kept is theirs').toBeVisible();
  await visitorContext.close();
});
