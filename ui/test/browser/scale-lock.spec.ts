import { expect, test, type Page } from '@playwright/test';

type Step = { active: boolean; note?: string; notes?: string[] };
const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
// The lane's line as one string: each step's notes, or a dash for an empty one.
const tune = async (page: Page) => ((await stored(page)).synths[0].pattern.steps as Step[]).map(step => (step.active ? [step.note, ...(step.notes ?? [])].join('+') : '-')).join(' ');
const line = (...steps: string[]) => [...steps, ...Array(16 - steps.length).fill('-')].join(' ');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the scale lock keeps the piano roll to the key and scale, builds chords in it, and lets go when it is off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const lock = lane.getByRole('button', { name: 'Scale lock', exact: true });
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });
  await lane.getByLabel('Randomize key', { exact: true }).selectOption('C');
  await lane.getByLabel('Randomize scale', { exact: true }).selectOption({ label: 'Major' });
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');

  // Unlocked, any note goes in.
  await cell('F#3', 1).click();
  await expect.poll(() => tune(page)).toBe(line('F#3'));

  // Locked to C major: the notes outside it are marked and take nothing new; a note already there
  // can still be taken out.
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(cell('C#3', 2)).toHaveClass(/out-of-scale/);
  await expect(cell('D3', 2)).not.toHaveClass(/out-of-scale/);
  await cell('C#3', 2).click();
  await cell('D3', 3).click();
  await expect.poll(() => tune(page)).toBe(line('F#3', '-', 'D3'));
  await cell('F#3', 1).click();
  await expect.poll(() => tune(page)).toBe(line('-', '-', 'D3'));

  // A chord in the key: on D in C major, D minor.
  await lane.getByLabel('Chord shape', { exact: true }).selectOption('key-triad');
  await cell('D3', 5).click();
  await expect.poll(() => tune(page)).toBe(line('-', '-', 'D3', '-', 'D3+F3+A3'));
  await lane.getByLabel('Chord shape', { exact: true }).selectOption('off');

  // The lock is this browser's: it is still on after a reload, and not in the project.
  expect(await page.evaluate(() => localStorage.getItem('discobot_scale_lock_v1'))).toBe('on');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  // Off, everything goes in again.
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await expect(cell('C#3', 7)).not.toHaveClass(/out-of-scale/);
  await cell('C#3', 7).click();
  await expect.poll(() => tune(page)).toBe(line('-', '-', 'D3', '-', 'D3+F3+A3', '-', 'C#3'));
  expect(errors).toEqual([]);
});
