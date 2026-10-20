import { expect, test, type Locator } from '@playwright/test';

// A picture of the sound (roadmap 21): the open lane's, on its Sound level, and the whole mix's, on
// the mixer. Each says how much it has to show in `data-peak`, which the page never renders.

const peak = async (picture: Locator) => Number((await picture.getAttribute('data-peak')) ?? 0);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the open lane and the mixer each show the sound as a wave or a spectrum', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  const wave = page.getByRole('img', { name: 'Synth 1: the wave as it sounds now', exact: true });
  await expect(wave).toBeVisible();
  // Nothing has sounded, so there is nothing to see, and no audio was started to look.
  await expect(wave).toHaveAttribute('data-peak', '0.00');

  // A note a whole bar long, played by the transport. (A key held on the on-screen keyboard is let
  // go when the Notes level is left, which unmounts the keyboard.)
  await page.getByRole('tab', { name: 'Notes', exact: true }).first().click();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).first().click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByLabel('Step 1 note length', { exact: true }).first().selectOption('16');
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await expect.poll(() => peak(wave), { timeout: 10000 }).toBeGreaterThan(0.01);

  await page.getByRole('group', { name: 'Synth 1 picture', exact: true }).getByRole('button', { name: 'Spectrum', exact: true }).click();
  const spectrum = page.getByRole('img', { name: 'Synth 1: the spectrum as it sounds now', exact: true });
  await expect(spectrum).toHaveAttribute('data-mode', 'spectrum');
  await expect.poll(() => peak(spectrum), { timeout: 10000 }).toBeGreaterThan(0.05);

  const main = page.getByRole('img', { name: 'Mixer main: the wave as it sounds now', exact: true });
  await main.scrollIntoViewIfNeeded();
  await expect.poll(() => peak(main), { timeout: 10000 }).toBeGreaterThan(0.01);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect(errors).toEqual([]);
});
