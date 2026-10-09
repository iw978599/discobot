import { test, expect, type Page } from '@playwright/test';
import { encodeWav } from '../../src/services/wavExport';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
async function menu(page: Page, name: 'Project' | 'Export', item: string) {
  await page.getByRole('button', { name: `${name} ▾`, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const openMidi = (page: Page) => page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();

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
  await page.getByRole('button', { name: 'Mute Synth 2', exact: true }).click();
  await page.getByRole('button', { name: 'Synth 2', exact: true }).click();
  await page.getByRole('button', { name: 'Oct +', exact: true }).click();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'E4 step 1', exact: true }).click();
  await page.getByRole('button', { name: '+ Save', exact: true }).click();
  await page.locator('.save-name-input').fill('Local arrangement');
  await page.locator('.save-name-input').press('Enter');
  await expect(page.getByText('Saved!', { exact: false })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('discobot_browser_project_v1')!).savedPatterns[0]);
  expect(saved.tempo).toBe(146);
  expect(saved.drumSwing).toBe(.35);
  expect(saved.synths).toHaveLength(3);
  expect(saved.synths.find((s: any) => s.id === 2).muted).toBe(true);
  expect(saved.synths.find((s: any) => s.id === 2).octaveShift).toBe(1);
  await page.getByRole('button', { name: 'Mute Synth 2', exact: true }).click();
  await page.getByRole('button', { name: /Remove/ }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Synth 2 +', exact: true })).toBeVisible();
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('90');
  await page.locator('.tempo-led-input').press('Enter');
  await page.locator('.load-select').selectOption(saved.id);
  await expect(page.locator('.tempo-led-value')).toHaveText('146');
  await expect(page.getByRole('button', { name: 'Mute Synth 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('discobot_browser_project_v1')!).synths.find((s: any) => s.synthId === 2)?.pattern.steps[0].note)).toBe('E4');
  await page.reload();
  await expect(page.locator('.tempo-led-value')).toHaveText('146');
  await expect(page.getByLabel('Swing value', { exact: true })).toHaveValue('35%');
  await expect(page.getByRole('button', { name: 'Mute Synth 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('samples persist in IndexedDB and play and delete without uploading', async ({ page }) => {
  await page.goto('./');
  const samples = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 44100) * .1);
  await openMidi(page);
  await page.getByLabel('Import audio sample', { exact: true }).setInputFiles({
    name: 'local-tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([samples], 44100)),
  });
  await expect(page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true })).toBeVisible();
  await page.reload();
  await openMidi(page);
  await page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true }).click();
  await expect(page.locator('.sample-panel [role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete sample local-tone.wav', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true })).toHaveCount(0);
  await page.reload();
  await openMidi(page);
  await expect(page.getByText('No samples yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play sample local-tone.wav', exact: true })).toHaveCount(0);
});

test('MIDI and WAV exports create local downloadable files', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  const midiPromise = page.waitForEvent('download');
  await menu(page, 'Export', 'Export MIDI');
  const midi = await midiPromise;
  expect(midi.suggestedFilename()).toMatch(/\.mid$/);
  const wavPromise = page.waitForEvent('download');
  await menu(page, 'Export', 'Download WAV');
  const wav = await wavPromise;
  expect(wav.suggestedFilename()).toMatch(/\.wav$/);
  expect(await wav.failure()).toBeNull();
});

test('undo and redo step through synth and drum edits in the order they were made', async ({ page }) => {
  await page.goto('./');
  const state = () => page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem('discobot_browser_project_v1')!);
    return {
      kick: project.drumState.kick.steps[0],
      snare: project.drumState.snare.steps[4],
      note: project.synths.find((s: any) => s.synthId === 2)?.pattern.steps[0].note ?? null,
    };
  });
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Synth 2', exact: true }).click();
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 5', exact: true }).click();
  await expect.poll(state).toEqual({ kick: true, snare: true, note: 'C3' });

  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect.poll(state).toEqual({ kick: true, snare: false, note: 'C3' });
  await undo.click();
  await expect.poll(state).toEqual({ kick: true, snare: false, note: null });
  await undo.click();
  await expect.poll(state).toEqual({ kick: false, snare: false, note: null });

  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await redo.click();
  await redo.click();
  await expect.poll(state).toEqual({ kick: true, snare: false, note: 'C3' });
});

test('drums on the same step all reach the drum voice at their own levels and are audible', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.drumHits = [];
    win.drumProbe = null;
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        if (name !== 'drum-processor') return;
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        this.connect(analyser);
        win.drumProbe = analyser;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message: any) => {
          if (message.type === 'hit') win.drumHits.push({ instrument: message.instrument, velocity: message.velocity, volume: message.settings.volume, time: message.time });
          post(message);
        };
      }
    };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Kick step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Select Snare', exact: true }).click();
  await page.getByRole('button', { name: 'Snare step 1', exact: true }).click();
  await page.getByLabel('Snare step 1 velocity', { exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Select Open Hat', exact: true }).click();
  await page.getByRole('button', { name: 'Open Hat step 1', exact: true }).click();
  await page.getByRole('button', { name: 'Select Closed Hat', exact: true }).click();
  await page.getByRole('button', { name: 'Closed Hat step 1', exact: true }).click();
  await page.evaluate(() => { (window as any).drumHits.length = 0; });
  const volumes = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('discobot_browser_project_v1')!).drumState;
    return { kick: state.kick.settings.volume, snare: state.snare.settings.volume, openHH: state.openHH.settings.volume, closedHH: state.closedHH.settings.volume };
  });

  await page.getByRole('button', { name: /Play All/ }).click();
  const scheduled = () => page.evaluate(() => (window as any).drumHits.filter((hit: any) => typeof hit.time === 'number'));
  await expect.poll(async () => (await scheduled()).length, { timeout: 8000 }).toBeGreaterThanOrEqual(4);
  const hits = (await scheduled()).slice(0, 4);
  expect(new Set(hits.map((hit: any) => hit.time)).size, 'all four drums are scheduled for the same instant').toBe(1);
  const byInstrument = Object.fromEntries(hits.map((hit: any) => [hit.instrument, hit]));
  expect(Object.keys(byInstrument).sort()).toEqual(['closedHH', 'kick', 'openHH', 'snare']);
  for (const instrument of ['kick', 'snare', 'openHH', 'closedHH'] as const) {
    expect(byInstrument[instrument].volume).toBeCloseTo(volumes[instrument]);
  }
  expect(byInstrument.kick.velocity).toBe(1);
  expect(byInstrument.snare.velocity).toBeCloseTo(0.4);
  await expect.poll(() => page.evaluate(() => {
    const analyser = (window as any).drumProbe as AnalyserNode | null;
    if (!analyser) return false;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return samples.some(value => Math.abs(value) > .01);
  }), { timeout: 8000 }).toBe(true);
  await page.getByRole('button', { name: /Stop All/ }).click();
});

test('the new voice controls, FM engine and step slide are saved with the project', async ({ page }) => {
  await page.goto('./');
  const lane = () => page.evaluate(() => JSON.parse(localStorage.getItem('discobot_browser_project_v1')!).synths[0]);
  await tab(page, 'Osc');
  await page.getByLabel('Oscillator 2 enabled').check({ force: true });
  await page.getByLabel('Voice mode').selectOption('mono');
  await page.getByRole('slider', { name: 'Sub', exact: true }).press('ArrowUp');
  await tab(page, 'Filter');
  await page.getByRole('slider', { name: 'Env Amt', exact: true }).press('ArrowUp');
  await tab(page, 'LFO');
  await page.getByLabel('LFO 1 target').selectOption('amp', { force: true });
  await expect.poll(async () => {
    const params = (await lane()).synthParams;
    return [params.oscillator2.enabled, params.voiceMode, params.filter.envAmount > 0, params.mixer.sub > 0, params.lfo1.target];
  }).toEqual([true, 'mono', true, true, 'amp']);

  await tab(page, 'Osc');
  await page.getByLabel('Synth engine').selectOption('fm');
  await expect(page.getByLabel('FM algorithm')).toBeVisible();
  await page.getByLabel('FM algorithm').selectOption('0');
  await expect.poll(async () => { const params = (await lane()).synthParams; return [params.engine, params.fm.algorithm]; }).toEqual(['fm', 0]);
  await page.getByLabel('Synth model').selectOption('tb-303');
  await expect.poll(async () => { const params = (await lane()).synthParams; return [params.engine, params.voiceMode, params.velocity.filter > 0.5]; }).toEqual(['subtractive', 'mono', true]);

  await tab(page, 'Notes');
  await page.getByRole('button', { name: 'Piano Roll', exact: true }).click();
  await page.getByRole('button', { name: 'C3 step 1', exact: true }).click();
  await page.getByLabel('Step 1 slide', { exact: true }).check();
  await expect.poll(async () => (await lane()).pattern.steps[0].slide).toBe(true);
  await page.reload();
  await expect.poll(async () => (await lane()).pattern.steps[0].slide).toBe(true);
  await tab(page, 'Osc');
  await expect(page.getByLabel('Voice mode')).toHaveValue('mono');
});
