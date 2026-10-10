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
});

test('an edit to one lane leaves the other lanes and the drums as they are', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = (id: number) => page.getByRole('region', { name: `Synth ${id} module`, exact: true });
  const edit = async (id: number, knob: string, text: string) => {
    const input = lane(id).getByLabel(`${knob} value`, { exact: true });
    await input.fill(text);
    await input.press('Enter');
  };
  await expect(lane(2)).toBeVisible();

  let before = await settled(page);
  expect(Object.keys(before).sort()).toEqual(['drums', 'synth 1', 'synth 2', 'synth 3']);

  await edit(1, 'Level', '40');
  let after = await settled(page);
  expect(after['synth 1'], 'the lane that was edited').toBeGreaterThan(before['synth 1']);
  expect(after['synth 2'], 'another lane').toBe(before['synth 2']);
  expect(after['synth 3']).toBe(before['synth 3']);
  expect(after.drums, 'the drums').toBe(before.drums);

  before = after;
  await page.getByRole('button', { name: 'Kick step 3', exact: true }).click();
  after = await settled(page);
  expect(after.drums).toBeGreaterThan(before.drums);
  expect([after['synth 1'], after['synth 2'], after['synth 3']], 'no lane for a drum step').toEqual([before['synth 1'], before['synth 2'], before['synth 3']]);

  // A lane that sat those out still answers, and with the state as it is now.
  await page.getByRole('button', { name: 'Mute Synth 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute Synth 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await edit(2, 'Level', '25');
  await edit(3, 'Level', '60');
  const saved = await stored(page);
  const level = (id: number) => Math.round(saved.synths.find((entry: { synthId: number }) => entry.synthId === id).volume * 100);
  expect([level(1), level(2), level(3)], 'each lane kept its own edit').toEqual([40, 25, 60]);
  expect(saved.synths.find((entry: { synthId: number }) => entry.synthId === 2).muted).toBe(true);
  expect(errors).toEqual([]);
});

test('a change that reaches every unit is drawn by every unit', async ({ page }) => {
  const lane = (id: number) => page.getByRole('region', { name: `Synth ${id} module`, exact: true });
  const level = lane(2).getByLabel('Level value', { exact: true });
  const original = await level.inputValue();
  await level.fill('15');
  await level.press('Enter');
  await page.getByRole('button', { name: 'Kick step 5', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kick step 5', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Undo goes back through both, on units that did not render for each other's edit.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Kick step 5', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Control+z');
  await expect(level).toHaveValue(original);
});
