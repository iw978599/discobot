import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { enterSynthModel, mapSynthModelToEngineParams } from '../src/synthModels.ts';
import type { SynthParameters } from '../src/types.ts';
import { setup } from './helpers/store.ts';

const SR = 48000;
type Inserts = NonNullable<SynthParameters['inserts']>;
const base = (): SynthParameters => ({ ...createDefaultSynthParameters(), envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.05 } });

// A note held for `hold` seconds, then `tail` seconds of what is left.
function render(inserts: Inserts | undefined, hold = 0.2, tail = 1, bpm = 120): [Float32Array, Float32Array] {
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({ ...base(), ...(inserts ? { inserts } : {}) }, bpm));
  core.noteOn({ note: 'A4', velocity: 1, duration: hold });
  const left = new Float32Array(Math.round(SR * (hold + tail))), right = new Float32Array(left.length);
  core.process(left, right);
  return [left, right];
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((sample, index) => sample === b[index]);
const energy = (samples: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) sum += samples[i] * samples[i];
  return sum;
};

test('a lane with no insert effects, or with each at its neutral setting, plays as it always did', () => {
  const [plain] = render(undefined);
  const [neutral] = render({ drive: 0, tone: 0, chorus: { mix: 0, depth: 1, rate: 5 }, delay: { mix: 0, time: 0.4, feedback: 0.8 } });
  assert.ok(same(plain, neutral));
  assert.ok(energy(plain, 0.1, 0.2) > 0, 'and it sounds');
});

test('drive changes the sound, and tone takes the top or the bottom off', () => {
  const [plain] = render(undefined), [driven] = render({ drive: 0.8 });
  assert.ok(!same(plain, driven));
  const [dark] = render({ tone: -1 }), [thin] = render({ tone: 1 });
  assert.ok(energy(dark, 0.1, 0.2) < energy(plain, 0.1, 0.2), 'the low-pass takes the harmonics of an A4 saw away');
  assert.ok(energy(thin, 0.1, 0.2) < energy(plain, 0.1, 0.2) * 0.2, 'a high-pass at 2 kHz takes most of an A4 saw');
  for (const out of [driven, dark, thin]) assert.ok(out.every(Number.isFinite));
});

test('the delay repeats the note after its time, and its feedback keeps repeating it', () => {
  const [plain] = render(undefined, 0.1, 1.2);
  const [echo] = render({ delay: { mix: 0.8, time: 0.3, feedback: 0.5 } }, 0.1, 1.2);
  assert.ok(energy(plain, 0.5, 0.7) < 1e-6, 'nothing sounds long after the note without it');
  assert.ok(energy(echo, 0.31, 0.4) > energy(plain, 0.31, 0.4), 'the first echo');
  assert.ok(energy(echo, 0.61, 0.7) > 0, 'and the second');
});

test('the chorus changes the sound and stays bounded', () => {
  const [plain] = render(undefined), [wide] = render({ chorus: { mix: 0.7, depth: 1, rate: 1 } });
  assert.ok(!same(plain, wide));
  assert.ok(wide.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1.5));
});

test('switching the effects off clears what they held', () => {
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({ ...base(), inserts: { delay: { mix: 1, time: 0.2, feedback: 0.8 } } }));
  core.noteOn({ note: 'A4', velocity: 1, duration: 0.1 });
  core.process(new Float32Array(SR / 2), new Float32Array(SR / 2));
  core.setParams(toVoiceParams(base()));
  const left = new Float32Array(SR / 2), right = new Float32Array(SR / 2);
  core.process(left, right);
  assert.ok(energy(left, 0.1, 0.4) < 1e-9, 'no echo is left to come back');
});

test('a synced chorus and delay take their rate and time from the tempo', () => {
  const synced = toVoiceParams({ ...base(), inserts: { chorus: { mix: 0.5, depth: 0.5, rate: 0.6, sync: '1/4' }, delay: { mix: 0.5, time: 0.9, feedback: 0.3, sync: '1/8' } } }, 120);
  assert.equal(synced.insChorusRate, 2, 'a quarter note at 120 is two a second');
  assert.equal(synced.insDelayTime, 0.25, 'an eighth note at 120 is a quarter of a second');
  const free = toVoiceParams({ ...base(), inserts: { chorus: { mix: 0.5, depth: 0.5, rate: 0.6 }, delay: { mix: 0.5, time: 0.9, feedback: 0.3 } } }, 120);
  assert.equal(free.insChorusRate, 0.6);
  assert.equal(free.insDelayTime, 0.9);
  assert.equal(toVoiceParams(base()).insDrive, 0);
});

test('stored insert effects are bounded, and an older sound has none', () => {
  const defaults = createDefaultSynthParameters();
  const old = sanitizeSynthParams(defaults, defaults);
  assert.equal('inserts' in old, false, 'a sound saved before they existed stores nothing for them');
  assert.deepEqual(sanitizeSynthParams({ ...defaults, inserts: { drive: 0, tone: 0, chorus: { mix: 0, depth: 0.5, rate: 0.6, sync: 'off' }, delay: { mix: 0, time: 0.25, feedback: 0.3 } } }, defaults), old);

  const hostile = sanitizeSynthParams({
    ...defaults,
    inserts: { drive: 9, tone: -4, chorus: { mix: -1, depth: 'deep', rate: 1e9, sync: 'weekly' }, delay: { mix: 7, time: 99, feedback: 5, sync: '1/4' } },
  }, defaults);
  assert.deepEqual(hostile.inserts, {
    drive: 1, tone: -1,
    chorus: { mix: 0, depth: 0.5, rate: 20 },
    delay: { mix: 1, time: 1.5, feedback: 0.85, sync: '1/4' },
  });
  for (const junk of ['loud', 7, null, [], { drive: 'x', chorus: 3, delay: [] }]) {
    assert.equal('inserts' in sanitizeSynthParams({ ...defaults, inserts: junk }, defaults), false, JSON.stringify(junk));
  }
});

test('the Polysix Ensemble is the lane chorus insert, and leaving the Polysix takes it away', () => {
  const macros = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 1 };
  assert.equal(mapSynthModelToEngineParams('polysix', macros).fxSends, undefined, 'it no longer sets the send');
  const entered = enterSynthModel('polysix', macros);
  assert.ok((entered.inserts?.chorus?.mix ?? 0) > 0);
  assert.equal(entered.fxSends, undefined);

  const defaults = createDefaultSynthParameters();
  const left = enterSynthModel('minimoog-model-d', macros, 'polysix');
  assert.equal(left.fxSends, undefined, 'a chorus send is the person\'s own and stays');
  const lane = sanitizeSynthParams({ ...defaults, inserts: { drive: 0.3, chorus: { mix: 0.5, depth: 0.6, rate: 0.8 } } }, defaults);
  const after = sanitizeSynthParams({ ...lane, ...left, inserts: { ...lane.inserts, ...left.inserts, chorus: { ...lane.inserts!.chorus, ...left.inserts!.chorus } } }, defaults);
  assert.deepEqual(after.inserts, { drive: 0.3 }, 'the chorus goes and the drive stays');
});

test('a whole sound with no inserts takes a lane\'s inserts away, and one knob\'s change does not', () => {
  const service = setup();
  const sound = () => (service.snapshot() as any).synths[0].synthParams as SynthParameters;
  assert.ok(service.setSynthParams(1, { inserts: { drive: 0.5, delay: { mix: 0.4, time: 0.3, feedback: 0.2 } } }).ok);
  assert.equal(sound().inserts?.drive, 0.5);
  assert.ok(service.setSynthParams(1, { gain: 1.2 }).ok);
  assert.equal(sound().inserts?.drive, 0.5, 'a knob elsewhere leaves them');
  assert.ok(service.setSynthParams(1, createDefaultSynthParameters()).ok);
  assert.equal('inserts' in sound(), false, 'a preset, Reset or undo that has none puts none');
});
