import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the Model menu is laid out like the presets: Generic on its own, then a list for each group', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  await lane.getByRole('tab', { name: 'Sound', exact: true }).click();
  const menu = lane.getByRole('button', { name: /^Synth model: / });
  await expect(menu).toHaveAccessibleName('Synth model: Generic');

  await menu.click();
  const first = lane.getByRole('menu', { name: 'Synth model', exact: true });
  await expect(first.locator(':scope > [role="menuitem"], :scope > .rack-menu-group > [role="menuitem"]')).toHaveText(['Generic', /Mono/, /Poly/, /Digital/]);

  await lane.locator('[role="menuitem"][data-group="Poly"]').click();
  const juno = lane.getByRole('menuitem', { name: 'Juno-106', exact: true });
  await expect(juno).toHaveAttribute('title', /Poly saw/);
  await juno.click();
  await expect(menu).toHaveAccessibleName('Synth model: Juno-106');
  await expect(menu).toBeFocused();
  await expect(page.getByRole('button', { name: 'Synth 1', exact: true }).locator('span')).toHaveText('Juno-106');

  // The keyboard reaches Generic, which is chosen from the first list.
  await menu.press('ArrowDown');
  await expect(lane.getByRole('menuitem', { name: 'Generic', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAccessibleName('Synth model: Generic');
  expect(errors).toEqual([]);
});
