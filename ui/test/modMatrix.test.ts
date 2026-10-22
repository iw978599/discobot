import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MOD_ROUTES, SynthCore, createDefaultSynthParameters, toVoiceParams, type ModRoute } from '@discobot/engine';
import { sanitizeModMatrix, sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import type { SynthParameters } from '../src/types.ts';

const SR = 48000;

interface Played { left: Float32Array; right: Float32Array }

// A held note through a sound made of the plain one with `patch` laid over it.
function play(patch: Partial<SynthParameters>, options: { note?: string; velocity?: number; seconds?: number } = {}): Played {
  const base = createDefaultSynthParameters();
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({
    ...base, oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.1 },
    ...patch,
  }));
  core.noteOn({ note: options.note ?? 'A2', velocity: options.velocity ?? 1 });
  const left = new Float32Array(Math.round(SR * (options.seconds ?? 1))), right = new Float32Array(left.length);
  core.process(left, right);
  return { left, right };
}
const route = (source: ModRoute['source'], destination: ModRoute['destination'], depth: number): ModRoute => ({ source, destination, depth });
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((sample, index) => sample === b[index]);
const size = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
// How much of one frequency is in a signal, in dB (Goertzel).
function level(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SR);
  let s1 = 0, s2 = 0;
  for (const sample of samples) { const s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return 20 * Math.log10(Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / samples.length);
}
// The pitch of a plain tone, from how often it crosses zero going up.
function pitch(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return crossings * SR / samples.length;
}

test('a sound with no routes plays exactly as it did before there were any', () => {
  const plain = play({});
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as unknown as Record<string, unknown>;
  delete old.modMatrix;
  assert.deepEqual(sanitizeSynthParams(old, defaults).modMatrix, []);
  assert.ok(same(play({ modMatrix: [] }).left, plain.left));
  assert.ok(same(play({ modMatrix: undefined }).left, plain.left));
  // A route that goes nowhere, or by nothing, is no route.
  assert.ok(same(play({ modMatrix: [route('lfo1', 'filter', 0)] }).left, plain.left));
  assert.ok(same(play({ modMatrix: [{ source: 'wheel', destination: 'filter', depth: 1 } as unknown as ModRoute] }).left, plain.left));
});

test('routes read from a file are checked: unknown ends dropped, amounts bounded, no more than the voice has places for', () => {
  assert.deepEqual(sanitizeModMatrix('routes'), []);
  assert.deepEqual(sanitizeModMatrix([null, 7, { source: 'lfo1' }, { source: 'explode', destination: 'filter', depth: 1 }]), []);
  assert.deepEqual(sanitizeModMatrix([{ source: 'lfo1', destination: 'pan', depth: 9, extra: true }]), [{ source: 'lfo1', destination: 'pan', depth: 1 }]);
  assert.deepEqual(sanitizeModMatrix([{ source: 'key', destination: 'pitch', depth: 'far' }]), [{ source: 'key', destination: 'pitch', depth: 0 }]);
  const many = Array.from({ length: 9 }, () => route('velocity', 'filter', -0.5));
  assert.equal(sanitizeModMatrix(many).length, MAX_MOD_ROUTES);
  const defaults = createDefaultSynthParameters();
  const kept = sanitizeSynthParams({ ...defaults, modMatrix: [route('random', 'osc2Pitch', -0.25)] }, defaults);
  assert.deepEqual(kept.modMatrix, [route('random', 'osc2Pitch', -0.25)]);
  assert.deepEqual(sanitizeSynthParams(structuredClone(kept), defaults), kept, 'and a checked sound is unchanged by being checked again');
});

test('velocity to the filter: a harder note is brighter, and the other way with the amount under zero', () => {
  const closed = { filter: { ...createDefaultSynthParameters().filter, frequency: 400, q: 0.7 } };
  const harmonic = 1760;
  const plain = level(play(closed).left, harmonic);
  const opened = level(play({ ...closed, modMatrix: [route('velocity', 'filter', 1)] }).left, harmonic);
  const shut = level(play({ ...closed, modMatrix: [route('velocity', 'filter', -1)] }).left, harmonic);
  assert.ok(opened > plain + 20, `a full-velocity note is ${(opened - plain).toFixed(1)} dB brighter up there`);
  assert.ok(shut < plain - 20, `and ${(plain - shut).toFixed(1)} dB duller the other way`);
  // A soft note is moved less.
  const soft = level(play({ ...closed, modMatrix: [route('velocity', 'filter', 1)] }, { velocity: 0.3 }).left, harmonic);
  const softPlain = level(play(closed, { velocity: 0.3 }).left, harmonic);
  assert.ok(soft - softPlain < opened - plain);
});

test('an LFO can be a source without being switched on, and moves the sound from side to side through the pan', () => {
  const lfo1 = { enabled: false, target: 'filter' as const, waveform: 'square' as const, rate: 2, depth: 0, sync: false, retrigger: true };
  const { left, right } = play({ lfo1, modMatrix: [route('lfo1', 'pan', 1)] });
  // A square at 2 Hz: the first quarter of a second one way, the next quarter the other.
  const quarter = SR / 4;
  const first = size(right.subarray(1000, quarter - 1000)) / size(left.subarray(1000, quarter - 1000));
  const second = size(right.subarray(quarter + 1000, 2 * quarter - 1000)) / size(left.subarray(quarter + 1000, 2 * quarter - 1000));
  assert.ok(first > 5 && second < 0.2, `right over left is ${first.toFixed(1)} and then ${second.toFixed(2)}`);
  const centre = play({ lfo1 });
  assert.ok(Math.abs(size(centre.right) / size(centre.left) - 1) < 0.01, 'without the route it stays in the middle');
});

test('the filter envelope to the pitch: the note starts high and settles', () => {
  const patch = {
    oscillator: { type: 'sine' as const, detune: 0, pulseWidth: 0.5 },
    filterEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
    modMatrix: [route('filterEnv', 'pitch', 1)],
  };
  const { left } = play(patch, { note: 'A4' });
  const early = pitch(left.subarray(96, 960)), late = pitch(left.subarray(SR / 2));
  assert.ok(Math.abs(late - 440) < 3, `it settles on the note (${late.toFixed(1)} Hz)`);
  assert.ok(early > 600, `and starts well over it (${early.toFixed(0)} Hz)`);
});

test('a source to the second oscillator moves that one alone', () => {
  const sines = {
    oscillator: { type: 'sine' as const, detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: true, type: 'sine' as const, semitones: 0, detune: 0, level: 1 },
  };
  // Velocity 1 by a third of the way is one octave of the three: the second oscillator at 220, the first still at 110.
  const { left } = play({ ...sines, modMatrix: [route('velocity', 'osc2Pitch', 1 / 3)] });
  const plain = play(sines).left;
  assert.ok(level(left, 220) > level(plain, 220) + 30, 'the second oscillator is an octave up');
  assert.ok(level(left, 110) > -40, 'and the first is where it was');
});

test('the level, the pulse width and the FM amount can each be moved', () => {
  // Level: a square LFO takes it from full to nothing.
  const lfo1 = { enabled: false, target: 'filter' as const, waveform: 'square' as const, rate: 2, depth: 0, sync: false, retrigger: true };
  const gated = play({ lfo1, modMatrix: [route('lfo1', 'amp', 1)] }).left;
  const quarter = SR / 4;
  assert.ok(size(gated.subarray(quarter + 2000, 2 * quarter - 2000)) < size(gated.subarray(2000, quarter - 2000)) * 0.05, 'half of each cycle is silent');
  // Pulse width: a narrower pulse has less of its fundamental.
  const square = { oscillator: { type: 'square' as const, detune: 0, pulseWidth: 0.5 } };
  const narrowed = play({ ...square, modMatrix: [route('velocity', 'pulseWidth', 1)] }).left;
  assert.ok(level(narrowed, 110) < level(play(square).left, 110) - 3, 'the pulse is narrower');
  // FM amount: with the index at nothing the voice is nearly a sine, and velocity brings the sidebands in.
  const fm = { engine: 'fm' as const, fm: { algorithm: 0, ratio: 2, index: 0, decay: 10, feedback: 0 } };
  const bright = play({ ...fm, modMatrix: [route('velocity', 'fmIndex', 1)] }).left;
  assert.ok(level(bright, 330) > level(play(fm).left, 330) + 20, 'FM sidebands appear');
});

test('the random source steps with LFO 1, and is the same every time the same thing is played', () => {
  const lfo1 = { enabled: false, target: 'filter' as const, waveform: 'sawtooth' as const, rate: 8, depth: 0, sync: false, retrigger: true };
  const patch = { lfo1, filter: { ...createDefaultSynthParameters().filter, frequency: 600, q: 2 }, modMatrix: [route('random', 'filter', 0.5)] };
  const once = play(patch).left, again = play(patch).left;
  assert.ok(same(once, again), 'an export is repeatable');
  assert.ok(!same(once, play({ lfo1, filter: patch.filter }).left));
  // Eight steps a second: the brightness in one eighth of a second differs from the next.
  const eighth = SR / 8, brightness = (index: number) => level(once.subarray(index * eighth + 500, (index + 1) * eighth - 500), 1760);
  const steps = [0, 1, 2, 3, 4, 5].map(brightness);
  assert.ok(Math.max(...steps) - Math.min(...steps) > 6, `the steps differ by ${(Math.max(...steps) - Math.min(...steps)).toFixed(1)} dB`);
  // And it does not disturb the noise oscillator, which has a sequence of its own.
  const noisy = { mixer: { sub: 0, noise: 1, osc: 0 } };
  assert.ok(same(play({ ...noisy, lfo1, modMatrix: [route('random', 'pan', 0)] }).left, play({ ...noisy, lfo1 }).left));
});

test('every source to every destination stays finite and inside full scale', () => {
  const sources = ['lfo1', 'lfo2', 'ampEnv', 'filterEnv', 'velocity', 'key', 'random'] as const;
  const destinations = ['pitch', 'osc2Pitch', 'filter', 'amp', 'pulseWidth', 'pan', 'fmIndex'] as const;
  for (const source of sources) {
    for (const destination of destinations) {
      for (const depth of [-1, 1]) {
        const { left, right } = play({ modMatrix: Array.from({ length: MAX_MOD_ROUTES }, () => route(source, destination, depth)) }, { seconds: 0.2 });
        assert.ok([left, right].every(side => side.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1)), `${source} to ${destination} by ${depth}`);
      }
    }
  }
});

test('a sound has up to eight routes, and the eighth is heard as the first is', () => {
  assert.equal(MAX_MOD_ROUTES, 8);
  const idle = Array.from({ length: 7 }, () => route('velocity', 'pan', 0));
  const plain = play({ modMatrix: idle }).left;
  const eighth = play({ modMatrix: [...idle, route('velocity', 'pitch', 0.5)] }).left;
  const first = play({ modMatrix: [route('velocity', 'pitch', 0.5)] }).left;
  assert.ok(same(eighth, first), 'the eighth place sounds as the first');
  assert.ok(pitch(eighth.subarray(6000)) / pitch(plain.subarray(6000)) > 1.3);
  const nine = Array.from({ length: 9 }, (_, index) => route('velocity', 'pitch', index === 8 ? 1 : 0.1));
  assert.equal(sanitizeModMatrix(nine).length, 8);
  assert.equal(sanitizeModMatrix(nine).some(entry => entry.depth === 1), false, 'a ninth is left out');
});

test('a sound of four routes or fewer plays exactly as it did, and each LFO\'s own setting is still its own', () => {
  const four = [route('lfo1', 'filter', 0.3), route('key', 'pan', -0.2), route('velocity', 'amp', 0.4), route('random', 'pulseWidth', 0.5)];
  const voice = toVoiceParams({ ...createDefaultSynthParameters(), modMatrix: four }) as unknown as Record<string, unknown>;
  for (let n = 5; n <= 8; n++) assert.deepEqual([voice[`mod${n}Source`], voice[`mod${n}Destination`], voice[`mod${n}Depth`]], ['', '', 0], `place ${n} is empty`);
  assert.deepEqual([voice.mod4Source, voice.mod4Destination, voice.mod4Depth], ['random', 'pulseWidth', 0.5]);
  const params = createDefaultSynthParameters();
  const lfo = sanitizeSynthParams({ ...params, lfo1: { ...params.lfo1, enabled: true, target: 'vibrato', depth: 0.7 } }, params);
  assert.deepEqual([lfo.lfo1.target, lfo.lfo1.depth, (lfo.modMatrix ?? []).length], ['vibrato', 0.7, 0], 'not turned into a route');
});
