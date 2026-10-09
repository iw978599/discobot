import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { BrowserTransport } from '../src/services/browserTransport.ts';
import { encodeWav } from '../src/services/wavExport.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const storage = new Map<string, string>();
const defaults = () => ({
  synthParams: createDefaultSynthParameters(),
  drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
  }])) as DrumState,
  drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 },
  effectsLoop: {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  } satisfies EffectsLoopState,
});
function setup() {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize(defaults());
  return service;
}
const mutate = (service: LocalProjectService, path: string, body: unknown, method = 'POST') =>
  service.request(path, { method, body: JSON.stringify(body) });

test('local synth state merges nested controls, isolates lanes, persists across reload', async () => {
  const service = setup();
  await mutate(service, '/synth/create', { synthId: 2 });
  await mutate(service, '/synth/1/parameters', { filter: { frequency: 1234 }, lfo1: { sync: true } });
  const state = service.snapshot();
  assert.equal(state.synths[0].synthParams.filter.frequency, 1234);
  assert.equal(state.synths[0].synthParams.filter.q, defaults().synthParams.filter.q);
  assert.equal(state.synths[0].synthParams.lfo1.sync, true);
  assert.notEqual(state.synths[1].synthParams.filter.frequency, 1234);
  service.flush();
  const restored = new LocalProjectService();
  restored.initialize(defaults());
  assert.equal(restored.snapshot().synths[0].synthParams.filter.frequency, 1234);
  assert.equal(restored.snapshot().synths.length, 2);
  assert.equal((await service.request('/synth/1', { method: 'DELETE' })).status, 400);
});

test('patterns save, overwrite, load and delete entirely locally', async () => {
  const service = setup();
  const initial = service.snapshot();
  const body = { name: 'My arrangement', steps: initial.synths[0].pattern.steps, synthParams: initial.synths[0].synthParams, tempo: 120,
    drumState: initial.drumState, synths: [{ id: 1, steps: initial.synths[0].pattern.steps, synthParams: initial.synths[0].synthParams }], drumSwing: .25 };
  const saved = await (await mutate(service, '/patterns/save', body)).json();
  const conflict = await mutate(service, '/patterns/save', { ...body, name: 'my arrangement' });
  assert.equal(conflict.status, 409);
  await mutate(service, '/patterns/save', { ...body, tempo: 140, overwriteId: saved.id });
  const restored = new LocalProjectService(); restored.initialize(defaults());
  const loaded = await (await restored.request(`/patterns/saved/${saved.id}`)).json();
  assert.equal(loaded.tempo, 140);
  assert.equal(loaded.drumSwing, .25);
  assert.equal(loaded.synths.length, 1);
  await restored.request(`/patterns/saved/${saved.id}`, { method: 'DELETE' });
  assert.deepEqual(await (await restored.request('/patterns/saved')).json(), []);
});

test('drum kits, velocity, pan, mute, swing, effects and tempo are functional state', async () => {
  const service = setup();
  const kits = await (await service.request('/drum/kits')).json();
  assert.equal(kits.kits.length, 8);
  await mutate(service, '/drum/step', { instrument: 'kick', step: 3, active: true });
  await mutate(service, '/drum/step-velocity', { instrument: 'kick', step: 3, velocity: .33 });
  await mutate(service, '/drum/settings', { instrument: 'kick', settings: { pan: -.5, tune: .4 } });
  await mutate(service, '/drum/mix', { instrument: 'kick', muted: true });
  await mutate(service, '/drum/swing', { swing: .3 });
  await mutate(service, '/drum/master-volume', { volume: .6 });
  await mutate(service, '/effects-loop', { delay: { feedback: .7 } });
  await mutate(service, '/tempo', { tempo: 137 }, 'PUT');
  let state = service.snapshot();
  assert.equal(state.drumState.kick.steps[3], true);
  assert.equal(state.drumState.kick.stepVelocities[3], .33);
  assert.equal(state.drumState.kick.settings.pan, -.5);
  assert.equal(state.drumState.kick.muted, true);
  assert.equal(state.drumSwing, .3);
  assert.equal(state.drumMasterVolume, .6);
  assert.equal(state.effectsLoop.delay.feedback, .7);
  assert.equal(state.effectsLoop.delay.time, .2);
  assert.equal(state.synths[0].pattern.tempo, 137);
  await mutate(service, '/drum/kit', { kitId: 'tr-808' });
  state = service.snapshot();
  assert.equal(state.drumState.kick.settings.volume, .75);
  assert.equal(state.drumState.kick.steps[3], true);
});

test('imported pattern becomes active and transport never resumes automatically on reload', async () => {
  const service = setup();
  const pattern = { id: 'midi-import', name: 'Imported', tempo: 90, steps: [{ active: true, note: 'C4', velocity: .8 }] };
  await mutate(service, '/synth/1/patterns/midi-import', pattern, 'PUT');
  await mutate(service, '/sequencer/play', { synthId: 1, patternId: pattern.id });
  assert.equal(service.snapshot().synths[0].isPlaying, true);
  await mutate(service, '/synth/1/parameters', { gain: .7 });
  service.flush();
  const restored = new LocalProjectService(); restored.initialize(defaults());
  assert.equal(restored.snapshot().synths[0].pattern.id, pattern.id);
  assert.equal(restored.snapshot().synths[0].isPlaying, false);
});

test('quota failures do not claim successful arrangement saves', async () => {
  const service = setup();
  const messages: string[] = [];
  service.subscribe(message => messages.push(message.type));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    setItem() { throw new Error('QuotaExceededError'); },
  } });
  const result = await mutate(service, '/patterns/save', { name: 'Lost', steps: [] });
  assert.equal(result.status, 507);
  assert.deepEqual(service.snapshot().savedPatterns, []);
  assert.ok(messages.includes('storageError'));
});

test('an intact project reloads without a damage warning; a broken drum grid is reported', async () => {
  const service = setup();
  await mutate(service, '/drum/step', { instrument: 'kick', step: 3, active: true });
  service.flush();
  const reload = () => {
    const restored = new LocalProjectService();
    restored.initialize(defaults());
    const messages: string[] = [];
    restored.subscribe(message => messages.push(message.type));
    return messages;
  };
  assert.deepEqual(reload(), ['init']);
  const stored = JSON.parse(storage.get('discobot_browser_project_v1')!);
  stored.drumState.kick.steps = 'none';
  storage.set('discobot_browser_project_v1', JSON.stringify(stored));
  assert.deepEqual(reload(), ['init', 'storageError']);
});

test('damaged stored projects recover to a usable local synth and announce the error', () => {
  setup();
  storage.set('discobot_browser_project_v1', JSON.stringify({ version: 1, synths: [{}], savedPatterns: [], drumState: null }));
  const service = new LocalProjectService();
  service.initialize(defaults());
  const messages: string[] = [];
  service.subscribe(message => messages.push(message.type));
  assert.equal(service.snapshot().synths[0].synthId, 1);
  assert.equal(service.snapshot().restored, false);
  assert.ok(messages.includes('storageError'));
});

test('failed deletes leave the saved arrangement available', async () => {
  const service = setup();
  const saved = await (await mutate(service, '/patterns/save', { name: 'Keep', steps: [] })).json();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    setItem() { throw new Error('QuotaExceededError'); },
  } });
  assert.equal((await service.request(`/patterns/saved/${saved.id}`, { method: 'DELETE' })).status, 507);
  assert.equal(service.snapshot().savedPatterns.length, 1);
});

test('WAV encoding writes valid interleaved stereo PCM and sanitizes nonfinite samples', () => {
  const data = new DataView(encodeWav([new Float32Array([.5, Infinity]), new Float32Array([-.5, NaN])], 48000));
  assert.equal(data.getUint16(22, true), 2);
  assert.equal(data.getUint32(24, true), 48000);
  assert.equal(data.getUint32(40, true), 8);
  assert.equal(data.getInt16(44, true), 16384);
  assert.equal(data.getInt16(46, true), -16383);
  assert.equal(data.getInt16(48, true), 0);
  assert.equal(data.getInt16(50, true), 0);
});

test('shared transport schedules 32 synchronized ticks and skips stale work after suspension', () => {
  let time = 0, bpm = 120;
  const ticks: { step: number; time: number; duration: number }[] = [];
  const transport = new BrowserTransport(() => time, () => bpm, tick => ticks.push(tick));
  transport.start();
  for (let i = 1; i <= 100; i++) { time = i * .02; transport.pump(); }
  assert.deepEqual(ticks.slice(0, 32).map(t => t.step), Array.from({ length: 32 }, (_, i) => i));
  assert.ok(Math.abs(ticks[16].time - ticks[0].time - 1) < .0001);
  bpm = 240; time += .1; transport.pump();
  assert.equal(ticks[ticks.length - 1].duration, .03125);
  const before = ticks.length;
  time += 30; transport.pump();
  assert.ok(ticks.length - before < 6);
  transport.stop();
  assert.equal(transport.running, false);
});
