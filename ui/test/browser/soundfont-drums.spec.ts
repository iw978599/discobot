import { expect, test, type Page } from '@playwright/test';
import { INSTRUMENT, SAMPLE_ID, buildSoundFont, keys } from '../helpers/soundFontFile.ts';

// A drum kit from a SoundFont on the drum lanes (the owner, 2026-10-20): the kit chosen among the
// font's presets, each lane offered the drum General MIDI has for it, and nothing kept until the
// choices are confirmed.

const stored = (page: Page) => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1') || '{}')));
const hit = (step: number) => Array.from({ length: 3000 }, (_, i) => Math.round(9000 * Math.sin(i / step) * (1 - i / 3000)));

function kitFont(): Buffer {
  return Buffer.from(buildSoundFont({
    name: 'Little kit',
    samples: [{ name: 'kick', data: hit(20), rate: 22050, pitch: 36 }, { name: 'snare', data: hit(6), rate: 22050, pitch: 38 }, { name: 'piano', data: hit(8), rate: 22050, pitch: 60 }],
    instruments: [
      { name: 'Kit', zones: [{ gens: [keys(36, 36), [SAMPLE_ID, 0]] }, { gens: [keys(38, 38), [SAMPLE_ID, 1]] }] },
      { name: 'Piano', zones: [{ gens: [keys(0, 127), [SAMPLE_ID, 2]] }] },
    ],
    presets: [
      { name: 'Piano', bank: 0, program: 0, zones: [{ gens: [[INSTRUMENT, 1]] }] },
      { name: 'Standard', bank: 128, program: 0, zones: [{ gens: [[INSTRUMENT, 0]] }] },
    ],
  }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
    localStorage.setItem('discobot_walkthrough_v1', 'seen');
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Discobot', exact: true })).toBeVisible();
});

test('a SoundFont drum kit puts its kick and snare on those lanes, chosen first and confirmed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const drums = page.getByRole('region', { name: 'Drums module', exact: true });
  await drums.getByLabel('Import SoundFont drum kit', { exact: true }).setInputFiles({ name: 'kit.sf2', mimeType: 'application/octet-stream', buffer: kitFont() });

  const choose = page.getByRole('dialog', { name: 'Import a SoundFont drum kit', exact: true });
  await expect(choose.getByLabel('SoundFont instrument', { exact: true }).locator('option:checked'), 'the kit, not the piano, to begin with').toHaveText('128:0 Standard');
  await choose.getByRole('button', { name: 'Import', exact: true }).click();

  const kit = page.getByRole('dialog', { name: 'Import a drum kit', exact: true });
  await expect(kit.getByLabel('File for Kick', { exact: true }).locator('option:checked')).toHaveText('Bass Drum 1 (C2).wav');
  await expect(kit.getByLabel('File for Snare', { exact: true }).locator('option:checked')).toHaveText('Acoustic Snare (D2).wav');
  await expect(kit.getByLabel('File for Clap', { exact: true }).locator('option:checked'), 'a drum the kit lacks is left').toHaveText('Leave as it is');
  expect((await stored(page)).drumState.kick.sampleId, 'nothing is kept before it is confirmed').toBeUndefined();
  await kit.getByRole('button', { name: 'Use These Sounds', exact: true }).click();
  await expect(kit).toHaveCount(0);

  await expect.poll(async () => (await stored(page)).drumState.kick.sampleId).toMatch(/^[0-9a-f-]{36}$/);
  const saved = await stored(page);
  expect(saved.drumState.snare.sampleId).toMatch(/^[0-9a-f-]{36}$/);
  expect(saved.drumState.snare.sampleId).not.toBe(saved.drumState.kick.sampleId);
  expect('sampleId' in saved.drumState.clap).toBe(false);
  expect(errors).toEqual([]);
});
