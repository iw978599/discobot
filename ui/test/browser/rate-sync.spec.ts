import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('the phaser, the chorus and a sequence of waves can each follow the tempo, and turning the knob sets them free again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const effects = page.locator('.effects-unit');
  const phaserSync = effects.getByLabel('Phaser sync', { exact: true });
  const phaserRate = effects.getByLabel('Phaser rate value', { exact: true });
  const chorusSync = effects.getByLabel('Chorus sync', { exact: true });

  // Free to begin with, as every project was before there was a choice.
  await expect(phaserSync).toHaveValue('off');
  await expect(chorusSync).toHaveValue('off');
  expect('sync' in (await stored(page)).effectsLoop.phaser).toBe(false);

  await phaserSync.selectOption({ label: '1/4' });
  await expect.poll(async () => (await stored(page)).effectsLoop.phaser.sync).toBe('1/4');
  await expect(phaserRate, 'the knob says what it is following').toHaveValue('1/4');
  await chorusSync.selectOption({ label: '2 bars' });
  await expect.poll(async () => (await stored(page)).effectsLoop.chorus?.sync).toBe('2bar');
  await expect(effects.getByLabel('Chorus rate value', { exact: true })).toHaveValue('2 bars');

  // It plays, and the tempo can change under it.
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(400);
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('90');
  await page.locator('.tempo-led-input').press('Enter');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Still synced after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(page.locator('.effects-unit').getByLabel('Phaser sync', { exact: true })).toHaveValue('1/4');
  await expect(page.locator('.effects-unit').getByLabel('Chorus sync', { exact: true })).toHaveValue('2bar');

  // A rate typed into the knob is a free rate, and the menu goes back to Free.
  const rate = page.locator('.effects-unit').getByLabel('Phaser rate value', { exact: true });
  await rate.fill('2');
  await rate.press('Enter');
  await expect.poll(async () => { const now = (await stored(page)).effectsLoop.phaser; return ['sync' in now, now.rate]; }).toEqual([false, 2]);
  await expect(page.locator('.effects-unit').getByLabel('Phaser sync', { exact: true })).toHaveValue('off');
  await page.locator('.effects-unit').getByLabel('Chorus sync', { exact: true }).selectOption({ label: 'Free' });
  await expect.poll(async () => 'sync' in ((await stored(page)).effectsLoop.chorus ?? {})).toBe(false);

  // A sequence of waves steps in time.
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  await synth.getByLabel('Synth engine', { exact: true }).selectOption('sample');
  await synth.getByLabel('Synth sample', { exact: true }).selectOption({ label: 'Sequence: FM' });
  const sequenceSync = synth.getByLabel('Sequence sync', { exact: true });
  await expect(sequenceSync).toHaveValue('off');
  await sequenceSync.selectOption({ label: '1/16' });
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.sample.sync).toBe('1/16');
  await expect(synth.getByLabel('Sequence speed value', { exact: true })).toHaveValue('1/16');
  await sequenceSync.selectOption({ label: 'Free' });
  await expect.poll(async () => 'sync' in (await stored(page)).synths[0].synthParams.sample).toBe(false);
  expect(errors).toEqual([]);
});
