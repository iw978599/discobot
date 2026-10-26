import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide screen.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 1059 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};

// Export is a dialog: what (the scene or the song), as what, then Export. It is closed at once and
// the file goes on being made, so the caller waits for the download.
async function exportAs(page: Page, item: string) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: item.startsWith('Song') ? 'The whole song' : 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: item === 'Loop WAV' ? 'Seamless loop' : item.endsWith('MIDI') ? 'MIDI' : 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}
async function exported(page: Page, item: string, path: string) {
  const download = page.waitForEvent('download');
  await exportAs(page, item);
  await (await download).saveAs(path);
  return readFile(path);
}
// Seconds of audio in a 16-bit stereo WAV at 44.1 kHz.
const seconds = (wav: Buffer) => (wav.length - 44) / (44100 * 4);

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

const song = (page: Page) => page.locator('.song-module');
const time = (page: Page) => song(page).getByLabel('Time signature of the open scene', { exact: true });
const lane = (page: Page) => page.getByRole('region', { name: 'Synth 1 module', exact: true });
const kicks = (page: Page) => page.locator('.drum-grid-row[data-drum="kick"] .drum-step-btn');
// Which of a row's cells are marked as starting a beat, counted from the first.
const beats = (cells: Locator) => cells.evaluateAll(found => found.flatMap((cell, index) => (cell.classList.contains('beat') ? [index] : [])));
// How many cells are on each line of a row that wraps, from the top.
const lines = (cells: Locator) => cells.evaluateAll(found => {
  const counts = new Map<number, number>();
  for (const cell of found) { const top = Math.round(cell.getBoundingClientRect().top); counts.set(top, (counts.get(top) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
});
const setTempo = async (page: Page, tempo: number) => {
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill(String(tempo));
  await page.locator('.tempo-led-input').press('Enter');
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

// Each signature: the steps in a bar, where its beats start, and how a phone breaks the row.
const SIGNATURES: Array<[string, number, number[], number[]]> = [
  ['3/4', 12, [0, 4, 8], [8, 4]],
  ['6/8', 12, [0, 6], [6, 6]],
  ['5/4', 20, [0, 4, 8, 12, 16], [8, 8, 4]],
  ['7/8', 14, [0, 4, 8], [8, 6]],
  ['12/8', 24, [0, 6, 12, 18], [6, 6, 6, 6]],
  ['4/4', 16, [0, 4, 8, 12], [8, 8]],
];

test('a scene\'s time signature sets the steps in a bar of every grid, with its beats marked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await lane(page).getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cells = lane(page).locator('.step-cell'), heads = lane(page).locator('.piano-roll-step-header');
  await expect(time(page)).toHaveValue('4/4');
  await expect(time(page).locator('option')).toHaveText(['4/4', '3/4', '6/8', '5/4', '7/8', '12/8']);
  await expect(cells).toHaveCount(16);
  await expect(kicks(page)).toHaveCount(16);
  await expect(heads).toHaveCount(16);

  for (const [signature, steps, marks, phoneLines] of SIGNATURES) {
    await time(page).selectOption(signature);
    await expect(time(page)).toHaveValue(signature);
    await expect(cells, `${signature}: the lane's row`).toHaveCount(steps);
    await expect(kicks(page), `${signature}: a drum's row`).toHaveCount(steps);
    await expect(page.locator('.drum-step-indicator'), `${signature}: the drum grid's numbers`).toHaveCount(steps);
    await expect(heads, `${signature}: the piano roll`).toHaveCount(steps);
    await expect(lane(page).getByRole('button', { name: `C3 step ${steps}`, exact: true })).toHaveCount(1);
    await expect(lane(page).getByRole('button', { name: `C3 step ${steps + 1}`, exact: true })).toHaveCount(0);
    expect(await beats(cells), `${signature}: beats on the lane's row`).toEqual(marks);
    expect(await beats(kicks(page)), `${signature}: beats on the drum grid`).toEqual(marks);
    expect(await beats(heads), `${signature}: beats on the piano roll`).toEqual(marks);
    // The lane's own step size is the bar's steps or twice that.
    await expect(lane(page).getByLabel('Sequence length', { exact: true }).locator('option')).toHaveText([`${steps} steps`, `${steps * 2} steps`]);
    await expect(lane(page).getByLabel('Sequence length', { exact: true })).toHaveValue(String(steps));

    if (onPhone(page)) {
      expect(await lines(cells), `${signature}: the lane's row breaks where a beat ends`).toEqual(phoneLines);
      expect(await lines(kicks(page)), `${signature}: and so does a drum's`).toEqual(phoneLines);
    } else {
      // On a wide screen each row is one line, and the lane's steps stand over the drums'.
      expect(await lines(cells)).toEqual([steps]);
      expect(await lines(kicks(page))).toEqual([steps]);
      const edges = async (row: Locator) => { const first = (await row.first().boundingBox())!, last = (await row.last().boundingBox())!; return [first.x, last.x + last.width]; };
      const [laneLeft, laneRight] = await edges(cells), [drumLeft, drumRight] = await edges(kicks(page));
      expect(Math.abs(laneLeft - drumLeft), `${signature}: the first steps line up`).toBeLessThan(2);
      expect(Math.abs(laneRight - drumRight), `${signature}: and the last`).toBeLessThan(2);
    }
  }

  // A lane of finer steps has twice the bar's steps, with the beats twice as far apart.
  await time(page).selectOption('6/8');
  await lane(page).getByLabel('Sequence length', { exact: true }).selectOption('24');
  await expect(cells).toHaveCount(24);
  expect(await beats(cells)).toEqual([0, 12]);
  expect(await beats(heads)).toEqual([0, 12]);
  await expect(kicks(page), 'the drums are still sixteenths').toHaveCount(12);
  const saved = await stored(page);
  expect(saved.scenes[0].signature).toBe('6/8');
  expect(saved.synths[0].pattern.steps).toHaveLength(24);
  expect(saved.drumState.kick.steps).toHaveLength(12);
  expect(errors).toEqual([]);
});

test('a shorter bar cuts off its end, Undo brings it back, and a reload keeps the signature', async ({ page }) => {
  await lane(page).getByRole('button', { name: 'Piano Roll', exact: true }).click();
  const cell = (note: string, step: number) => lane(page).getByRole('button', { name: `${note} step ${step}`, exact: true });
  const kick = (step: number) => page.getByRole('button', { name: `Kick step ${step}`, exact: true });
  await cell('C3', 3).click();
  await cell('E3', 14).click();
  await kick(2).click();
  await kick(15).click();
  await expect(cell('E3', 14)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(15)).toHaveAttribute('aria-pressed', 'true');
  const height = (await lane(page).locator('.step-row').boundingBox())!.height;

  await time(page).selectOption('3/4');
  await expect(lane(page).locator('.step-cell')).toHaveCount(12);
  await expect(cell('C3', 3), 'what is inside the shorter bar is kept').toHaveAttribute('aria-pressed', 'true');
  await expect(cell('E3', 14), 'what was past its end is gone').toHaveCount(0);
  await expect(kick(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(15)).toHaveCount(0);
  let saved = await stored(page);
  expect(saved.scenes[0].signature).toBe('3/4');
  expect(saved.synths.map((synth: any) => synth.pattern.steps.length), 'every lane').toEqual(saved.synths.map(() => 12));
  expect(saved.drumState.kick.steps).toHaveLength(12);
  expect(saved.synths[0].pattern.steps.filter((step: any) => step.active)).toHaveLength(1);
  if (!onPhone(page)) expect((await lane(page).locator('.step-row').boundingBox())!.height, 'the row is as tall as it was').toBe(height);

  // One Undo: the signature, the lane's cut note and the drum's cut hit all come back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(time(page)).toHaveValue('4/4');
  await expect(lane(page).locator('.step-cell')).toHaveCount(16);
  await expect(cell('E3', 14)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell('C3', 3)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(15)).toHaveAttribute('aria-pressed', 'true');
  saved = await stored(page);
  expect('signature' in saved.scenes[0], '4/4 is stored as nothing').toBe(false);
  expect(saved.synths.map((synth: any) => synth.pattern.steps.length)).toEqual(saved.synths.map(() => 16));

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(time(page)).toHaveValue('3/4');
  await expect(lane(page).locator('.step-cell')).toHaveCount(12);
  await expect(kick(15)).toHaveCount(0);

  // An edit in the new bar, then a reload: the scene is still in 3/4 with what it held.
  await kick(12).click();
  await expect(kick(12)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(time(page)).toHaveValue('3/4');
  await expect(lane(page).locator('.step-cell')).toHaveCount(12);
  await expect(kicks(page)).toHaveCount(12);
  await expect(kick(12)).toHaveAttribute('aria-pressed', 'true');
  await expect(kick(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(lane(page).getByRole('button', { name: 'Select step 3 C3', exact: true })).toBeVisible();
  await expect(page.locator('.app-alert'), 'a bar of twelve steps is not read as damage').toHaveCount(0);

  // A new scene is in the signature of the one it was made from, and each keeps its own.
  await song(page).getByRole('button', { name: '+ Empty', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scene: Scene 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(time(page)).toHaveValue('3/4');
  await time(page).selectOption('5/4');
  await expect(kicks(page)).toHaveCount(20);
  await page.getByRole('button', { name: 'Scene: Scene 1', exact: true }).click();
  await expect(time(page)).toHaveValue('3/4');
  await expect(kicks(page)).toHaveCount(12);
  await page.getByRole('button', { name: 'Scene: Scene 2', exact: true }).click();
  await expect(time(page)).toHaveValue('5/4');
  await expect(lane(page).locator('.step-cell')).toHaveCount(20);
});

test('a scene in 3/4 plays twelve steps and comes round', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await time(page).selectOption('3/4');
  await expect(kicks(page)).toHaveCount(12);
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(page.locator('.drum-step-indicator.active')).toHaveCount(1);
  // Every step the lights are seen on, for a little over two bars: a bar of 3/4 at 120 is a second and a half.
  const seen = await page.evaluate(() => new Promise<{ drums: number[]; lane: number[] }>((resolve) => {
    const drums: number[] = [], lane: number[] = [];
    const note = (list: number[], selector: string) => {
      const lit = document.querySelector<HTMLElement>(selector);
      const step = lit ? Number(lit.dataset.step) : -1;
      if (step >= 0 && list[list.length - 1] !== step) list.push(step);
    };
    const timer = setInterval(() => {
      note(drums, '.drum-step-indicator.active');
      note(lane, '[aria-label="Synth 1 module"] .step-light.on');
    }, 15);
    setTimeout(() => { clearInterval(timer); resolve({ drums, lane }); }, 3600);
  }));
  await page.getByRole('button', { name: /Stop All/ }).click();
  for (const [name, steps] of Object.entries(seen)) {
    expect(Math.max(...steps), `${name}: no step past the twelfth is ever lit`).toBe(11);
    const last = steps.indexOf(11);
    expect(steps[last + 1], `${name}: after the twelfth step comes the first`).toBe(0);
    // Between a first step and the next, the steps are the twelve of the bar in order.
    const from = steps.indexOf(0, last + 1), bar = steps.slice(from, from + 12);
    if (bar.length === 12) expect(bar, `${name}: a whole bar`).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  }
  expect(errors).toEqual([]);
});

test('a bar of 3/4 is exported at its own length, in audio and in MIDI, and a song takes each scene\'s', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // At 240 BPM a bar of 4/4 is one second and a bar of 3/4 is three quarters of one.
  await setTempo(page, 240);
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await lane(page).getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await lane(page).getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await expect.poll(async () => (await stored(page)).drumState.kick.steps[0]).toBe(true);
  const four = seconds(await exported(page, 'Scene WAV', testInfo.outputPath('four.wav')));

  await time(page).selectOption('3/4');
  await expect.poll(async () => (await stored(page)).scenes[0].signature).toBe('3/4');
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Export', exact: true }), 'the dialog says how long the file will be').toContainText('1 bar of 3/4 at 240 BPM');
  await page.keyboard.press('Escape');
  const three = seconds(await exported(page, 'Scene WAV', testInfo.outputPath('three.wav')));
  expect(four - three, 'a quarter of a second shorter: one beat fewer, the same tail').toBeCloseTo(0.25, 2);
  expect(seconds(await exported(page, 'Loop WAV', testInfo.outputPath('three-loop.wav'))), 'a loop is exactly the bar').toBeCloseTo(0.75, 3);

  // The MIDI file says 3/4: FF 58 04, three, a quarter note (two to the power two), 24 clocks, eight 32nds.
  const midi = await exported(page, 'Scene MIDI', testInfo.outputPath('three.mid'));
  expect(midi.includes(Buffer.from([0xff, 0x58, 0x04, 3, 2, 24, 8]))).toBe(true);
  expect(midi.includes(Buffer.from([0xff, 0x58, 0x04, 4, 2, 24, 8]))).toBe(false);

  // A second scene in 4/4 after it. The song is a bar of each: a second and three quarters.
  await song(page).getByRole('button', { name: '+ Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scene: Scene 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await time(page).selectOption('4/4');
  await song(page).getByRole('button', { name: '+ Add Scene 2', exact: true }).click();
  await expect.poll(async () => (await stored(page)).song.entries.length).toBe(2);
  await expect(page.getByRole('region', { name: 'Song module', exact: true })).toContainText('2 bars');
  const whole = seconds(await exported(page, 'Song WAV', testInfo.outputPath('song.wav')));
  expect(whole - three, 'the song is the 3/4 bar and then one second of 4/4').toBeCloseTo(1, 2);
  const songMidi = await exported(page, 'Song MIDI', testInfo.outputPath('song.mid'));
  expect(songMidi.includes(Buffer.from([0xff, 0x58, 0x04, 3, 2, 24, 8])), 'the song starts in 3/4').toBe(true);
  expect(songMidi.includes(Buffer.from([0xff, 0x58, 0x04, 4, 2, 24, 8])), 'and says where it turns to 4/4').toBe(true);

  // Played as a song, slowly enough to watch: the first scene's twelve steps (three seconds at
  // 60 BPM), then the second scene's sixteen (four), and the song ends by itself.
  await setTempo(page, 60);
  await song(page).getByRole('group', { name: 'Play mode', exact: true }).getByRole('button', { name: 'Song', exact: true }).click();
  await expect(kicks(page), 'the second scene is the open one').toHaveCount(16);
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(kicks(page), 'the first scene is opened as it plays: twelve steps').toHaveCount(12);
  await expect(time(page)).toHaveValue('3/4');
  await expect(kicks(page), 'then the second: sixteen').toHaveCount(16, { timeout: 8000 });
  await expect(time(page)).toHaveValue('4/4');
  await expect(page.getByRole('button', { name: /Play All/ }), 'the song ends by itself').toBeVisible({ timeout: 12000 });
  expect(errors).toEqual([]);
});
