import { test, expect } from '@playwright/test';
import { encodeWav } from '../../src/services/wavExport';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: undefined });
  });
});

test('browser-local transport emits audible independent synth lanes with no API or sockets', async ({ page }) => {
  const errors: string[] = [], remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/\/(api|auth|synth|sequencer|drum|patterns|samples|ws)(\/|$)/.test(new URL(request.url()).pathname)) remote.push(request.url());
  });
  page.on('websocket', socket => remote.push(socket.url()));
  await page.addInitScript(() => {
    const win = window as any;
    win.audioProbes = [];
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        this.connect(analyser);
        win.audioProbes.push(analyser);
      }
    };
  });
  await page.goto('./');
  for (const id of [1, 2, 3]) {
    await page.getByRole('button', { name: `Synth ${id}`, exact: true }).click();
    await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
    await page.getByRole('button', { name: `${id === 1 ? 'C3' : id === 2 ? 'E3' : 'G3'} step 1`, exact: true }).click();
  }
  await page.getByRole('button', { name: /Play All/ }).click();
  await expect(page.getByRole('button', { name: /Stop All/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).audioProbes.length)).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as any).audioProbes.filter((analyser: AnalyserNode) => {
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return samples.some(value => Math.abs(value) > .001);
  }).length), { timeout: 8000 }).toBe(3);
  await page.getByRole('button', { name: /Stop All/ }).click();
  await expect(page.locator('.step-light.on')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Play All/ })).toBeVisible();
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('saved projects restore tempo, mixer, swing and drum velocity; undo restores edits', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByLabel('Kick step 1 velocity', { exact: true }).fill('0.35');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Kick step 1 velocity', { exact: true })).toHaveValue('1');
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('146');
  await page.locator('.tempo-led-input').press('Enter');
  await page.getByLabel('Swing value', { exact: true }).fill('35%');
  await page.getByLabel('Swing value', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '+ Save', exact: true }).click();
  await page.locator('.save-name-input').fill('Local arrangement');
  await page.locator('.save-name-input').press('Enter');
  await expect(page.getByText('Saved!', { exact: false })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('discobot_browser_project_v1')!).savedPatterns[0]);
  expect(saved.tempo).toBe(146);
  expect(saved.drumSwing).toBe(.35);
  expect(saved.synths).toHaveLength(3);
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('90');
  await page.locator('.tempo-led-input').press('Enter');
  await page.locator('.load-select').selectOption(saved.id);
  await expect(page.locator('.tempo-led-value')).toHaveText('146');
  await page.reload();
  await expect(page.locator('.tempo-led-value')).toHaveText('146');
  await expect(page.getByLabel('Swing value', { exact: true })).toHaveValue('35%');
});

test('samples persist in IndexedDB and play and delete without uploading', async ({ page }) => {
  await page.goto('./');
  const samples = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 44100) * .1);
  await page.getByLabel('Import audio sample', { exact: true }).setInputFiles({
    name: 'local-tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([samples], 44100)),
  });
  await expect(page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true }).click();
  await expect(page.locator('.sample-panel [role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete sample local-tone.wav', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true })).toHaveCount(0);
});

test('MIDI and WAV exports create local downloadable files', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  const midiPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MIDI', exact: true }).click();
  const midi = await midiPromise;
  expect(midi.suggestedFilename()).toMatch(/\.mid$/);
  const wavPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download WAV', exact: true }).click();
  const wav = await wavPromise;
  expect(wav.suggestedFilename()).toMatch(/\.wav$/);
  expect(await wav.failure()).toBeNull();
});
