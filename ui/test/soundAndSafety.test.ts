import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore } from '../../engine/src/synth/SynthCore.ts';
import { createDefaultSynthParameters, toVoiceParams } from '../../engine/src/synth/voiceParams.ts';
import type { VoiceParams } from '../../engine/src/synth/voiceParams.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { drumHits } from '../src/services/wavExport.ts';
import { scheduleDuck } from '../src/hooks/browserAudio.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const SR = 48000;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

function render(params: Partial<VoiceParams>, note = 'A2', seconds = 0.5) {
  const core = new SynthCore(SR);
  core.setParams({ ...toVoiceParams(createDefaultSynthParameters()), oscType: 'sawtooth', attack: 0.002, sustain: 1, ...params });
  core.noteOn({ note, velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  assert.ok(left.every(Number.isFinite));
  return left;
}

// Energy of one frequency in a signal (Goertzel), so a test can ask how loud a harmonic is.
function level(samples: Float32Array, frequency: number) {
  const w = 2 * Math.PI * frequency / SR, coefficient = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (const sample of samples) { const s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - coefficient * s1 * s2) / samples.length;
}

test('one unison voice is exactly the old sound; more voices beat against each other at the same loudness', () => {
  assert.deepEqual(render({ unisonVoices: 1, unisonDetune: 1 }), render({}), 'a single voice ignores the spread setting');
  const single = render({}, 'A2', 1), stacked = render({ unisonVoices: 5, unisonDetune: 0.6 }, 'A2', 1);
  assert.notDeepEqual(stacked, single);
  assert.ok(Math.abs(rms(stacked) / rms(single) - 1) < 0.35, 'stacking voices does not make the lane much louder or quieter');
  // Detuned copies drift in and out of phase, so the level moves over time; a single saw is steady.
  const wobble = (samples: Float32Array) => {
    const windows = Array.from({ length: 16 }, (_, i) => rms(samples.subarray(12000 + i * 2000, 14000 + i * 2000)));
    return (Math.max(...windows) - Math.min(...windows)) / Math.max(...windows);
  };
  assert.ok(wobble(single) < 0.12, `a single saw is steady (${wobble(single)})`);
  assert.ok(wobble(stacked) > Math.max(0.25, wobble(single) * 3), `unison beats (${wobble(stacked)})`);
  assert.deepEqual(render({ unisonVoices: 5, unisonDetune: 0 }, 'A2', 0.2).slice(0, 8).some(Number.isNaN), false);
});

test('the 24 dB filter cuts harmonics above the cutoff much harder than the 12 dB one', () => {
  // A 110 Hz saw through a 400 Hz low-pass: compare a harmonic two octaves above the cutoff.
  const base = { filterFreq: 400, filterQ: 0.7 };
  const gentle = render({ ...base, filterSlope: 12 }), steep = render({ ...base, filterSlope: 24 });
  const high = (samples: Float32Array) => level(samples.subarray(4800), 1760);
  const fundamental = (samples: Float32Array) => level(samples.subarray(4800), 110);
  assert.ok(high(steep) < high(gentle) * 0.2, 'about another 12 dB per octave down');
  assert.ok(Math.abs(fundamental(steep) / fundamental(gentle) - 1) < 0.15, 'below the cutoff the two are alike');
  const resonant = render({ filterFreq: 880, filterQ: 12, filterSlope: 24 });
  assert.ok(level(resonant.subarray(4800), 880) > level(render({ filterFreq: 880, filterQ: 0.7, filterSlope: 24 }).subarray(4800), 880) * 2, 'resonance still peaks at the cutoff');
  assert.deepEqual(render({ filterType: 'notch', filterFreq: 400, filterSlope: 24 }), render({ filterType: 'notch', filterFreq: 400 }), 'notch has one slope');
});

test('new sound settings are clamped on load and default to off for older projects', () => {
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as Record<string, any>;
  delete old.unison; delete old.duck; delete old.filter.slope;
  const loaded = sanitizeSynthParams(old, defaults);
  assert.deepEqual([loaded.unison, loaded.duck, loaded.filter.slope], [{ voices: 1, detune: 0.3 }, 0, 12]);
  const hostile = sanitizeSynthParams({ ...defaults, unison: { voices: 99, detune: -4 }, duck: 7, filter: { ...defaults.filter, slope: 48 } }, defaults);
  assert.deepEqual([hostile.unison, hostile.duck, hostile.filter.slope], [{ voices: 5, detune: 0 }, 1, 12]);
  const voice = toVoiceParams(sanitizeSynthParams({ ...defaults, unison: { voices: 3, detune: 0.5 }, filter: { ...defaults.filter, slope: 24 } }, defaults));
  assert.deepEqual([voice.unisonVoices, voice.unisonDetune, voice.filterSlope], [3, 0.5, 24]);
});

test('a duck dips to the right depth at the kick and recovers; zero amount schedules nothing', () => {
  const events: Array<[number, number, number]> = [];
  const param = { setTargetAtTime: (value: number, time: number, constant: number) => { events.push([value, time, constant]); } } as unknown as AudioParam;
  scheduleDuck(param, 2, 0);
  assert.deepEqual(events, []);
  scheduleDuck(param, 2, 1);
  assert.equal(events.length, 2);
  assert.ok(Math.abs(events[0][0] - 0.1) < 1e-9, 'full amount is -20 dB');
  assert.equal(events[0][1], 2);
  assert.deepEqual([events[1][0], events[1][1] > 2], [1, true], 'then it returns to full level');
  events.length = 0;
  scheduleDuck(param, 0, 0.5);
  assert.ok(Math.abs(events[0][0] - 0.55) < 1e-9);
});

test('export works out every drum hit once, so kick ducking follows the kicks that actually play', () => {
  const drumState = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5 },
  }])) as DrumState;
  drumState.kick.steps[0] = drumState.kick.steps[8] = true;
  drumState.kick.stepRatchets = Array(16).fill(1); drumState.kick.stepRatchets[8] = 2;
  drumState.snare.steps[4] = true;
  const arrangement = { tempo: 120, drumState, drumKitId: 'tr-808', drumMasterVolume: 0.5, drumSwing: 0 };
  const hits = drumHits(arrangement, 2);
  const kicks = hits.filter(hit => hit.instrument === 'kick').map(hit => hit.time);
  assert.deepEqual(kicks, [0, 1, 1.0625, 2, 3, 3.0625], 'two bars, with the repeat half a step after beat three');
  assert.equal(hits.find(hit => hit.instrument === 'snare')!.time, 0.5);
  assert.equal(hits[0].settings.volume, 0.4, 'kit master volume is folded in');
  drumState.kick.muted = true;
  assert.equal(drumHits(arrangement).some(hit => hit.instrument === 'kick'), false, 'a muted kick ducks nothing');
  drumState.kick.muted = false;
  drumState.kick.stepProbabilities = Array(16).fill(0);
  assert.equal(drumHits(arrangement).some(hit => hit.instrument === 'kick'), false, 'nor does a kick step that never plays');
});

const effectsLoop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};
const defaults = () => ({
  synthParams: createDefaultSynthParameters(),
  drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
  }])) as DrumState,
  drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop,
});

function store() {
  const storage = new Map<string, string>();
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize(defaults());
  const tempo = () => { const raw = storage.get('discobot_browser_project_v1'); return raw ? JSON.parse(raw).tempo : null; };
  return { service, storage, tempo, writes: () => writes };
}
const post = (service: LocalProjectService, path: string, body: unknown) => service.request(path, { method: 'POST', body: JSON.stringify(body) });

test('a burst of edits is one write, made shortly after the last edit or when flushed', async () => {
  const { service, tempo, writes } = store();
  for (let bpm = 100; bpm <= 140; bpm++) await post(service, '/tempo', { tempo: bpm });
  assert.equal(writes(), 0, 'dragging a control does not write on every change');
  assert.equal(service.snapshot().tempo, 140, 'the live project is already up to date');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual([writes(), tempo()], [1, 140]);

  await post(service, '/tempo', { tempo: 90 });
  assert.equal(service.flush(), true);
  assert.deepEqual([writes(), tempo()], [2, 90], 'closing the page writes at once');
  service.flush();
  assert.equal(writes(), 2, 'nothing to write when nothing changed');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(writes(), 2, 'the pending timer was cancelled by the flush');

  await post(service, '/tempo', { tempo: 91 });
  const saved = await post(service, '/patterns/save', { name: 'Now', steps: [] });
  assert.equal(saved.status, 200);
  assert.deepEqual([writes(), tempo()], [3, 91], 'saving an arrangement writes immediately, pending edits included');
});

test('when another tab has changed the project, this one stops saving until told to keep its version', async () => {
  const listeners = new Map<string, (event: { key: string }) => void>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (type: string, listener: (event: { key: string }) => void) => { listeners.set(type, listener); },
    dispatchEvent: () => true,
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false, addEventListener: () => {} } });
  try {
    const { service, storage, tempo, writes } = store();
    const messages: string[] = [];
    service.subscribe(message => messages.push(message.type));
    await post(service, '/tempo', { tempo: 100 });
    service.flush();
    listeners.get('storage')!({ key: 'something-else' });
    assert.equal(service.savingPaused, false, 'other keys are not our project');

    // The other tab saves tempo 150.
    storage.set('discobot_browser_project_v1', JSON.stringify({ ...JSON.parse(storage.get('discobot_browser_project_v1')!), tempo: 150 }));
    listeners.get('storage')!({ key: 'discobot_browser_project_v1' });
    assert.equal(service.savingPaused, true);
    assert.ok(messages.includes('externalChange'));
    const before = writes();
    await post(service, '/tempo', { tempo: 110 });
    service.flush();
    listeners.get('pagehide')!({ key: '' });
    assert.deepEqual([writes(), tempo()], [before, 150], 'edits here no longer overwrite the other tab, even on reload');

    assert.equal(service.resumeSaving(), true);
    assert.deepEqual([service.savingPaused, tempo()], [false, 110], 'keeping this tab\'s version writes it and resumes');
  } finally {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  }
});
