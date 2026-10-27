import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Drum sounds sent from another app (docs/SEND_PROTOCOL.md), by the example sender
// (docs/send-example.html), which the local API serves from another address.
const senderAddress = (baseURL: string, mode: string) =>
  `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__send?app=${encodeURIComponent(baseURL)}&mode=${mode}`;

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
type Received = Array<{ type: string; imported?: number; message?: string }>;
const received = (sender: Page) => sender.evaluate(() => (window as unknown as { received: Received }).received);

async function openFrom(context: BrowserContext, baseURL: string, mode: string) {
  const sender = await context.newPage();
  await sender.goto(senderAddress(baseURL, mode));
  const [app] = await Promise.all([context.waitForEvent('page'), sender.getByRole('button', { name: 'Send to Discobot', exact: true }).click()]);
  return { sender, app };
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
});

test('sounds sent from another app open Import Kit on the lanes they were sent for, and Import answers how many', async ({ context }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const { sender, app } = await openFrom(context, baseURL, 'normal');
  const dialog = app.getByRole('dialog', { name: 'Import a drum kit', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`From Example Sender (127.0.0.1:${Number(new URL(baseURL).port) + 1000})`);
  // The mark is off the address, so a reload waits for nobody.
  expect(new URL(app.url()).hash).toBe('');
  // Sent for the kick; sent for no lane, named a snare; sent for a lane that is not one.
  await expect(dialog.getByLabel('File for Kick', { exact: true })).toHaveValue('0');
  await expect(dialog.getByLabel('File for Snare', { exact: true })).toHaveValue('1');
  await expect(dialog.getByRole('group', { name: 'zzz.wav', exact: true })).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'A new row for zzz.wav', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect((await received(sender)).map(message => message.type)).toEqual(['ready']);

  await dialog.getByRole('button', { name: 'Use These Sounds', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => received(sender)).toEqual([{ discobotImport: 1, type: 'ready' }, { discobotImport: 1, type: 'done', imported: 3 }]);
  // The kick, the snare and a row added after the eight each play one of them.
  await expect.poll(async () => {
    const { drumState } = await stored(app);
    return [Boolean(drumState.kick.sampleId), Boolean(drumState.snare.sampleId), Boolean(drumState.extra1?.sampleId)];
  }).toEqual([true, true, true]);
});

test('Cancel answers that nothing was kept, and a second sending is ignored', async ({ context }, testInfo) => {
  const { sender, app } = await openFrom(context, String(testInfo.project.use.baseURL), 'twice');
  const dialog = app.getByRole('dialog', { name: 'Import a drum kit', exact: true });
  await expect(dialog).toContainText('From Example Sender');
  await dialog.getByRole('button', { name: 'Close kit import', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => received(sender)).toEqual([{ discobotImport: 1, type: 'ready' }, { discobotImport: 1, type: 'done', imported: 0 }]);
  await app.waitForTimeout(1000);
  await expect(dialog, 'the second sending opens nothing').toBeHidden();
  expect(await received(sender)).toHaveLength(2);
});

test('sounds from a window other than the one that opened Discobot are ignored', async ({ context }, testInfo) => {
  const { sender, app } = await openFrom(context, String(testInfo.project.use.baseURL), 'other');
  const dialog = app.getByRole('dialog', { name: 'Import a drum kit', exact: true });
  // The frame on the sender's page sends first; only the opener's sounds, a moment later, are shown.
  await expect(dialog).toContainText('From Example Sender');
  await expect(dialog).not.toContainText('Impostor');
  expect((await received(sender)).map(message => message.type)).toEqual(['ready']);
});

test('Discobot opened without #receive tells the page that opened it nothing', async ({ context }, testInfo) => {
  const { sender, app } = await openFrom(context, String(testInfo.project.use.baseURL), 'plain');
  await expect(app.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await app.waitForTimeout(2000);
  expect(await received(sender)).toEqual([]);
  await expect(app.getByRole('dialog', { name: 'Import a drum kit', exact: true })).toHaveCount(0);
});
