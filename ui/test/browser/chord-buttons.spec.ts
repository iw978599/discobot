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

test('with a chord shape chosen, a note put in the piano roll is the root of a whole chord, and each note can still be taken out', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const shape = lane.getByLabel('Chord shape', { exact: true });
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });

  // Off to begin with: one press, one note.
  await expect(shape).toHaveValue('off');
  await cell('C3', 1).click();
  await expect.poll(() => notesAt(page, 0)).toEqual(['C3']);

  // A shape, then the root.
  await shape.selectOption({ label: 'Minor' });
  await cell('A3', 5).click();
  await expect.poll(() => notesAt(page, 4)).toEqual(['A3', 'C4', 'E4']);
  for (const note of ['A3', 'C4', 'E4']) await expect(cell(note, 5)).toHaveAttribute('aria-pressed', 'true');

  // One note of it is taken out by itself, and the others stay.
  await cell('C4', 5).click();
  await expect.poll(() => notesAt(page, 4)).toEqual(['A3', 'E4']);

  // The chord went in as one edit: one Undo puts the note back, a second takes the whole chord out.
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect.poll(() => notesAt(page, 4)).toEqual(['A3', 'C4', 'E4']);
  await undo.click();
  await expect.poll(() => notesAt(page, 4)).toEqual([]);
  await expect.poll(() => notesAt(page, 0), 'the note from before is untouched').toEqual(['C3']);

  // A four-note shape, and Off again.
  await shape.selectOption({ label: 'Seventh' });
  await cell('G3', 9).click();
  await expect.poll(() => notesAt(page, 8)).toEqual(['G3', 'B3', 'D4', 'F4']);
  await shape.selectOption({ label: 'Off' });
  await cell('D3', 13).click();
  await expect.poll(() => notesAt(page, 12)).toEqual(['D3']);

  // One note of the chord is made longer by its end, and the others stay as they were. Dragging is
  // a mouse gesture, so this part is for the desktop.
  if (testInfo.project.name === 'chromium') {
    const lengths = async () => { const step = (await stored(page)).synths[0].pattern.steps[8]; return [step.length ?? 1, step.lengths ?? null]; };
    const drag = async (note: string, from: number, to: number) => {
      // A click scrolls the roll to its cell; a bare mouse move does not, so the note is brought on show first.
      await cell(note, from).scrollIntoViewIfNeeded();
      const handle = (await cell(note, from).locator('.piano-roll-resize').boundingBox())!, end = (await cell(note, to).boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
      await page.mouse.up();
    };
    const whole = lane.getByRole('button', { name: 'Whole step', exact: true });
    await expect(whole).toHaveAttribute('aria-pressed', 'false');
    await drag('D4', 9, 11);
    await expect.poll(lengths).toEqual([3, [1, 1, 3, 1]]);
    await expect(cell('D4', 11)).toHaveClass(/held/);
    await expect(cell('G3', 10), 'the other notes of the chord are not stretched').not.toHaveClass(/held/);

    // With Whole step on, every note of the step goes together, as it always did.
    await whole.click();
    await drag('G3', 9, 10);
    await expect.poll(lengths).toEqual([2, null]);
    for (const note of ['G3', 'B3', 'D4', 'F4']) await expect(cell(note, 10)).toHaveClass(/held/);
  }
  expect(errors).toEqual([]);
});

test('an inversion puts the notes above the root an octave down, and a chord can be strummed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const lane = page.getByRole('region', { name: 'Synth 1 module', exact: true });
  await lane.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const inversion = lane.getByLabel('Chord inversion', { exact: true });
  const cell = (note: string, step: number) => lane.getByRole('button', { name: `${note} step ${step}`, exact: true });

  await expect(inversion, 'an inversion needs a chord').toBeDisabled();
  await lane.getByLabel('Chord shape', { exact: true }).selectOption({ label: 'Major' });
  await inversion.selectOption({ label: '1st' });
  await cell('C4', 3).click();
  await expect.poll(() => notesAt(page, 2)).toEqual(['E3', 'G3', 'C4']);

  // The step is selected; its notes can be strummed from the step controls.
  const strum = lane.getByLabel('Step 3 strum', { exact: true });
  await expect(strum).toHaveValue('0');
  await strum.selectOption({ label: '1/8 step' });
  await expect.poll(async () => (await stored(page)).synths[0].pattern.steps[2].strum).toBe(0.125);
  expect(errors).toEqual([]);
});
