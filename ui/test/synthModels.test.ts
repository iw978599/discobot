import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { SYNTH_MODELS, SYNTH_MODEL_GROUPS, enterSynthModel, mapSynthModelToEngineParams, normalizeSynthModelId } from '../src/synthModels.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import type { SynthModelId, SynthModelParams, SynthParameters } from '../src/types.ts';

const MIDDLE: SynthModelParams = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
const KEYS = ['macro1', 'macro2', 'macro3', 'macro4'] as const;

// A lane's sound after a model's macros are laid over it, one level deep, as the store does.
function onLane(base: SynthParameters, patch: Partial<SynthParameters>): SynthParameters {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' ? { ...(current as object), ...(value as object) } : value;
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
  assert.equal(normalizeSynthModelId('no-such-synth'), 'generic');
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

test('the JP-8000 is seven saws, one in tune and six either side, with Detune and Mix', () => {
  const middle = voice('jp-8000');
  assert.equal(middle.voiceMode, 'poly');
  assert.deepEqual([middle.oscType, middle.osc2Enabled, middle.unisonVoices], ['sawtooth', false, 7]);
  assert.equal(voice('jp-8000', { ...MIDDLE, macro1: 0 }).unisonDetune, 0);
  assert.equal(voice('jp-8000', { ...MIDDLE, macro1: 1 }).unisonDetune, 1);
  assert.ok(middle.unisonDetune < 0.5, 'half way round the knob is well under half the spread');
  assert.equal(voice('jp-8000', { ...MIDDLE, macro2: 0 }).unisonMix, 0);
  assert.equal(voice('jp-8000', { ...MIDDLE, macro2: 1 }).unisonMix, 1);
  assert.ok(voice('jp-8000', { ...MIDDLE, macro3: 1 }).filterFreq > voice('jp-8000', { ...MIDDLE, macro3: 0 }).filterFreq, 'Cutoff');
  assert.ok(voice('jp-8000', { ...MIDDLE, macro4: 1 }).release > 2 && voice('jp-8000', { ...MIDDLE, macro4: 0 }).release < 0.1, 'Release');
});

test('the Mono/Poly is four oscillators stacked on one note, pulled apart by Detune, into a four-pole filter', () => {
  const middle = voice('mono-poly');
  assert.deepEqual([middle.voiceMode, middle.unisonVoices, middle.filterSlope, middle.osc2Enabled], ['mono', 4, 24, false]);
  assert.ok(voice('mono-poly', { ...MIDDLE, macro1: 1 }).unisonDetune > voice('mono-poly', { ...MIDDLE, macro1: 0 }).unisonDetune, 'Detune');
  assert.ok(voice('mono-poly', { ...MIDDLE, macro2: 1 }).filterQ > voice('mono-poly', { ...MIDDLE, macro2: 0 }).filterQ, 'Resonance');
  assert.ok(voice('mono-poly', { ...MIDDLE, macro3: 1 }).filterFreq > voice('mono-poly', { ...MIDDLE, macro3: 0 }).filterFreq, 'Cutoff');
  assert.ok(voice('mono-poly', { ...MIDDLE, macro4: 1 }).filterEnvAmount > voice('mono-poly', { ...MIDDLE, macro4: 0 }).filterEnvAmount, 'Env');
});

test('the Polysix is one oscillator with a moving pulse and a sub, one envelope, and its ensemble on the lane\'s chorus', () => {
  const middle = voice('polysix');
  assert.deepEqual([middle.voiceMode, middle.oscType, middle.osc2Enabled, middle.filterSlope], ['poly', 'square', false, 24]);
  assert.ok(middle.subLevel > 0, 'a sub under the one oscillator');
  assert.deepEqual(
    [middle.attack, middle.decay, middle.sustain, middle.release],
    [middle.filterAttack, middle.filterDecay, middle.filterSustain, middle.filterRelease], 'one envelope drives filter and level');
  const still = voice('polysix', { ...MIDDLE, macro1: 0 }), moving = voice('polysix', { ...MIDDLE, macro1: 1 });
  assert.equal(still.lfo1Enabled, false);
  assert.ok(moving.lfo1Enabled && moving.lfo1Target === 'pulseWidth' && moving.lfo1Depth > 0.7, 'PWM');
  assert.ok(voice('polysix', { ...MIDDLE, macro2: 1 }).filterQ > voice('polysix', { ...MIDDLE, macro2: 0 }).filterQ, 'Resonance');
  assert.ok(voice('polysix', { ...MIDDLE, macro3: 1 }).filterFreq > voice('polysix', { ...MIDDLE, macro3: 0 }).filterFreq, 'Brightness');
  // Ensemble is the mix of the lane's own chorus, and says nothing about the sends.
  assert.equal(mapSynthModelToEngineParams('polysix', { ...MIDDLE, macro4: 0 }).inserts?.chorus?.mix, 0);
  assert.equal(sound('polysix', { ...MIDDLE, macro4: 1 }).inserts?.chorus?.mix, 0.7);
  assert.equal(mapSynthModelToEngineParams('polysix', MIDDLE).fxSends, undefined);
  assert.deepEqual(sound('polysix', { ...MIDDLE, macro4: 1 }).fxSends, createDefaultSynthParameters().fxSends, 'the sends are left alone');
});

test('the ensemble goes when a lane leaves the Polysix, and no lane\'s chorus send is touched', () => {
  const polysix = sound('polysix', { ...MIDDLE, macro4: 1 });
  assert.equal(onLane(polysix, enterSynthModel('juno-106', MIDDLE, 'polysix')).inserts?.chorus?.mix, 0);
  assert.deepEqual(onLane(polysix, enterSynthModel('juno-106', MIDDLE, 'polysix')).fxSends, polysix.fxSends);
  // A Polysix lane saved with the ensemble as a chorus send keeps that send on leaving.
  const older = onLane(polysix, { fxSends: { ...polysix.fxSends, chorus: 0.64 } });
  assert.equal(onLane(older, enterSynthModel('juno-106', MIDDLE, 'polysix')).fxSends.chorus, 0.64);
  // Someone's own chorus on another model stays when that lane changes model.
  const own = onLane(sound('juno-106'), { fxSends: { ...sound('juno-106').fxSends, chorus: 0.6 } });
  assert.equal(onLane(own, enterSynthModel('prophet-5', MIDDLE, 'juno-106')).fxSends.chorus, 0.6);
  // No other model says anything about the sends.
  for (const model of SYNTH_MODELS.filter(entry => entry.id !== 'polysix')) {
    assert.equal(mapSynthModelToEngineParams(model.id, MIDDLE).fxSends, undefined, model.id);
  }
});

test('the MS-20 is two oscillators, mono, through a high-pass and a two-pole low-pass that share a peak', () => {
  const middle = voice('ms-20');
  assert.deepEqual([middle.voiceMode, middle.filterModel, middle.filterSlope, middle.osc2Enabled], ['mono', 'ms20', 12, true]);
  assert.ok(middle.portamentoEnabled);
  // HP Cutoff is off at the bottom, and climbs.
  assert.equal(voice('ms-20', { ...MIDDLE, macro1: 0 }).filterHighpass, 0);
  assert.ok(voice('ms-20', { ...MIDDLE, macro1: 0.1 }).filterHighpass >= 30);
  assert.ok(voice('ms-20', { ...MIDDLE, macro1: 1 }).filterHighpass >= 1400);
  assert.ok(voice('ms-20', { ...MIDDLE, macro2: 1 }).filterFreq > voice('ms-20', { ...MIDDLE, macro2: 0 }).filterFreq, 'LP Cutoff');
  assert.ok(voice('ms-20', { ...MIDDLE, macro3: 1 }).filterQ > 20 && voice('ms-20', { ...MIDDLE, macro3: 0 }).filterQ < 1, 'Peak');
  assert.equal(voice('ms-20', { ...MIDDLE, macro4: 0 }).filterEnvAmount, 0);
  assert.ok(voice('ms-20', { ...MIDDLE, macro4: 1 }).filterEnvAmount > 0.8, 'Env');
  // Each macro leaves the other three's things alone.
  assert.equal(voice('ms-20', { ...MIDDLE, macro1: 1 }).filterFreq, middle.filterFreq);
  assert.equal(voice('ms-20', { ...MIDDLE, macro2: 1 }).filterHighpass, middle.filterHighpass);
});

test('the high-pass and the distorting filter go when a lane leaves the MS-20', () => {
  const lane = sound('ms-20', { ...MIDDLE, macro1: 1 });
  assert.ok(toVoiceParams(lane).filterHighpass > 0);
  for (const next of ['juno-106', 'pro-one', 'jp-8000', 'minimoog-model-d'] as const) {
    const moved = toVoiceParams(onLane(lane, enterSynthModel(next, MIDDLE, 'ms-20')));
    assert.equal(moved.filterHighpass, 0, next);
    assert.notEqual(moved.filterModel, 'ms20', next);
  }
  // A high-pass someone set on another model stays while a macro is turned.
  const own = onLane(sound('juno-106'), { filter: { ...sound('juno-106').filter, highpass: 300 } });
  assert.equal(toVoiceParams(onLane(own, mapSynthModelToEngineParams('juno-106', { ...MIDDLE, macro3: 0.9 }))).filterHighpass, 300);
});

test('the Odyssey is two oscillators with the second synced, a ring modulator, and a filter stepped at random', () => {
  const middle = voice('odyssey');
  assert.deepEqual([middle.voiceMode, middle.osc2Enabled, middle.osc2Sync, middle.filterSlope], ['mono', true, true, 24]);
  assert.ok(middle.portamentoEnabled);
  // Sync: how far the second oscillator is tuned over the first, and how far the filter's envelope sweeps it.
  const unswept = sound('odyssey', { ...MIDDLE, macro1: 0 }), swept = sound('odyssey', { ...MIDDLE, macro1: 1 });
  assert.equal(unswept.oscillator2!.semitones, 0);
  assert.ok(swept.oscillator2!.semitones >= 19);
  assert.equal(unswept.modMatrix!.some(route => route.destination === 'osc2Pitch'), false);
  assert.deepEqual(swept.modMatrix!.find(route => route.destination === 'osc2Pitch'), { source: 'filterEnv', destination: 'osc2Pitch', depth: 0.5 });
  // Ring.
  assert.equal(voice('odyssey', { ...MIDDLE, macro2: 0 }).ringLevel, 0);
  assert.equal(voice('odyssey', { ...MIDDLE, macro2: 1 }).ringLevel, 1);
  assert.ok(voice('odyssey', { ...MIDDLE, macro3: 1 }).filterFreq > voice('odyssey', { ...MIDDLE, macro3: 0 }).filterFreq, 'Cutoff');
  // S&H: the random source to the filter, clocked by the first LFO, which is sent nowhere itself.
  assert.equal(sound('odyssey', { ...MIDDLE, macro4: 0 }).modMatrix!.some(route => route.source === 'random'), false);
  assert.deepEqual(sound('odyssey', { ...MIDDLE, macro4: 1 }).modMatrix!.find(route => route.source === 'random'), { source: 'random', destination: 'filter', depth: 0.6 });
  assert.deepEqual([middle.lfo1Enabled, middle.lfo1Rate], [false, 6]);
  // With everything down it has no routes at all.
  assert.deepEqual(sound('odyssey', { ...MIDDLE, macro1: 0, macro4: 0 }).modMatrix, []);
});

test('the Virus morphs a saw into a pulse through a driven filter, and its fourth knob moves everything at once', () => {
  const middle = voice('virus');
  assert.deepEqual([middle.voiceMode, middle.filterSlope, middle.osc2Sync], ['poly', 24, false]);
  assert.ok(middle.filterDrive >= 0.5 && middle.subLevel > 0);
  // Morph: all saw at one end, all pulse at the other.
  const saw = voice('virus', { ...MIDDLE, macro1: 0 }), pulse = voice('virus', { ...MIDDLE, macro1: 1 });
  assert.deepEqual([saw.oscLevel, saw.osc2Level, saw.osc2Type], [0, 1, 'sawtooth']);
  assert.deepEqual([pulse.oscLevel, pulse.osc2Enabled, pulse.oscType], [1, false, 'square']);
  assert.ok(voice('virus', { ...MIDDLE, macro2: 1 }).filterQ > voice('virus', { ...MIDDLE, macro2: 0 }).filterQ, 'Resonance');
  assert.ok(voice('virus', { ...MIDDLE, macro3: 1 }).filterFreq > voice('virus', { ...MIDDLE, macro3: 0 }).filterFreq, 'Cutoff');
  // Mod Depth: nothing moves at the bottom, and every route grows with it.
  assert.deepEqual(sound('virus', { ...MIDDLE, macro4: 0 }).modMatrix, []);
  const half = sound('virus', { ...MIDDLE, macro4: 0.5 }).modMatrix!, full = sound('virus', { ...MIDDLE, macro4: 1 }).modMatrix!;
  assert.equal(full.length, 4);
  for (let index = 0; index < full.length; index++) {
    assert.deepEqual([half[index].source, half[index].destination], [full[index].source, full[index].destination]);
    assert.ok(full[index].depth > half[index].depth && half[index].depth > 0);
  }
  // Its LFOs are sources only: neither is switched on to its own target.
  assert.deepEqual([middle.lfo1Enabled, middle.lfo2Enabled], [false, false]);
});

test('the CS-80 plays two layers a note, and its knobs set the second against the first', () => {
  const middle = voice('cs-80');
  assert.deepEqual([middle.voiceMode, middle.layerEnabled, middle.filterSlope], ['poly', true, 12]);
  assert.ok(middle.filterHighpass >= 20 && middle.velocityFilter > 0 && middle.layerWidth > 0);
  assert.deepEqual([voice('cs-80', { ...MIDDLE, macro1: 0 }).layerMix, voice('cs-80', { ...MIDDLE, macro1: 1 }).layerMix], [0, 1]);
  assert.deepEqual([voice('cs-80', { ...MIDDLE, macro2: 0 }).layerDetune, voice('cs-80', { ...MIDDLE, macro2: 1 }).layerDetune], [0, 30]);
  // Brightness is level in the middle, darker below and brighter above.
  assert.deepEqual([0, 0.5, 1].map(macro3 => voice('cs-80', { ...MIDDLE, macro3 }).layerBrightness), [-2, 0, 2]);
  assert.equal(voice('cs-80', { ...MIDDLE, macro4: 0 }).layerAttack, 0);
  assert.ok(voice('cs-80', { ...MIDDLE, macro4: 1 }).layerAttack > voice('cs-80', MIDDLE).layerAttack);
});

test('the second layer goes when a lane leaves the CS-80', () => {
  const lane = sound('cs-80', { macro1: 1, macro2: 1, macro3: 1, macro4: 1 });
  for (const model of SYNTH_MODELS.filter(entry => entry.id !== 'generic' && entry.id !== 'cs-80')) {
    const moved = toVoiceParams(onLane(lane, enterSynthModel(model.id, MIDDLE, 'cs-80')));
    // A model with a layer of its own has that one, and not the CS-80's.
    assert.equal(moved.layerEnabled, mapSynthModelToEngineParams(model.id, MIDDLE).layer?.enabled ?? false, model.id);
    assert.equal(moved.filterHighpass, mapSynthModelToEngineParams(model.id, MIDDLE).filter?.highpass ?? 0, model.id);
  }
  // Only turning a macro leaves a layer someone switched on by hand where it is.
  const byHand = onLane(sound('juno-106'), { layer: { enabled: true, mix: 0.5, detune: 8, brightness: 0, attack: 0, width: 0 } });
  assert.equal(toVoiceParams(onLane(byHand, mapSynthModelToEngineParams('juno-106', { ...MIDDLE, macro1: 1 }))).layerEnabled, true);
});

test('sync, the ring and the routes go when a lane leaves the Odyssey', () => {
  const lane = sound('odyssey', { macro1: 1, macro2: 1, macro3: 0.5, macro4: 1 });
  for (const model of SYNTH_MODELS.filter(entry => entry.id !== 'generic' && entry.id !== 'odyssey')) {
    const moved = onLane(lane, enterSynthModel(model.id, MIDDLE, 'odyssey'));
    const flat = toVoiceParams(moved);
    assert.equal(flat.osc2Sync, false, model.id);
    assert.equal(flat.ringLevel, 0, model.id);
    // The Odyssey's routes are gone; a model with routes of its own has those, and no others.
    assert.deepEqual(moved.modMatrix, mapSynthModelToEngineParams(model.id, MIDDLE).modMatrix ?? [], model.id);
  }
});

test('a lane that moves to another model is given back what the one it leaves had set', () => {
  // Out of the supersaw: no stack of seven. Out of a four-pole model: the two-pole slope.
  const fromJp = onLane(sound('jp-8000'), enterSynthModel('juno-106', MIDDLE));
  assert.equal(toVoiceParams(fromJp).unisonVoices, 1);
  const fromPro = onLane(sound('pro-one'), enterSynthModel('juno-106', MIDDLE));
  assert.equal(toVoiceParams(fromPro).filterSlope, 12);
  // A model that sets these for itself keeps its own.
  assert.equal(toVoiceParams(onLane(sound('juno-106'), enterSynthModel('jp-8000', MIDDLE))).unisonVoices, 7);
  assert.equal(toVoiceParams(onLane(sound('juno-106'), enterSynthModel('sh-101', MIDDLE))).filterSlope, 24);
  // Turning a macro on a lane that stays where it is takes nothing away: a slope or a stack someone chose stays.
  const chosen = onLane(sound('juno-106'), { unison: { voices: 3, detune: 0.4, mix: 1 }, filter: { ...sound('juno-106').filter, slope: 24 } });
  const turned = toVoiceParams(onLane(chosen, mapSynthModelToEngineParams('juno-106', { ...MIDDLE, macro3: 0.8 })));
  assert.deepEqual([turned.unisonVoices, turned.filterSlope], [3, 24]);
  // Routes someone made on a lane go with the model they were made for, and stay while its macros are turned.
  const routed = onLane(sound('juno-106'), { modMatrix: [{ source: 'velocity', destination: 'filter', depth: 0.5 }] });
  assert.deepEqual(onLane(routed, enterSynthModel('prophet-5', MIDDLE, 'juno-106')).modMatrix, []);
  assert.equal(onLane(routed, mapSynthModelToEngineParams('juno-106', { ...MIDDLE, macro2: 0.9 })).modMatrix!.length, 1);
  // The plain engine takes nothing away either: it is where a model's sound is taken to be changed by hand.
  assert.deepEqual(enterSynthModel('generic', MIDDLE), {});
});

test('leaving the SH-101 for another model puts the first oscillator back to full level', () => {
  const lane = sound('sh-101', { ...MIDDLE, macro1: 0 });
  assert.equal(toVoiceParams(lane).oscLevel, 0);
  for (const next of ['minimoog-model-d', 'juno-106', 'tb-303', 'prophet-5', 'pro-one', 'jupiter-8', 'ob-xa', 'jp-8000', 'mono-poly'] as const) {
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
