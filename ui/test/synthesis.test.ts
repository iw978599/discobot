import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters, toVoiceParams } from '../../engine/src/synth/voiceParams.ts';
import { SYNTH_MODELS, mapSynthModelToEngineParams, normalizeSynthModelParams } from '../src/synthModels.ts';
import { sanitizeSteps, sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { expandStep } from '../src/services/noteScheduling.ts';
import { renderDrums, renderSynthLane } from '../src/services/wavExport.ts';
import { safetyCurve } from '../src/hooks/browserAudio.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, Pattern, SynthParameters } from '../src/types.ts';

const SR = 44100;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const peak = (samples: Float32Array) => samples.reduce((max, x) => Math.max(max, Math.abs(x)), 0);

function merge(base: SynthParameters, patch: Partial<SynthParameters>): SynthParameters {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === 'object' ? { ...(result[key] as object), ...value } : value;
  }
  return result as unknown as SynthParameters;
}

function pattern(notes: Array<[number, string, number?, boolean?]>, length = 16): Pattern {
  const steps: Pattern['steps'] = Array.from({ length }, () => ({ active: false, velocity: 0.7 }));
  for (const [index, note, velocity = 0.8, slide] of notes) steps[index] = { active: true, note, velocity, ...(slide ? { slide } : {}) };
  return { id: 'p', name: 'p', tempo: 120, steps };
}

test('all model macros alter actual synthesis parameters; normalization rejects NaN', () => {
  const defaults = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
  assert.equal(normalizeSynthModelParams({ macro1: NaN }).macro1, 0.5);
  for (const model of SYNTH_MODELS.filter(model => model.id !== 'generic')) {
    const base = mapSynthModelToEngineParams(model.id, defaults);
    for (const macro of model.macros) {
      assert.notDeepEqual(mapSynthModelToEngineParams(model.id, { ...defaults, [macro.key]: 0.9 }), base, `${model.id} ${macro.key}`);
    }
  }
});

test('each model is a genuinely different voice, not the same one with new knob positions', () => {
  const defaults = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
  const voice = (id: Parameters<typeof mapSynthModelToEngineParams>[0]) =>
    toVoiceParams(merge(createDefaultSynthParameters(), mapSynthModelToEngineParams(id, defaults)));
  assert.equal(voice('dx7').engine, 'fm');
  assert.equal(voice('tb-303').voiceMode, 'mono');
  assert.ok(voice('tb-303').velocityFilter > 0.5, 'the 303 has accent');
  assert.ok(voice('tb-303').portamentoEnabled, 'the 303 slides');
  assert.ok(voice('tb-303').filterEnvAmount > 0.3);
  assert.equal(voice('minimoog-model-d').voiceMode, 'mono');
  assert.ok(voice('minimoog-model-d').osc2Enabled && voice('minimoog-model-d').subLevel > 0);
  assert.equal(voice('juno-106').voiceMode, 'poly');
  assert.ok(voice('prophet-5').osc2Enabled);
  // Leaving FM for an analog model must switch the engine back.
  const afterFm = merge(merge(createDefaultSynthParameters(), mapSynthModelToEngineParams('dx7', defaults)), mapSynthModelToEngineParams('juno-106', defaults));
  assert.equal(toVoiceParams(afterFm).engine, 'subtractive');
});

test('projects and presets saved before the new voice existed load with neutral defaults', () => {
  const defaults = createDefaultSynthParameters();
  const legacy = {
    hold: false, gain: 0.8, fxReturn: 0.5, pan: 0.2,
    portamento: { enabled: false, glide: 0.05 },
    arpeggiator: { enabled: false, mode: 'up', rate: '1/16', gate: 0.7 },
    oscillator: { type: 'sawtooth', detune: 5 },
    lfo1: { enabled: true, target: 'filter', waveform: 'sine', rate: 4, depth: 0.3, sync: true },
    lfo2: { enabled: false, target: 'pitch', waveform: 'sine', rate: 1, depth: 0.1 },
    filter: { frequency: 900, q: 3, type: 'lowpass' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.4 },
    fxSends: { reverb: 0.1, delay: 0.1, drive: 0, phaser: 0 },
    effects: { reverb: { enabled: false, wet: 0.3, decay: 2 }, delay: { enabled: false, wet: 0.3, time: 0.25, feedback: 0.3 } },
  };
  const upgraded = sanitizeSynthParams(legacy, defaults);
  assert.equal(upgraded.oscillator.type, 'sawtooth');
  assert.equal(upgraded.filter.frequency, 900);
  assert.equal(upgraded.lfo1.sync, true);
  const voice = toVoiceParams(upgraded);
  assert.equal(voice.engine, 'subtractive');
  assert.equal(voice.voiceMode, 'poly');
  assert.equal(voice.osc2Enabled, false);
  assert.equal(voice.subLevel + voice.noiseLevel + voice.filterEnvAmount + voice.filterDrive + voice.filterKeyTracking, 0);
  assert.equal(voice.velocityAmp, 1);
  assert.equal(voice.lfo1Retrigger, true);

  const hostile = sanitizeSynthParams({
    ...legacy, engine: 'granular', voiceMode: 7, oscillator2: { enabled: 'yes', type: 'laser', semitones: 900, detune: NaN, level: 5 },
    mixer: { sub: -3, noise: Infinity }, fm: { algorithm: 99, ratio: -1, index: 4, decay: 0, feedback: NaN },
    filter: { frequency: 900, q: 3, type: 'lowpass', envAmount: 9, keyTracking: -2, drive: 'max' },
    lfo1: { ...legacy.lfo1, target: 'volume' },
  }, defaults);
  assert.equal(hostile.engine, 'subtractive');
  assert.equal(hostile.voiceMode, 'poly');
  assert.equal(hostile.oscillator2!.type, defaults.oscillator2!.type);
  assert.equal(hostile.oscillator2!.semitones, 36);
  assert.equal(hostile.oscillator2!.level, 1);
  assert.deepEqual(hostile.mixer, { sub: 0, noise: 0 });
  assert.equal(hostile.fm!.algorithm, 3);
  assert.equal(hostile.filter.envAmount, 1);
  assert.equal(hostile.filter.keyTracking, 0);
  assert.equal(hostile.filter.drive, 0);
  assert.equal(hostile.lfo1.target, defaults.lfo1.target);
  assert.deepEqual(sanitizeSteps([{ active: true, note: 'C3', velocity: 0.5, slide: true }, { active: true, note: 'D3', velocity: 0.5, slide: 'x' }]).slice(0, 2),
    [{ active: true, note: 'C3', velocity: 0.5, slide: true }, { active: true, note: 'D3', velocity: 0.5 }]);
});

test('a slide holds the note past the next step; the arpeggiator fills the step with pulses', () => {
  const params = createDefaultSynthParameters();
  const window = 0.125;
  assert.ok(expandStep('C3', params, window, 120)[0].duration < window);
  assert.ok(expandStep('C3', params, window, 120, true)[0].duration > window);
  const arp = merge(params, { arpeggiator: { enabled: true, mode: 'up', rate: '1/32', gate: 0.5 } });
  const pulses = expandStep('C3', arp, 0.25, 120);
  assert.deepEqual(pulses.map(pulse => pulse.note), ['C3', 'E3', 'G3', 'C4']);
  assert.deepEqual(pulses.map(pulse => pulse.offset), [0, 0.0625, 0.125, 0.1875]);
});

test('exported synth audio is deterministic, follows the pattern, and glides on slide steps in mono', () => {
  const params = merge(createDefaultSynthParameters(), { oscillator: { type: 'sawtooth', detune: 0 }, filter: { frequency: 1200, q: 2, type: 'lowpass' }, mixer: { sub: 0, noise: 0.2 } });
  const frames = SR * 3;
  const lane = pattern([[0, 'C3'], [4, 'G3'], [8, 'C4']]);
  const [left, right] = renderSynthLane(lane, params, 120, frames, SR);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.deepEqual(renderSynthLane(lane, params, 120, frames, SR)[0], left);
  const stepFrames = SR * 0.125;
  assert.ok(rms(left.subarray(0, stepFrames)) > 0.01, 'step 1 sounds');
  assert.equal(rms(left.subarray(Math.round(stepFrames * 13), Math.round(stepFrames * 13.9)).map(Math.abs)) < 0.001, true, 'the bar goes quiet after the last note');

  const mono = merge(params, { voiceMode: 'mono', portamento: { enabled: true, glide: 0.08 }, envelope: { attack: 0.002, decay: 0.03, sustain: 0.05, release: 0.02 } });
  const tied = renderSynthLane(pattern([[0, 'C3', 0.8, true], [1, 'C4']]), mono, 120, frames, SR)[0];
  const separate = renderSynthLane(pattern([[0, 'C3'], [1, 'C4']]), mono, 120, frames, SR)[0];
  const second = (samples: Float32Array) => peak(samples.subarray(Math.round(stepFrames * 1.02), Math.round(stepFrames * 1.5)));
  assert.ok(second(separate) > second(tied) * 2, 'a retriggered note has a fresh attack; a slid note does not');
});

test('exported drums are the plain sum of their hits and honour mute, solo, swing and master volume', () => {
  const state = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), stepVelocities: Array(16).fill(1), muted: false, solo: false,
    settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0, pan: 0 },
  }])) as DrumState;
  const render = (drumState: DrumState, overrides = {}) =>
    renderDrums({ tempo: 120, drumState, drumKitId: 'tr-808', drumMasterVolume: 1, drumSwing: 0, ...overrides }, SR * 2, SR)[0];
  const kick = state(); kick.kick.steps[0] = true;
  const snare = state(); snare.snare.steps[0] = true;
  const both = state(); both.kick.steps[0] = true; both.snare.steps[0] = true;
  const a = render(kick), b = render(snare), mix = render(both);
  let difference = 0;
  for (let i = 0; i < mix.length; i++) difference = Math.max(difference, Math.abs(mix[i] - a[i] - b[i]));
  assert.ok(difference < 1e-6, 'a kick and snare on the same step do not change each other');

  const half = render(kick, { drumMasterVolume: 0.5 });
  assert.ok(Math.abs(peak(half) - peak(a) * 0.5) < 1e-6);
  const muted = state(); muted.kick.steps[0] = true; muted.kick.muted = true;
  assert.equal(rms(render(muted)), 0);
  const solo = state(); solo.kick.steps[0] = true; solo.snare.steps[0] = true; solo.snare.solo = true;
  assert.deepEqual(render(solo), b);
  const offbeat = state(); offbeat.closedHH.steps[1] = true;
  const firstSound = (samples: Float32Array) => samples.findIndex(x => Math.abs(x) > 0.001);
  const straight = firstSound(render(offbeat)), swung = firstSound(render(offbeat, { drumSwing: 0.5 }));
  assert.ok(Math.abs((swung - straight) / SR - 0.0625) < 0.002, 'swing delays the off-beat by half a step');
});

test('the master safety stage leaves normal levels untouched and never exceeds full scale', () => {
  const curve = safetyCurve();
  const at = (x: number) => curve[Math.round((x + 1) / 2 * (curve.length - 1))];
  for (const level of [-0.8, -0.3, 0, 0.25, 0.5, 0.8]) assert.ok(Math.abs(at(level) - level) < 1e-3, `transparent at ${level}`);
  assert.ok(at(1) < 1 && at(1) > 0.9);
  assert.ok(at(-1) > -1 && at(-1) < -0.9);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], 'monotonic');
});
