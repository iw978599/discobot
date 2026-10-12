import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { enterSynthModel, mapSynthModelToEngineParams } from '../src/synthModels.ts';
import type { OscillatorType, SynthParameters } from '../src/types.ts';

const SR = 48000;
const MIDDLE = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };

// A held note on A2 (110 Hz) through the filter as set, after the filter has settled.
function render(filter: Partial<SynthParameters['filter']>, wave: OscillatorType = 'sawtooth', seconds = 0.5): Float32Array {
  const base = createDefaultSynthParameters();
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({
    ...base, oscillator: { type: wave, detune: 0, pulseWidth: 0.5 },
    envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.1 },
    filter: { ...base.filter, ...filter },
  }));
  core.noteOn({ note: 'A2', velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left.subarray(SR / 10);
}

// How much of one frequency is in a signal, in dB (Goertzel).
function level(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SR);
  let s1 = 0, s2 = 0;
  for (const sample of samples) { const s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return 20 * Math.log10(Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / samples.length);
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((sample, index) => sample === b[index]);

test('a sound saved before there was a high-pass plays exactly as it did', () => {
  const before = { frequency: 900, q: 3 };
  assert.ok(same(render(before), render({ ...before, highpass: 0 })));
  assert.ok(same(render(before), render({ ...before, highpass: 19 })), 'under 20 Hz there is none');
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as unknown as { filter: Record<string, unknown> };
  delete old.filter.highpass; delete old.filter.model;
  const loaded = sanitizeSynthParams(old, defaults).filter;
  assert.deepEqual([loaded.highpass, loaded.model], [0, 'svf']);
  const hostile = sanitizeSynthParams({ ...defaults, filter: { ...defaults.filter, highpass: -50, model: 'ms20' } }, defaults).filter;
  assert.deepEqual([hostile.highpass, hostile.model], [0, 'ms20']);
  assert.equal(sanitizeSynthParams({ ...defaults, filter: { ...defaults.filter, highpass: 9e9 } }, defaults).filter.highpass, 20000);
});

test('the high-pass takes out what is under it and leaves what is over it', () => {
  const open = render({ frequency: 18000, q: 0.7 }), thinned = render({ frequency: 18000, q: 0.7, highpass: 800 });
  // 110 Hz is nearly three octaves under 800: a two-pole high-pass takes most of it away.
  assert.ok(level(thinned, 110) < level(open, 110) - 24, `the fundamental drops by ${(level(open, 110) - level(thinned, 110)).toFixed(1)} dB`);
  // 3520 Hz, the thirty-second harmonic, is two octaves over it and nearly untouched.
  assert.ok(Math.abs(level(thinned, 3520) - level(open, 3520)) < 1.5);
  // It works in front of any filter.
  assert.ok(level(render({ frequency: 18000, q: 0.7, highpass: 800, model: 'ladder' }), 110) < level(render({ frequency: 18000, q: 0.7, model: 'ladder' }), 110) - 24);
});

test('the MS-20 filter is a two-pole low-pass that is close to the clean one until its peak is pushed', () => {
  const clean = render({ frequency: 700, q: 0.7 }), ms = render({ frequency: 700, q: 0.7, model: 'ms20' });
  for (const frequency of [110, 660, 2200]) {
    assert.ok(Math.abs(level(ms, frequency) - level(clean, frequency)) < 2, `at ${frequency} Hz with the peak down`);
  }
  // It is always two poles, whatever slope the lane had.
  assert.ok(same(render({ frequency: 700, q: 2, model: 'ms20', slope: 24 }), render({ frequency: 700, q: 2, model: 'ms20', slope: 12 })));
  // And only a low-pass: any other type is the clean filter's sound, sample for sample.
  for (const type of ['highpass', 'bandpass', 'notch'] as const) {
    assert.ok(same(render({ type, frequency: 900, q: 2, model: 'ms20' }), render({ type, frequency: 900, q: 2 })), type);
  }
});

test('pushed, its peak is held back and distorts, where the clean filter rings cleanly', () => {
  // A sine has one frequency. Whatever else comes out, the filter made.
  const cutoff = 330, third = 990;
  const clean = render({ frequency: cutoff, q: 25 }, 'sine', 1), ms = render({ frequency: cutoff, q: 25, model: 'ms20' }, 'sine', 1);
  assert.ok(level(ms, third) > level(clean, third) + 12, `the third harmonic is ${(level(ms, third) - level(clean, third)).toFixed(1)} dB over the clean filter's`);
  // On a saw, the harmonic sitting on the cutoff is held back, not let go on growing with the resonance.
  const sawClean = render({ frequency: cutoff, q: 25 }), sawMs = render({ frequency: cutoff, q: 25, model: 'ms20' });
  assert.ok(level(sawMs, cutoff) < level(sawClean, cutoff) - 3, `the peak is ${(level(sawClean, cutoff) - level(sawMs, cutoff)).toFixed(1)} dB lower`);
  // The more it is pushed, the more it distorts.
  const mild = render({ frequency: cutoff, q: 3, model: 'ms20' }, 'sine', 1);
  assert.ok(level(ms, third) - level(ms, 110) > level(mild, third) - level(mild, 110) + 6, 'more peak, more distortion');
});

test('the MS-20 filter and the high-pass stay bounded at every setting', () => {
  for (const q of [0.1, 1, 10, 30]) {
    for (const frequency of [20, 200, 5000, 20000]) {
      for (const highpass of [0, 30, 1500, 20000]) {
        const out = render({ frequency, q, highpass, model: 'ms20', drive: 1 }, 'sawtooth', 0.3);
        assert.ok(out.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1), `q ${q}, low-pass ${frequency}, high-pass ${highpass}`);
      }
    }
  }
});

test('only the MS-20 model sets the distorting filter and a high-pass, and it sets them with its macros', () => {
  const mapped = mapSynthModelToEngineParams('ms-20', MIDDLE).filter!;
  assert.equal(mapped.model, 'ms20');
  assert.ok((mapped.highpass ?? 0) > 100);
  const entered = enterSynthModel('ms-20', MIDDLE).filter!;
  assert.deepEqual([entered.model, entered.slope], ['ms20', 12]);
  for (const other of ['minimoog-model-d', 'juno-106', 'tb-303', 'prophet-5', 'sh-101', 'pro-one', 'jupiter-8', 'ob-xa', 'jp-8000', 'mono-poly', 'polysix'] as const) {
    const filter = mapSynthModelToEngineParams(other, MIDDLE).filter!;
    assert.equal(filter.highpass, undefined, other);
    assert.equal(filter.model, undefined, other);
    assert.equal(enterSynthModel(other, MIDDLE).filter!.highpass, 0, other);
  }
});
