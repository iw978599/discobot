import { createDefaultSynthParameters } from '@discobot/engine';
import type { SynthModelId, SynthModelParams, SynthParameters } from '../types';
import { DEFAULT_SYNTH_MODEL_ID, createDefaultSynthModelParams, mapSynthModelToEngineParams } from '../synthModels';
import type { PresetKind } from './presetKinds';

// The sounds that come with the app. Each has a kind, which is the group the presets menu
// shows it in. They are data: nothing here touches a project or the audio.
export interface BuiltInPreset {
  id: string;
  name: string;
  kind: PresetKind;
  builtIn: true;
  params: SynthParameters;
  modelId: SynthModelId;
  modelParams: SynthModelParams;
}

type Patch = { [Key in keyof SynthParameters]?: SynthParameters[Key] extends object | undefined ? Partial<NonNullable<SynthParameters[Key]>> : SynthParameters[Key] };

// A sound written as what differs from the plain starting sound. One level deep: a group such
// as `filter` or `lfo1` is laid over the default's, so a patch names only what it sets.
function sound(patch: Patch, base: SynthParameters = createDefaultSynthParameters()): SynthParameters {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = value && typeof value === 'object' && current && typeof current === 'object'
      ? { ...(current as object), ...(value as object) } : value;
  }
  return result as unknown as SynthParameters;
}

// What a patch for a model's preset may set: only what the model's four macros leave alone.
// Everything else comes from the macros, so the knobs a lane shows for the model always agree
// with the sound, and turning one never makes the sound jump.
type Extras = Pick<Patch, 'gain' | 'pan' | 'spread' | 'fxReturn' | 'fxSends' | 'unison' | 'lfo2' | 'duck'>;

const generic = (id: string, name: string, kind: PresetKind, patch: Patch): BuiltInPreset => ({
  id: `builtin-${id}`, name, kind, builtIn: true,
  modelId: DEFAULT_SYNTH_MODEL_ID, modelParams: createDefaultSynthModelParams(), params: sound(patch),
});

const model = (id: string, name: string, kind: PresetKind, modelId: SynthModelId, macros: [number, number, number, number], extras: Extras): BuiltInPreset => {
  const modelParams = { macro1: macros[0], macro2: macros[1], macro3: macros[2], macro4: macros[3] };
  return {
    id: `builtin-${id}`, name, kind, builtIn: true, modelId, modelParams,
    params: sound(extras, sound(mapSynthModelToEngineParams(modelId, modelParams) as Patch)),
  };
};

// Each preset's `gain` is set so that, played as its kind is played (a bass or lead one note, a
// pad or keys a chord), it is about as loud as the others: a test holds every one within a few
// decibels of its kind's level. Change a sound and its gain may need changing with it.
const BASS: BuiltInPreset[] = [
  generic('bass-sub', 'Sub Bass', 'bass', {
    gain: 1.4,
    voiceMode: 'mono', oscillator: { type: 'sine' }, mixer: { sub: 0.35, noise: 0 },
    filter: { frequency: 420, q: 0.8, drive: 0.15, keyTracking: 0.3 },
    envelope: { attack: 0.004, decay: 0.2, sustain: 0.85, release: 0.12 },
    fxSends: { reverb: 0.02, delay: 0, drive: 0.1, phaser: 0, chorus: 0 },
  }),
  model('bass', 'Round Bass', 'bass', 'minimoog-model-d', [0.2, 0.25, 0.3, 0.35], {
    gain: 1.75,
    fxReturn: 0.55, fxSends: { reverb: 0.05, delay: 0.03, drive: 0.25, phaser: 0, chorus: 0 },
  }),
  model('bass-acid', 'Acid Bass', 'bass', 'tb-303', [0.8, 0.7, 0.35, 0.45], {
    gain: 2,
    fxReturn: 0.6, fxSends: { reverb: 0.06, delay: 0.12, drive: 0.4, phaser: 0, chorus: 0 },
  }),
  model('bass-101', '101 Bass', 'bass', 'sh-101', [0.25, 0.6, 0.3, 0.6], {
    gain: 1.8,
    fxReturn: 0.55, fxSends: { reverb: 0.04, delay: 0.04, drive: 0.2, phaser: 0, chorus: 0 },
  }),
  model('bass-pro', 'Pro Bass', 'bass', 'pro-one', [0.3, 0.35, 0.3, 0.55], {
    gain: 2,
    fxReturn: 0.55, fxSends: { reverb: 0.04, delay: 0.03, drive: 0.25, phaser: 0, chorus: 0 },
  }),
  generic('bass-rubber', 'Rubber Bass', 'bass', {
    gain: 1.05,
    voiceMode: 'mono', portamento: { enabled: true, glide: 0.05 },
    oscillator: { type: 'square', pulseWidth: 0.5 }, mixer: { sub: 0.4, noise: 0 },
    filter: { frequency: 500, q: 2.2, envAmount: 0.5, keyTracking: 0.4, slope: 24 },
    filterEnvelope: { attack: 0.002, decay: 0.18, sustain: 0.1, release: 0.14 },
    envelope: { attack: 0.004, decay: 0.25, sustain: 0.5, release: 0.14 },
    velocity: { amp: 1, filter: 0.3 },
    fxSends: { reverb: 0.04, delay: 0, drive: 0.2, phaser: 0, chorus: 0 },
  }),
  generic('bass-reese', 'Reese Bass', 'bass', {
    gain: 1.4,
    voiceMode: 'mono', oscillator: { type: 'sawtooth' },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 18, level: 1 },
    unison: { voices: 3, detune: 0.25 },
    filter: { frequency: 900, q: 1, drive: 0.25, keyTracking: 0.3, slope: 24 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.2 },
    lfo1: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.25, depth: 0.2, sync: false, retrigger: false },
    fxSends: { reverb: 0.06, delay: 0, drive: 0.3, phaser: 0.15, chorus: 0 },
  }),
  generic('bass-fm', 'FM Bass', 'bass', {
    gain: 2,
    engine: 'fm', voiceMode: 'mono', fm: { algorithm: 1, ratio: 1, index: 0.55, decay: 0.18, feedback: 0.2 },
    filter: { frequency: 4000, q: 0.7, keyTracking: 0.5 },
    envelope: { attack: 0.002, decay: 0.3, sustain: 0.35, release: 0.12 },
    velocity: { amp: 1, filter: 0.3 },
    fxSends: { reverb: 0.05, delay: 0, drive: 0.15, phaser: 0, chorus: 0 },
  }),
  generic('bass-pluck', 'Pluck Bass', 'bass', {
    gain: 2,
    voiceMode: 'mono', oscillator: { type: 'sawtooth' }, mixer: { sub: 0.5, noise: 0 },
    filter: { frequency: 300, q: 1.5, envAmount: 0.6, keyTracking: 0.4, slope: 24 },
    filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
    envelope: { attack: 0.002, decay: 0.22, sustain: 0.15, release: 0.1 },
    velocity: { amp: 1, filter: 0.35 },
    fxSends: { reverb: 0.04, delay: 0.05, drive: 0.15, phaser: 0, chorus: 0 },
  }),
  generic('bass-wobble', 'Wobble Bass', 'bass', {
    gain: 1.45,
    voiceMode: 'mono', oscillator: { type: 'sawtooth' },
    oscillator2: { enabled: true, type: 'square', semitones: -12, detune: 4, level: 0.7 },
    filter: { frequency: 400, q: 3, drive: 0.3, slope: 24 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.15 },
    lfo1: { enabled: true, target: 'filter', waveform: 'sine', rate: 8, depth: 0.7, sync: true, retrigger: false },
    fxSends: { reverb: 0.05, delay: 0, drive: 0.3, phaser: 0, chorus: 0 },
  }),
];

const LEAD: BuiltInPreset[] = [
  model('lead', 'Saw Lead', 'lead', 'minimoog-model-d', [0.35, 0.3, 0.75, 0.5], {
    gain: 1.45,
    fxReturn: 0.72, fxSends: { reverb: 0.2, delay: 0.3, drive: 0.15, phaser: 0.08, chorus: 0 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 5.5, depth: 0.25, sync: false, retrigger: true },
  }),
  model('lead-101', '101 Lead', 'lead', 'sh-101', [0.75, 0.2, 0.65, 0.4], {
    gain: 1.3,
    fxReturn: 0.7, fxSends: { reverb: 0.18, delay: 0.3, drive: 0.1, phaser: 0, chorus: 0.1 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 5.5, depth: 0.2, sync: false, retrigger: true },
  }),
  model('lead-pro', 'Pro Lead', 'lead', 'pro-one', [0.5, 0.4, 0.7, 0.5], {
    gain: 1.75,
    fxReturn: 0.7, fxSends: { reverb: 0.2, delay: 0.3, drive: 0.2, phaser: 0, chorus: 0 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 5.5, depth: 0.2, sync: false, retrigger: true },
  }),
  generic('lead-square', 'Square Lead', 'lead', {
    gain: 0.75,
    voiceMode: 'mono', portamento: { enabled: true, glide: 0.06 },
    oscillator: { type: 'square', pulseWidth: 0.5 },
    filter: { frequency: 3200, q: 1.6, envAmount: 0.25, keyTracking: 0.6 },
    filterEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.25 },
    envelope: { attack: 0.008, decay: 0.2, sustain: 0.75, release: 0.22 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 5.2, depth: 0.2, sync: false, retrigger: true },
    fxSends: { reverb: 0.18, delay: 0.3, drive: 0.1, phaser: 0, chorus: 0 },
  }),
  generic('lead-pwm', 'PWM Lead', 'lead', {
    gain: 0.6,
    oscillator: { type: 'square', pulseWidth: 0.5 },
    oscillator2: { enabled: true, type: 'square', semitones: 0, detune: 6, level: 0.6 },
    filter: { frequency: 5200, q: 1.2, keyTracking: 0.5 },
    envelope: { attack: 0.01, decay: 0.25, sustain: 0.8, release: 0.3 },
    lfo1: { enabled: true, target: 'pulseWidth', waveform: 'triangle', rate: 0.9, depth: 0.6, sync: false, retrigger: false },
    fxSends: { reverb: 0.22, delay: 0.25, drive: 0.05, phaser: 0, chorus: 0.25 },
  }),
  generic('lead-supersaw', 'Super Saw', 'lead', {
    gain: 0.8,
    oscillator: { type: 'sawtooth' },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 12, detune: 9, level: 0.35 },
    unison: { voices: 5, detune: 0.45 }, spread: 0.3,
    filter: { frequency: 7000, q: 0.8, keyTracking: 0.5 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.35 },
    fxSends: { reverb: 0.3, delay: 0.25, drive: 0.05, phaser: 0, chorus: 0.2 },
  }),
  generic('lead-soft', 'Soft Lead', 'lead', {
    gain: 1.2,
    oscillator: { type: 'triangle' },
    oscillator2: { enabled: true, type: 'sine', semitones: 12, detune: 0, level: 0.3 },
    filter: { frequency: 2600, q: 0.9, keyTracking: 0.6 },
    envelope: { attack: 0.03, decay: 0.25, sustain: 0.8, release: 0.35 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 4.8, depth: 0.22, sync: false, retrigger: true },
    fxSends: { reverb: 0.3, delay: 0.2, drive: 0, phaser: 0, chorus: 0.15 },
  }),
  model('lead-squelch', 'Squelch Lead', 'lead', 'tb-303', [0.9, 0.8, 0.75, 0.55], {
    gain: 1.9,
    fxReturn: 0.7, fxSends: { reverb: 0.15, delay: 0.3, drive: 0.35, phaser: 0, chorus: 0 },
  }),
  generic('lead-glass', 'Glass Lead', 'lead', {
    gain: 0.95,
    engine: 'fm', fm: { algorithm: 0, ratio: 2, index: 0.5, decay: 1.2, feedback: 0.15 },
    filter: { frequency: 9000, q: 0.7, keyTracking: 0.5 },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0.7, release: 0.4 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 5, depth: 0.15, sync: false, retrigger: true },
    fxSends: { reverb: 0.3, delay: 0.3, drive: 0, phaser: 0, chorus: 0.1 },
  }),
];

const PAD: BuiltInPreset[] = [
  model('pad', 'Warm Pad', 'pad', 'juno-106', [0.5, 0.2, 0.35, 0.55], {
    gain: 0.85,
    spread: 0.5, fxReturn: 0.9, fxSends: { reverb: 0.5, delay: 0.2, drive: 0, phaser: 0.1, chorus: 0.45 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 4.2, depth: 0.08, sync: false, retrigger: false },
  }),
  generic('pad-strings', 'String Ensemble', 'pad', {
    gain: 0.9,
    oscillator: { type: 'sawtooth' },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 12, level: 0.9 },
    unison: { voices: 3, detune: 0.3 }, spread: 0.6,
    filter: { frequency: 3200, q: 0.7, keyTracking: 0.4 },
    envelope: { attack: 0.35, decay: 0.6, sustain: 0.85, release: 1.1 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 5, depth: 0.08, sync: false, retrigger: false },
    fxReturn: 0.9, fxSends: { reverb: 0.45, delay: 0.1, drive: 0, phaser: 0, chorus: 0.5 },
  }),
  generic('pad-pwm', 'PWM Pad', 'pad', {
    gain: 0.5,
    oscillator: { type: 'square', pulseWidth: 0.5 },
    oscillator2: { enabled: true, type: 'square', semitones: -12, detune: 5, level: 0.5 },
    spread: 0.5,
    filter: { frequency: 2400, q: 0.9, keyTracking: 0.4 },
    envelope: { attack: 0.5, decay: 0.8, sustain: 0.85, release: 1.4 },
    lfo1: { enabled: true, target: 'pulseWidth', waveform: 'triangle', rate: 0.35, depth: 0.7, sync: false, retrigger: false },
    fxReturn: 0.9, fxSends: { reverb: 0.5, delay: 0.15, drive: 0, phaser: 0, chorus: 0.35 },
  }),
  generic('pad-glass', 'Glass Pad', 'pad', {
    gain: 0.7,
    engine: 'fm', fm: { algorithm: 2, ratio: 3, index: 0.25, decay: 2.5, feedback: 0 }, spread: 0.5,
    filter: { frequency: 9000, q: 0.7, keyTracking: 0.4 },
    envelope: { attack: 0.4, decay: 1, sustain: 0.8, release: 1.8 },
    fxReturn: 0.95, fxSends: { reverb: 0.55, delay: 0.25, drive: 0, phaser: 0, chorus: 0.3 },
  }),
  generic('pad-sweep', 'Sweep Pad', 'pad', {
    gain: 0.8,
    oscillator: { type: 'sawtooth' },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: -9, level: 0.9 },
    spread: 0.6,
    filter: { frequency: 600, q: 3, keyTracking: 0.3, slope: 24 },
    envelope: { attack: 0.8, decay: 1, sustain: 0.9, release: 2 },
    lfo1: { enabled: true, target: 'filter', waveform: 'sine', rate: 0.12, depth: 0.8, sync: false, retrigger: false },
    fxReturn: 0.9, fxSends: { reverb: 0.5, delay: 0.2, drive: 0, phaser: 0.3, chorus: 0.2 },
  }),
  generic('pad-dark', 'Dark Pad', 'pad', {
    gain: 0.9,
    oscillator: { type: 'triangle' }, mixer: { sub: 0.4, noise: 0 },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 7, level: 0.35 },
    spread: 0.4,
    filter: { frequency: 900, q: 1, keyTracking: 0.3, slope: 24 },
    envelope: { attack: 1, decay: 1.2, sustain: 0.9, release: 2.5 },
    lfo1: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.2, depth: 0.2, sync: false, retrigger: false },
    fxReturn: 0.95, fxSends: { reverb: 0.6, delay: 0.15, drive: 0, phaser: 0.1, chorus: 0.2 },
  }),
  generic('pad-breath', 'Breath Pad', 'pad', {
    gain: 0.95,
    oscillator: { type: 'triangle' }, mixer: { sub: 0, noise: 0.5, osc: 1 }, spread: 0.5,
    filter: { frequency: 2200, q: 0.8, keyTracking: 0.5 },
    envelope: { attack: 0.6, decay: 1, sustain: 0.85, release: 1.6 },
    lfo1: { enabled: true, target: 'filter', waveform: 'sine', rate: 0.18, depth: 0.25, sync: false, retrigger: false },
    fxReturn: 0.95, fxSends: { reverb: 0.6, delay: 0.2, drive: 0, phaser: 0, chorus: 0.3 },
  }),
];

const KEYS: BuiltInPreset[] = [
  model('grand-piano', 'Electric Piano', 'keys', 'dx7', [0.95, 0.19, 0.3, 0.5], {
    gain: 0.85,
    fxReturn: 0.82, fxSends: { reverb: 0.3, delay: 0.05, drive: 0, phaser: 0.05, chorus: 0.3 },
  }),
  generic('keys-digital', 'Digital Piano', 'keys', {
    gain: 1.05,
    engine: 'fm', fm: { algorithm: 1, ratio: 1, index: 0.35, decay: 0.5, feedback: 0.1 },
    filter: { frequency: 7000, q: 0.7, keyTracking: 0.6 },
    envelope: { attack: 0.002, decay: 1.4, sustain: 0.1, release: 0.5 },
    velocity: { amp: 1, filter: 0.4 },
    fxReturn: 0.8, fxSends: { reverb: 0.3, delay: 0.05, drive: 0, phaser: 0, chorus: 0.1 },
  }),
  generic('keys-organ', 'Organ', 'keys', {
    gain: 0.75,
    engine: 'fm', fm: { algorithm: 3, ratio: 2, index: 0.6, decay: 10, feedback: 0 },
    filter: { frequency: 6000, q: 0.7, keyTracking: 0.3 },
    envelope: { attack: 0.005, decay: 0.1, sustain: 1, release: 0.08 },
    velocity: { amp: 0.2, filter: 0 },
    lfo2: { enabled: true, target: 'vibrato', waveform: 'sine', rate: 6.5, depth: 0.12, sync: false, retrigger: false },
    fxReturn: 0.8, fxSends: { reverb: 0.25, delay: 0, drive: 0.15, phaser: 0, chorus: 0.4 },
  }),
  generic('keys-clav', 'Clav', 'keys', {
    gain: 0.85,
    oscillator: { type: 'square', pulseWidth: 0.2 },
    filter: { frequency: 2200, q: 2.5, envAmount: 0.45, keyTracking: 0.6, drive: 0.2 },
    filterEnvelope: { attack: 0.001, decay: 0.15, sustain: 0.1, release: 0.08 },
    envelope: { attack: 0.001, decay: 0.35, sustain: 0.2, release: 0.08 },
    velocity: { amp: 1, filter: 0.5 },
    fxReturn: 0.7, fxSends: { reverb: 0.12, delay: 0, drive: 0.2, phaser: 0.2, chorus: 0 },
  }),
  model('keys-juno', 'Juno Keys', 'keys', 'juno-106', [0.3, 0.3, 0.4, 0.9], {
    gain: 0.9,
    spread: 0.3, fxReturn: 0.85, fxSends: { reverb: 0.3, delay: 0.1, drive: 0, phaser: 0, chorus: 0.4 },
  }),
  model('keys-brass', 'Poly Brass', 'keys', 'prophet-5', [0.4, 0.3, 0.55, 0.7], {
    gain: 0.9,
    spread: 0.3, fxReturn: 0.8, fxSends: { reverb: 0.3, delay: 0.12, drive: 0.1, phaser: 0, chorus: 0.15 },
  }),
];

const PLUCK: BuiltInPreset[] = [
  generic('pluck', 'Saw Pluck', 'pluck', {
    gain: 1.4,
    oscillator: { type: 'sawtooth' },
    filter: { frequency: 600, q: 2, envAmount: 0.65, keyTracking: 0.5, slope: 24 },
    filterEnvelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.12 },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.25 },
    velocity: { amp: 1, filter: 0.3 },
    fxSends: { reverb: 0.2, delay: 0.25, drive: 0.05, phaser: 0, chorus: 0 },
  }),
  model('pluck-bell', 'Bell', 'pluck', 'dx7', [0.72, 0.5, 0.5, 0.25], {
    gain: 0.75,
    fxReturn: 0.9, fxSends: { reverb: 0.45, delay: 0.2, drive: 0, phaser: 0, chorus: 0.1 },
  }),
  generic('pluck-marimba', 'Marimba', 'pluck', {
    gain: 1.1,
    engine: 'fm', fm: { algorithm: 1, ratio: 4, index: 0.3, decay: 0.08, feedback: 0 },
    filter: { frequency: 6000, q: 0.7, keyTracking: 0.5 },
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.3 },
    velocity: { amp: 1, filter: 0.3 },
    fxSends: { reverb: 0.25, delay: 0.1, drive: 0, phaser: 0, chorus: 0 },
  }),
  generic('pluck-kalimba', 'Kalimba', 'pluck', {
    gain: 0.9,
    engine: 'fm', fm: { algorithm: 1, ratio: 5, index: 0.18, decay: 0.12, feedback: 0 },
    filter: { frequency: 8000, q: 0.7, keyTracking: 0.5 },
    envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.5 },
    velocity: { amp: 1, filter: 0.25 },
    fxSends: { reverb: 0.35, delay: 0.2, drive: 0, phaser: 0, chorus: 0 },
  }),
  generic('pluck-nylon', 'Nylon Pluck', 'pluck', {
    gain: 1,
    oscillator: { type: 'triangle' },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 3, level: 0.25 },
    filter: { frequency: 2400, q: 1, envAmount: 0.35, keyTracking: 0.7 },
    filterEnvelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
    envelope: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.6 },
    velocity: { amp: 1, filter: 0.3 },
    fxSends: { reverb: 0.3, delay: 0.12, drive: 0, phaser: 0, chorus: 0.1 },
  }),
  generic('pluck-stab', 'Chord Stab', 'pluck', {
    gain: 1.8,
    oscillator: { type: 'sawtooth' },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 10, level: 0.9 },
    unison: { voices: 2, detune: 0.2 }, spread: 0.3,
    filter: { frequency: 1800, q: 1.4, envAmount: 0.5, keyTracking: 0.4, slope: 24 },
    filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.15 },
    envelope: { attack: 0.002, decay: 0.28, sustain: 0, release: 0.2 },
    fxSends: { reverb: 0.3, delay: 0.3, drive: 0.05, phaser: 0, chorus: 0.2 },
  }),
  model('pluck-pro', 'Pro Zap', 'pluck', 'pro-one', [0.2, 0.6, 0.25, 0.3], {
    gain: 1.45,
    fxReturn: 0.7, fxSends: { reverb: 0.2, delay: 0.3, drive: 0.25, phaser: 0, chorus: 0 },
  }),
  generic('pluck-blip', 'Blip', 'pluck', {
    gain: 1.7,
    oscillator: { type: 'square', pulseWidth: 0.35 },
    filter: { frequency: 5000, q: 1, keyTracking: 0.5 },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 },
    fxSends: { reverb: 0.15, delay: 0.3, drive: 0, phaser: 0, chorus: 0 },
  }),
];

const EFFECTS: BuiltInPreset[] = [
  generic('fx-riser', 'Noise Riser', 'effects', {
    gain: 2,
    mixer: { sub: 0, noise: 1, osc: 0 },
    filter: { type: 'bandpass', frequency: 300, q: 2, envAmount: 1 },
    filterEnvelope: { attack: 4, decay: 0.5, sustain: 1, release: 0.4 },
    envelope: { attack: 1.5, decay: 0.5, sustain: 1, release: 0.4 },
    fxReturn: 0.9, fxSends: { reverb: 0.5, delay: 0.3, drive: 0, phaser: 0.3, chorus: 0 },
  }),
  generic('fx-laser', 'Laser', 'effects', {
    gain: 1.65,
    oscillator: { type: 'sawtooth' },
    filter: { frequency: 6000, q: 2 },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
    lfo1: { enabled: true, target: 'pitch', waveform: 'sawtooth', rate: 1.5, depth: 1, sync: false, retrigger: true },
    fxSends: { reverb: 0.3, delay: 0.45, drive: 0.1, phaser: 0, chorus: 0 },
  }),
  generic('fx-wind', 'Wind', 'effects', {
    gain: 2,
    mixer: { sub: 0, noise: 1, osc: 0 },
    filter: { frequency: 800, q: 4, slope: 24 },
    envelope: { attack: 1, decay: 1, sustain: 1, release: 2 },
    lfo1: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.15, depth: 0.9, sync: false, retrigger: false },
    lfo2: { enabled: true, target: 'amp', waveform: 'sine', rate: 0.23, depth: 0.5, sync: false, retrigger: false },
    fxReturn: 0.9, fxSends: { reverb: 0.5, delay: 0.1, drive: 0, phaser: 0, chorus: 0 },
  }),
  generic('fx-siren', 'Siren', 'effects', {
    gain: 0.85,
    oscillator: { type: 'triangle' },
    filter: { frequency: 5000, q: 1 },
    envelope: { attack: 0.05, decay: 0.2, sustain: 1, release: 0.4 },
    lfo1: { enabled: true, target: 'pitch', waveform: 'triangle', rate: 0.6, depth: 0.35, sync: false, retrigger: true },
    fxSends: { reverb: 0.35, delay: 0.3, drive: 0, phaser: 0, chorus: 0 },
  }),
  generic('fx-alarm', 'Alarm', 'effects', {
    gain: 0.5,
    oscillator: { type: 'square', pulseWidth: 0.5 },
    filter: { frequency: 3500, q: 1.5 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 1, release: 0.1 },
    lfo1: { enabled: true, target: 'pitch', waveform: 'square', rate: 3, depth: 0.25, sync: false, retrigger: true },
    fxSends: { reverb: 0.25, delay: 0.2, drive: 0.05, phaser: 0, chorus: 0 },
  }),
  generic('fx-helicopter', 'Helicopter', 'effects', {
    gain: 2,
    oscillator: { type: 'sine' }, mixer: { sub: 0, noise: 1, osc: 0.3 },
    filter: { frequency: 400, q: 1.5, slope: 24 },
    envelope: { attack: 0.3, decay: 0.5, sustain: 1, release: 0.8 },
    lfo1: { enabled: true, target: 'amp', waveform: 'sawtooth', rate: 12, depth: 1, sync: false, retrigger: false },
    fxSends: { reverb: 0.3, delay: 0.1, drive: 0.1, phaser: 0.2, chorus: 0 },
  }),
];

export function createBuiltInPresets(): BuiltInPreset[] {
  return [...BASS, ...LEAD, ...PAD, ...KEYS, ...PLUCK, ...EFFECTS].map(preset => structuredClone(preset));
}
