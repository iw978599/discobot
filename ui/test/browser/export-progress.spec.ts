import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window { releaseExport: () => void }
}

const exportMenu = (page: Page) => page.getByRole('menu', { name: 'Export', exact: true });
async function openExportMenu(page: Page) {
  await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
  await expect(exportMenu(page)).toBeVisible();
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

test('the Export menu names the scene and song exports as pairs', async ({ page }) => {
  await openExportMenu(page);
  await expect(exportMenu(page).getByRole('menuitem')).toHaveText(['Scene WAV', 'Loop WAV', 'Stems', 'Scene MIDI', 'Song WAV', 'Song MIDI']);
  await expect(page.getByRole('menuitem', { name: 'Download WAV', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Export MIDI', exact: true })).toHaveCount(0);
});

for (const item of ['Scene WAV', 'Song WAV']) {
  test(`${item} says it is being made, allows no second export, and says when it is done`, async ({ page }) => {
    const download = page.waitForEvent('download');
    await openExportMenu(page);
    await exportMenu(page).getByRole('menuitem', { name: item, exact: true }).click();

    const status = page.getByRole('status').filter({ hasText: `Making ${item}` });
    await expect(status).toBeVisible();

    await openExportMenu(page);
    for (const name of ['Scene WAV', 'Loop WAV', 'Stems', 'Song WAV']) {
      await expect(exportMenu(page).getByRole('menuitem', { name, exact: true }), `${name} while ${item} is being made`).toBeDisabled();
    }
    // The MIDI files are made at once and stay available.
    await expect(exportMenu(page).getByRole('menuitem', { name: 'Scene MIDI', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.releaseExport());
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.wav$/);
    await expect(page.getByRole('status').filter({ hasText: `${item} finished` })).toBeVisible();
    await expect(status).toHaveCount(0);

    await openExportMenu(page);
    for (const name of ['Scene WAV', 'Loop WAV', 'Stems', 'Song WAV']) {
      await expect(exportMenu(page).getByRole('menuitem', { name, exact: true }), `${name} after ${item} is done`).toBeEnabled();
    }

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Dismiss export message', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: `${item} finished` })).toHaveCount(0);
  });
}
