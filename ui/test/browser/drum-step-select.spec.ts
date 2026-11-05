import { expect, test, type Page } from '@playwright/test';

// Shift+click on a drum step selects it and leaves the hit as it is, so its velocity, chance and
// repeats can be changed without removing it. A plain click still adds and removes.

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the desktop rack; the grid is the same markup on a phone');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('Shift+click selects a hit without removing it, and an empty step without adding one', async ({ page }) => {
  const drums = page.getByRole('region', { name: 'Drums module', exact: true });
  const snare = (step: number) => button(page, `Snare step ${step}`);

  await snare(5).click();
  await expect(snare(5), 'a plain click adds a hit').toHaveAttribute('aria-pressed', 'true');
  await snare(9).click();
  await expect(snare(9)).toHaveAttribute('aria-pressed', 'true');
  await expect(drums.getByText('Step 9', { exact: true }), 'the last step clicked is selected').toBeVisible();

  await snare(5).click({ modifiers: ['Shift'] });
  await expect(snare(5), 'the hit is still there').toHaveAttribute('aria-pressed', 'true');
  await expect(drums.getByText('Step 5', { exact: true }), 'and it is the step selected').toBeVisible();

  await drums.getByLabel('Snare step 5 velocity', { exact: true }).fill('0.4');
  await drums.getByLabel('Snare step 5 repeats', { exact: true }).selectOption('3');
  await expect.poll(async () => {
    const row = (await stored(page)).drumState.snare;
    return [row.steps[4], row.stepVelocities?.[4], row.stepRatchets?.[4], row.steps[8]];
  }, 'the details are set on the hit selected').toEqual([true, 0.4, 3, true]);

  await snare(12).click({ modifiers: ['Shift'] });
  await expect(snare(12), 'an empty step stays empty').toHaveAttribute('aria-pressed', 'false');
  await expect(drums.getByText('Step 12', { exact: true })).toBeVisible();

  await snare(5).click();
  await expect(snare(5), 'a plain click still removes a hit').toHaveAttribute('aria-pressed', 'false');
});
