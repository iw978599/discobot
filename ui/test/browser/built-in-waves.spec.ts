import { expect, test, type Page } from '@playwright/test';

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
const sound = async (page: Page) => (await stored(page)).synths[0].synthParams;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
});

test('the sample engine offers the app\'s own sounds, fetched from this site, and the three models that use them set them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'Sound', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Osc', exact: true }).first().click();
  const sample = synth.getByLabel('Synth sample', { exact: true });
  const root = synth.getByRole('slider', { name: 'Sample root note', exact: true });

  await synth.getByLabel('Synth engine', { exact: true }).selectOption('sample');
  await sample.selectOption({ label: 'Piano' });
  await expect.poll(async () => (await sound(page)).sample.wave).toBe('piano');
  await expect(synth.locator('.synth-sample-note')).toHaveCount(0);
  // A built-in sound knows its own notes, so there is no root to set, and a piano is not a sequence.
  await expect(root).toHaveAttribute('aria-disabled', 'true');
  await expect(synth.getByRole('slider', { name: 'Sequence speed', exact: true })).toHaveCount(0);
  // The sounds are a file of the app's own, on this site.
  // It is fetched as the app starts, for the drums' cymbals, so here it is asked for again and looked at.
  const file = await page.evaluate(async () => {
    const response = await fetch('waves.bin');
    return { status: response.status, sameSite: new URL(response.url).origin === location.origin, bytes: (await response.arrayBuffer()).byteLength };
  });
  expect(file.status).toBe(200);
  expect(file.sameSite).toBe(true);
  expect(file.bytes).toBeGreaterThan(100_000);

  // A sequence of waves has a speed and a crossfade.
  await sample.selectOption({ label: 'Sequence: FM' });
  const speed = synth.getByLabel('Sequence speed value', { exact: true });
  await speed.fill('8');
  await speed.press('Enter');
  await synth.getByLabel('Sequence crossfade value', { exact: true }).fill('25');
  await synth.getByLabel('Sequence crossfade value', { exact: true }).press('Enter');
  await expect.poll(async () => { const now = (await sound(page)).sample; return [now.wave, now.scan, now.fade]; }).toEqual(['seq-fm', 8, 0.25]);

  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Each of the three models puts the lane on the sample engine with one of the app's sounds.
  const model = synth.getByLabel('Synth model', { exact: true });
  for (const [id, wave] of [['m1', /^(piano|mallet|organ|choir)$/], ['d-50', /^attack-/], ['wavestation', /^seq-/]] as const) {
    await model.selectOption(id);
    await expect.poll(async () => (await sound(page)).engine, { message: id }).toBe('sample');
    await expect.poll(async () => (await sound(page)).sample.wave, { message: id }).toMatch(wave);
    await expect(sample.locator('option:checked')).not.toHaveText('Not in this version');
  }
  // And another model takes it back to its oscillators.
  await model.selectOption('juno-106');
  await expect.poll(async () => (await sound(page)).engine).toBe('subtractive');

  // None gives the built-in sound up.
  await model.selectOption('generic');
  await synth.getByLabel('Synth engine', { exact: true }).selectOption('sample');
  await sample.selectOption({ label: 'None' });
  await expect.poll(async () => 'wave' in (await sound(page)).sample).toBe(false);
  await expect(root).toHaveAttribute('aria-disabled', 'false');
  expect(errors).toEqual([]);
});
