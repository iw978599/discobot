import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PROJECT_KEY = 'discobot_browser_project_v1';
// Edits are written a moment after they are made; a pagehide makes the app write now, as closing the tab would.
const project = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);
type Hit = { type: string; instrument?: string; time?: number };
const hits = (page: Page) => page.evaluate(() => (window as unknown as { drumHits: Hit[] }).drumHits.filter(hit => typeof hit.time === 'number'));
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });
const drum = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function openProject(page: Page, name: string) {
  await page.getByRole('button', { name: /^Project: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  await dialog.getByRole('group', { name: `Project ${name}`, exact: true }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Project: ${name}`, exact: true })).toBeVisible();
}
async function menu(page: Page, name: 'Project' | 'Export', item: string) {
  await page.getByRole('button', { name: `${name} ▾`, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    const captured: Array<{ type: string }> = [];
    (window as unknown as { drumHits: typeof captured }).drumHits = captured;
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name !== 'drum-processor') return;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: { type: string }) => {
          if (message.type === 'hit') captured.push(message);
          post(message);
        };
      }
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');
});

test('scenes hold their own notes and drums, can be renamed and deleted, and survive a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await drum(page, 'Kick step 1').click();

  await page.getByRole('button', { name: '+ Copy', exact: true }).click();
  await expect(scene(page, 'Scene 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'C3 step 1', exact: true }), 'a copy starts with the same notes').toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'G3 step 5', exact: true }).click();
  await drum(page, 'Kick step 1').click();
  await drum(page, 'Snare step 5').click();

  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Scene name', { exact: true }).fill('Chorus');
  await page.getByLabel('Scene name', { exact: true }).press('Enter');
  await expect(scene(page, 'Chorus')).toHaveAttribute('aria-pressed', 'true');

  await scene(page, 'Scene 1').click();
  await expect(page.getByRole('button', { name: 'C3 step 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'G3 step 5', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(drum(page, 'Kick step 1')).toHaveAttribute('aria-pressed', 'true');
  await expect(drum(page, 'Snare step 5')).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await expect(scene(page, 'Scene 3')).toHaveAttribute('aria-pressed', 'true');
  await expect(drum(page, 'Kick step 1')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.step-cell.has-note')).toHaveCount(0);

  await page.reload();
  await expect(scene(page, 'Scene 3'), 'the open scene is remembered').toHaveAttribute('aria-pressed', 'true');
  await scene(page, 'Chorus').click();
  await expect(drum(page, 'Snare step 5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.synth-module').first().getByRole('button', { name: 'Select step 5 G3', exact: true })).toBeVisible();

  page.once('dialog', dialog => { void dialog.accept(); });
  await page.locator('.song-module').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(scene(page, 'Chorus')).toHaveCount(0);
  await expect(scene(page, 'Scene 3'), 'deleting the open scene opens the one before it').toHaveAttribute('aria-pressed', 'true');
  const stored = await project(page);
  expect(stored.scenes.map((entry: { name: string }) => entry.name)).toEqual(['Scene 1', 'Scene 3']);
  expect(stored.scenes[0].drums.kick.steps[0]).toBe(true);
});

test('song mode plays the chain in order, follows it in the editor, and stops at the end', async ({ page }) => {
  // Scene 1 has a kick on beat one; the Break has a snare there instead.
  await drum(page, 'Kick step 1').click();
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Scene name', { exact: true }).fill('Break');
  await page.getByLabel('Scene name', { exact: true }).press('Enter');
  await drum(page, 'Snare step 1').click();
  await page.getByRole('button', { name: '+ Add Break', exact: true }).click();
  await page.getByRole('button', { name: 'More repeats for block 1', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Song block 1: Scene 1', exact: true })).toContainText('×2');
  await expect(page.locator('.song-row .rack-plate')).toContainText('3 bars · 0:06');

  // In scene mode, Play loops the open scene only.
  await page.evaluate(() => { (window as unknown as { drumHits: unknown[] }).drumHits.length = 0; });
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect.poll(async () => (await hits(page)).length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect((await hits(page)).every(hit => hit.instrument === 'snare'), 'scene mode stays on the open scene').toBe(true);

  await page.getByRole('group', { name: 'Play mode' }).getByRole('button', { name: 'Song', exact: true }).click();
  await page.getByRole('group', { name: 'Song block 1: Scene 1', exact: true }).getByRole('button', { name: /Scene 1/ }).click();
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as unknown as { drumHits: unknown[] }).drumHits.length = 0; });
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(scene(page, 'Break'), 'the editor follows the song into the next scene').toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  await expect(page.getByRole('group', { name: 'Song block 2: Break', exact: true })).toHaveClass(/playing/);
  await expect(page.getByRole('button', { name: /Play All/ }), 'a song that does not loop stops by itself').toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.song-block.playing')).toHaveCount(0);

  const played = await hits(page);
  expect(played.map(hit => hit.instrument)).toEqual(['kick', 'kick', 'snare']);
  expect(played[1].time! - played[0].time!, 'one bar apart at 120 BPM').toBeCloseTo(2, 2);
  expect(played[2].time! - played[1].time!, 'the scene change lands exactly on the bar line').toBeCloseTo(2, 2);

  // Starting from the second block skips the first.
  await page.getByRole('group', { name: 'Song block 2: Break', exact: true }).getByRole('button', { name: /Break/ }).click();
  await page.getByLabel('Loop the song', { exact: true }).check();
  await page.evaluate(() => { (window as unknown as { drumHits: unknown[] }).drumHits.length = 0; });
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect.poll(async () => (await hits(page)).map(hit => hit.instrument).slice(0, 2), { timeout: 10_000 }).toEqual(['snare', 'kick']);
  await page.getByRole('button', { name: /Stop All/ }).click();
  expect((await project(page)).song).toMatchObject({ loop: true, entries: [{ repeats: 2 }, { repeats: 1 }] });
});

test('the whole song exports as WAV and as MIDI with section markers', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await drum(page, 'Kick step 1').click();
  await page.getByRole('button', { name: '+ Add Scene 2', exact: true }).click();

  const wavDownload = page.waitForEvent('download');
  await menu(page, 'Export', 'Song WAV');
  const wav = await wavDownload;
  expect(wav.suggestedFilename()).toMatch(/^discobot-song-\d+\.wav$/);
  const wavPath = testInfo.outputPath('song.wav');
  await wav.saveAs(wavPath);
  const audio = (await readFile(wavPath)).subarray(44);
  const frames = audio.length / 4;
  expect(frames, 'two bars at 120 BPM plus an effect tail').toBeGreaterThan(4 * 44100);
  expect(frames).toBeLessThan(13 * 44100);
  const loud = (fromSeconds: number, toSeconds: number) => {
    let peak = 0;
    for (let frame = Math.round(fromSeconds * 44100); frame < toSeconds * 44100; frame++) peak = Math.max(peak, Math.abs(audio.readInt16LE(frame * 4)));
    return peak / 32768;
  };
  expect(loud(0, 0.1), 'the synth note opens the first bar').toBeGreaterThan(0.02);
  expect(loud(2, 2.1), 'the kick opens the second bar').toBeGreaterThan(0.1);
  expect(loud(2, 2.1)).toBeGreaterThan(loud(1.8, 1.99) * 3);

  const midiDownload = page.waitForEvent('download');
  await menu(page, 'Export', 'Song MIDI');
  const midi = await midiDownload;
  expect(midi.suggestedFilename()).toMatch(/^discobot-song-\d+\.mid$/);
  const midiPath = testInfo.outputPath('song.mid');
  await midi.saveAs(midiPath);
  const text = (await readFile(midiPath)).toString('latin1');
  expect(text.startsWith('MThd')).toBe(true);
  expect(text).toContain('\xff\x06\x07Scene 1');
  expect(text).toContain('\xff\x06\x07Scene 2');
  await expect(page.locator('.app-alert')).toHaveCount(0);
});

test('undo returns to the scene the edit was made in, and a copy of the project brings its scenes back', async ({ page }) => {
  await drum(page, 'Kick step 1').click();
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await drum(page, 'Snare step 5').click();
  await scene(page, 'Scene 1').click();
  await drum(page, 'Kick step 9').click();
  await scene(page, 'Scene 2').click();
  await expect(drum(page, 'Snare step 5')).toHaveAttribute('aria-pressed', 'true');

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect(scene(page, 'Scene 1'), 'the last edit was in scene 1, so undo goes there').toHaveAttribute('aria-pressed', 'true');
  await expect(drum(page, 'Kick step 9')).toHaveAttribute('aria-pressed', 'false');
  await expect(drum(page, 'Kick step 1')).toHaveAttribute('aria-pressed', 'true');
  await undo.click();
  await expect(scene(page, 'Scene 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(drum(page, 'Snare step 5')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(drum(page, 'Snare step 5')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '+ Add Scene 2', exact: true }).click();
  await menu(page, 'Project', 'Save a Copy');

  await menu(page, 'Project', 'Reset All');
  await expect(scene(page, 'Scene 2')).toHaveCount(0);
  await expect(page.locator('.scene-chip')).toHaveCount(1);
  await expect(page.locator('.drum-step-btn.active')).toHaveCount(0);

  await openProject(page, 'Untitled copy');
  await expect(scene(page, 'Scene 2')).toHaveAttribute('aria-pressed', 'true');
  await expect(drum(page, 'Snare step 5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.song-block')).toHaveCount(2);
  await scene(page, 'Scene 1').click();
  await expect(drum(page, 'Kick step 1')).toHaveAttribute('aria-pressed', 'true');
});
