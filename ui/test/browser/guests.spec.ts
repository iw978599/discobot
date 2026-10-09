import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const guestAddress = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest`;

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a guest instrument is hosted, follows the transport, sends its sound to the mixer and keeps its settings', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL), address = guestAddress(baseURL);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Addresses that must be refused: not https, and Discobot's own site.
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await expect(dialog).toContainText('cannot read your projects or your account');
  for (const bad of ['http://example.com/synth', `${baseURL}index.html`, 'javascript:alert(1)']) {
    await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(bad);
    await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).press('Enter');
    await expect(dialog.getByRole('alert'), bad).toContainText('not an address a guest instrument can be loaded from');
  }
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(address);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();

  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(unit.getByRole('status')).toContainText('Connected');
  const guest = unit.frameLocator('iframe');
  await expect(guest.getByRole('status')).toContainText(`Hosted by ${new URL(baseURL).origin}`);
  await expect(guest.getByRole('status')).toContainText('Stopped');
  await expect(guest.getByRole('button', { name: 'Start', exact: true }), 'the host drives the transport').toBeHidden();

  // The frame is kept apart from Discobot: it is another site's page.
  const frame = unit.locator('iframe');
  expect(await frame.getAttribute('sandbox')).toContain('allow-scripts');
  expect(new URL((await frame.getAttribute('src'))!).origin).not.toBe(new URL(baseURL).origin);

  // Its settings are saved in the project.
  await guest.getByLabel('Note', { exact: true }).selectOption('G4');
  await expect.poll(async () => (await stored(page)).guests?.[0]?.state).toEqual({ note: 'G4', wave: 'triangle' });

  // Play: the guest starts with the transport at Discobot's tempo, and its sound arrives.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('150');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(guest.getByRole('status')).toContainText('Playing at 150 BPM');
  await expect.poll(async () => Number(/Beats played: (\d+)/.exec(await guest.getByRole('status').innerText())?.[1])).toBeGreaterThan(2);
  await expect.poll(async () => Number(await unit.getAttribute('data-audio-blocks')), { message: 'audio crosses from the frame into the mixer' }).toBeGreaterThan(10);

  // A tempo change reaches it while playing.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('100');
  await page.locator('.tempo-led-input').press('Enter');
  await expect(guest.getByRole('status')).toContainText('Playing at 100 BPM');
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(guest.getByRole('status')).toContainText('Stopped');

  // Level and mute are the project's, like any lane.
  await unit.getByRole('button', { name: /^Mute guest / }).click();
  expect((await stored(page)).guests[0]).toMatchObject({ url: address, muted: true });

  // After a reload the guest comes back with its settings, without being asked about again.
  await page.reload();
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(guest.getByLabel('Note', { exact: true })).toHaveValue('G4');
  await expect(unit.getByRole('button', { name: /^Mute guest / })).toHaveAttribute('aria-pressed', 'true');

  page.once('dialog', confirm => { void confirm.accept(); });
  await unit.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(unit).toHaveCount(0);
  expect((await stored(page)).guests).toEqual([]);
  expect(errors).toEqual([]);
});

test('a guest that arrives with someone else\'s song is not loaded until the visitor agrees', async ({ page, browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL), address = guestAddress(baseURL);
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(address);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  await expect(page.getByRole('region', { name: /^Guest instrument / })).toHaveAttribute('data-status', 'ready');
  await menu(page, 'Share Link');
  const link = await page.getByRole('dialog', { name: 'Share this song', exact: true }).getByLabel('Share link', { exact: true }).inputValue();

  const visitorContext = await browser.newContext({ baseURL });
  const visitor = await visitorContext.newPage();
  const requests: string[] = [];
  visitor.on('request', request => { if (request.url().startsWith(new URL(address).origin)) requests.push(request.url()); });
  await visitor.goto(link);
  await visitor.getByRole('button', { name: 'Open a Copy to Edit', exact: true }).click();
  const unit = visitor.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'asking');
  await expect(unit).toContainText(`uses a guest instrument from ${new URL(address).origin}`);
  await expect(unit.locator('iframe')).toHaveCount(0);
  expect(requests, 'nothing is fetched from the guest\'s site before the visitor agrees').toEqual([]);

  await unit.getByRole('button', { name: 'Load It', exact: true }).click();
  await expect(unit).toHaveAttribute('data-status', 'ready');
  expect(requests.length).toBeGreaterThan(0);
  await visitorContext.close();
});
