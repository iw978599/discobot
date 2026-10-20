import { expect, test, type Page } from '@playwright/test';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

declare global {
  interface Window { releaseExport: () => void }
}

const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export', exact: true });
const radio = (page: Page, name: string) => exportDialog(page).getByRole('radio', { name, exact: true });
const go = (page: Page) => exportDialog(page).getByRole('button', { name: 'Export', exact: true });
async function openExport(page: Page) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(exportDialog(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    // The render is held until the test lets it go, so the time "while it is being made" is as long as the test needs.
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    window.releaseExport = () => release();
    const original = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = async function (this: OfflineAudioContext) {
      await gate;
      return original.call(this);
    };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
});

test('Export is one dialog: what, as what, and how long the file will be', async ({ page }) => {
  await openExport(page);
  await expect(radio(page, 'This scene')).toBeChecked();
  await expect(radio(page, 'Audio')).toBeChecked();
  await expect(exportDialog(page).getByRole('group', { name: 'As', exact: true }).getByRole('radio')).toHaveCount(4);
  await expect(exportDialog(page).locator('.export-length')).toContainText('1 bar at 120 BPM: 0:02');
  await expect(exportDialog(page).getByRole('status')).toHaveText('');

  // A loop and stems are of one scene: with the song chosen they stand down, and it is plain audio.
  await radio(page, 'Seamless loop').check();
  await radio(page, 'The whole song').check();
  await expect(radio(page, 'Seamless loop')).toBeDisabled();
  await expect(radio(page, 'Stems')).toBeDisabled();
  await expect(radio(page, 'Audio')).toBeChecked();
  await expect(radio(page, 'MIDI')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(exportDialog(page)).toHaveCount(0);
});

for (const item of ['Scene WAV', 'Song WAV']) {
  test(`${item} says it is being made in the dialog, allows no second audio export, and says when it is done`, async ({ page }) => {
    const download = page.waitForEvent('download');
    await openExport(page);
    await radio(page, item === 'Song WAV' ? 'The whole song' : 'This scene').check();
    await go(page).click();

    const progress = exportDialog(page).getByRole('status');
    await expect(progress).toContainText(`Making ${item}`);
    // The lanes and the drums are made before the browser's render, which is held: half way.
    const bar = exportDialog(page).getByRole('progressbar', { name: 'Export progress', exact: true });
    await expect(bar).toHaveAttribute('value', '50');
    await expect(go(page), 'one audio file at a time').toBeDisabled();
    // The MIDI files are made at once and stay available.
    await radio(page, 'MIDI').check();
    await expect(go(page)).toBeEnabled();
    await radio(page, 'Audio').check();
    await expect(go(page)).toBeDisabled();

    await page.evaluate(() => window.releaseExport());
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.wav$/);
    await expect(progress).toContainText(`${item} finished`);
    await expect(bar, 'the bar goes once the file is made').toHaveCount(0);
    await expect(go(page)).toBeEnabled();

    // Closed, the rack still says so until it is dismissed.
    await page.keyboard.press('Escape');
    await expect(exportDialog(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: `${item} finished` })).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss export message', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${item} finished` })).toHaveCount(0);
  });
}

test('the dialog can be closed while a file is being made, and the rack carries the message on', async ({ page }) => {
  const download = page.waitForEvent('download');
  await openExport(page);
  await go(page).click();
  await expect(exportDialog(page).getByRole('status')).toContainText('Making Scene WAV');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'Making Scene WAV' })).toBeVisible();
  await page.evaluate(() => window.releaseExport());
  expect((await download).suggestedFilename()).toMatch(/\.wav$/);
  await expect(page.getByRole('status').filter({ hasText: 'Scene WAV finished' })).toBeVisible();
});
