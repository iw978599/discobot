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

const drums = (page: Page) => page.locator('[data-unit="drums"]');
const select = (page: Page, drum: string) => drums(page).getByRole('button', { name: `Select ${drum}`, exact: true }).click();
const share = (page: Page, drum: string, effect: 'delay' | 'reverb') => drums(page).getByRole('slider', { name: `${drum} to ${effect}`, exact: true });
const setShare = (page: Page, drum: string, effect: 'delay' | 'reverb', text: string) => edit(drums(page).getByLabel(`${drum} to ${effect} value`, { exact: true }), text);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('each drum has a delay send and a reverb send of its own, beside the kit\'s, kept with the project', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const unit = drums(page);
  await unit.getByRole('button', { name: 'Sends', exact: true }).click();
  const row = unit.locator('.drum-sends');
  await expect(row.getByRole('group', { name: 'Kick\'s share of the kit\'s delay and reverb sends', exact: true })).toBeVisible();
  await expect(row.locator('.drum-send-name')).toHaveText('Kick\'s share');

  // Every drum starts with all of itself sent, and a project that sets none stores none.
  for (const effect of ['delay', 'reverb'] as const) {
    await expect(share(page, 'Kick', effect)).toHaveAttribute('aria-valuenow', '1');
    await expect(share(page, 'Kick', effect)).toHaveAttribute('aria-valuetext', '100%');
  }
  expect(JSON.stringify((await stored(page)).drumState)).not.toContain('Send');
  // The kit's own sends are still there, with the names they had.
  for (const name of ['Rev Send', 'Dly Send', 'Drv Send', 'Phs Send', 'Cho Send']) await expect(row.getByRole('slider', { name, exact: true })).toBeVisible();

  await setShare(page, 'Kick', 'reverb', '0%');
  await expect(share(page, 'Kick', 'reverb')).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(async () => (await stored(page)).drumState.kick.settings.reverbSend).toBe(0);

  // Another drum has its own, and choosing it does not change how tall the row is.
  const height = async () => Math.round((await row.boundingBox())!.height);
  const before = await height();
  await select(page, 'Snare');
  await expect(share(page, 'Kick', 'reverb')).toHaveCount(0);
  await expect(share(page, 'Snare', 'reverb')).toHaveAttribute('aria-valuenow', '1');
  await setShare(page, 'Snare', 'delay', '40%');
  await expect(share(page, 'Snare', 'delay')).toHaveAttribute('aria-valuenow', '0.4');
  await select(page, 'Closed Hat');
  await expect(row.locator('.drum-send-name')).toHaveText('Closed Hat\'s share');
  expect(await height(), 'the longest name does not make the row taller').toBe(before);
  await setShare(page, 'Closed Hat', 'reverb', '250%');
  await expect(share(page, 'Closed Hat', 'reverb'), 'a share is never more than all of it').toHaveAttribute('aria-valuenow', '1');

  await expect.poll(async () => (await stored(page)).drumState.snare.settings.delaySend).toBe(0.4);
  const saved = (await stored(page)).drumState;
  expect(saved.kick.settings.reverbSend).toBe(0);
  expect('delaySend' in saved.kick.settings).toBe(false);
  expect('reverbSend' in saved.snare.settings).toBe(false);
  expect(JSON.stringify(saved.closedHH.settings)).not.toContain('Send');

  // Choosing another kit changes the drums' sound and leaves where each is sent.
  await page.getByLabel('Drum kit', { exact: true }).selectOption('tr-909');
  await expect.poll(async () => (await stored(page)).selectedDrumKitId).toBe('tr-909');
  expect((await stored(page)).drumState.kick.settings.reverbSend).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
  await drums(page).getByRole('button', { name: 'Sends', exact: true }).click();
  await expect(share(page, 'Kick', 'reverb')).toHaveAttribute('aria-valuenow', '0');
  await expect(share(page, 'Kick', 'delay')).toHaveAttribute('aria-valuenow', '1');
  await select(page, 'Snare');
  await expect(share(page, 'Snare', 'delay')).toHaveAttribute('aria-valuenow', '0.4');

  // Back to all of it: a middle click with a mouse, or the figure typed. It is then stored as nothing.
  if (testInfo.project.name === 'chromium') await share(page, 'Snare', 'delay').click({ button: 'middle' });
  else await setShare(page, 'Snare', 'delay', '100%');
  await expect(share(page, 'Snare', 'delay')).toHaveAttribute('aria-valuenow', '1');
  await expect.poll(async () => 'delaySend' in (await stored(page)).drumState.snare.settings).toBe(false);
  await select(page, 'Kick');
  await setShare(page, 'Kick', 'reverb', '100%');
  await expect.poll(async () => JSON.stringify((await stored(page)).drumState).includes('Send')).toBe(false);
  expect(errors).toEqual([]);
});

test('a drum kept out of the reverb or the delay is kept out of it in an export, and the rest of the kit is not', async ({ page }, testInfo) => {
  // Nine audio exports one after another.
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const unit = drums(page), effects = page.locator('.effects-unit');
  const block = (name: string) => effects.locator('.effects-block').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const take = (name: string) => exportWav(page, testInfo.outputPath(`${name}.wav`));

  // One short, loud kick at the start of the bar, into a long reverb that the whole kit is sent to.
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await edit(unit.getByLabel('Kick Punch value', { exact: true }), '20%');
  await edit(unit.getByLabel('Kick volume value', { exact: true }), '100%');
  await effects.getByLabel('Reverb enabled', { exact: true }).check();
  await effects.getByLabel('Delay enabled', { exact: true }).check();
  await edit(block('Reverb').getByLabel('Decay value', { exact: true }), '4');
  await edit(block('Reverb').getByLabel('Mix value', { exact: true }), '100%');
  await unit.getByRole('button', { name: 'Sends', exact: true }).click();
  await edit(unit.getByLabel('Rev Send value', { exact: true }), '100%');
  await edit(unit.getByLabel('Dly Send value', { exact: true }), '0%');
  await edit(unit.getByLabel('FX Return value', { exact: true }), '100%');
  await expect.poll(async () => (await stored(page)).drumFx).toMatchObject({ sends: { reverb: 1, delay: 0 }, returnLevel: 1 });
  expect((await stored(page)).effectsLoop.reverb).toMatchObject({ enabled: true, decay: 4, mix: 1 });

  // The kick is over well inside a second; what is left after that is the reverb.
  const wet = await take('kick-in-reverb');
  await setShare(page, 'Kick', 'reverb', '0%');
  await expect.poll(async () => (await stored(page)).drumState.kick.settings.reverbSend).toBe(0);
  const dry = await take('kick-out-of-reverb');
  expect(dry.length, 'the file is as long either way').toBe(wet.length);
  const tail = (wav: Buffer) => loudness(wav, 1.25, 3.25);
  expect(tail(wet), 'with the kick sent, the reverb rings on after it').toBeGreaterThan(5);
  expect(tail(dry), 'kept out, it leaves next to nothing behind').toBeLessThan(tail(wet) / 10);
  expect(Math.abs(loudness(dry, 0, 0.1) - loudness(wet, 0, 0.1)), 'the kick itself is as loud as it was').toBeLessThan(loudness(wet, 0, 0.1) * 0.25);

  // A snare with the kick: only the kick is kept out.
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  const snareIn = await take('snare-in-reverb');
  expect(same(snareIn, dry), 'the snare is heard').toBe(false);
  expect(loudness(snareIn, 2.5, 4), 'and its reverb rings on though the kick\'s does not').toBeGreaterThan(Math.max(1, loudness(dry, 2.5, 4) * 5));
  // Both kept out is what the kit's own send at nothing gives: the kit's send is the master over them.
  await select(page, 'Snare');
  await setShare(page, 'Snare', 'reverb', '0%');
  await expect.poll(async () => (await stored(page)).drumState.snare.settings.reverbSend).toBe(0);
  const bothOut = await take('both-out-of-reverb');
  expect(same(bothOut, snareIn)).toBe(false);
  await setShare(page, 'Snare', 'reverb', '100%');
  await select(page, 'Kick');
  await setShare(page, 'Kick', 'reverb', '100%');
  await expect.poll(async () => JSON.stringify((await stored(page)).drumState).includes('Send')).toBe(false);
  const allIn = await take('all-in-reverb');
  await edit(unit.getByLabel('Rev Send value', { exact: true }), '0%');
  await expect.poll(async () => (await stored(page)).drumFx.sends.reverb).toBe(0);
  const kitOut = await take('kit-out-of-reverb');
  expect(same(kitOut, bothOut), 'every drum kept out is the kit\'s send turned to nothing').toBe(true);
  expect(same(allIn, kitOut)).toBe(false);

  // The delay the same way: with the kit sent to it, a kick kept out changes the export, and put back it is what it was.
  await edit(unit.getByLabel('Dly Send value', { exact: true }), '100%');
  await expect.poll(async () => (await stored(page)).drumFx.sends.delay).toBe(1);
  const echo = await take('kick-in-delay');
  await setShare(page, 'Kick', 'delay', '0%');
  await expect.poll(async () => (await stored(page)).drumState.kick.settings.delaySend).toBe(0);
  const noEcho = await take('kick-out-of-delay');
  expect(same(noEcho, echo), 'the kick\'s echoes are gone').toBe(false);
  expect(loudness(noEcho, 0.2, 0.45), 'the first echo of the kick is not there').toBeLessThan(loudness(echo, 0.2, 0.45));
  await setShare(page, 'Kick', 'delay', '100%');
  await expect.poll(async () => 'delaySend' in (await stored(page)).drumState.kick.settings).toBe(false);
  expect(same(await take('kick-back-in-delay'), echo), 'all of it again is the export it was').toBe(true);
  expect(errors).toEqual([]);
});
