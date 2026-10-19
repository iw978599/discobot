import { expect, test, type Page } from '@playwright/test';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide
// screen; `less` puts it away again after something that leaves it up.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
const less = async (page: Page) => {
  if (await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close more controls', exact: true }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const group = (page: Page) => page.getByRole('group', { name: 'Metronome', exact: true });
const click = (page: Page) => group(page).getByRole('button', { name: 'Click', exact: true });
const count = (page: Page) => group(page).getByRole('button', { name: 'Count', exact: true });
const playing = (page: Page) => page.locator('.drum-step-btn.current');
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('discobot_metronome_v1') || 'null'));

async function setTempo(page: Page, bpm: number) {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill(String(bpm));
  await page.locator('.tempo-led-input').press('Enter');
}

test('the metronome and the count-in are switches beside the tempo, off to begin with, and kept for the next visit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await more(page);
  await expect(click(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(count(page)).toHaveAttribute('aria-pressed', 'false');

  await click(page).click();
  await expect(click(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toEqual({ click: true, countIn: false });
  // It is this browser's, not the project's: nothing about it is saved with the song.
  const project = await page.evaluate(() => localStorage.getItem('discobot_browser_project_v1') || '');
  expect(project).not.toContain('countIn');
  await less(page);

  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(playing(page).first()).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Stop All/ }).click();

  await more(page);
  await count(page).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await more(page);
  await expect(click(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(count(page)).toHaveAttribute('aria-pressed', 'true');
  await click(page).click();
  await count(page).click();
  expect(await stored(page)).toEqual({ click: false, countIn: false });
  expect(errors).toEqual([]);
});

test('with the count-in on, a bar goes by before anything plays', async ({ page }) => {
  // At 60 a bar is four seconds: long enough to tell a count-in from a slow start.
  await setTempo(page, 60);
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(playing(page).first(), 'without a count-in the first step lights at once').toBeVisible({ timeout: 1500 });
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(playing(page)).toHaveCount(0);

  await more(page);
  await count(page).click();
  await less(page);
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(2000);
  await expect(playing(page), 'half way through the count-in nothing is playing yet').toHaveCount(0);
  await expect(playing(page).first(), 'and after the bar it starts').toBeVisible({ timeout: 6000 });
  await page.getByRole('button', { name: /Stop All/ }).click();
});

test('the count-in can last two or four bars, and the click has a level, both kept for the next visit', async ({ page }) => {
  // At 120 a bar is two seconds, so two bars are four.
  await setTempo(page, 120);
  await more(page);
  await count(page).click();
  await group(page).getByLabel('Count-in length', { exact: true }).selectOption('2');
  const level = group(page).getByRole('slider', { name: 'Click level', exact: true });
  await expect(level).toHaveAttribute('aria-valuenow', '0.5');
  await level.focus();
  for (let n = 0; n < 3; n++) await level.press('ArrowDown');
  await expect.poll(async () => (await stored(page))?.bars).toBe(2);
  expect((await stored(page)).level).toBeLessThan(0.5);
  await less(page);

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(3000);
  await expect(playing(page), 'three seconds into a two-bar count-in nothing is playing yet').toHaveCount(0);
  await expect(playing(page).first(), 'and after the second bar it starts').toBeVisible({ timeout: 4000 });
  await page.getByRole('button', { name: /Stop All/ }).click();

  await page.reload();
  await more(page);
  await expect(group(page).getByLabel('Count-in length', { exact: true })).toHaveValue('2');
  await expect(group(page).getByRole('slider', { name: 'Click level', exact: true })).not.toHaveAttribute('aria-valuenow', '0.5');
});
