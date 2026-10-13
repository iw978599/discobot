import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import type { SynthParameters } from '../src/types.ts';

const SR = 48000;
// A fifth over A2: 110 Hz and, seven semitones up, 164.81 Hz, which is no harmonic of 110.
const FIRST = 110, SECOND = 110 * 2 ** (7 / 12);

function play(patch: Partial<SynthParameters>, seconds = 1): Float32Array {
  const base = createDefaultSynthParameters();
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({
    ...base, envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.1 }, ...patch,
  }));
  core.noteOn({ note: 'A2', velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left.subarray(SR / 10);
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((sample, index) => sample === b[index]);
function level(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SR);
  let s1 = 0, s2 = 0;
  for (const sample of samples) { const s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return 20 * Math.log10(Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / samples.length);
}
const osc = (type: 'sine' | 'sawtooth') => ({ type, detune: 0, pulseWidth: 0.5 });
const second = (type: 'sine' | 'sawtooth', extra: Partial<NonNullable<SynthParameters['oscillator2']>> = {}) =>
  ({ enabled: true, type, semitones: 7, detune: 0, level: 1, ...extra });

test('a sound saved before sync and ring modulation existed plays exactly as it did', () => {
  const two = { oscillator: osc('sawtooth'), oscillator2: second('sawtooth') };
  assert.ok(same(play(two), play({ ...two, oscillator2: second('sawtooth', { sync: false }) })));
  assert.ok(same(play(two), play({ ...two, mixer: { sub: 0, noise: 0, osc: 1, ring: 0 } })));
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as unknown as { oscillator2: Record<string, unknown>; mixer: Record<string, unknown> };
  delete old.oscillator2.sync; delete old.mixer.ring;
  const loaded = sanitizeSynthParams(old, defaults);
  assert.deepEqual([loaded.oscillator2!.sync, loaded.mixer!.ring], [false, 0]);
  const hostile = sanitizeSynthParams({ ...defaults, oscillator2: { ...defaults.oscillator2!, sync: 'yes' }, mixer: { ...defaults.mixer!, ring: 40 } }, defaults);
  assert.deepEqual([hostile.oscillator2!.sync, hostile.mixer!.ring], [false, 1]);
});

test('a synced second oscillator takes the first one\'s pitch, and its own tuning becomes tone', () => {
  const free = play({ oscillator: osc('sine'), oscillator2: second('sawtooth') });
  const synced = play({ oscillator: osc('sine'), oscillator2: second('sawtooth', { sync: true }) });
  // Free, the second oscillator sounds at its own pitch. Synced, nothing is left there: everything is a harmonic of the first.
  assert.ok(level(free, SECOND) > -36, `free, it is there at its own pitch (${level(free, SECOND).toFixed(1)} dB)`);
  assert.ok(level(synced, SECOND) < level(free, SECOND) - 20, `synced, that pitch is ${(level(free, SECOND) - level(synced, SECOND)).toFixed(1)} dB down`);
  assert.ok(level(synced, FIRST * 2) > level(free, FIRST * 2) + 10, 'and the first one\'s harmonics have come up');
  // Tuned further over the first, a synced oscillator is brighter, not higher.
  const further = play({ oscillator: osc('sine'), oscillator2: second('sawtooth', { sync: true, semitones: 17 }) });
  // The power in the first one's harmonics from the tenth to the thirtieth, against the power in its first three.
  const tilt = (samples: Float32Array) => {
    const power = (from: number, to: number) => { let sum = 0; for (let n = from; n <= to; n++) sum += 10 ** (level(samples, FIRST * n) / 10); return 10 * Math.log10(sum); };
    return power(10, 30) - power(1, 3);
  };
  assert.ok(tilt(further) > tilt(synced) + 3, `tuning it up moves the weight up the harmonics (${tilt(synced).toFixed(1)} dB to ${tilt(further).toFixed(1)} dB)`);
  // Seventeen semitones up is 293.7 Hz, between the first one's second and third harmonics.
  assert.ok(level(further, FIRST * 2 ** (17 / 12)) < level(further, FIRST * 3) - 20, 'and still nothing at its own pitch');
});

test('ring modulation is the two oscillators multiplied: their sum and their difference', () => {
  const sines = { oscillator: osc('sine'), oscillator2: second('sine', { level: 0 }) };
  const ringOnly = play({ ...sines, mixer: { sub: 0, noise: 0, osc: 0, ring: 1 } });
  assert.ok(level(ringOnly, SECOND + FIRST) > -40 && level(ringOnly, SECOND - FIRST) > -40, 'the sum and the difference are there');
  assert.ok(level(ringOnly, FIRST) < level(ringOnly, SECOND + FIRST) - 30, 'and neither oscillator is, by itself');
  assert.ok(level(ringOnly, SECOND) < level(ringOnly, SECOND + FIRST) - 30);
  // It is added to the oscillators, not put in their place.
  const mixed = play({ ...sines, mixer: { sub: 0, noise: 0, osc: 1, ring: 0.5 } });
  assert.ok(level(mixed, FIRST) > -30 && level(mixed, SECOND + FIRST) > -45);
});

test('ring modulation and sync need the second oscillator switched on', () => {
  const off = { oscillator: osc('sawtooth'), oscillator2: { ...second('sawtooth', { sync: true }), enabled: false } };
  assert.ok(same(play({ ...off, mixer: { sub: 0, noise: 0, osc: 1, ring: 1 } }), play({ oscillator: osc('sawtooth') })));
});

test('synced and ring modulated at every tuning, the sound stays finite and inside full scale', () => {
  for (const semitones of [-36, -7, 0, 7, 19, 36]) {
    for (const type of ['sine', 'sawtooth'] as const) {
      const out = play({ oscillator: osc('sawtooth'), oscillator2: second(type, { sync: true, semitones }), mixer: { sub: 1, noise: 1, osc: 1, ring: 1 }, unison: { voices: 7, detune: 1, mix: 1 } }, 0.3);
      assert.ok(out.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1), `${type} at ${semitones}`);
    }
  }
});
