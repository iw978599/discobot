import { expect, test, type Page } from '@playwright/test';

type Step = { active: boolean; note?: string; notes?: string[]; slide?: boolean; probability?: number; ratchet?: number; offset?: number };
const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const steps = async (page: Page): Promise<Step[]> => (await stored(page)).synths[0].pattern.steps;
// The lane's line as one string: each step's notes, or a dash for an empty one.
const tune = async (page: Page) => (await steps(page)).map(step => (step.active ? [step.note, ...(step.notes ?? [])].join('+') : '-')).join(' ');

// Every drum's steps. Undo writes the drums back with their defaults spelled out, so the whole
// state is not compared, only what the drums play.
const drumSteps = async (page: Page) => JSON.stringify(Object.entries((await stored(page)).drumState).map(([drum, lane]) => [drum, (lane as { steps: boolean[] }).steps]).sort());

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('Randomize fills the lane with a line in the chosen key and scale, a second press gives another, and one Undo brings back what was there', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const key = lane.getByLabel('Randomize key', { exact: true });
  const scale = lane.getByLabel('Randomize scale', { exact: true });
  const randomize = lane.getByRole('button', { name: 'Randomize Synth 1', exact: true });

  // Something of the person's own first: two notes, one of them not in the scale to come.
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });
  await cell('F#3', 2).click();
  await cell('D3', 3).click();
  const mine = '- F#3 D3 - - - - - - - - - - - - -';
  await expect.poll(() => tune(page)).toBe(mine);
  const drums = await drumSteps(page);

  await expect(scale.locator('option')).toHaveText(['Major', 'Minor', 'Major pentatonic', 'Minor pentatonic']);
  await expect(key.locator('option')).toHaveCount(12);
  await key.selectOption('A');
  await scale.selectOption({ label: 'Minor pentatonic' });
  await randomize.click();
  await expect.poll(() => tune(page)).not.toBe(mine);

  // Every note is one of A, C, D, E and G, the first step is the root, and there is one note to a step.
  const first = await tune(page);
  const made = await steps(page);
  expect(made).toHaveLength(16);
  expect(made[0].active && made[0].note).toBe('A3');
  const sounding = made.filter(step => step.active);
  expect(sounding.length, 'a line, not one note').toBeGreaterThan(2);
  for (const step of sounding) {
    expect(step.note, 'in A minor pentatonic').toMatch(/^[ACDEG]\d$/);
    expect(step.notes ?? [], 'one note to a step').toEqual([]);
    expect([step.slide, step.probability, step.ratchet, step.offset], 'slide, chance, repeats and timing are left off').toEqual([undefined, undefined, undefined, undefined]);
  }
  await expect(cell('A3', 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell('F#3', 2), 'what was there is replaced').toHaveAttribute('aria-pressed', 'false');

  // Another press, another line, still starting on the root. Two lines the same would be a wonder.
  await randomize.click();
  await expect.poll(() => tune(page)).not.toBe(first);
  const second = await tune(page);
  expect(second.startsWith('A3')).toBe(true);

  // A different key and scale.
  await key.selectOption('F');
  await scale.selectOption({ label: 'Major' });
  await randomize.click();
  await expect.poll(async () => (await steps(page))[0].note).toBe('F3');
  for (const step of (await steps(page)).filter(entry => entry.active)) expect(step.note, 'in F major').toMatch(/^(F|G|A|A#|C|D|E)\d$/);

  // Each press was one undo step, back to the person's own notes.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect.poll(() => tune(page)).toBe(second);
  await undo.click();
  await expect.poll(() => tune(page)).toBe(first);
  await undo.click();
  await expect.poll(() => tune(page)).toBe(mine);
  await expect(cell('F#3', 2)).toHaveAttribute('aria-pressed', 'true');

  // Nothing else was touched, and the key and scale are the browser's, not the project's.
  const project = await stored(page);
  expect(await drumSteps(page), 'the drums are as they were').toBe(drums);
  expect(JSON.stringify(project)).not.toContain('pentatonic');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('discobot_randomize_v1') || 'null'))).toEqual({ key: 'F', scale: 'major' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Synth 1 module', exact: true }).getByLabel('Randomize key', { exact: true })).toHaveValue('F');
  await expect(page.getByRole('region', { name: 'Synth 1 module', exact: true }).getByLabel('Randomize scale', { exact: true })).toHaveValue('major');
  expect(errors).toEqual([]);
});
