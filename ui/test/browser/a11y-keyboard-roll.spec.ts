import { expect, test, type Page } from '@playwright/test';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
// A unit's own Help button is on the unit, not in the sheet, and needs no such step.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);
const guestAddress = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}/__guest`;

const lane = (page: Page) => page.locator('[data-unit="synth-1"]');
const key = (page: Page, note: string) => lane(page).getByRole('button', { name: `Play ${note}`, exact: true });
const step = (page: Page, number: number) => lane(page).getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) });
const stops = (page: Page) => lane(page).locator('.key').evaluateAll(keys => keys.filter(element => (element as HTMLElement).tabIndex === 0).length);
const helpDialog = (page: Page) => page.getByRole('dialog', { name: 'How to use Discobot', exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('the on-screen keys are one stop for the Tab key, and the arrow keys, Home and End move along them', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'mobile-chromium';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const range = lane(page).locator('.keyboard-range');
  await expect(lane(page).getByRole('group', { name: 'Piano keys', exact: true })).toBeVisible();

  // The one stop is the first key on show: the lowest of the three octaves on a wide screen,
  // and the middle octave on a phone, which shows one at a time.
  const start = phone ? 'C4' : 'C3';
  if (phone) await expect(range).toHaveText('C4 - B4');
  await expect(key(page, start)).toHaveAttribute('tabindex', '0');
  expect(await stops(page)).toBe(1);

  // With no step selected, left and right move a semitone, black keys included, and so do up and down.
  const octave = phone ? 4 : 3;
  await key(page, start).focus();
  await page.keyboard.press('ArrowRight');
  await expect(key(page, `C#${octave}`)).toBeFocused();
  await expect(key(page, `C#${octave}`)).toHaveAttribute('tabindex', '0');
  expect(await stops(page), 'the stop goes with the keyboard').toBe(1);
  await page.keyboard.press('ArrowUp');
  await expect(key(page, `D${octave}`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(key(page, start)).toBeFocused();
  await expect(lane(page).locator('.key[aria-pressed="true"]'), 'moving along the keys plays nothing').toHaveCount(0);

  // Space plays the key the keyboard is on, for as long as it is down.
  await page.keyboard.down('Space');
  await expect(key(page, start)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('Space');
  await expect(key(page, start)).toHaveAttribute('aria-pressed', 'false');

  // The letters still play the lane while a key has the keyboard.
  await page.keyboard.down('a');
  await expect(key(page, 'C4')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('a');
  await expect(key(page, 'C4')).toHaveAttribute('aria-pressed', 'false');

  // End and Home go to the two ends. On a phone those are octaves that were off the strip, and
  // each is brought on show, a whole octave at a time.
  await page.keyboard.press('End');
  await expect(key(page, 'B5')).toBeFocused();
  await expect(key(page, 'B5')).toBeInViewport();
  if (phone) {
    await expect(range).toHaveText('C5 - B5');
    await expect(key(page, 'C4'), 'the octave that was on show has gone off').not.toBeInViewport();
  }
  await page.keyboard.press('ArrowRight');
  await expect(key(page, 'B5'), 'there is no key past the last').toBeFocused();
  await page.keyboard.press('Home');
  await expect(key(page, 'C3')).toBeFocused();
  await expect(key(page, 'C3')).toBeInViewport();
  if (phone) {
    await expect(range).toHaveText('C3 - B3');
    // Walking off the end of the octave on show brings the next one on.
    for (let press = 0; press < 12; press += 1) await page.keyboard.press('ArrowRight');
    await expect(key(page, 'C4')).toBeFocused();
    await expect(key(page, 'C4')).toBeInViewport();
    await expect(range).toHaveText('C4 - B4');
    await page.keyboard.press('Home');
    await expect(key(page, 'C3')).toBeFocused();
  }

  // Tab leaves the keys in one press, and Shift+Tab comes back to the key it left.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.classList.contains('key')), 'Tab goes on past the keys').toBe(false);
  await page.keyboard.press('Shift+Tab');
  await expect(key(page, 'C3')).toBeFocused();
  expect(await stops(page)).toBe(1);

  // On a phone the strip can be moved by its buttons. The stop is then the first key on show,
  // so Tab never lands on a key that is out of sight.
  if (phone) {
    await lane(page).getByRole('button', { name: 'Higher keys', exact: true }).click();
    await expect(range).toHaveText('C4 - B4');
    await expect(key(page, 'C4')).toHaveAttribute('tabindex', '0');
    expect(await stops(page)).toBe(1);
  }

  // With a step selected, left and right walk the selection along the row as they always have,
  // and up, down, Home and End still move along the keys.
  await step(page, 3).click();
  await expect(step(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await key(page, 'E4').focus();
  await page.keyboard.press('ArrowRight');
  await expect(step(page, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(key(page, 'E4'), 'the keyboard stays on its key').toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(key(page, 'F4')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(key(page, 'E4')).toBeFocused();
  await page.keyboard.press('End');
  await expect(key(page, 'B5')).toBeFocused();
  await expect(step(page, 4), 'and the selection stays where it was').toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('the piano roll is a grid to a screen reader: a cell has its step as a column header and its note as a row header', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await lane(page).getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const grid = lane(page).getByRole('grid', { name: 'Piano roll notes', exact: true });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('row')).toHaveCount(37);
  await expect(grid.getByRole('rowheader')).toHaveCount(36);
  await expect(grid.getByRole('columnheader'), 'sixteen steps and the corner over the note names').toHaveCount(17);
  await expect(grid.getByRole('gridcell')).toHaveCount(36 * 16);
  await expect(grid.getByRole('columnheader', { name: 'Step 1', exact: true }), 'the number shown is unchanged').toHaveText('1');
  await expect(grid.getByRole('rowheader', { name: 'C3', exact: true })).toHaveCount(1);

  // A cell is still the button it was, by the same name, inside a cell of the grid.
  const button = grid.getByRole('button', { name: 'D3 step 2', exact: true });
  const cell = grid.getByRole('gridcell').filter({ has: page.getByRole('button', { name: 'D3 step 2', exact: true }) });
  await expect(cell).toHaveCount(1);
  expect(await cell.evaluate((element) => {
    const row = element.closest('[role="row"]')!;
    const column = Array.from(row.querySelectorAll('[role="gridcell"]')).indexOf(element);
    const heads = element.closest('[role="grid"]')!.querySelector('[role="row"]')!.querySelectorAll('[role="columnheader"]');
    return { row: row.querySelector('[role="rowheader"]')!.textContent!.trim(), column: heads[column + 1].getAttribute('aria-label') };
  }), 'its headers are its own note and step').toEqual({ row: 'D3', column: 'Step 2' });

  // The rows and cells have no boxes of their own, so the layout is the one grid it was: the
  // button is under its step's number and beside its note's name.
  const [at, above, beside] = [
    (await button.boundingBox())!,
    (await grid.getByRole('columnheader', { name: 'Step 2', exact: true }).boundingBox())!,
    (await grid.getByRole('rowheader', { name: 'D3', exact: true }).boundingBox())!,
  ];
  expect(Math.abs(at.x - above.x), 'under its step').toBeLessThan(2);
  expect(Math.abs(at.width - above.width)).toBeLessThan(2);
  expect(Math.abs(at.y - beside.y), 'beside its note').toBeLessThan(2);

  // And it is edited from the keyboard as before.
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(grid.getByRole('button', { name: 'D3 step 3', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(grid.getByRole('button', { name: 'D#3 step 3', exact: true })).toBeFocused();
  expect(await grid.locator('.piano-roll-cell').evaluateAll(cells => cells.filter(element => (element as HTMLElement).tabIndex === 0).length), 'still one stop for Tab').toBe(1);
  expect(errors).toEqual([]);
});

test('each unit has a Help button on its name plate that opens Help at the section about it', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'mobile-chromium';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const units = [
    ['Help for scenes and the song', 'Scenes and song', 'song'],
    ['Help for Synth 1', 'Synth lanes', 'synth-1'],
    ['Help for Synth 2', 'Synth lanes', 'synth-2'],
    ['Help for Synth 3', 'Synth lanes', 'synth-3'],
    ['Help for the drums', 'Drums', 'drums'],
    ['Help for the mixer', 'Mixer', 'mixer'],
    ['Help for the effects', 'Effects', 'effects'],
  ] as const;
  for (const [name, title, unit] of units) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button, name).toHaveCount(1);
    expect(await button.evaluate(element => element.closest('[data-unit]')?.getAttribute('data-unit')), `${name} is in its unit`).toBe(unit);

    // The plate is as tall with the button as without it. Measured in one go from the button
    // itself: once it is hidden it can no longer be found by its role.
    const [withIt, without] = await button.evaluate((element) => {
      const help = element as HTMLElement, plate = help.parentElement!;
      const before = plate.getBoundingClientRect().height;
      help.style.display = 'none';
      const after = plate.getBoundingClientRect().height;
      help.style.display = '';
      return [before, after];
    });
    expect(withIt, `${name} does not make its plate taller`).toBe(without);
    if (phone) {
      const area = (await button.boundingBox())!;
      expect(Math.min(area.width, area.height), `${name} is big enough for a finger`).toBeGreaterThanOrEqual(36);
    }

    await button.click();
    const heading = helpDialog(page).getByRole('heading', { name: title, exact: true });
    await expect(heading, `${name} opens Help at ${title}`).toBeFocused();
    await expect(heading).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(helpDialog(page)).toHaveCount(0);
    await expect(button, 'the keyboard goes back to the button').toBeFocused();
  }

  // A lane's name plate still opens the lane, and its Help button does not.
  await page.getByRole('button', { name: 'Synth 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synth 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Help for Synth 1', exact: true }).click();
  await expect(helpDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Synth 1', exact: true }), 'asking for help about a lane does not open it').toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('Help opened from the top bar after a unit\'s own button starts at the top again', async ({ page }) => {
  await page.getByRole('button', { name: 'Help for the effects', exact: true }).click();
  await expect(helpDialog(page).getByRole('heading', { name: 'Effects', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(helpDialog(page)).toHaveCount(0);
  await more(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(helpDialog(page).getByRole('button', { name: 'Close help', exact: true })).toBeFocused();
  await expect(helpDialog(page).getByRole('heading', { name: 'Quick start', exact: true })).toBeInViewport();
  await expect(helpDialog(page).getByRole('heading', { name: 'Effects', exact: true })).not.toBeInViewport();
});

test('a guest instrument\'s unit has a Help button that opens Help at the section about guests', async ({ page }, testInfo) => {
  const address = guestAddress(String(testInfo.project.use.baseURL));
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Guest Instrument', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a guest instrument', exact: true });
  await dialog.getByLabel('Address of the instrument\'s page', { exact: true }).fill(address);
  await dialog.getByRole('button', { name: 'Add Guest', exact: true }).click();
  const unit = page.getByRole('region', { name: /^Guest instrument / });
  await expect(unit).toBeVisible();
  const button = unit.getByRole('button', { name: /^Help for guest / });
  await expect(button).toHaveCount(1);
  await button.click();
  const heading = helpDialog(page).getByRole('heading', { name: 'Guest instruments', exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(helpDialog(page).locator('#help-guests')).toContainText('Add Guest Instrument');
});
