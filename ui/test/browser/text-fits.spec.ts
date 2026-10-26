import { expect, test, type Locator, type Page } from '@playwright/test';

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

// Words must be whole where a person reads them. Each check measures what is on the screen: a box at
// least as wide as its content, a code on one line, a name that is not squeezed to a word.

const apiUrl = (baseURL: string) => `http://127.0.0.1:${Number(new URL(baseURL).port) + 1000}`;

test.beforeEach(async ({ page, request }, testInfo) => {
  await request.post(`${apiUrl(String(testInfo.project.use.baseURL))}/__reset`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

// What is cut off in each element: its content is wider than its box, or its text runs past its edge.
const clipped = (locator: Locator) => locator.evaluateAll(found => found.filter(element => {
  if (element.scrollWidth > element.clientWidth) return true;
  if (element instanceof HTMLInputElement) return false;
  const range = document.createRange();
  range.selectNodeContents(element);
  const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
  return text.right > box.right + 0.5 || text.left < box.left - 0.5;
}).map(element => `${element.className} "${(element as HTMLInputElement).value ?? ''}${element.textContent ?? ''}"`));

test('the Scene and Song switch shows both words whole', async ({ page }) => {
  const switches = page.getByRole('group', { name: 'Play mode', exact: true }).getByRole('button');
  await expect(switches).toHaveText(['Scene', 'Song']);
  await expect.poll(() => clipped(switches)).toEqual([]);
});

test('knob figures show all of their unit, in the effects and the drums', async ({ page }) => {
  const figures = page.locator('.effects-unit, [data-unit="drums"]').locator('.knob-value-input, .drum-knob-value-input');
  await expect(figures.first()).toBeVisible();
  await expect.poll(() => clipped(figures)).toEqual([]);
  // The longest figure a knob shows, in every box.
  await figures.evaluateAll(found => found.forEach(input => { (input as HTMLInputElement).value = '-12.00 st'; }));
  await expect.poll(() => clipped(figures)).toEqual([]);
});

test('the delay\'s On button and its Sync menu have a gap between them', async ({ page }) => {
  const on = page.getByRole('switch', { name: 'Delay enabled', exact: true });
  const sync = page.getByLabel('Delay sync', { exact: true }).locator('xpath=ancestor::label');
  await expect(on).toBeVisible();
  const [first, second] = [(await on.boundingBox())!, (await sync.boundingBox())!];
  const gap = second.x - (first.x + first.width);
  expect(gap, 'the pixels between "On" and "Sync"').toBeGreaterThanOrEqual(8);
});

async function createAccount(page: Page) {
  await more(page);
  await page.getByRole('button', { name: /^(Sign in|Account: .+)$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Account', exact: true });
  await dialog.getByRole('tab', { name: 'Create Account', exact: true }).click();
  await dialog.getByLabel('Username', { exact: true }).fill('Ian');
  await dialog.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await dialog.getByLabel('Invite code', { exact: true }).fill('browser-test-owner');
  await dialog.getByLabel('Password', { exact: true }).press('Enter');
  return dialog;
}

test('the recovery code is on one line, whole', async ({ page }) => {
  const dialog = await createAccount(page);
  const code = dialog.getByLabel('Your new recovery code', { exact: true });
  await expect(code).toHaveText(/^(\w{5}-){4}\w{5}$/);
  await expect.poll(() => code.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top)));
    return { lines: lines.size, fits: element.scrollWidth <= element.clientWidth };
  })).toEqual({ lines: 1, fits: true });
});

test('in the signed-in Projects list a name is not squeezed, and the words under it are whole', async ({ page }) => {
  const dialog = await createAccount(page);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toContainText('Signed in as Ian');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
  await projects.locator('.rack-list-row.current').getByRole('button', { name: 'Rename', exact: true }).click();
  await projects.getByLabel('Project name', { exact: true }).fill('Friday Night');
  await projects.getByLabel('Project name', { exact: true }).press('Enter');
  const row = projects.getByRole('group', { name: 'Project Friday Night', exact: true });
  await expect(row).toBeVisible();

  const narrow = (page.viewportSize()?.width ?? 0) <= 720;
  await expect.poll(() => row.evaluate((element, below) => {
    const name = element.querySelector('strong')!.getBoundingClientRect(), text = element.firstElementChild!;
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('strong')!);
    const found: string[] = [];
    if (new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top))).size !== 1) found.push('the name is on more than one line');
    if (text.scrollWidth > text.clientWidth || text.scrollHeight > text.clientHeight) found.push('the words under the name are cut off');
    if (below) {
      if (name.width < element.getBoundingClientRect().width * 0.6) found.push(`the name is only ${Math.round(name.width)}px wide`);
      for (const button of Array.from(element.querySelectorAll('button'))) {
        if (button.getBoundingClientRect().top < text.getBoundingClientRect().bottom - 1) found.push(`${button.textContent} is beside the name`);
      }
    }
    return found;
  }, narrow)).toEqual([]);
});
