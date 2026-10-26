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
// the file goes on being made, so the caller waits for the download as it did with the menu.
async function exportAs(page: Page, item: string) {
  await more(page);
  await page.locator('.transport').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
  await dialog.getByRole('radio', { name: item.startsWith('Song') ? 'The whole song' : 'This scene', exact: true }).check();
  await dialog.getByRole('radio', { name: item === 'Loop WAV' ? 'Seamless loop' : item === 'Stems' ? 'Stems' : item.endsWith('MIDI') ? 'MIDI' : 'Audio', exact: true }).check();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

const PROJECT_KEY = 'discobot_browser_project_v1';
const stored = (page: Page) => page.evaluate(key => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem(key) || '{}')), PROJECT_KEY);

async function edit(control: Locator, text: string) {
  await control.fill(text);
  await control.press('Enter');
}

// An edit reaches the arrangement a moment after the control changes, so the export waits for it.
async function exportWav(page: Page, path: string) {
  await page.waitForTimeout(250);
  const download = page.waitForEvent('download');
  await exportAs(page, 'Scene WAV');
  await (await download).saveAs(path);
  return readFile(path);
}

// The browser's offline renderer can round a handful of samples differently from one run to the
// next, by the smallest step a WAV file has. Anything more than that is a real difference.
function same(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 44; i + 1 < a.length; i += 2) {
    const gap = Math.abs(a.readInt16LE(i) - b.readInt16LE(i));
    if (gap > 2 || (gap > 0 && ++differing > 40)) return false;
  }
  return true;
}

// How loud a stretch of a 16-bit stereo WAV at 44.1 kHz is, in the file's own steps.
function loudness(wav: Buffer, from: number, to: number) {
  let sum = 0, count = 0;
  for (let i = 44 + Math.round(from * 44100) * 4; i + 1 < Math.min(wav.length, 44 + Math.round(to * 44100) * 4); i += 2) {
    sum += wav.readInt16LE(i) ** 2;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}
const decibels = (ratio: number) => 20 * Math.log10(ratio);

const effects = (page: Page) => page.locator('.effects-unit');
const kind = (page: Page) => effects(page).getByLabel('Reverb kind', { exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('the reverb\'s kind is chosen, stored, kept across a reload, and the Room is stored as nothing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(kind(page)).toHaveValue('room');
  expect((await stored(page)).effectsLoop.reverb.kind, 'a project that never chose one has none').toBeUndefined();
  await kind(page).selectOption({ label: 'Hall' });
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.kind).toBe('hall');
  await page.reload();
  await expect(kind(page)).toHaveValue('hall');
  // Live playback takes the change of kind, and of decay on the Hall, while it plays.
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(400);
  const reverb = effects(page).locator('.effects-block').filter({ has: page.getByRole('heading', { name: 'Reverb', exact: true }) });
  await edit(reverb.getByLabel('Decay value', { exact: true }), '5');
  await kind(page).selectOption({ label: 'Room' });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect.poll(async () => 'kind' in (await stored(page)).effectsLoop.reverb, 'back to the Room, nothing is stored').toBe(false);
  expect((await stored(page)).effectsLoop.reverb.decay).toBe(5);
  await page.reload();
  await expect(kind(page)).toHaveValue('room');
  expect(errors).toEqual([]);
});

test('an export with the Hall differs from the Room, is about as loud, rings on for the decay asked, and is the same every time', async ({ page }, testInfo) => {
  // Seven audio exports one after another.
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const unit = page.locator('[data-unit="drums"]');
  const reverb = effects(page).locator('.effects-block').filter({ has: page.getByRole('heading', { name: 'Reverb', exact: true }) });
  const take = (name: string) => exportWav(page, testInfo.outputPath(`${name}.wav`));

  // One kick at the start of the bar, all of it into a reverb with no gap and no damping.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await effects(page).getByLabel('Delay enabled', { exact: true }).uncheck();
  await effects(page).getByLabel('Drive enabled', { exact: true }).uncheck();
  await edit(reverb.getByLabel('Decay value', { exact: true }), '2');
  await edit(reverb.getByLabel('Mix value', { exact: true }), '100%');
  await edit(effects(page).getByLabel('Reverb pre-delay value', { exact: true }), '0');
  await edit(effects(page).getByLabel('Reverb damping value', { exact: true }), '0');
  await unit.getByRole('button', { name: 'Sends', exact: true }).click();
  await edit(unit.getByLabel('Rev Send value', { exact: true }), '100%');
  await edit(unit.getByLabel('FX Return value', { exact: true }), '100%');
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb).toEqual({ enabled: true, decay: 2, mix: 1 });

  // The kick rings on quietly by itself for about three seconds, under every reverb tail: the check
  // machines' takes showed it, and it is what read every tail as about three seconds long, whatever
  // the knob said (roadmap 14). So a tail is measured with the same kick and no reverb subtracted,
  // sample by sample. Renders repeat, and nothing here comes near the limiter, so what is left is the
  // reverb alone.
  await effects(page).getByLabel('Reverb enabled', { exact: true }).uncheck();
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.enabled).toBe(false);
  const dry = await take('dry');
  await effects(page).getByLabel('Reverb enabled', { exact: true }).check();
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.enabled).toBe(true);
  const wet = (wav: Buffer) => {
    const out = Buffer.from(wav);
    for (let i = 44; i + 1 < out.length; i += 2) out.writeInt16LE(Math.max(-32768, Math.min(32767, wav.readInt16LE(i) - (i + 1 < dry.length ? dry.readInt16LE(i) : 0))), i);
    return out;
  };

  const room = await take('room');
  await kind(page).selectOption({ label: 'Hall' });
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.kind).toBe('hall');
  const hall = await take('hall');
  expect(hall.length, 'the file is as long either way').toBe(room.length);
  expect(same(hall, room), 'the Hall is not the Room').toBe(false);
  expect(same(await take('hall-again'), hall), 'and renders the same every time').toBe(true);

  // The kick is over well inside half a second; after that it is the reverb.
  const late = (wav: Buffer) => loudness(wav, 0.6, 2.4);
  const levels = { room: late(room), hall: late(hall) };
  // The tail's fall over 0.8 s, as seconds to fall 60 dB.
  const decayOf = (wav: Buffer) => 60 * 0.8 / decibels(loudness(wav, 0.6, 0.9) / loudness(wav, 1.4, 1.7));
  console.log('hall-reverb levels', JSON.stringify({ ...levels, difference: decibels(levels.hall / levels.room), hallDecay: decayOf(hall), roomDecay: decayOf(room) }));
  expect(levels.hall, 'the Hall rings on after the kick').toBeGreaterThan(5);
  // The two are matched by their whole tail (`hallReverb.test.ts`). The Room's impulse falls only
  // 52 dB in its decay and stops, the Hall the full 60, so late on the Hall reads a few decibels
  // under it, and it falls a little faster. This measure reads long for both (the Room at 2 s
  // read 3.07 on the check machines, the Hall 2.92), so the Hall is held to the Room's reading.
  expect(Math.abs(decibels(levels.hall / levels.room)), 'about as loud as the Room at the same mix').toBeLessThan(6);
  expect(decayOf(hall) / decayOf(room), 'and falls in about the time the Room does').toBeGreaterThan(0.7);
  expect(decayOf(hall) / decayOf(room)).toBeLessThan(1.1);

  // A longer decay leaves more late; a shorter one less.
  await edit(reverb.getByLabel('Decay value', { exact: true }), '4');
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.decay).toBe(4);
  const long = await take('hall-long');
  await edit(reverb.getByLabel('Decay value', { exact: true }), '1');
  await expect.poll(async () => (await stored(page)).effectsLoop.reverb.decay).toBe(1);
  const short = await take('hall-short');
  const end = (wav: Buffer) => loudness(wav, 1.5, 1.9);
  // The whole takes, the kick's own tail included: they only show the tail following the knob
  // upwards, since a short reverb sinks under the kick's tail. The model in `hallReverb.test.ts` has
  // a four-second Hall 16 times louder here than a two-second one; the whole takes gave 2.4 for
  // that reason. The reverb alone is measured below.
  console.log('hall-reverb tails', JSON.stringify({ long: end(long), hall: end(hall), short: end(short), room: end(room), hallLast: loudness(hall, 2.2, 2.4), roomLast: loudness(room, 2.2, 2.4), longDecay: decayOf(long), shortDecay: decayOf(short) }));
  expect(end(long), 'a four-second Hall is louder late than a two-second one').toBeGreaterThan(end(hall) * 1.5);
  expect(decayOf(long), 'which follows the knob').toBeGreaterThan(decayOf(hall) * 1.2);

  // The reverb alone, with the kick's own tail taken out: the decay knob is followed both ways.
  const alone = { short: wet(short), hall: wet(hall), long: wet(long), room: wet(room) };
  console.log('hall-reverb alone', JSON.stringify({ shortEnd: end(alone.short), hallEnd: end(alone.hall), longEnd: end(alone.long), roomEnd: end(alone.room), shortDecay: decayOf(alone.short), hallDecay: decayOf(alone.hall), longDecay: decayOf(alone.long), roomDecay: decayOf(alone.room) }));
  expect(end(alone.long), 'a four-second Hall rings on louder than a two-second one').toBeGreaterThan(end(alone.hall) * 1.5);
  expect(end(alone.short), 'and a one-second Hall quieter').toBeLessThan(end(alone.hall) / 1.5);
  // Not the decays read off the reverb alone: the reverb is fed the kick, whose own tail falls in about
  // three seconds, and nothing that comes out can fall faster than what goes in. The check machines
  // read 3.02, 3.09 and 4.29 seconds for one, two and four. The levels above are what tell them apart.
  expect(errors).toEqual([]);
});
