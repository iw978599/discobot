import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
  await page.getByRole('button', { name: 'Export ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download WAV', exact: true }).click();
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('chorus, the reverb shape and the master EQ change the sound, in the export too, and are saved', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const effects = page.locator('.effects-unit');
  const block = (name: string) => effects.locator('.effects-block').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  let last = await exportWav(page, testInfo.outputPath('plain.wav'));
  const changed = async (name: string, why: string) => {
    const next = await exportWav(page, testInfo.outputPath(`${name}.wav`));
    expect(same(next, last), why).toBe(false);
    last = next;
  };
  const unchanged = async (name: string, why: string) => {
    expect(same(await exportWav(page, testInfo.outputPath(`${name}.wav`)), last), why).toBe(true);
  };

  // A new project's reverb has a gap before it and loses its highs; both can be turned off.
  expect((await stored(page)).effectsLoop.reverb).toMatchObject({ preDelay: 0.02, damping: 0.35 });
  await edit(effects.getByLabel('Reverb pre-delay value', { exact: true }), '80');
  await changed('pre-delay', 'pre-delay moves the reverb');
  await edit(effects.getByLabel('Reverb damping value', { exact: true }), '90');
  await changed('damping', 'damping darkens the reverb');
  await edit(effects.getByLabel('Reverb pre-delay value', { exact: true }), '0');
  await edit(effects.getByLabel('Reverb damping value', { exact: true }), '0');
  await changed('plain-reverb', 'and both can be taken away again');
  expect((await stored(page)).effectsLoop.reverb, 'which is stored the way older projects have it').toEqual({ enabled: true, decay: 2.1, mix: 0.38 });

  // The chorus is a fifth send. Sending to it does nothing until the chorus is on.
  await page.getByRole('button', { name: 'Sends', exact: true }).click();
  await edit(page.getByLabel('Cho Send value', { exact: true }), '80');
  await unchanged('chorus-off', 'a send to a chorus that is off is silent');
  await block('Chorus').getByLabel('Chorus enabled', { exact: true }).check();
  await changed('chorus', 'the chorus is heard once it is on');
  await unchanged('chorus-again', 'and renders the same every time');
  await edit(effects.getByLabel('Chorus depth value', { exact: true }), '90');
  await changed('chorus-deep', 'its depth matters');

  // The EQ is on the whole mix. Flat, it changes nothing.
  await block('Master EQ').getByLabel('Master EQ enabled', { exact: true }).check();
  await unchanged('eq-flat', 'a flat EQ leaves the mix alone');
  await edit(effects.getByLabel('EQ low value', { exact: true }), '6');
  await expect(effects.getByRole('slider', { name: 'EQ low', exact: true })).toHaveAttribute('aria-valuetext', '+6.0dB');
  await changed('eq-low', 'a bass boost is heard');
  await edit(effects.getByLabel('EQ high value', { exact: true }), '-40');
  await changed('eq-high', 'and a treble cut');
  await effects.getByLabel('Effects loop enabled', { exact: true }).uncheck();
  await changed('loop-off', 'turning the effects off takes the chorus and reverb away');
  await block('Master EQ').getByLabel('Master EQ enabled', { exact: true }).uncheck();
  await changed('eq-off', 'but the EQ worked without them, until it was switched off');
  await block('Master EQ').getByLabel('Master EQ enabled', { exact: true }).check();
  await effects.getByLabel('Effects loop enabled', { exact: true }).check();

  // Live playback uses the same settings without complaint.
  await page.getByRole('button', { name: /Play All/ }).click();
  await page.waitForTimeout(600);
  await edit(effects.getByLabel('Chorus rate value', { exact: true }), '2.5');
  await edit(effects.getByLabel('Reverb damping value', { exact: true }), '50');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Stop All/ }).click();

  const saved = (await stored(page)).effectsLoop;
  expect(saved.chorus).toEqual({ enabled: true, rate: 2.5, depth: 0.9, mix: 0.6 });
  expect(saved.eq).toEqual({ enabled: true, low: 6, mid: 0, high: -12 });
  expect(saved.reverb.damping).toBe(0.5);
  expect((await stored(page)).drumFx.sends.chorus).toBe(0.8);
  await page.reload();
  await expect(block('Chorus').getByLabel('Chorus enabled', { exact: true })).toBeChecked();
  await expect(effects.getByRole('slider', { name: 'EQ high', exact: true })).toHaveAttribute('aria-valuenow', '-12');

  // A synth lane has the send too, and an LFO can be a fine vibrato.
  const synth = page.locator('.synth-controls-panel').first();
  await page.getByRole('tab', { name: 'LFO', exact: true }).first().click();
  await synth.getByLabel('LFO 1 enabled', { exact: true }).check();
  await synth.getByLabel('LFO 1 target', { exact: true }).selectOption('vibrato');
  await expect.poll(async () => (await stored(page)).synths[0].synthParams.lfo1.target).toBe('vibrato');
  expect(errors).toEqual([]);
});
