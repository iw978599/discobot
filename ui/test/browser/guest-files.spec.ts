import { expect, test, type Page } from '@playwright/test';

// A file a guest keeps with the project (the optional "files" feature of the guest protocol), as
// Tape Loop Deck keeps its tapes. The example guest keeps a quarter second of its bell when its
// address carries ?files=1: 4,044 bytes of WAV.

const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 1059 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
async function menu(page: Page, item: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const guestAddress = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest?files=1`;
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await ready(page);
});

test('a guest keeps a recording with the project: it is there after a reload and travels in a project file', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await menu(page, 'Add Guest Instrument');
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(guestAddress(String(testInfo.project.use.baseURL)));
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toHaveAttribute('data-status', 'ready');
  const status = unit.frameLocator('iframe').getByRole('status');

  await unit.frameLocator('iframe').getByRole('button', { name: 'Keep a Recording', exact: true }).click();
  await expect(status, 'kept, and fetched back by its id').toContainText('Recording: loaded, audio/wav, 4044 bytes');
  await expect.poll(async () => JSON.stringify((await stored(page)).guests?.[0]?.state ?? null), { message: 'the id is in the saved settings' })
    .toMatch(/"recording":"discobot-file:[0-9a-f]{64}"/);
  const project = await stored(page);
  expect(JSON.stringify(project), 'the project holds the id and never the audio').not.toContain('UklGR');

  await page.reload();
  await ready(page);
  await expect(unit).toHaveAttribute('data-status', 'ready');
  await expect(status, 'back after a reload').toContainText('Recording: loaded, audio/wav, 4044 bytes');

  // The project file carries the recording beside the project, and another browser takes it in.
  const download = page.waitForEvent('download');
  await menu(page, 'Export Project');
  const path = testInfo.outputPath('with-recording.json');
  await (await download).saveAs(path);
  const { readFile } = await import('node:fs/promises');
  const file = JSON.parse(await readFile(path, 'utf8'));
  expect(file.guestFiles).toHaveLength(1);
  expect(file.guestFiles[0].id).toBe(project.guests[0].state.recording);
  expect(file.guestFiles[0].data.startsWith('UklGR'), 'a WAV, as base64').toBe(true);

  const elsewhere = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), viewport: page.viewportSize() });
  const other = await elsewhere.newPage();
  await other.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await other.goto('./');
  await ready(other);
  const chooser = other.waitForEvent('filechooser');
  await menu(other, 'Import Project');
  await (await chooser).setFiles(path);
  const arrived = other.getByRole('region', { name: /^Guest instrument / });
  // A guest that arrives in someone else's project is loaded only when asked to.
  await arrived.getByRole('button', { name: 'Load It', exact: true }).click();
  await expect(arrived).toHaveAttribute('data-status', 'ready');
  await expect(arrived.frameLocator('iframe').getByRole('status'), 'the other browser has the recording from the file').toContainText('Recording: loaded, audio/wav, 4044 bytes');
  await elsewhere.close();
  expect(errors).toEqual([]);
});
