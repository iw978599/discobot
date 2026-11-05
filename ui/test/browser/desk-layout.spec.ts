import { expect, test, type Page } from '@playwright/test';

// The desk layout is an option from the Project menu, this browser's choice. The rack is the default.

const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 1059 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
async function menu(page: Page, item: string) {
  if (onPhone(page) && !await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'More controls', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const layout = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-layout'));
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await ready(page);
});

test('the rack is the default, the desk is a choice that survives a reload, and the rack comes back', async ({ page }) => {
  expect(await layout(page), 'the rack sets nothing').toBeNull();

  await menu(page, 'Try the Desk Layout');
  await expect.poll(() => layout(page)).toBe('desk');
  expect(await page.evaluate(() => localStorage.getItem('discobot_layout_v1'))).toBe('desk');

  await page.reload();
  await ready(page);
  expect(await layout(page), 'kept in this browser').toBe('desk');

  await menu(page, 'Back to the Rack');
  await expect.poll(() => layout(page)).toBeNull();

  await page.reload();
  await ready(page);
  expect(await layout(page)).toBeNull();
});
