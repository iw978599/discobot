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

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), PROJECT_KEY);

const HEADINGS = ['Quick start', 'Top row', 'Scenes and song', 'Synth lanes', 'Drums', 'Mixer', 'Effects', 'Guest instruments', 'Keys'];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

const openHelp = async (page: Page) => {
  await more(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'How to use Discobot', exact: true });
  await expect(help).toBeVisible();
  return help;
};

test('Help lists its headings, and each one goes to its section', async ({ page }) => {
  const help = await openHelp(page);
  const contents = help.getByRole('navigation', { name: 'Help sections', exact: true });
  await expect(contents.getByRole('button')).toHaveText(HEADINGS);
  await expect(help.locator('.help-sections section:visible')).toHaveCount(HEADINGS.length);
  await expect(help.getByRole('status'), 'nothing is said until something is typed').toHaveText('');

  const keys = help.getByRole('heading', { name: 'Keys', exact: true });
  await expect(keys, 'the last section starts off the screen').not.toBeInViewport();
  await contents.getByRole('button', { name: 'Keys', exact: true }).click();
  await expect(keys).toBeInViewport();
  await expect(keys, 'the heading has the keyboard, so a screen reader reads on from it').toBeFocused();

  // Tab from the heading goes back to the list, not out of the dialog.
  await page.keyboard.press('Tab');
  await expect(contents.getByRole('button', { name: 'Keys', exact: true })).toBeFocused();

  await contents.getByRole('button', { name: 'Quick start', exact: true }).click();
  await expect(help.getByRole('heading', { name: 'Quick start', exact: true })).toBeInViewport();
  await expect(keys).not.toBeInViewport();
});

test('a search leaves only the sections that match, says when nothing does, and can be cleared', async ({ page }) => {
  const help = await openHelp(page);
  const contents = help.getByRole('navigation', { name: 'Help sections', exact: true });
  const search = help.getByLabel('Search Help', { exact: true });
  const count = help.getByRole('status');
  const shown = help.locator('.help-sections section:visible h3');
  const clear = help.getByRole('button', { name: 'Clear search', exact: true });
  await expect(clear, 'nothing to clear yet').toBeDisabled();

  await search.fill('kick');
  await expect(shown).toHaveText(['Synth lanes', 'Drums']);
  await expect(contents.getByRole('button')).toHaveText(['Synth lanes', 'Drums']);
  await expect(count).toHaveText('2 of 9 sections match.');
  await expect(help.getByRole('heading', { name: 'Keys', exact: true })).toHaveCount(0);

  // Capitals do not matter, and every word typed has to be in the section.
  await search.fill('UNISON');
  await expect(shown).toHaveText(['Synth lanes']);
  await expect(count).toHaveText('1 of 9 sections matches.');
  await search.fill('kick import');
  await expect(shown).toHaveText(['Drums']);

  // A heading in the narrowed list still goes to its section.
  await contents.getByRole('button', { name: 'Drums', exact: true }).click();
  await expect(help.getByRole('heading', { name: 'Drums', exact: true })).toBeFocused();

  await search.fill('zebra');
  await expect(shown).toHaveCount(0);
  await expect(contents, 'no headings to offer').toHaveCount(0);
  await expect(count).toHaveText('Nothing in Help matches “zebra”.');
  await expect(help.getByRole('button', { name: 'Show the Walkthrough', exact: true }), 'the walkthrough is still offered').toBeVisible();

  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search, 'the keyboard goes back to the box').toBeFocused();
  await expect(shown).toHaveText(HEADINGS);
  await expect(contents.getByRole('button')).toHaveText(HEADINGS);
  await expect(count).toHaveText('');
  await expect(clear).toBeDisabled();
});

test('Escape closes Help from the search box, and it opens again with nothing typed', async ({ page }) => {
  let help = await openHelp(page);
  const search = help.getByLabel('Search Help', { exact: true });
  await search.fill('drum');
  // A letter that would play a note on the rack is typed into the box.
  await search.pressSequentially('s');
  await expect(search).toHaveValue('drums');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  help = await openHelp(page);
  await expect(help.getByLabel('Search Help', { exact: true })).toHaveValue('');
  await expect(help.locator('.help-sections section:visible')).toHaveCount(HEADINGS.length);
});
