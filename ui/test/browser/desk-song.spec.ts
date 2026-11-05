import { expect, test, type Page } from '@playwright/test';

// The desk's Song view (docs/DESK_LAYOUT_PLAN.md, stage 4): the tracks region can show the song, every
// scene laid end to end with a block where each track plays, and the audio tracks' clips. Wide screens
// only; stage 5 does the phone. The presence marks on the track headers are covered by the selector
// test in deskSong.test.ts, since a live session needs two signed-in browsers (sharing.spec.ts).

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the song view is the wide arrangement; stage 5 covers phones');
});

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

async function open(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
    localStorage.setItem('discobot_layout_v1', 'desk');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(page)).synths?.length).toBe(3);
}

const view = (page: Page, name: 'Patterns' | 'Song') => page.getByRole('radiogroup', { name: 'Desk view', exact: true }).getByRole('radio', { name, exact: true });
const cell = (page: Page, name: string) => page.getByRole('button', { name: `Overview ${name}`, exact: true });
const scene = (page: Page, name: string) => page.getByRole('button', { name: `Scene: ${name}`, exact: true });
const block = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

// One second of a 440 Hz tone at half strength, as a mono 16-bit WAV.
function toneWav(): Buffer {
  const rate = 44100, frames = rate, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + frames * 2, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * frame / rate) * 0.5 * 32767), 44 + frame * 2);
  return bytes;
}

test('the Song view shows the song strip and its choice survives a reload', async ({ page }) => {
  await open(page);
  await expect(view(page, 'Patterns')).toHaveAttribute('aria-checked', 'true');
  await expect(cell(page, 'Synth 1 step 1')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Song entries', exact: true })).toHaveCount(0);

  await view(page, 'Song').click();
  await expect(view(page, 'Song')).toHaveAttribute('aria-checked', 'true');
  const strip = page.getByRole('group', { name: 'Song entries', exact: true });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('button')).toHaveCount(1);
  await expect(cell(page, 'Synth 1 step 1'), 'no step cells in the song view').toHaveCount(0);
  await expect(page.locator('.desk-song-ruler .desk-song-bar').first()).toHaveText('1');

  await page.reload();
  await expect(view(page, 'Song'), 'the choice is this browser\'s').toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('group', { name: 'Song entries', exact: true })).toBeVisible();

  await view(page, 'Patterns').click();
  await expect(cell(page, 'Synth 1 step 1')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Song entries', exact: true })).toHaveCount(0);
});

test('each scene of the song has a block where a track plays, and pressing one opens that scene in the patterns', async ({ page }) => {
  await open(page);
  await cell(page, 'Synth 1 step 1').click();
  await page.getByRole('button', { name: '+ Empty', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Scene name', { exact: true }).fill('Break');
  await page.getByLabel('Scene name', { exact: true }).press('Enter');
  await expect(scene(page, 'Break')).toHaveAttribute('aria-pressed', 'true');
  await cell(page, 'Synth 2 step 1').click();
  await page.getByRole('button', { name: '+ Add Break', exact: true }).click();

  await view(page, 'Song').click();
  const strip = page.getByRole('group', { name: 'Song entries', exact: true });
  await expect(strip.getByRole('button')).toHaveCount(2);
  await expect(block(page, 'Song entry 1, Scene 1, 1 time')).toBeVisible();
  await expect(block(page, 'Song entry 2, Break, 1 time')).toBeVisible();

  await expect(block(page, 'Song Synth 1 plays in Scene 1, entry 1')).toBeVisible();
  await expect(block(page, 'Song Synth 1 plays in Break, entry 2'), 'Synth 1 is silent in the Break').toHaveCount(0);
  await expect(block(page, 'Song Synth 2 plays in Break, entry 2')).toBeVisible();
  await expect(block(page, 'Song Synth 2 plays in Scene 1, entry 1')).toHaveCount(0);
  await expect(page.locator('.desk-song-block[aria-label^="Song Drums"]'), 'no drum hits anywhere').toHaveCount(0);
  await expect(block(page, 'Song Synth 3 plays in Scene 1, entry 1')).toHaveCount(0);

  const one = (await block(page, 'Song entry 1, Scene 1, 1 time').boundingBox())!;
  const two = (await block(page, 'Song entry 2, Break, 1 time').boundingBox())!;
  expect(two.x, 'the entries lie end to end').toBeGreaterThan(one.x + one.width - 2);

  await block(page, 'Song Synth 1 plays in Scene 1, entry 1').click();
  await expect(view(page, 'Patterns')).toHaveAttribute('aria-checked', 'true');
  await expect(scene(page, 'Scene 1')).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(page, 'Synth 1 step 1')).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(page, 'Synth 2 step 1')).toHaveAttribute('aria-pressed', 'false');

  await view(page, 'Song').click();
  await block(page, 'Song entry 2, Break, 1 time').click();
  await expect(scene(page, 'Break')).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(page, 'Synth 2 step 1')).toHaveAttribute('aria-pressed', 'true');
  expect((await stored(page)).song.entries).toHaveLength(2);
});

test('the Song view shows an audio track\'s clip by name at its place in the song', async ({ page }, testInfo) => {
  const { writeFile } = await import('node:fs/promises');
  const tone = testInfo.outputPath('Tone.wav');
  await writeFile(tone, toneWav());
  await open(page);

  await page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name: 'Timeline', exact: true }).click();
  const timeline = page.getByRole('group', { name: 'Timeline', exact: true });
  await timeline.getByLabel('Bar new recordings go in at', { exact: true }).fill('2');
  await timeline.locator('input[type="file"]').setInputFiles(tone);
  await expect(timeline.getByRole('button', { name: /^Tone, / })).toHaveCount(1);

  await view(page, 'Song').click();
  const lane = page.getByRole('group', { name: 'Song audio track Audio 1', exact: true });
  const clip = lane.getByRole('button', { name: 'Song clip Tone, Audio 1', exact: true });
  await expect(clip).toBeVisible();
  await expect(clip).toContainText('Tone');
  const box = (await clip.boundingBox())!, laneBox = (await lane.boundingBox())!;
  expect(box.x, 'it starts on the second bar, not at the start').toBeGreaterThan(laneBox.x + 4);
  await expect(page.getByRole('button', { name: 'Show Audio 1 in the dock' }), 'an audio track has no unit for the dock').toHaveCount(0);

  await clip.click();
  await expect(clip).toHaveAttribute('aria-pressed', 'true');
  const at = async () => (await stored(page)).audioTracks[0].clips[0].at;
  const before = await at();
  await clip.press('ArrowRight');
  await expect.poll(at).toBe(before + 8);
  await clip.press('Delete');
  await expect(clip).toHaveCount(0);
});
