import { test, expect, type Page } from '@playwright/test';
import { encodeWav } from '../../src/services/wavExport';

// At phone width the top bar is one line, and the rest of it is in the sheet its last button
// raises. `more` raises the sheet before something in it is used, and does nothing on a wide
// screen; `less` puts it away again after something that leaves it up.
const onPhone = (page: Page) => {
  const size = page.viewportSize();
  return size !== null && (size.width <= 720 || (size.width <= 960 && size.height <= 500 && size.width > size.height));
};
const more = async (page: Page) => {
  if (!onPhone(page) || await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) return;
  await page.getByRole('button', { name: 'More controls', exact: true }).click();
};
const less = async (page: Page) => {
  if (await page.getByRole('dialog', { name: 'More controls', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close more controls', exact: true }).click();
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

// The editor has two levels, Notes and Sound; the pages of the sound (Osc, Filter and the rest) are under Sound.
const tab = async (page: Page, name: string) => {
  if (name !== 'Notes' && name !== 'Sound') await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).click();
};
async function menu(page: Page, name: 'Project' | 'Export', item: string) {
  if (name === 'Export') return exportAs(page, item);
  await more(page);
  await page.getByRole('button', { name: 'Project ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
// A project that shares its row with copies of itself is chosen from that row's list first: pass the row's name as `family`.
async function openProject(page: Page, name: string, family?: string) {
  await more(page);
  await page.getByRole('button', { name: /^Project: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Projects', exact: true });
  const row = dialog.getByRole('group', { name: `Project ${family ?? name}`, exact: true });
  if (family) await row.getByLabel(`Version of ${family}`, { exact: true }).selectOption(name);
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await more(page);
  await expect(page.getByRole('button', { name: `Project: ${name}`, exact: true })).toBeVisible();
  await less(page);
}
const openMidi = async (page: Page) => {
  await more(page);
  await page.getByRole('button', { name: 'MIDI and samples', exact: true }).click();
};

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

test('a kept copy restores tempo, lanes, swing and mutes; undo restores edits', async ({ page }) => {
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
  const saved = await page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1')!)));
  expect(saved.tempo).toBe(146);
  expect(saved.drumSwing).toBe(.35);
  expect(saved.synths).toHaveLength(3);
  expect(saved.synths.find((s: any) => s.synthId === 2).muted).toBe(true);
  expect(saved.synths.find((s: any) => s.synthId === 2).octaveShift).toBe(1);
  await menu(page, 'Project', 'Save a Copy');
  await page.getByRole('button', { name: 'Mute Synth 2', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Synth 2 +', exact: true })).toBeVisible();
  await page.locator('.tempo-led').click();
  await page.locator('.tempo-led-input').fill('90');
  await page.locator('.tempo-led-input').press('Enter');
  await openProject(page, 'Untitled copy', 'Untitled');
  await expect(page.locator('.tempo-led-value')).toHaveText('146');
  await expect(page.getByRole('button', { name: 'Mute Synth 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1')!)).synths.find((s: any) => s.synthId === 2)?.pattern.steps[0].note)).toBe('E4');
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
  await menu(page, 'Export', 'Scene MIDI');
  const midi = await midiPromise;
  expect(midi.suggestedFilename()).toMatch(/\.mid$/);
  const wavPromise = page.waitForEvent('download');
  await menu(page, 'Export', 'Scene WAV');
  const wav = await wavPromise;
  expect(wav.suggestedFilename()).toMatch(/\.wav$/);
  expect(await wav.failure()).toBeNull();
});

test('undo and redo step through synth and drum edits in the order they were made', async ({ page }) => {
  await page.goto('./');
  const state = () => page.evaluate(() => {
    const project = (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1')!));
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
    const state = (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1')!)).drumState;
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
  const lane = () => page.evaluate(() => (window.dispatchEvent(new Event('pagehide')), JSON.parse(localStorage.getItem('discobot_browser_project_v1')!)).synths[0]);
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
