import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { createBuiltInPresets } from '../src/services/builtInPresets.ts';
import { PRESET_KINDS, type PresetKind } from '../src/services/presetKinds.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { mapSynthModelToEngineParams } from '../src/synthModels.ts';
import { AUDIT_RATE, RING_LIMIT, measurePreset } from './helpers/presetAudit.ts';

const presets = createBuiltInPresets();
const measures = new Map(presets.map(preset => [preset.id, measurePreset(preset.params, preset.kind)]));

// How loud each kind is, measured as its loudest tenth of a second in dB below full scale, played
// as the kind is played (see AUDIT_NOTES). A sound that dies away at once cannot hold the level of
// one that sustains, so plucks and effects sit lower.
const LEVEL: Record<PresetKind, number> = { bass: -18, lead: -20, pad: -17, keys: -17, pluck: -23, effects: -22 };
// Filtered noise cannot be made as loud as a tone at the most a lane's level allows, so the
// sounds made of it are allowed to sit further under.
const MADE_OF_NOISE = new Set(['builtin-fx-riser', 'builtin-fx-wind', 'builtin-fx-helicopter']);

test('every kind has sounds to choose from, and no two presets share an id or a name', () => {
  for (const kind of PRESET_KINDS) {
    assert.ok(presets.filter(preset => preset.kind === kind).length >= 5, `${kind} has at least five`);
  }
  assert.equal(new Set(presets.map(preset => preset.id)).size, presets.length);
  assert.equal(new Set(presets.map(preset => preset.name)).size, presets.length);
  for (const preset of presets) {
    assert.match(preset.id, /^builtin-[a-z0-9-]+$/);
    assert.equal(preset.builtIn, true);
    assert.ok(preset.name.length <= 20, `${preset.name} fits the menu`);
  }
});

test('every preset is already inside the limits a stored sound is held to', () => {
  const defaults = createDefaultSynthParameters();
  for (const preset of presets) {
    assert.deepEqual(sanitizeSynthParams(structuredClone(preset.params), defaults), preset.params, preset.name);
    for (const macro of Object.values(preset.modelParams)) assert.ok(macro >= 0 && macro <= 1, preset.name);
  }
});

test('a preset for a synth model sounds as its four macros say, so turning one never makes it jump', () => {
  const withModel = presets.filter(preset => preset.modelId !== 'generic');
  assert.ok(withModel.length >= 6);
  for (const preset of withModel) {
    const mapped = mapSynthModelToEngineParams(preset.modelId, preset.modelParams) as Record<string, unknown>;
    const params = preset.params as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(mapped)) {
      const actual = params[key];
      if (value && typeof value === 'object') {
        for (const [inner, expected] of Object.entries(value)) {
          assert.deepEqual((actual as Record<string, unknown>)[inner], expected, `${preset.name}: ${key}.${inner}`);
        }
      } else assert.deepEqual(actual, value, `${preset.name}: ${key}`);
    }
  }
  for (const preset of presets.filter(entry => entry.modelId === 'generic')) {
    assert.deepEqual(preset.modelParams, { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 });
  }
});

test('every preset makes sound, stays clear of the limiter and falls silent after the key comes up', () => {
  for (const preset of presets) {
    const m = measures.get(preset.id)!;
    assert.ok(m.finite, `${preset.name}: every sample is a number`);
    assert.ok(m.loudness > -40, `${preset.name} is not silent (${m.loudness.toFixed(1)} dB)`);
    assert.ok(m.peak < 0.8, `${preset.name} peaks at ${m.peak.toFixed(2)}, clear of the limiter`);
    assert.ok(m.ring < RING_LIMIT, `${preset.name} falls silent`);
    assert.ok(m.ring <= 4, `${preset.name} rings for ${m.ring.toFixed(1)} s after the key comes up`);
  }
});

test('presets of a kind are about as loud as each other', () => {
  for (const preset of presets) {
    const m = measures.get(preset.id)!;
    const under = MADE_OF_NOISE.has(preset.id) ? 6 : 3;
    assert.ok(
      m.loudness <= LEVEL[preset.kind] + 3 && m.loudness >= LEVEL[preset.kind] - under,
      `${preset.name} (${preset.kind}) is at ${m.loudness.toFixed(1)} dB; its kind sits at ${LEVEL[preset.kind]}`,
    );
  }
});

test('a bass, a lead, keys and a pluck speak at once', () => {
  for (const preset of presets.filter(entry => ['bass', 'lead', 'keys', 'pluck'].includes(entry.kind))) {
    const m = measures.get(preset.id)!;
    assert.ok(m.attack <= 0.06, `${preset.name} takes ${Math.round(m.attack * 1000)} ms to speak`);
  }
});

// The level of the first oscillator, which the noise sounds turn down.
const render = (mixer: { sub: number; noise: number; osc?: number }, seconds = 0.25) => {
  const core = new SynthCore(AUDIT_RATE);
  core.setParams(toVoiceParams({ ...createDefaultSynthParameters(), oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 }, mixer }));
  core.noteOn({ note: 'A2', velocity: 1 });
  const left = new Float32Array(Math.round(AUDIT_RATE * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left;
};

test('a sound saved before the first oscillator had a level plays exactly as it did', () => {
  assert.deepEqual(render({ sub: 0.3, noise: 0 }), render({ sub: 0.3, noise: 0, osc: 1 }));
  assert.equal(toVoiceParams({ ...createDefaultSynthParameters(), mixer: { sub: 0, noise: 0 } }).oscLevel, 1);
});

const stack = (unison: { voices: number; detune: number; mix?: number }, seconds = 0.25) => {
  const core = new SynthCore(AUDIT_RATE);
  core.setParams(toVoiceParams({ ...createDefaultSynthParameters(), oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 }, unison }));
  core.noteOn({ note: 'A2', velocity: 1 });
  const left = new Float32Array(Math.round(AUDIT_RATE * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left;
};

test('up to seven copies can be stacked, and a stack saved before the side copies had a level plays exactly as it did', () => {
  for (const voices of [1, 2, 3, 5]) {
    assert.deepEqual(stack({ voices, detune: 0.4 }), stack({ voices, detune: 0.4, mix: 1 }), `${voices} copies`);
  }
  const five = stack({ voices: 5, detune: 0.4 }), seven = stack({ voices: 7, detune: 0.4 });
  assert.notDeepEqual(seven, five, 'seven is not five');
  assert.deepEqual(stack({ voices: 99, detune: 0.4 }), seven, 'more than seven is seven');
  assert.ok(seven.every(Number.isFinite));
});

test('with the side copies turned right down, a stack is its one in-tune copy', () => {
  const size = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  // How much the level moves over time: copies out of tune with each other beat, one copy is steady.
  const wobble = (samples: Float32Array) => {
    const windows = Array.from({ length: 16 }, (_, i) => size(samples.subarray(12000 + i * 2000, 14000 + i * 2000)));
    return (Math.max(...windows) - Math.min(...windows)) / Math.max(...windows);
  };
  const alone = stack({ voices: 1, detune: 0.6 }, 1), middleOnly = stack({ voices: 7, detune: 0.6, mix: 0 }, 1), all = stack({ voices: 7, detune: 0.6, mix: 1 }, 1);
  // The middle copy starts at another point in its wave than a lone oscillator, so it is as loud and as steady, not the same samples.
  assert.ok(Math.abs(size(middleOnly) / size(alone) - 1) < 0.02, `as loud as one copy (${(size(middleOnly) / size(alone)).toFixed(3)})`);
  assert.ok(wobble(middleOnly) < 0.12, `and as steady (${wobble(middleOnly).toFixed(3)})`);
  assert.ok(wobble(all) > 0.25, `where all seven beat (${wobble(all).toFixed(3)})`);
  const half = stack({ voices: 7, detune: 0.6, mix: 0.5 }, 1);
  assert.ok(wobble(half) > wobble(middleOnly) && Math.abs(size(half) / size(all) - 1) < 0.35, 'half way is between the two, at much the same loudness');
});

test('the first oscillator can be turned off, and with everything off there is silence, not a fault', () => {
  const silent = render({ sub: 0, noise: 0, osc: 0 });
  assert.ok(silent.every(sample => sample === 0));
  // Turned down with nothing else on, it is quieter: half the level is half the signal.
  const half = render({ sub: 0, noise: 0, osc: 0.5 }), full = render({ sub: 0, noise: 0, osc: 1 });
  const size = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  assert.ok(Math.abs(size(half) / size(full) - 0.5) < 0.02, `half the level measured ${(size(half) / size(full)).toFixed(3)} of full`);
  const noiseOnly = render({ sub: 0, noise: 1, osc: 0 });
  assert.ok(noiseOnly.some(sample => sample !== 0) && noiseOnly.every(Number.isFinite));
});
