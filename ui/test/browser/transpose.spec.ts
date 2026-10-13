import { expect, test, type Page } from '@playwright/test';

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const notesAt = async (page: Page, step: number) => {
  const found = (await stored(page)).synths[0].pattern.steps[step];
  return found.active ? [found.note, ...(found.notes ?? [])] : [];
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('Transpose moves every note of the lane together, one press is one undo, and a move that would leave the range is not offered', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  const move = (words: string) => lane.getByRole('button', { name: `Transpose Synth 1 ${words}`, exact: true });
  const moves = ['down an octave', 'down a semitone', 'up a semitone', 'up an octave'];
  const both = async () => [await notesAt(page, 0), await notesAt(page, 4)];

  // The four buttons are there with nothing to move, and none of them can be pressed.
  await expect(lane.getByRole('group', { name: 'Synth 1 transpose', exact: true }).getByRole('button')).toHaveText(['−12', '−1', '+1', '+12']);
  for (const words of moves) await expect(move(words)).toBeDisabled();

  // A note and a chord.
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const shape = lane.getByLabel('Chord shape', { exact: true });
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });
  await cell('C3', 1).click();
  await shape.selectOption({ label: 'Minor' });
  await cell('A3', 5).click();
  await shape.selectOption({ label: 'Off' });
  await expect.poll(both).toEqual([['C3'], ['A3', 'C4', 'E4']]);
  for (const words of moves) await expect(move(words)).toBeEnabled();
  const velocity = (await stored(page)).synths[0].pattern.steps[4].velocity;
  const drums = JSON.stringify((await stored(page)).drumState);

  // Up a semitone, up an octave, and back the same way.
  await move('up a semitone').click();
  await expect.poll(both).toEqual([['C#3'], ['A#3', 'C#4', 'F4']]);
  await expect(cell('C#3', 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell('C3', 1)).toHaveAttribute('aria-pressed', 'false');
  await move('up an octave').click();
  await expect.poll(both).toEqual([['C#4'], ['A#4', 'C#5', 'F5']]);
  await move('down a semitone').click();
  await expect.poll(both).toEqual([['C4'], ['A4', 'C5', 'E5']]);
  await move('down an octave').click();
  await expect.poll(both).toEqual([['C3'], ['A3', 'C4', 'E4']]);
  expect((await stored(page)).synths[0].pattern.steps[4].velocity, 'only the notes moved').toBe(velocity);
  expect((await stored(page)).synths[0].pattern.steps.filter((step: { active: boolean }) => step.active), 'no step was added or lost').toHaveLength(2);

  // One press is one undo step.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect.poll(both).toEqual([['C4'], ['A4', 'C5', 'E5']]);
  await undo.click();
  await expect.poll(both).toEqual([['C#4'], ['A#4', 'C#5', 'F5']]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(both).toEqual([['C4'], ['A4', 'C5', 'E5']]);

  // Down to the bottom of the range: the lowest note is C0, and nothing goes further down.
  for (let octave = 0; octave < 4; octave += 1) await move('down an octave').click();
  await expect.poll(both).toEqual([['C0'], ['A0', 'C1', 'E1']]);
  await expect(move('down an octave')).toBeDisabled();
  await expect(move('down a semitone')).toBeDisabled();
  await expect(move('up a semitone')).toBeEnabled();
  await expect(move('up an octave')).toBeEnabled();
  await expect(move('down a semitone')).toHaveAttribute('title', /below C0/);

  // The top: E8 has room for a semitone and not for an octave.
  for (let octave = 0; octave < 7; octave += 1) await move('up an octave').click();
  await expect.poll(both).toEqual([['C7'], ['A7', 'C8', 'E8']]);
  await expect(move('up an octave')).toBeDisabled();
  await expect(move('up a semitone')).toBeEnabled();
  await move('up a semitone').click();
  await expect.poll(both).toEqual([['C#7'], ['A#7', 'C#8', 'F8']]);

  expect(JSON.stringify((await stored(page)).drumState), 'the drums are not transposed').toBe(drums);
  expect(errors).toEqual([]);
});
