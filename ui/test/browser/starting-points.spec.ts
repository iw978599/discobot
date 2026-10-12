import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

const offer = (page: Page) => page.getByRole('region', { name: 'Starting points', exact: true });
const tempo = (page: Page) => page.locator('.tempo-led-value');
const kick = (page: Page, step: number) => page.getByRole('button', { name: `Kick step ${step}`, exact: true });
const lane = (page: Page) => page.getByRole('region', { name: 'Synth 1 module', exact: true });

test('an empty project offers beats to start from, and one press fills it in', async ({ page }) => {
  await expect(offer(page)).toBeVisible();
  await expect(tempo(page)).toHaveText('120');
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'false');

  await offer(page).getByRole('button', { name: 'House Beat', exact: true }).click();
  await expect(tempo(page)).toHaveText('124');
  for (const step of [1, 5, 9, 13]) await expect(kick(page, step)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(page, 2)).toHaveAttribute('aria-pressed', 'false');
  await expect(lane(page).getByRole('button', { name: 'Select step 3 C3', exact: true })).toBeVisible();
  await expect(lane(page).getByRole('button', { name: 'Select step 15 D#3', exact: true })).toBeVisible();
  await expect(offer(page), 'the project is no longer empty, so the offer is gone').toHaveCount(0);

  // It was one edit: one undo empties the project again and the offer comes back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'false');
  await expect(tempo(page)).toHaveText('120');
  await expect(offer(page)).toBeVisible();
});

test('the offer can be turned down, and goes away once anything is put in', async ({ page }) => {
  await offer(page).getByRole('button', { name: 'Leave It Empty', exact: true }).click();
  await expect(offer(page)).toHaveCount(0);
  await expect(kick(page, 1), 'nothing was put in').toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(offer(page), 'a project that is still empty offers again on the next visit').toBeVisible();
  await kick(page, 1).click();
  await expect(kick(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(offer(page)).toHaveCount(0);
});
