import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { SYNTH_MODELS, SYNTH_MODEL_GROUPS, mapSynthModelToEngineParams, normalizeSynthModelId } from '../src/synthModels.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import type { SynthModelId, SynthModelParams, SynthParameters } from '../src/types.ts';

const MIDDLE: SynthModelParams = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
const KEYS = ['macro1', 'macro2', 'macro3', 'macro4'] as const;

// A lane's sound after a model's macros are laid over it, one level deep, as the store does.
function onLane(base: SynthParameters, patch: Partial<SynthParameters>): SynthParameters {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && current && typeof current === 'object' ? { ...(current as object), ...(value as object) } : value;
  }
  return result as unknown as SynthParameters;
}
const sound = (id: SynthModelId, macros: SynthModelParams = MIDDLE) => onLane(createDefaultSynthParameters(), mapSynthModelToEngineParams(id, macros));
const voice = (id: SynthModelId, macros: SynthModelParams = MIDDLE) => toVoiceParams(sound(id, macros));

test('every model has a group in the menu, four macros, and a name of its own', () => {
  const models = SYNTH_MODELS.filter(model => model.id !== 'generic');
  assert.equal(new Set(SYNTH_MODELS.map(model => model.id)).size, SYNTH_MODELS.length);
  assert.equal(new Set(SYNTH_MODELS.map(model => model.name)).size, SYNTH_MODELS.length);
  for (const model of models) {
    assert.ok(model.group && SYNTH_MODEL_GROUPS.includes(model.group), `${model.id} is in a group`);
    assert.deepEqual(model.macros.map(macro => macro.key), [...KEYS], model.id);
    assert.equal(new Set(model.macros.map(macro => macro.label)).size, 4, `${model.id}: four different labels`);
  }
  assert.equal(SYNTH_MODELS.find(model => model.id === 'generic')!.group, undefined, 'the plain engine stands outside the groups');
});

test('at every end and the middle of every macro, a model stays inside the limits a stored sound is held to', () => {
  const defaults = createDefaultSynthParameters();
  for (const model of SYNTH_MODELS.filter(entry => entry.id !== 'generic')) {
    for (const key of KEYS) {
      for (const value of [0, 0.5, 1]) {
        const made = sound(model.id, { ...MIDDLE, [key]: value });
        assert.deepEqual(sanitizeSynthParams(structuredClone(made), defaults), made, `${model.id} ${key} at ${value}`);
      }
    }
  }
});

test('a model this copy of the app does not know opens with the plain engine', () => {
  assert.equal(normalizeSynthModelId('polysix'), 'generic');
  assert.equal(normalizeSynthModelId('sh-101'), 'sh-101');
  assert.equal(normalizeSynthModelId('pro-one'), 'pro-one');
  assert.deepEqual(mapSynthModelToEngineParams('generic', MIDDLE), {});
});

test('the SH-101 is one oscillator, saw and pulse balanced, a sub, a four-pole filter and one envelope for both', () => {
  const middle = voice('sh-101');
  assert.equal(middle.voiceMode, 'mono');
  assert.equal(middle.filterSlope, 24);
  assert.equal(middle.oscType, 'square');
  assert.equal(middle.osc2Type, 'sawtooth');
  assert.equal(middle.osc2Semitones, 0, 'the saw and the pulse are the same oscillator: the same pitch');
  assert.equal(middle.osc2Detune, 0);
  assert.deepEqual(
    [middle.attack, middle.decay, middle.sustain, middle.release],
    [middle.filterAttack, middle.filterDecay, middle.filterSustain, middle.filterRelease], 'one envelope drives filter and level');
  assert.ok(middle.lfo1Enabled && middle.lfo1Target === 'pulseWidth', 'the pulse width moves');

  // Wave Mix: all saw at one end, all pulse at the other.
  const saw = voice('sh-101', { ...MIDDLE, macro1: 0 }), pulse = voice('sh-101', { ...MIDDLE, macro1: 1 });
  assert.deepEqual([saw.oscLevel, saw.osc2Level, saw.osc2Enabled], [0, 1, true]);
  assert.deepEqual([pulse.oscLevel, pulse.osc2Enabled], [1, false]);
  // Sub, Cutoff and Env each move what they say and nothing else of the four.
  assert.equal(voice('sh-101', { ...MIDDLE, macro2: 0 }).subLevel, 0);
  assert.ok(voice('sh-101', { ...MIDDLE, macro2: 1 }).subLevel > 0.8);
  assert.ok(voice('sh-101', { ...MIDDLE, macro3: 0 }).filterFreq < 200 && voice('sh-101', { ...MIDDLE, macro3: 1 }).filterFreq > 7000);
  assert.equal(voice('sh-101', { ...MIDDLE, macro4: 0 }).filterEnvAmount, 0);
  assert.ok(voice('sh-101', { ...MIDDLE, macro4: 1 }).filterEnvAmount > 0.7);
  assert.equal(voice('sh-101', { ...MIDDLE, macro3: 1 }).subLevel, middle.subLevel);
});

test('the Pro-One is two oscillators, mono with glide, into a four-pole filter with its own fast envelope', () => {
  const middle = voice('pro-one');
  assert.equal(middle.voiceMode, 'mono');
  assert.equal(middle.filterSlope, 24);
  assert.ok(middle.osc2Enabled && middle.oscLevel === 1);
  assert.ok(middle.portamentoEnabled, 'it glides');
  assert.ok(middle.attack <= 0.03, 'it speaks at once');
  assert.ok(voice('pro-one', { ...MIDDLE, macro1: 1 }).osc2Detune > voice('pro-one', { ...MIDDLE, macro1: 0 }).osc2Detune, 'Detune');
  assert.ok(voice('pro-one', { ...MIDDLE, macro2: 1 }).filterQ > voice('pro-one', { ...MIDDLE, macro2: 0 }).filterQ, 'Resonance');
  assert.ok(voice('pro-one', { ...MIDDLE, macro3: 1 }).filterFreq > voice('pro-one', { ...MIDDLE, macro3: 0 }).filterFreq, 'Cutoff');
  assert.ok(voice('pro-one', { ...MIDDLE, macro4: 1 }).filterEnvAmount > voice('pro-one', { ...MIDDLE, macro4: 0 }).filterEnvAmount, 'Env');
});

test('the Jupiter-8 is a clean poly of saw and pulse into a four-pole filter, with separate envelopes', () => {
  const middle = voice('jupiter-8');
  assert.equal(middle.voiceMode, 'poly');
  assert.equal(middle.filterSlope, 24);
  assert.ok(middle.osc2Enabled && middle.oscType === 'sawtooth' && middle.osc2Type === 'square');
  assert.ok(middle.filterDrive <= 0.1, 'clean: next to no drive');
  assert.notDeepEqual([middle.attack, middle.decay, middle.sustain], [middle.filterAttack, middle.filterDecay, middle.filterSustain], 'the filter has an envelope of its own');
  assert.ok(voice('jupiter-8', { ...MIDDLE, macro1: 1 }).osc2Detune > voice('jupiter-8', { ...MIDDLE, macro1: 0 }).osc2Detune, 'Detune');
  assert.ok(voice('jupiter-8', { ...MIDDLE, macro2: 1 }).filterQ > voice('jupiter-8', { ...MIDDLE, macro2: 0 }).filterQ, 'Resonance');
  assert.ok(voice('jupiter-8', { ...MIDDLE, macro3: 1 }).filterFreq > voice('jupiter-8', { ...MIDDLE, macro3: 0 }).filterFreq, 'Brightness');
  assert.ok(voice('jupiter-8', { ...MIDDLE, macro4: 1 }).filterEnvAmount > voice('jupiter-8', { ...MIDDLE, macro4: 0 }).filterEnvAmount, 'Contour');
});

test('the OB-Xa is two saws spread apart into a two-pole filter, and its fourth knob is the swell', () => {
  const middle = voice('ob-xa');
  assert.equal(middle.voiceMode, 'poly');
  assert.equal(middle.filterSlope, 12);
  assert.ok(middle.osc2Enabled && middle.oscType === 'sawtooth' && middle.osc2Type === 'sawtooth');
  assert.ok(middle.osc2Detune > voice('jupiter-8').osc2Detune, 'its oscillators sit further apart than the Jupiter\'s');
  assert.ok(voice('ob-xa', { ...MIDDLE, macro1: 1 }).osc2Detune >= 40 && voice('ob-xa', { ...MIDDLE, macro1: 0 }).osc2Detune <= 6, 'Spread');
  assert.ok(voice('ob-xa', { ...MIDDLE, macro2: 1 }).filterQ > voice('ob-xa', { ...MIDDLE, macro2: 0 }).filterQ, 'Resonance');
  assert.ok(voice('ob-xa', { ...MIDDLE, macro3: 0 }).filterFreq <= 800 && voice('ob-xa', { ...MIDDLE, macro3: 1 }).filterFreq >= 14000, 'Brightness');
  const fast = voice('ob-xa', { ...MIDDLE, macro4: 0 }), slow = voice('ob-xa', { ...MIDDLE, macro4: 1 });
  assert.ok(fast.attack <= 0.01 && slow.attack >= 0.8, 'Attack');
  assert.ok(slow.filterAttack > slow.attack, 'the filter opens a little after the level, which is the brass');
  assert.equal(fast.release, slow.release, 'Attack leaves the release alone');
});

test('leaving the SH-101 for another model puts the first oscillator back to full level', () => {
  const lane = sound('sh-101', { ...MIDDLE, macro1: 0 });
  assert.equal(toVoiceParams(lane).oscLevel, 0);
  for (const next of ['minimoog-model-d', 'juno-106', 'tb-303', 'prophet-5', 'pro-one', 'jupiter-8', 'ob-xa'] as const) {
    assert.equal(toVoiceParams(onLane(lane, mapSynthModelToEngineParams(next, MIDDLE))).oscLevel, 1, next);
  }
});

test('the models that were here before still make the sounds they made', () => {
  // The only thing added to their mapping is the first oscillator's level at 1, which is what it was.
  for (const id of ['minimoog-model-d', 'juno-106', 'tb-303', 'prophet-5'] as const) {
    const mapped = mapSynthModelToEngineParams(id, MIDDLE);
    assert.equal(mapped.mixer!.osc, 1, id);
    assert.equal(mapped.filter!.slope, undefined, `${id} leaves the lane's filter slope as it is`);
  }
});
