import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { Ladder, ladderFeedback, svfCoefficient } from '../../engine/src/dsp.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { enterSynthModel, mapSynthModelToEngineParams, SYNTH_MODELS } from '../src/synthModels.ts';
import type { SynthParameters } from '../src/types.ts';

const SR = 48000;
const MIDDLE = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };

// A held saw on A2 (110 Hz) through the filter as set, long enough for the filter to settle.
function render(filter: Partial<SynthParameters['filter']>, seconds = 0.5): Float32Array {
  const base = createDefaultSynthParameters();
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({
    ...base, oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
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

test('a sound saved before there was a choice of filter plays exactly as it did', () => {
  const before = { frequency: 900, q: 3, slope: 24 };
  assert.ok(same(render(before), render({ ...before, model: 'svf' })));
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as unknown as { filter: Record<string, unknown> };
  delete old.filter.model;
  assert.equal(sanitizeSynthParams(old, defaults).filter.model, 'svf');
  assert.equal(sanitizeSynthParams({ ...defaults, filter: { ...defaults.filter, model: 'explode' } }, defaults).filter.model, 'svf');
  assert.equal(sanitizeSynthParams({ ...defaults, filter: { ...defaults.filter, model: 'ladder' } }, defaults).filter.model, 'ladder');
  assert.equal(toVoiceParams({ ...defaults, filter: old.filter as unknown as SynthParameters['filter'] }).filterModel, 'svf');
});

test('the ladder is a four-pole low-pass: far steeper above the cutoff than the two-pole filter', () => {
  // The sixteenth harmonic of 110 Hz, more than two octaves over a 400 Hz cutoff.
  const high = 1760;
  const twoPole = level(render({ frequency: 400, q: 0.7, slope: 12 }), high);
  const ladder = level(render({ frequency: 400, q: 0.7, slope: 24, model: 'ladder' }), high);
  assert.ok(ladder < twoPole - 15, `the ladder leaves ${ladder.toFixed(1)} dB of it, the two-pole ${twoPole.toFixed(1)} dB`);
  // Wide open, it lets the sound through.
  const open = level(render({ frequency: 18000, q: 0.7, model: 'ladder' }), 110);
  const plain = level(render({ frequency: 18000, q: 0.7 }), 110);
  assert.ok(Math.abs(open - plain) < 3, `open, the fundamental is ${open.toFixed(1)} dB against ${plain.toFixed(1)} dB`);
});

test('resonance on the ladder thins the bass and lifts the cutoff, which the clean filter does not do', () => {
  const cutoff = 880, fundamental = 110;
  const flat = render({ frequency: cutoff, q: 0.25, model: 'ladder' }), peaky = render({ frequency: cutoff, q: 12, model: 'ladder' });
  const bass = level(peaky, fundamental) - level(flat, fundamental), peak = level(peaky, cutoff) - level(flat, cutoff);
  assert.ok(bass < -0.75, `the fundamental drops as resonance comes up (${bass.toFixed(2)} dB)`);
  assert.ok(peak > 6, `and the harmonic at the cutoff stands out (${peak.toFixed(2)} dB)`);
  const cleanFlat = render({ frequency: cutoff, q: 0.25 }), cleanPeaky = render({ frequency: cutoff, q: 12 });
  const clean = level(cleanPeaky, fundamental) - level(cleanFlat, fundamental);
  assert.ok(clean > -0.5, `the state-variable filter keeps its bass (${clean.toFixed(2)} dB)`);
});

test('the ladder stays bounded at any setting, rings by itself at full resonance, and falls back where it cannot be used', () => {
  for (const q of [0.1, 1, 10, 30]) {
    for (const frequency of [20, 200, 5000, 20000]) {
      const out = render({ frequency, q, model: 'ladder', drive: 1 }, 0.3);
      assert.ok(out.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1), `q ${q} at ${frequency} Hz`);
    }
  }
  // Left alone after one click at full feedback, the filter goes on sounding at its cutoff.
  const filter = new Ladder(), g = svfCoefficient(1000, SR);
  let energy = 0;
  for (let i = 0; i < SR; i++) { const out = filter.tick(i === 0 ? 1 : 0, g, 4); if (i > SR / 2) energy += out * out; }
  assert.ok(energy > 1, 'it is still ringing half a second later');
  // A ladder is a low-pass. Set to anything else, the sound is the state-variable filter's.
  for (const type of ['highpass', 'bandpass', 'notch'] as const) {
    assert.ok(same(render({ type, frequency: 900, q: 2, model: 'ladder' }), render({ type, frequency: 900, q: 2 })), type);
  }
  assert.ok(!same(render({ frequency: 900, q: 2, model: 'ladder' }), render({ frequency: 900, q: 2, slope: 24 })), 'as a low-pass it is not the old 24 dB filter');
});

test('the resonance setting means much the same on either filter', () => {
  assert.equal(ladderFeedback(0.1), 0);
  assert.equal(ladderFeedback(0.25), 0);
  let last = -1;
  for (const q of [0.25, 0.5, 1, 2, 5, 10, 20, 30]) {
    const feedback = ladderFeedback(q);
    assert.ok(feedback >= last && feedback < 4, `q ${q}`);
    last = feedback;
  }
  assert.ok(ladderFeedback(30) > 3.7, 'the top of the knob is close to ringing');
});

test('the Minimoog and the TB-303 take the ladder when a lane moves to them, and no other model does', () => {
  for (const model of SYNTH_MODELS.filter(entry => entry.id !== 'generic')) {
    const entered = enterSynthModel(model.id, MIDDLE).filter!;
    const ladder = model.id === 'minimoog-model-d' || model.id === 'tb-303';
    assert.equal(entered.model, ladder ? 'ladder' : 'svf', model.id);
    if (ladder) assert.equal(entered.slope, 24, model.id);
    // Turning a macro says nothing about which filter it is, so a lane set to one of these
    // before the ladder existed goes on sounding as it did.
    assert.equal(mapSynthModelToEngineParams(model.id, MIDDLE).filter?.model, undefined, model.id);
  }
  assert.deepEqual(enterSynthModel('generic', MIDDLE), {});
});
