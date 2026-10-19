import { expect, test, type Locator, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const sound = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.stringify(JSON.parse(localStorage.getItem(key) || '{}').synths?.[0]?.synthParams ?? null)), PROJECT_KEY);

const lane = (page: Page) => page.locator('.synth-module').first();
const picker = (page: Page) => lane(page).getByRole('button', { name: /^Synth preset/ });
// Found by its data-group and not by its name: the Bass group holds a preset that is also called Bass.
const groupRow = (page: Page, group: string) => lane(page).locator(`[role="menuitem"][data-group="${group}"]`);
const groupList = (page: Page, group: string) => lane(page).getByRole('menu', { name: group, exact: true });
// The rows of a group that choose a preset. On a phone the group's list starts with a Back row.
const choices = (page: Page, group: string) => groupList(page, group).locator('[role="menuitem"]:not([data-back])');
const spoken = (rows: Locator) => rows.evaluateAll(found => found.map(row => row.getAttribute('aria-label')));
const groupNames = (page: Page) => spoken(lane(page).locator('[role="menuitem"][data-group]'));
const phone = (page: Page) => page.viewportSize()!.width <= 720;
const search = (page: Page) => lane(page).getByRole('searchbox', { name: 'Search presets', exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  // The presets are on the editor's Sound level; a lane opens on Notes.
  await lane(page).getByRole('tab', { name: 'Sound', exact: true }).click();
});

test('the preset menu lists the kinds, then a person\'s own presets, and each opens a list of its presets', async ({ page }) => {
  await expect(picker(page), 'nothing has been loaded on this lane yet').toHaveAccessibleName('Synth preset: Preset…');
  await expect(picker(page)).toHaveAttribute('aria-haspopup', 'menu');
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');

  await picker(page).click();
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => groupNames(page), 'the kinds, in their agreed order').toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Effects']);
  await expect(lane(page).getByRole('menu', { name: 'Synth preset', exact: true })).toBeVisible();
  await expect(lane(page).locator('[role="menuitem"]:not([data-group])'), 'no preset is shown until a group is chosen').toHaveCount(0);

  await groupRow(page, 'Pad').click();
  await expect(choices(page, 'Pad').first()).toBeVisible();
  const pads = await spoken(choices(page, 'Pad'));
  expect(pads.length, 'the group has presets in it').toBeGreaterThan(0);
  await expect(choices(page, 'Pad').first(), 'a preset that comes with the app is marked').toHaveText(`${pads[0]} *`);

  if (!phone(page)) {
    // A second list, beside the first and level with the group it belongs to.
    await expect(groupRow(page, 'Pad')).toHaveAttribute('aria-expanded', 'true');
    const row = (await groupRow(page, 'Pad').boundingBox())!;
    const second = (await groupList(page, 'Pad').boundingBox())!;
    expect(second.x, 'the presets are to the side of the groups').toBeGreaterThanOrEqual(row.x + row.width);
    expect(Math.abs(second.y - row.y), 'and start level with their group').toBeLessThan(12);

    await groupRow(page, 'Bass').click();
    await expect(choices(page, 'Bass').first()).toBeVisible();
    await expect(groupList(page, 'Pad'), 'only one group is open at a time').toHaveCount(0);
  }

  // A click anywhere else closes it without loading anything.
  await page.mouse.click(2, 2);
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(lane(page).getByRole('menuitem')).toHaveCount(0);
  await expect(picker(page)).toHaveAccessibleName('Synth preset: Preset…');
});

test('choosing a preset loads it, closes the menu and puts its name on the button', async ({ page }) => {
  const before = await sound(page);
  const height = (await picker(page).boundingBox())!.height, width = (await picker(page).boundingBox())!.width;

  await picker(page).click();
  await groupRow(page, 'Pad').click();
  await expect(choices(page, 'Pad').first()).toBeVisible();
  const name = (await spoken(choices(page, 'Pad')))[0]!;
  await choices(page, 'Pad').first().click();

  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(lane(page).getByRole('menuitem')).toHaveCount(0);
  await expect(picker(page)).toHaveAccessibleName(`Synth preset: ${name}`);
  await expect(picker(page), 'the mark of a built-in preset is on the button too').toHaveText(`${name} *▾`);
  await expect.poll(() => sound(page), 'the lane\'s sound is the preset\'s').not.toBe(before);
  await expect(lane(page).getByRole('button', { name: 'Delete', exact: true }), 'a preset that comes with the app cannot be deleted').toBeDisabled();

  // One of the person's own goes in a group of its own, after the kinds, with no mark.
  const mine = 'A long name for a preset that will not fit on the button';
  await lane(page).getByLabel('Preset name', { exact: true }).fill(mine);
  await lane(page).getByRole('button', { name: 'Save', exact: true }).click();
  await picker(page).click();
  await expect.poll(() => groupNames(page)).toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Effects', 'My presets']);
  await groupRow(page, 'My presets').click();
  await expect(choices(page, 'My presets')).toHaveText([mine]);
  await choices(page, 'My presets').first().click();
  await expect(picker(page)).toHaveAccessibleName(`Synth preset: ${mine}`);
  await expect(lane(page).getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();

  // The button is the same size whatever it says, so nothing under it moves.
  const box = (await picker(page).boundingBox())!;
  expect(box.height, 'a long name does not make the button taller').toBe(height);
  expect(box.width, 'or wider').toBe(width);

  await lane(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(picker(page), 'deleting the preset clears the button').toHaveAccessibleName('Synth preset: Preset…');
  await picker(page).click();
  await expect.poll(() => groupNames(page), 'and its group goes with the last preset in it').toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Effects']);
});

test('the preset menu works from the keyboard alone', async ({ page }) => {
  test.skip(phone(page), 'a phone has no keyboard; its sheet has a test of its own');
  await expect.poll(() => sound(page)).not.toBe('null');
  const before = await sound(page);

  await picker(page).focus();
  await page.keyboard.press('Enter');
  await expect(search(page), 'opening puts the keyboard in the search field').toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(groupRow(page, 'Bass'), 'and down from there is the first group').toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(groupRow(page, 'Lead')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(groupRow(page, 'Effects'), 'the arrows go round from the first row to the last').toBeFocused();
  await page.keyboard.press('Home');
  await expect(groupRow(page, 'Bass')).toBeFocused();
  await page.keyboard.press('End');
  await expect(groupRow(page, 'Effects')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(groupRow(page, 'Bass')).toBeFocused();

  // Right opens a group and Left closes it again.
  await page.keyboard.press('ArrowRight');
  await expect(choices(page, 'Bass').first()).toBeFocused();
  await expect(groupRow(page, 'Bass')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(groupRow(page, 'Bass')).toBeFocused();
  await expect(groupList(page, 'Bass')).toHaveCount(0);

  // Enter opens one too. Escape goes back one level, and then closes the menu.
  await page.keyboard.press('Enter');
  await expect(choices(page, 'Bass').first()).toBeFocused();
  const names = await spoken(choices(page, 'Bass'));
  expect(names.length, 'the group has more than one preset to move between').toBeGreaterThan(1);
  await page.keyboard.press('ArrowDown');
  await expect(choices(page, 'Bass').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(groupRow(page, 'Bass')).toBeFocused();
  await expect(picker(page), 'the menu is still open').toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(picker(page), 'the keyboard is back on the button').toBeFocused();
  await expect(picker(page), 'nothing was loaded on the way').toHaveAccessibleName('Synth preset: Preset…');

  // Down on the button opens it as well, on the first group and past the search field, and Enter on a preset loads it.
  await page.keyboard.press('ArrowDown');
  await expect(groupRow(page, 'Bass')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(choices(page, 'Bass').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(choices(page, 'Bass').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveAccessibleName(`Synth preset: ${names[1]}`);
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(picker(page)).toBeFocused();
  await expect.poll(() => sound(page)).not.toBe(before);

  // Tab is not held in the menu: it goes on to the next control and the menu closes behind it.
  await page.keyboard.press('Enter');
  await expect(groupRow(page, 'Bass')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(lane(page).getByLabel('Preset name', { exact: true })).toBeFocused();
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(lane(page).getByRole('menuitem')).toHaveCount(0);
});

test('on a phone the sheet shows the groups, then one group\'s presets under a Back row', async ({ page }) => {
  test.skip(!phone(page), 'this is the narrow layout');
  const back = lane(page).getByRole('menuitem', { name: 'Back', exact: true });

  await picker(page).click();
  await expect.poll(() => groupNames(page)).toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Effects']);
  const sheet = (await lane(page).getByRole('menu', { name: 'Synth preset', exact: true }).boundingBox())!;
  const view = page.viewportSize()!;
  expect(sheet.y + sheet.height, 'the sheet is along the bottom of the screen').toBeGreaterThan(view.height - 40);
  expect(sheet.width, 'and as wide as the screen').toBeGreaterThan(view.width - 40);

  await groupRow(page, 'Pad').click();
  await expect(back).toBeVisible();
  await expect(lane(page).locator('[role="menuitem"][data-group]'), 'the group\'s presets take the place of the groups').toHaveCount(0);
  await expect(choices(page, 'Pad').first()).toBeVisible();
  await expect(groupList(page, 'Pad').locator('[role="menuitem"]').first(), 'Back is the top row').toHaveAccessibleName('Back');

  await back.click();
  await expect.poll(() => groupNames(page), 'Back shows the groups again').toEqual(['Bass', 'Lead', 'Pad', 'Keys', 'Pluck', 'Effects']);
  await expect(back).toHaveCount(0);
  await expect(picker(page), 'and the sheet is still open').toHaveAttribute('aria-expanded', 'true');

  await groupRow(page, 'Bass').click();
  await expect(choices(page, 'Bass').first()).toBeVisible();
  const name = (await spoken(choices(page, 'Bass')))[0]!;
  await choices(page, 'Bass').first().click();
  await expect(picker(page)).toHaveAccessibleName(`Synth preset: ${name}`);
  await expect(lane(page).getByRole('menuitem')).toHaveCount(0);
});

test('typing in the preset menu finds presets in every group at once, and Enter loads the first', async ({ page }) => {
  await expect.poll(() => sound(page)).not.toBe('null');
  await picker(page).click();
  if (phone(page)) await expect(search(page), 'a phone does not raise its keyboard by itself').not.toBeFocused();
  await search(page).fill('grand piano');
  const found = lane(page).getByRole('menu', { name: 'Synth preset', exact: true }).locator('[role="menuitem"]');
  await expect.poll(() => spoken(found)).toEqual(['Kawai Grand Piano', 'Steinway Grand Piano']);
  await expect(lane(page).locator('[role="menuitem"][data-group]'), 'the groups give way to what was found').toHaveCount(0);
  await expect(found.first(), 'a row found says which group it is from').toHaveAttribute('title', 'Keys');

  // A word may be in the group's name: every bass is found by "bass".
  await search(page).fill('bass');
  expect((await spoken(found)).length).toBeGreaterThan(5);
  await search(page).fill('zzzz');
  await expect(found).toHaveCount(0);
  await expect(lane(page).getByText('Nothing matches', { exact: true })).toBeVisible();

  await search(page).fill('steinway');
  await search(page).press('Enter');
  await expect(picker(page)).toHaveAccessibleName('Synth preset: Steinway Grand Piano');
  await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => JSON.parse(await sound(page)).sample?.wave).toBe('steinway-piano');

  // Opened again, the menu has forgotten the search.
  await picker(page).click();
  await expect(search(page)).toHaveValue('');
  await expect(lane(page).locator('[role="menuitem"][data-group]')).toHaveCount(6);
});
