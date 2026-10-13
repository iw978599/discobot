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

async function menu(page: Page, item: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
async function setTempo(page: Page, bpm: string) {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill(bpm);
  await page.locator('.tempo-led-input').press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('earlier versions of a project are kept and can be restored or saved as a copy', async ({ page }) => {
  // First session: a kick and 140 BPM. The reload is a second session, which keeps what it opened.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await setTempo(page, '140');
  await page.reload();
  await expect(page.locator('.tempo-led-value')).toHaveText('140');

  // Second session: the mistake. Clear the kick and change the tempo.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await setTempo(page, '90');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await menu(page, 'Version History');
  const dialog = page.getByRole('dialog', { name: 'Version history', exact: true });
  const versions = dialog.getByRole('group');
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('As it was when opened');

  // Restore the newest kept version: the project as this session found it.
  await versions.first().getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Restored the version from');
  await expect(page.locator('.tempo-led-value')).toHaveText('140');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Kick step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // What was there before the restore was kept too, so the restore can be taken back.
  await menu(page, 'Version History');
  await expect(versions).toHaveCount(3);
  await expect(versions.first()).toContainText('Before an earlier version was restored');
  await versions.first().getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.tempo-led-value')).toHaveText('90');

  // An older version as a separate project.
  await versions.last().getByRole('button', { name: 'Save as a Copy', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved as a separate project');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tempo-led-value'), 'the open project is left alone').toHaveText('90');
  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  // The copy shares the row of the project it was taken from.
  const row = projects.getByRole('group', { name: 'Project Untitled', exact: true });
  await row.getByLabel('Version of Untitled', { exact: true }).selectOption('Untitled (earlier version)');
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.tempo-led-value'), 'the very first version: an empty project at 120').toHaveText('120');

  // Versions survive a reload, and belong to their own project.
  await page.reload();
  await menu(page, 'Version History');
  await expect(dialog).toContainText('Untitled (earlier version)');
  await expect(versions).toHaveCount(1);
});
