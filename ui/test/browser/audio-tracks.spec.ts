import { expect, test, type Page } from '@playwright/test';

// Audio tracks on the timeline, stage 2 (docs/TIMELINE_PLAN.md): a project with a track and a
// clip, made by adding them to a saved project file, is heard in a Song WAV where the clip falls,
// and its track has a strip on the mixer. There is no timeline unit yet to make one by hand.

const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
async function menu(page: Page, item: string) {
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
async function exportSong(page: Page) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: 'The whole song', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}
const ready = (page: Page) => expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await ready(page);
});

test('a clip on an audio track is in a Song WAV where it falls, and its track is on the mixer', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { readFile, writeFile } = await import('node:fs/promises');

  // The open project as a file, given a song of its scene twice (two bars at 120: four seconds)
  // and a track holding one clip, a second of tone starting on the second bar.
  const saved = page.waitForEvent('download');
  await menu(page, 'Export Project');
  const plain = testInfo.outputPath('plain.json');
  await (await saved).saveAs(plain);
  const file = JSON.parse(await readFile(plain, 'utf8'));
  const sampleId = '0f0f0f0f-1111-4222-8333-444444444444';
  file.project.name = 'With a track';
  file.project.tempo = 120;
  file.project.song = { entries: [{ sceneId: file.project.scenes[0].id, repeats: 2 }], loop: false };
  file.project.audioTracks = [{
    id: '0a0a0a0a-1111-4222-8333-444444444444', name: 'Vox', volume: 1,
    clips: [{ id: '0b0b0b0b-1111-4222-8333-444444444444', sampleId, at: 32, length: 1 }],
  }];
  file.samples = [{ id: sampleId, name: 'Tone.wav', type: 'audio/wav', data: toneWav().toString('base64') }];
  const withTrack = testInfo.outputPath('with-track.json');
  await writeFile(withTrack, JSON.stringify(file));

  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import Project');
  await (await chooser).setFiles(withTrack);
  await more(page);
  await expect(page.getByRole('button', { name: 'Project: With a track', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const strip = page.getByRole('group', { name: 'Mixer audio Vox', exact: true });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('slider', { name: 'Mixer audio Vox level', exact: true })).toHaveAttribute('aria-valuenow', '1');

  const level = async (name: string) => {
    const download = page.waitForEvent('download', { timeout: 30_000 });
    await exportSong(page);
    const path = testInfo.outputPath(name);
    await (await download).saveAs(path);
    const bytes = await readFile(path);
    // 16-bit stereo at 44.1 kHz: the level of the left channel between two times, in seconds.
    return (from: number, to: number) => {
      let sum = 0, count = 0;
      for (let frame = Math.round(from * 44100); frame < Math.round(to * 44100); frame++) { const value = bytes.readInt16LE(44 + frame * 4) / 32768; sum += value * value; count++; }
      return Math.sqrt(sum / count);
    };
  };
  const heard = await level('song.wav');
  expect(heard(0.2, 1.8), 'nothing before the clip: the project has no notes or drums').toBeLessThan(0.001);
  expect(heard(2.2, 2.8), 'the tone, from the second bar').toBeGreaterThan(0.1);
  expect(heard(3.3, 3.9), 'and nothing once its second is over').toBeLessThan(0.001);

  // Muted on the mixer, the track is left out.
  await strip.getByRole('button', { name: 'Mixer audio Vox mute', exact: true }).click();
  await expect(strip.getByRole('button', { name: 'Mixer audio Vox mute', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const muted = await level('muted.wav');
  expect(muted(2.2, 2.8)).toBeLessThan(0.001);
  expect(errors).toEqual([]);
});

test('the song\'s Timeline view adds a recording at a bar, and moves, fades and removes its clip', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { writeFile } = await import('node:fs/promises');
  const tone = testInfo.outputPath('Tone.wav');
  await writeFile(tone, toneWav());
  const project = () => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
  const clipAt = async () => (await project()).audioTracks?.flatMap((track: { clips: Array<{ at: number }> }) => track.clips.map(clip => clip.at));

  await page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name: 'Timeline', exact: true }).click();
  const timeline = page.getByRole('group', { name: 'Timeline', exact: true });
  await expect(timeline).toContainText('No audio tracks yet');
  await timeline.getByLabel('Bar new recordings go in at', { exact: true }).fill('2');
  await timeline.locator('input[type="file"]').setInputFiles(tone);

  const first = timeline.getByRole('group', { name: 'Audio track Audio 1', exact: true });
  const clip = timeline.getByRole('button', { name: /^Tone, / });
  await expect(clip).toHaveAccessibleName('Tone, Audio 1, bar 2 beat 1, 1 s');
  await expect(first.getByRole('button', { name: /^Tone, / })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Mixer audio Audio 1', exact: true }), 'its track is on the mixer').toBeVisible();
  await expect.poll(clipAt).toEqual([32]);

  // The keyboard: a beat, then a step with Alt, then down to a new track.
  await clip.focus();
  await page.keyboard.press('ArrowRight');
  await expect(clip).toHaveAccessibleName('Tone, Audio 1, bar 2 beat 2, 1 s');
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(clipAt).toEqual([42]);
  await timeline.getByRole('button', { name: '+ Track', exact: true }).click();
  await expect(timeline.getByRole('group', { name: 'Audio track Audio 2', exact: true })).toBeVisible();
  await clip.focus();
  await page.keyboard.press('ArrowDown');
  await expect(timeline.getByRole('group', { name: 'Audio track Audio 2', exact: true }).getByRole('button', { name: /^Tone, / })).toBeFocused();

  // A drag of one bar to the right, snapped to the beat, from the middle: the chosen clip's ends trim it.
  await clip.scrollIntoViewIfNeeded();
  const box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect.poll(clipAt).toEqual([72]);
  await expect(clip).toHaveAccessibleName('Tone, Audio 2, bar 3 beat 2, 1 s');

  // The selected clip's own settings.
  const tools = timeline.getByRole('group', { name: 'Clip Tone', exact: true });
  await tools.getByLabel('Clip fade in in seconds', { exact: true }).fill('0.25');
  await tools.getByLabel('Clip fade in in seconds', { exact: true }).press('Enter');
  await expect.poll(async () => (await project()).audioTracks[1].clips[0].fadeIn).toBe(0.25);

  await clip.focus();
  await page.keyboard.press('Delete');
  await expect(clip).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(clip, 'one Undo puts it back').toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the timeline zooms, and a chosen clip\'s fade is dragged by its handle', async ({ page }, testInfo) => {
  const { writeFile } = await import('node:fs/promises');
  const tone = testInfo.outputPath('Tone.wav');
  await writeFile(tone, toneWav());
  const project = () => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));

  await page.getByRole('group', { name: 'Song layout', exact: true }).getByRole('button', { name: 'Timeline', exact: true }).click();
  const timeline = page.getByRole('group', { name: 'Timeline', exact: true });
  await timeline.locator('input[type="file"]').setInputFiles(tone);
  const clip = timeline.getByRole('button', { name: /^Tone, / });
  await expect(clip).toBeVisible();
  const before = (await clip.boundingBox())!.width;
  await timeline.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(timeline.getByRole('button', { name: 'Zoom in', exact: true }), 'the widest zoom').toBeDisabled();
  await expect.poll(async () => (await clip.boundingBox())!.width).toBeCloseTo(before * 2, 0);

  // Half way across the clip is half its second.
  await clip.scrollIntoViewIfNeeded();
  const handle = clip.locator('.timeline-fade-handle.in');
  const box = (await handle.boundingBox())!, width = (await clip.boundingBox())!.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + width / 4, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(box.x + box.width / 2 + width / 2, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await project()).audioTracks[0].clips[0].fadeIn ?? 0).toBeGreaterThan(0.4);
  expect((await project()).audioTracks[0].clips[0].fadeIn).toBeLessThan(0.6);
  expect((await project()).audioTracks[0].clips[0].at, 'the clip did not move').toBe(0);
  await expect(clip.locator('.timeline-fade.in')).toBeVisible();
});
