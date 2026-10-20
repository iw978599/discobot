import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const notes = async (page: Page) => (await stored(page)).synths[0].pattern.steps.flatMap((step: { active: boolean; note?: string }, index: number) => (step.active ? [[index, step.note]] : []));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('with Rec on, a key played while the song runs is written where it was played, and not otherwise', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const rec = lane.getByRole('button', { name: 'Rec', exact: true });
  const key = lane.getByRole('button', { name: 'Play C3', exact: true });
  await expect(rec).toHaveAttribute('aria-pressed', 'false');
  await expect(lane.getByLabel('Record quantize', { exact: true })).toHaveValue('1');

  // A slow tempo, so a step is a quarter of a second and easy to land in.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('60');
  await page.locator('.tempo-led-input').press('Enter');

  // Not recording: a key played while the song runs is only heard.
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(500);
  await key.click();
  await page.waitForTimeout(300);
  expect(await notes(page)).toEqual([]);

  // Recording: it is written on a step of the bar, on the step itself at full quantize.
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');
  await key.click();
  await expect.poll(async () => (await notes(page)).length).toBe(1);
  const [[step, note]] = await notes(page);
  expect(note).toBe('C3');
  expect(step).toBeGreaterThanOrEqual(0);
  expect((await stored(page)).synths[0].pattern.steps[step].offset ?? 0).toBe(0);
  await page.getByRole('button', { name: /Stop All/ }).click();

  // Stopped, Rec writes nothing: there is no bar to write it in.
  await key.click();
  await page.waitForTimeout(200);
  expect((await notes(page)).length).toBe(1);

  // One Undo takes the recorded note back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => notes(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a recorded note lasts as long as its key was held, and one Undo takes back the note and its length', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const key = lane.getByRole('button', { name: 'Play C3', exact: true });
  // At 60 a step is a quarter of a second, so a second held is four steps.
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('60');
  await page.locator('.tempo-led-input').press('Enter');
  await lane.getByRole('button', { name: 'Rec', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(500);

  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await expect.poll(async () => (await notes(page)).length).toBe(1);
  const [[step]] = await notes(page);
  await expect.poll(async () => (await stored(page)).synths[0].pattern.steps[step].length ?? 1).toBeGreaterThanOrEqual(3);
  expect((await stored(page)).synths[0].pattern.steps[step].length).toBeLessThanOrEqual(5);
  await page.getByRole('button', { name: /Stop All/ }).click();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await notes(page)).length, 'the note and its length are one step').toBe(0);
  expect(errors).toEqual([]);
});
