import { expect, test, type Locator, type Page } from '@playwright/test';

// The open lane's editor has two levels: Notes, what the lane plays, and Sound, what it sounds
// like. Sound holds the model, the presets and their tools, and under them a page for each part
// of the sound.
const PROJECT_KEY = 'discobot_browser_project_v1';
const PAGES = ['Osc', 'Filter', 'Amp', 'LFO', 'Arp', 'Inserts', 'Sends'];
const sound = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.stringify(JSON.parse(localStorage.getItem(key) || '{}').synths?.[0]?.synthParams ?? null)), PROJECT_KEY);
const phone = (page: Page) => page.viewportSize()!.width <= 720;

const lane = (page: Page, id = 1) => page.getByRole('region', { name: `Synth ${id} module`, exact: true });
const levels = (scope: Locator) => scope.getByRole('tablist', { name: 'Synth editor', exact: true });
const pages = (scope: Locator) => scope.getByRole('tablist', { name: 'Sound pages', exact: true });
const tab = (scope: Locator, name: string) => scope.getByRole('tab', { name, exact: true });
const picker = (scope: Locator) => scope.getByRole('button', { name: /^Synth preset/ });
// Where something is inside its lane, so a page that scrolls does not count as the thing moving.
const placed = async (scope: Locator, target: Locator) => {
  const [outer, inner] = [(await scope.boundingBox())!, (await target.boundingBox())!];
  return { x: Math.round(inner.x - outer.x), y: Math.round(inner.y - outer.y), width: Math.round(inner.width), height: Math.round(inner.height) };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a lane opens on Notes, and Sound holds the model, the presets and the pages of the sound', async ({ page }) => {
  const first = lane(page);
  await expect(levels(first).getByRole('tab')).toHaveText(['Notes', 'Sound']);
  await expect(tab(first, 'Notes')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(first, 'Sound')).toHaveAttribute('aria-selected', 'false');

  // Notes is what is played, and nothing about the sound.
  await expect(first.locator('.keyboard-panel')).toBeVisible();
  await expect(first.getByLabel('Sequence length', { exact: true })).toBeVisible();
  await expect(picker(first), 'the presets are not on Notes').toHaveCount(0);
  await expect(first.getByRole('button', { name: /^Synth model: / })).toHaveCount(0);
  await expect(pages(first)).toHaveCount(0);
  for (const name of PAGES) await expect(tab(first, name), `${name} is under Sound`).toHaveCount(0);

  const before = { notes: await placed(first, tab(first, 'Notes')), sound: await placed(first, tab(first, 'Sound')), hold: await placed(first, first.locator('.synth-level-row .synth-toggle')) };
  await tab(first, 'Sound').click();
  await expect(tab(first, 'Sound')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(first, 'Notes')).toHaveAttribute('aria-selected', 'false');

  // Sound: the model and the presets with their tools first, then the pages.
  await expect(first.getByRole('button', { name: /^Synth model: / })).toBeVisible();
  await expect(picker(first)).toBeVisible();
  await expect(first.getByLabel('Preset name', { exact: true })).toBeVisible();
  for (const name of ['Save', 'Delete', 'Export']) await expect(first.locator('.preset-controls').getByRole('button', { name, exact: true }), name).toBeVisible();
  await expect(first.getByLabel('Import synth preset', { exact: true })).toBeAttached();
  await expect(pages(first).getByRole('tab')).toHaveText(PAGES);
  await expect(tab(first, 'Osc'), 'Sound opens on its first page').toHaveAttribute('aria-selected', 'true');
  await expect(first.getByLabel('Oscillator waveform', { exact: true })).toBeVisible();
  await expect(first.locator('.keyboard-panel'), 'the keyboard and piano roll are on Notes').toHaveCount(0);
  const presets = (await picker(first).boundingBox())!, row = (await pages(first).boundingBox())!;
  expect(presets.y + presets.height, 'the presets are above the pages').toBeLessThanOrEqual(row.y + 1);

  // The line the two levels are on is the same on both, so nothing above what was opened has moved.
  expect(await placed(first, tab(first, 'Notes')), 'Notes has not moved').toEqual(before.notes);
  expect(await placed(first, tab(first, 'Sound')), 'Sound has not moved').toEqual(before.sound);
  expect(await placed(first, first.locator('.synth-level-row .synth-toggle')), 'Hold has not moved').toEqual(before.hold);

  // Going from page to page leaves the row of pages where it is.
  const osc = await placed(first, tab(first, 'Osc'));
  for (const name of PAGES) {
    await tab(first, name).click();
    await expect(tab(first, name)).toHaveAttribute('aria-selected', 'true');
    await expect(pages(first).locator('[aria-selected="true"]'), 'one page is open at a time').toHaveCount(1);
    expect(await placed(first, tab(first, 'Osc')), `the row of pages has not moved for ${name}`).toEqual(osc);
  }
  await expect(first.getByLabel('Duck value', { exact: true })).toBeVisible();

  // Sound comes back on the page it was left on.
  await tab(first, 'Filter').click();
  await tab(first, 'Notes').click();
  await expect(first.locator('.keyboard-panel')).toBeVisible();
  await expect(pages(first)).toHaveCount(0);
  await tab(first, 'Sound').click();
  await expect(tab(first, 'Filter')).toHaveAttribute('aria-selected', 'true');
  await expect(first.getByLabel('Filter type', { exact: true })).toBeVisible();

  expect(await page.locator('.rack-page').evaluate(element => element.scrollWidth - element.clientWidth), 'no sideways scrolling').toBeLessThanOrEqual(1);
  if (phone(page)) {
    for (const name of ['Notes', 'Sound']) expect((await tab(first, name).boundingBox())!.height, `${name} is big enough for a thumb`).toBeGreaterThanOrEqual(30);
    const [notes, hold] = [(await tab(first, 'Notes').boundingBox())!, (await first.locator('.synth-level-row .synth-toggle').boundingBox())!];
    expect(hold.y, 'the levels and Hold share one line').toBeLessThan(notes.y + notes.height);
  }
});

test('both rows of tabs are one Tab stop each, and the arrow keys move along them', async ({ page }) => {
  const first = lane(page);
  // A selected step is walked by the arrow keys; in a row of tabs they belong to the tabs.
  await first.getByRole('button', { name: /^Select step 1( |$)/ }).click();
  const selected = first.locator('.step-cell.selected');
  await expect(selected).toHaveCount(1);
  const step = await selected.getAttribute('aria-label');

  await expect(tab(first, 'Notes')).toHaveAttribute('tabindex', '0');
  await expect(tab(first, 'Sound')).toHaveAttribute('tabindex', '-1');
  await tab(first, 'Notes').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(first, 'Sound')).toBeFocused();
  await expect(tab(first, 'Sound'), 'moving to a level opens it').toHaveAttribute('aria-selected', 'true');
  await expect(tab(first, 'Sound')).toHaveAttribute('tabindex', '0');
  await expect(tab(first, 'Notes')).toHaveAttribute('tabindex', '-1');
  await expect(picker(first)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tab(first, 'Notes'), 'the arrows go round from the last to the first').toBeFocused();
  await expect(first.locator('.keyboard-panel')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(first, 'Sound')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(first, 'Notes')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab(first, 'Sound')).toBeFocused();
  await expect(tab(first, 'Sound')).toHaveAttribute('aria-selected', 'true');

  // The pages of the sound are a row of their own.
  await expect(pages(first).locator('[tabindex="0"]')).toHaveCount(1);
  await tab(first, 'Osc').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(first, 'Filter')).toBeFocused();
  await expect(tab(first, 'Filter')).toHaveAttribute('aria-selected', 'true');
  await expect(first.getByLabel('Filter type', { exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab(first, 'Sends')).toBeFocused();
  await expect(tab(first, 'Sends')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tab(first, 'Osc')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(first, 'Sends')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(first, 'Osc')).toBeFocused();
  await expect(tab(first, 'Osc')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(first, 'Sound'), 'the level is still Sound').toHaveAttribute('aria-selected', 'true');
  await expect(pages(first).locator('[tabindex="0"]'), 'only the open page is a Tab stop').toHaveCount(1);

  // Space and Enter press a tab, as they press any button.
  await tab(first, 'Notes').focus();
  await page.keyboard.press('Enter');
  await expect(tab(first, 'Notes')).toHaveAttribute('aria-selected', 'true');
  await tab(first, 'Sound').focus();
  await page.keyboard.press('Space');
  await expect(tab(first, 'Sound')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Stop All/ }), 'Space on a tab is not Play').toHaveCount(0);

  await expect(selected, 'the selected step was not walked along its row').toHaveAttribute('aria-label', step!);
});

test('a preset is chosen on Sound, and its name is still on the button after a look at the notes', async ({ page }) => {
  const first = lane(page);
  await expect.poll(() => sound(page)).not.toBe('null');
  const before = await sound(page);

  await tab(first, 'Sound').click();
  await expect(picker(first)).toHaveAccessibleName('Synth preset: Preset…');
  await picker(first).click();
  await first.locator('[role="menuitem"][data-group="Bass"]').click();
  const rows = first.getByRole('menu', { name: 'Bass', exact: true }).locator('[role="menuitem"]:not([data-back])');
  await expect(rows.first()).toBeVisible();
  const name = (await rows.first().getAttribute('aria-label'))!;
  await rows.first().click();
  await expect(picker(first)).toHaveAccessibleName(`Synth preset: ${name}`);
  await expect.poll(() => sound(page), 'the lane has the preset\'s sound').not.toBe(before);

  await tab(first, 'Notes').click();
  await expect(picker(first)).toHaveCount(0);
  await tab(first, 'Sound').click();
  await expect(picker(first), 'the button still says what was loaded').toHaveAccessibleName(`Synth preset: ${name}`);
});

test('the level is each lane\'s own for the visit, and is not saved with the project', async ({ page }) => {
  const first = lane(page), second = lane(page, 2);
  await tab(first, 'Sound').click();
  await tab(first, 'Amp').click();
  await expect(tab(first, 'Amp')).toHaveAttribute('aria-selected', 'true');

  // Another lane opens on Notes whatever this one was on.
  await second.getByRole('button', { name: 'Synth 2', exact: true }).click();
  await expect(tab(second, 'Notes')).toHaveAttribute('aria-selected', 'true');
  await expect(second.locator('.keyboard-panel')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Synth editor', exact: true }), 'only the open lane has an editor').toHaveCount(1);

  // The first lane is where it was left.
  await first.getByRole('button', { name: 'Synth 1', exact: true }).click();
  await expect(tab(first, 'Sound')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(first, 'Amp')).toHaveAttribute('aria-selected', 'true');

  // It is how the editor is being looked at, not part of the song: a reload starts on Notes.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(tab(first, 'Notes')).toHaveAttribute('aria-selected', 'true');
  await expect(first.locator('.keyboard-panel')).toBeVisible();
});
