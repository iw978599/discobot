import test from 'node:test';
import assert from 'node:assert/strict';
import { eqGains, reverbImpulse } from '../src/hooks/browserAudio.ts';
import { sanitizeEffects, sanitizeSends, sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { seededRandom } from '../src/services/drumScheduling.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { SynthCore } from '../../engine/src/synth/SynthCore.ts';
import { createDefaultSynthParameters, toVoiceParams } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const RATE = 44100;
const context = {
  sampleRate: RATE,
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, getChannelData: (channel: number) => data[channel] };
  },
} as unknown as BaseAudioContext;
const energy = (samples: Float32Array) => samples.reduce((sum, value) => sum + value * value, 0);
// Energy in the sample-to-sample change: large for hiss, small for a dull sound.
const brightness = (samples: Float32Array) => samples.reduce((sum, value, index) => sum + (index ? (value - samples[index - 1]) ** 2 : 0), 0) / energy(samples);

const loop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};

test('a reverb with no pre-delay and no damping is the one older projects were made with', () => {
  const plain = reverbImpulse(context, 0.5, seededRandom(3)).getChannelData(0);
  const random = seededRandom(3), expected = new Float32Array(RATE / 2);
  for (let i = 0; i < expected.length; i++) expected[i] = (random() * 2 - 1) * Math.exp(-6 * i / expected.length) * Math.min(1, i / 64);
  assert.deepEqual(plain, expected);
  assert.deepEqual(reverbImpulse(context, 0.5, seededRandom(3), 0, 0).getChannelData(0), expected);
});

test('pre-delay holds the reverb back and damping darkens its tail', () => {
  const late = reverbImpulse(context, 0.5, seededRandom(3), 0.1, 0).getChannelData(0);
  assert.equal(late.length, RATE * 0.6, 'the tail is as long as before, after the gap');
  assert.equal(energy(late.subarray(0, RATE * 0.1)), 0, 'nothing sounds during the pre-delay');
  assert.ok(energy(late.subarray(RATE * 0.1)) > 0);

  const open = reverbImpulse(context, 0.5, seededRandom(3), 0.001, 0).getChannelData(0);
  const damped = reverbImpulse(context, 0.5, seededRandom(3), 0.001, 1).getChannelData(0);
  const half = Math.floor(open.length / 2);
  assert.ok(brightness(damped.subarray(half)) < brightness(open.subarray(half)) * 0.25, 'a damped tail has lost most of its highs');
  assert.ok(brightness(damped.subarray(half)) < brightness(damped.subarray(0, half)), 'and gets darker as it goes on');
  assert.ok(damped.every(Number.isFinite));
  assert.deepEqual(reverbImpulse(context, 0.5, seededRandom(3), 0.02, 0.4).getChannelData(1), reverbImpulse(context, 0.5, seededRandom(3), 0.02, 0.4).getChannelData(1), 'repeatable with a seeded source');
  assert.equal(reverbImpulse(context, 0.5, seededRandom(3), 99, 99).length, RATE * 0.75, 'a hostile pre-delay is bounded');
});

test('chorus, EQ and the reverb shape are optional, bounded, and absent from older projects', () => {
  const old = sanitizeEffects(loop, loop);
  assert.deepEqual(old, loop, 'a project saved before they existed is unchanged');
  assert.equal('chorus' in old || 'eq' in old || 'preDelay' in old.reverb, false);

  const set = sanitizeEffects({
    ...loop, reverb: { ...loop.reverb, preDelay: 0.03, damping: 0.4 },
    chorus: { enabled: true, rate: 1.2, depth: 0.5, mix: 0.7 }, eq: { enabled: true, low: 3, mid: -2.5, high: 6 },
  }, loop);
  assert.deepEqual(set.reverb, { enabled: true, decay: 2, mix: .3, preDelay: 0.03, damping: 0.4 });
  assert.deepEqual(set.chorus, { enabled: true, rate: 1.2, depth: 0.5, mix: 0.7 });
  assert.deepEqual(set.eq, { enabled: true, low: 3, mid: -2.5, high: 6 });

  const hostile = sanitizeEffects({
    ...loop, reverb: { ...loop.reverb, preDelay: 50, damping: -3 },
    chorus: { enabled: 'yes', rate: 1e9, depth: 'deep', mix: -1 }, eq: { enabled: true, low: 400, mid: NaN, high: '9' },
  }, loop);
  assert.deepEqual(hostile.reverb, { enabled: true, decay: 2, mix: .3, preDelay: 0.25 }, 'damping below zero is no damping');
  assert.deepEqual(hostile.chorus, { enabled: false, rate: 8, depth: 0.5, mix: 0 });
  assert.deepEqual(hostile.eq, { enabled: true, low: 12, mid: 0, high: 0 });
  assert.equal('chorus' in sanitizeEffects({ ...loop, chorus: 'on', eq: null }, loop), false);

  assert.deepEqual(eqGains(undefined), [0, 0, 0]);
  assert.deepEqual(eqGains({ enabled: false, low: 6, mid: 6, high: 6 }), [0, 0, 0], 'an EQ that is off is flat');
  assert.deepEqual(eqGains({ enabled: true, low: 6, mid: -40, high: NaN }), [6, -12, 0]);
});

test('a lane saved before the chorus has no send to it, and vibrato is a kept LFO target', () => {
  const defaults = createDefaultSynthParameters();
  assert.equal(defaults.fxSends.chorus, 0);
  assert.deepEqual(sanitizeSends({ reverb: 0.5, delay: 0.5, drive: 0.5, phaser: 0.5 }, defaults.fxSends), { reverb: 0.5, delay: 0.5, drive: 0.5, phaser: 0.5, chorus: 0 });
  assert.equal(sanitizeSends({ chorus: 7 }, defaults.fxSends).chorus, 1);
  const kept = sanitizeSynthParams({ ...defaults, lfo1: { ...defaults.lfo1, target: 'vibrato' }, lfo2: { ...defaults.lfo2, target: 'wobble' } }, defaults);
  assert.deepEqual([kept.lfo1.target, kept.lfo2.target], ['vibrato', defaults.lfo2.target]);
});

test('vibrato is the pitch LFO scaled to a semitone at full depth', () => {
  const render = (target: string, depth: number) => {
    const core = new SynthCore(48000);
    core.setParams({ ...toVoiceParams(createDefaultSynthParameters()), lfo1Enabled: true, lfo1Target: target, lfo1Depth: depth, lfo1Rate: 6 });
    core.noteOn({ note: 'A3', velocity: 0.8, time: 0, duration: 0.2 });
    const left = new Float32Array(9600), right = new Float32Array(9600);
    core.process(left, right);
    return left;
  };
  assert.deepEqual(render('vibrato', 0.6), render('pitch', 0.6 / 12), 'the same movement, twelve times finer');
  assert.notDeepEqual(render('vibrato', 1), render('vibrato', 0));
});

test('the store keeps the new effect settings, and only a new project starts with the shaped reverb', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize({
    synthParams: createDefaultSynthParameters(),
    drumState: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
      steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
    }])) as DrumState,
    drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0, chorus: 0 }, returnLevel: .7 },
    effectsLoop: loop,
  });
  const post = (path: string, body: unknown) => service.request(path, { method: 'POST', body: JSON.stringify(body) });
  assert.deepEqual(service.snapshot().effectsLoop.reverb, { ...loop.reverb, preDelay: 0.02, damping: 0.35 }, 'a new project gets a gap and some damping');

  await post('/effects-loop', { chorus: { enabled: true, rate: 0.8, depth: 0.4, mix: 0.9 }, eq: { enabled: true, low: 2, mid: 0, high: -3 } });
  await post('/effects-loop', { reverb: { ...loop.reverb, preDelay: 0, damping: 0 } });
  await post('/drum/fx', { sends: { chorus: 0.4 } });
  const state = service.snapshot();
  assert.deepEqual(state.effectsLoop.chorus, { enabled: true, rate: 0.8, depth: 0.4, mix: 0.9 });
  assert.deepEqual(state.effectsLoop.eq, { enabled: true, low: 2, mid: 0, high: -3 });
  assert.deepEqual(state.effectsLoop.reverb, loop.reverb, 'turned back to zero, the reverb is the plain one again');
  assert.equal(state.drumFx.sends.chorus, 0.4);

  // A project file from before these existed loads without them, and is not reported as damaged.
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  delete file.project.effectsLoop.chorus; delete file.project.effectsLoop.eq; delete file.project.drumFx.sends.chorus;
  for (const synth of file.project.synths) delete synth.synthParams.fxSends.chorus;
  const imported = await service.importProject(file);
  assert.equal(imported.ok, true);
  const back = service.snapshot();
  assert.equal('chorus' in back.effectsLoop || 'eq' in back.effectsLoop, false);
  assert.deepEqual(back.effectsLoop.reverb, loop.reverb);
  assert.equal(back.drumFx.sends.chorus, 0);
});
