import { expect, test, type Page } from '@playwright/test';

// A rack unit renders only when something it reads has changed. These count each unit's
// renders, then check that a unit which sat an edit out is not left showing something old.

type Counts = Record<string, number>;

const counts = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { rendered: Counts }).rendered }));
const settled = async (page: Page) => {
  await page.waitForTimeout(400);
  return counts(page);
};
const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1')!)));
const level = (page: Page, id: number) => page.getByLabel(`Synth ${id} level value`, { exact: true });
const setLevel = async (page: Page, id: number, text: string) => {
  await level(page, id).fill(text);
  await level(page, id).press('Enter');
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    const rendered: Counts = {};
    Object.assign(window, {
      rendered,
      __discobotRenders: (name: string, props: { synthId?: number }) => {
        const unit = props.synthId ? `${name} ${props.synthId}` : name;
        rendered[unit] = (rendered[unit] ?? 0) + 1;
      },
    });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(level(page, 3)).toBeVisible();
});

test('an edit to one lane leaves the other lanes and the drums as they are', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  let before = await settled(page);
  expect(Object.keys(before).sort()).toEqual(['drums', 'mixer', 'synth 1', 'synth 2', 'synth 3']);

  await setLevel(page, 1, '40%');
  let after = await settled(page);
  expect(after['synth 1'], 'the lane that was edited').toBeGreaterThan(before['synth 1']);
  expect(after['synth 2'], 'another lane').toBe(before['synth 2']);
  expect(after['synth 3']).toBe(before['synth 3']);
  expect(after.drums, 'the drums').toBe(before.drums);
  expect(after.mixer, 'the mixer shows that level').toBeGreaterThan(before.mixer);

  before = after;
  await page.getByRole('button', { name: 'Kick step 3', exact: true }).click();
  after = await settled(page);
  expect(after.drums).toBeGreaterThan(before.drums);
  expect([after['synth 1'], after['synth 2'], after['synth 3']], 'no lane for a drum step').toEqual([before['synth 1'], before['synth 2'], before['synth 3']]);
  expect(after.mixer, 'a step is nothing the mixer shows').toBe(before.mixer);

  // A note on a lane is nothing the mixer shows either.
  before = after;
  await page.locator('[data-unit="synth-1"]').getByRole('button', { name: /^Select step 1( |$)/ }).click();
  await page.keyboard.press('a');
  await expect(page.locator('[data-unit="synth-1"]').getByRole('button', { name: /^Select step 1 C/ })).toBeVisible();
  after = await settled(page);
  expect(after['synth 1'], 'the lane the note went on').toBeGreaterThan(before['synth 1']);
  expect(after.mixer, 'the mixer for a note').toBe(before.mixer);

  // A fader on the mixer draws the lane it belongs to and the mixer, and nothing else.
  before = after;
  const fader = page.getByLabel('Mixer Synth 2 level value', { exact: true });
  await fader.fill('70%');
  await fader.press('Enter');
  await expect(level(page, 2)).toHaveValue('70%');
  after = await settled(page);
  expect(after.mixer).toBeGreaterThan(before.mixer);
  expect(after['synth 2'], 'the lane whose level it is').toBeGreaterThan(before['synth 2']);
  expect([after['synth 1'], after['synth 3'], after.drums], 'no other lane, and not the drums, for a mixer fader').toEqual([before['synth 1'], before['synth 3'], before.drums]);

  // A lane that sat those out still answers, and with the state as it is now.
  const mute = page.getByRole('button', { name: 'Mute Synth 2', exact: true });
  const muted = await mute.getAttribute('aria-pressed') === 'true';
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', String(!muted));
  await setLevel(page, 2, '25%');
  await setLevel(page, 3, '60%');
  const saved = await stored(page);
  const lane = (id: number) => saved.synths.find((entry: { synthId: number }) => entry.synthId === id);
  expect([1, 2, 3].map(id => Math.round(lane(id).synthParams.gain * 100)), 'each lane kept its own edit').toEqual([40, 25, 60]);
  expect(lane(2).muted).toBe(!muted);
  expect(errors).toEqual([]);
});

test('undo reaches units that did not render for each other\'s edit', async ({ page }) => {
  const original = await level(page, 2).inputValue();
  expect(original).not.toBe('15%');
  await setLevel(page, 2, '15%');
  await expect(level(page, 2)).toHaveValue('15%');
  await page.waitForTimeout(400);
  const step = page.getByRole('button', { name: 'Kick step 5', exact: true });
  const active = await step.getAttribute('aria-pressed');
  await step.click();
  await expect(step).not.toHaveAttribute('aria-pressed', active!);

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect(step).toHaveAttribute('aria-pressed', active!);
  // The level was the first thing changed, a moment after the page loaded. It is its own undo
  // step all the same (undoSteps.ts): one more undo puts it back.
  await undo.click();
  await expect(level(page, 2)).toHaveValue(original);
});
