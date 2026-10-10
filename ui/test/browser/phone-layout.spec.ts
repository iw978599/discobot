import { expect, test, type Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const box = async (locator: Locator) => (await locator.first().boundingBox())!;

test('on a phone the rack fits the screen, with steps eight to a row and controls a finger can hit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'this is the narrow layout');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const view = page.viewportSize()!;
  const scroller = page.locator('.rack-page');
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const step = (number: number) => box(lane.getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) }));
  const drum = (number: number) => box(page.getByRole('button', { name: `Kick step ${number}`, exact: true }));

  // Nothing runs off the side, so the page only scrolls up and down.
  expect(await scroller.evaluate(element => element.scrollWidth - element.clientWidth), 'no sideways scrolling').toBeLessThanOrEqual(1);
  for (const unit of await page.locator('.rack-unit').all()) {
    const area = (await unit.boundingBox())!;
    expect(area.x, 'a unit starts on screen').toBeGreaterThanOrEqual(0);
    expect(area.x + area.width, 'and ends on it').toBeLessThanOrEqual(view.width + 1);
  }

  // A lane's sixteen steps are two rows of eight, each big enough to press.
  const [first, eighth, ninth, last] = [await step(1), await step(8), await step(9), await step(16)];
  expect(eighth.y).toBeCloseTo(first.y, 0);
  expect(ninth.y, 'step 9 starts the second row').toBeGreaterThan(first.y + first.height - 1);
  expect(ninth.x).toBeCloseTo(first.x, 0);
  expect(last.x).toBeCloseTo(eighth.x, 0);
  expect(first.width).toBeGreaterThanOrEqual(36);
  expect(first.height).toBeGreaterThanOrEqual(40);

  // The drum grid the same, and its mute buttons are not slivers.
  const [kick, kickEighth, kickNinth] = [await drum(1), await drum(8), await drum(9)];
  expect(kickEighth.y).toBeCloseTo(kick.y, 0);
  expect(kickNinth.y).toBeGreaterThan(kick.y + kick.height - 1);
  expect(kickNinth.x).toBeCloseTo(kick.x, 0);
  expect(kick.width).toBeGreaterThanOrEqual(24);
  expect(kick.height).toBeGreaterThanOrEqual(28);
  expect((await box(page.getByRole('button', { name: 'Mute Kick', exact: true }))).height).toBeGreaterThanOrEqual(28);

  // The keyboard is wider than the screen and slides, so a key is wide enough to play.
  expect(await page.locator('.keyboard-container').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect((await box(page.locator('.key.white'))).width).toBeGreaterThanOrEqual(24);

  // Play is on screen without scrolling sideways, and stays there when the rack is scrolled.
  const play = page.getByRole('button', { name: /Play All/ });
  for (const scrolled of [false, true]) {
    if (scrolled) await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight));
    const area = await box(play);
    expect(area.x).toBeGreaterThanOrEqual(0);
    expect(area.x + area.width).toBeLessThanOrEqual(view.width);
    expect(area.y).toBeGreaterThanOrEqual(0);
    expect(area.y + area.height).toBeLessThan(view.height / 2);
    // Scrolled, the bar is down to its last line: Play at the very top, the menus gone above it.
    if (scrolled) {
      expect(area.y, 'Play is the line that stays').toBeLessThan(30);
      expect((await box(page.getByRole('button', { name: 'Project ▾', exact: true }))).y, 'the menus have scrolled away').toBeLessThan(0);
    }
  }
  await scroller.evaluate(element => element.scrollTo(0, 0));

  // A menu comes up from the bottom, wholly on screen, with rows a finger can hit.
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  const list = await box(page.getByRole('menu', { name: 'Project', exact: true }));
  expect(list.x).toBeGreaterThanOrEqual(0);
  expect(list.x + list.width).toBeLessThanOrEqual(view.width);
  expect(list.y).toBeGreaterThanOrEqual(0);
  expect(list.y + list.height).toBeLessThanOrEqual(view.height);
  expect((await box(page.getByRole('menuitem', { name: 'New Project', exact: true }))).height).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Escape');

  // A dialog is the whole screen.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const help = await box(page.getByRole('dialog', { name: 'How to use Discobot', exact: true }));
  expect(help.x).toBe(0);
  expect(help.width).toBeCloseTo(view.width, 0);
  expect(help.height).toBeGreaterThanOrEqual(view.height - 1);
  await page.getByRole('button', { name: 'Close help', exact: true }).click();

  // And it still works: a drum hit and a note go on, on the second row.
  await page.getByRole('button', { name: 'Kick step 9', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 9', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lane.getByRole('button', { name: /^Select step 9( |$)/ }).click();
  await page.keyboard.press('a');
  await expect(lane.getByRole('button', { name: /^Select step 9 C/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a wide screen keeps the rack as one panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'this is the wide layout');
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const step = (number: number) => box(lane.getByRole('button', { name: new RegExp(`^Select step ${number}( |$)`) }));
  expect((await step(16)).y, 'sixteen steps in one row').toBeCloseTo((await step(1)).y, 0);
  expect((await box(page.getByRole('button', { name: 'Kick step 16', exact: true }))).y).toBeCloseTo((await box(page.getByRole('button', { name: 'Kick step 1', exact: true }))).y, 0);
  expect(await page.locator('.rack').evaluate(element => getComputedStyle(element).minWidth)).toBe('1060px');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  expect((await box(page.getByRole('dialog', { name: 'How to use Discobot', exact: true }))).width, 'a dialog is a panel, not the whole screen').toBeLessThanOrEqual(680);
});
