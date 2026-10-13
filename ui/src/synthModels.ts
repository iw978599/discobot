import { SynthModelId, SynthModelParams, SynthParameters } from './types';

type MacroKey = keyof SynthModelParams;

interface MacroDescriptor {
  key: MacroKey;
  label: string;
}

// How the model menu groups them. The plain engine stands outside any group.
export type SynthModelGroup = 'Mono' | 'Poly' | 'Digital';
export const SYNTH_MODEL_GROUPS: SynthModelGroup[] = ['Mono', 'Poly', 'Digital'];

interface SynthModelDefinition {
  id: SynthModelId;
  name: string;
  subtitle: string;
  group?: SynthModelGroup;
  macros: MacroDescriptor[];
}

export const SYNTH_MODELS: SynthModelDefinition[] = [
  { id: 'generic', name: 'Generic', subtitle: 'Default engine controls', macros: [] },
  {
    id: 'minimoog-model-d',
    name: 'Minimoog Model D',
    group: 'Mono',
    subtitle: 'Mono, two oscillators + sub into a driven filter',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Contour' },
    ],
  },
  {
    id: 'juno-106',
    name: 'Juno-106',
    group: 'Poly',
    subtitle: 'Poly saw + pulse + sub, gentle filter',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Contour' },
    ],
  },
  {
    id: 'dx7',
    name: 'DX7',
    group: 'Digital',
    subtitle: 'Four-operator FM voice',
    macros: [
      { key: 'macro1', label: 'Ratio' },
      { key: 'macro2', label: 'FM Amount' },
      { key: 'macro3', label: 'Bright' },
      { key: 'macro4', label: 'Pluck' },
    ],
  },
  {
    id: 'tb-303',
    name: 'TB-303',
    group: 'Mono',
    subtitle: 'Mono acid bass: accent on loud steps, slide on tied steps',
    macros: [
      { key: 'macro1', label: 'Wave / Tune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Decay' },
    ],
  },
  {
    id: 'prophet-5',
    name: 'Prophet-5',
    group: 'Poly',
    subtitle: 'Poly saw + pulse with filter envelope',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Contour' },
    ],
  },
  {
    id: 'sh-101',
    name: 'SH-101',
    group: 'Mono',
    subtitle: 'Mono, one oscillator: saw and moving pulse, a sub, one envelope for filter and level',
    macros: [
      { key: 'macro1', label: 'Wave Mix' },
      { key: 'macro2', label: 'Sub' },
      { key: 'macro3', label: 'Cutoff' },
      { key: 'macro4', label: 'Env' },
    ],
  },
  {
    id: 'jupiter-8',
    name: 'Jupiter-8',
    group: 'Poly',
    subtitle: 'Big, clean poly: saw and pulse a little apart into a smooth 24 dB filter',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Contour' },
    ],
  },
  {
    id: 'ob-xa',
    name: 'OB-Xa',
    group: 'Poly',
    subtitle: 'Wide, brassy poly: two saws spread apart into an open 12 dB filter, with a swell',
    macros: [
      { key: 'macro1', label: 'Spread' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Attack' },
    ],
  },
  {
    id: 'mono-poly',
    name: 'Mono/Poly',
    group: 'Mono',
    subtitle: 'Mono, four oscillators stacked and detuned into a 24 dB filter',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Cutoff' },
      { key: 'macro4', label: 'Env' },
    ],
  },
  {
    id: 'jp-8000',
    name: 'JP-8000',
    group: 'Digital',
    subtitle: 'Supersaw: seven saws, one in tune and six spread either side of it',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Mix' },
      { key: 'macro3', label: 'Cutoff' },
      { key: 'macro4', label: 'Release' },
    ],
  },
  {
    id: 'polysix',
    name: 'Polysix',
    group: 'Poly',
    subtitle: 'Warm poly: one oscillator with a moving pulse and a sub, one envelope, and its ensemble',
    macros: [
      { key: 'macro1', label: 'PWM' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Ensemble' },
    ],
  },
  {
    id: 'ms-20',
    name: 'MS-20',
    group: 'Mono',
    subtitle: 'Screaming mono: a high-pass, then a low-pass whose peak distorts as it is pushed',
    macros: [
      { key: 'macro1', label: 'HP Cutoff' },
      { key: 'macro2', label: 'LP Cutoff' },
      { key: 'macro3', label: 'Peak' },
      { key: 'macro4', label: 'Env' },
    ],
  },
  {
    id: 'odyssey',
    name: 'Odyssey',
    group: 'Mono',
    subtitle: 'Mono lead: a synced second oscillator swept by the envelope, ring modulation, and a filter stepped at random',
    macros: [
      { key: 'macro1', label: 'Sync' },
      { key: 'macro2', label: 'Ring' },
      { key: 'macro3', label: 'Cutoff' },
      { key: 'macro4', label: 'S&H' },
    ],
  },
  {
    id: 'pro-one',
    name: 'Pro-One',
    group: 'Mono',
    subtitle: 'Mono, two oscillators into a hard 24 dB filter with a fast envelope, and glide',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Cutoff' },
      { key: 'macro4', label: 'Env' },
    ],
  },
];

export const DEFAULT_SYNTH_MODEL_ID: SynthModelId = 'generic';

const clamp01 = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;

export function createDefaultSynthModelParams(): SynthModelParams {
  return { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
}

export function normalizeSynthModelId(value: unknown): SynthModelId {
  if (typeof value !== 'string') return DEFAULT_SYNTH_MODEL_ID;
  return SYNTH_MODELS.some((model) => model.id === value) ? value as SynthModelId : DEFAULT_SYNTH_MODEL_ID;
}

export function normalizeSynthModelParams(value: unknown): SynthModelParams {
  const defaults = createDefaultSynthModelParams();
  if (!value || typeof value !== 'object') return defaults;
  const incoming = value as Partial<SynthModelParams>;
  return {
    macro1: clamp01(incoming.macro1 ?? defaults.macro1),
    macro2: clamp01(incoming.macro2 ?? defaults.macro2),
    macro3: clamp01(incoming.macro3 ?? defaults.macro3),
    macro4: clamp01(incoming.macro4 ?? defaults.macro4),
  };
}

export function getSynthModelDefinition(modelId: SynthModelId): SynthModelDefinition {
  return SYNTH_MODELS.find((model) => model.id === modelId) ?? SYNTH_MODELS[0];
}

function range(min: number, max: number, value: number): number {
  return min + (max - min) * clamp01(value);
}

type Range = [number, number];

interface ModelVoicing {
  oscillator: SynthParameters['oscillator']['type'];
  voiceMode: 'poly' | 'mono';
  detune: Range;
  cutoff: Range;
  resonance: Range;
  attack: Range;
  decay: Range;
  sustain: Range;
  release: Range;
  lfoRate: Range;
  lfoDepth: Range;
  // second oscillator: waveform, semitone offset and how far macro 1 spreads it in cents
  oscillator2?: { type: SynthParameters['oscillator']['type']; semitones: number; spread: Range; level: number };
  sub?: number;
  noise?: number;
  pulseWidth?: number;
  envAmount: Range;
  filterDecay: Range;
  keyTracking: number;
  drive: number;
  accent: number;
  glide?: number;
  // 24 for a model whose filter is a four-pole. Left out, the lane keeps the slope it has.
  slope?: 24;
}

function mapModel(params: SynthModelParams, voicing: ModelVoicing): Partial<SynthParameters> {
  const osc2 = voicing.oscillator2;
  return {
    engine: 'subtractive',
    voiceMode: voicing.voiceMode,
    oscillator: {
      type: voicing.oscillator,
      detune: osc2 ? 0 : Math.round(range(voicing.detune[0], voicing.detune[1], params.macro1)),
      pulseWidth: voicing.pulseWidth ?? 0.5,
    },
    oscillator2: {
      enabled: Boolean(osc2),
      type: osc2?.type ?? 'sawtooth',
      semitones: osc2?.semitones ?? 0,
      detune: osc2 ? Math.round(range(osc2.spread[0], osc2.spread[1], params.macro1)) : 0,
      level: osc2?.level ?? 0,
      sync: false,
    },
    // The first oscillator at full level and no ring, whatever a model the lane had before left them at.
    mixer: { sub: voicing.sub ?? 0, noise: voicing.noise ?? 0, osc: 1, ring: 0 },
    filter: {
      type: 'lowpass',
      frequency: Math.round(range(voicing.cutoff[0], voicing.cutoff[1], params.macro3)),
      q: Number(range(voicing.resonance[0], voicing.resonance[1], params.macro2).toFixed(2)),
      envAmount: Number(range(voicing.envAmount[0], voicing.envAmount[1], params.macro4).toFixed(2)),
      keyTracking: voicing.keyTracking,
      drive: voicing.drive,
      ...(voicing.slope ? { slope: voicing.slope } : {}),
    },
    filterEnvelope: {
      attack: 0.003,
      decay: Number(range(voicing.filterDecay[0], voicing.filterDecay[1], params.macro4).toFixed(3)),
      sustain: 0.15,
      release: Number(range(voicing.release[0], voicing.release[1], params.macro4).toFixed(3)),
    },
    velocity: { amp: 1, filter: voicing.accent },
    portamento: { enabled: voicing.glide !== undefined, glide: voicing.glide ?? 0.05 },
    envelope: {
      attack: Number(range(voicing.attack[0], voicing.attack[1], 1 - params.macro4).toFixed(3)),
      decay: Number(range(voicing.decay[0], voicing.decay[1], params.macro4).toFixed(3)),
      sustain: Number(range(voicing.sustain[0], voicing.sustain[1], 1 - params.macro2).toFixed(2)),
      release: Number(range(voicing.release[0], voicing.release[1], params.macro4).toFixed(3)),
    },
    lfo1: {
      sync: false,
      retrigger: true,
      enabled: params.macro3 > 0.12,
      target: 'filter',
      waveform: 'triangle',
      rate: Number(range(voicing.lfoRate[0], voicing.lfoRate[1], params.macro3).toFixed(2)),
      depth: Number(range(voicing.lfoDepth[0], voicing.lfoDepth[1], params.macro2).toFixed(2)),
    },
  };
}

// Four-operator FM voice: the macros drive the modulator ratio, depth and decay directly.
function mapFmModel(params: SynthModelParams): Partial<SynthParameters> {
  const ratios = [0.5, 1, 2, 3, 4, 5, 7, 9, 14];
  return {
    engine: 'fm',
    voiceMode: 'poly',
    fm: {
      algorithm: 1,
      ratio: ratios[Math.min(ratios.length - 1, Math.floor(clamp01(params.macro1) * ratios.length))],
      index: Number(range(0.05, 0.95, params.macro2).toFixed(2)),
      decay: Number(range(2.5, 0.08, params.macro4).toFixed(3)),
      feedback: Number(range(0, 0.6, params.macro3).toFixed(2)),
    },
    oscillator2: { enabled: false, type: 'sine', semitones: 0, detune: 0, level: 0 },
    mixer: { sub: 0, noise: 0 },
    filter: {
      type: 'lowpass', frequency: Math.round(range(1800, 18000, params.macro3)), q: 0.7,
      envAmount: 0, keyTracking: 0.5, drive: 0,
    },
    velocity: { amp: 1, filter: 0.35 },
    portamento: { enabled: false, glide: 0.05 },
    envelope: {
      attack: 0.002,
      decay: Number(range(2.2, 0.25, params.macro4).toFixed(3)),
      sustain: Number(range(0.55, 0, params.macro4).toFixed(2)),
      release: Number(range(0.9, 0.18, params.macro4).toFixed(3)),
    },
    lfo1: { sync: false, retrigger: true, enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.05 },
  };
}

// One oscillator that gives a saw and a pulse at once, balanced by the first macro, with a sub
// under them and one envelope driving both the filter and the level. The pulse's width is kept
// moving by an LFO, which is most of what the instrument's pulse sounds like. The voice's first
// oscillator is the pulse, because only it has a width; the second is the saw.
function mapSh101(params: SynthModelParams): Partial<SynthParameters> {
  const pulse = clamp01(params.macro1), saw = 1 - pulse;
  const shared = { attack: 0.003, decay: 0.35, sustain: 0.45, release: 0.18 };
  return {
    engine: 'subtractive',
    voiceMode: 'mono',
    oscillator: { type: 'square', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: saw > 0, type: 'sawtooth', semitones: 0, detune: 0, level: Number(saw.toFixed(2)) },
    mixer: { sub: Number(range(0, 0.9, params.macro2).toFixed(2)), noise: 0, osc: Number(pulse.toFixed(2)) },
    filter: {
      type: 'lowpass',
      // The cutoff is heard in octaves, so the knob moves through them evenly: 120 Hz to 8 kHz.
      frequency: Math.round(120 * (8000 / 120) ** clamp01(params.macro3)),
      q: 2.5,
      envAmount: Number(range(0, 0.8, params.macro4).toFixed(2)),
      keyTracking: 0.5,
      drive: 0.15,
      slope: 24,
    },
    filterEnvelope: { ...shared },
    envelope: { ...shared },
    velocity: { amp: 1, filter: 0.2 },
    portamento: { enabled: false, glide: 0.05 },
    lfo1: { sync: false, retrigger: false, enabled: true, target: 'pulseWidth', waveform: 'triangle', rate: 1.2, depth: 0.35 },
  };
}

// Two saws spread apart by the first macro, into a two-pole filter that is left fairly open,
// and a level that swells in: the fourth macro is how long the swell takes, and the filter opens
// with it a little more slowly, which is the brass.
function mapObxa(params: SynthModelParams): Partial<SynthParameters> {
  const attack = range(0.005, 0.9, params.macro4);
  return {
    engine: 'subtractive',
    voiceMode: 'poly',
    oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: Math.round(range(6, 40, params.macro1)), level: 0.9 },
    mixer: { sub: 0, noise: 0, osc: 1 },
    filter: {
      type: 'lowpass',
      frequency: Math.round(800 * (14000 / 800) ** clamp01(params.macro3)),
      q: Number(range(0.4, 5, params.macro2).toFixed(2)),
      envAmount: 0.3,
      keyTracking: 0.4,
      drive: 0.2,
      slope: 12,
    },
    filterEnvelope: { attack: Number((attack * 1.2 + 0.005).toFixed(3)), decay: 0.9, sustain: 0.5, release: 1 },
    envelope: { attack: Number(attack.toFixed(3)), decay: 0.6, sustain: 0.85, release: 1 },
    velocity: { amp: 1, filter: 0.25 },
    portamento: { enabled: false, glide: 0.05 },
    lfo1: { sync: false, retrigger: true, enabled: false, target: 'filter', waveform: 'triangle', rate: 0.5, depth: 0.1 },
  };
}

// Seven saws on every note: one in tune, six spread either side. Detune is how far they spread,
// and it is not even: most of the knob's travel is small amounts, then it opens out fast, as
// the instrument's does. Mix is how loud the six are beside the one in tune.
function mapJp8000(params: SynthModelParams): Partial<SynthParameters> {
  return {
    engine: 'subtractive',
    voiceMode: 'poly',
    oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: false, type: 'sawtooth', semitones: 0, detune: 0, level: 0 },
    mixer: { sub: 0, noise: 0, osc: 1 },
    unison: { voices: 7, detune: Number((clamp01(params.macro1) ** 2).toFixed(3)), mix: Number(clamp01(params.macro2).toFixed(2)) },
    filter: {
      type: 'lowpass',
      frequency: Math.round(200 * (16000 / 200) ** clamp01(params.macro3)),
      q: 0.8,
      envAmount: 0.1,
      keyTracking: 0.5,
      drive: 0,
      slope: 12,
    },
    filterEnvelope: { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.4 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.85, release: Number(range(0.05, 2.5, params.macro4).toFixed(3)) },
    velocity: { amp: 1, filter: 0.15 },
    portamento: { enabled: false, glide: 0.05 },
    lfo1: { sync: false, retrigger: true, enabled: false, target: 'filter', waveform: 'triangle', rate: 0.5, depth: 0.1 },
  };
}

// One oscillator a note, a pulse whose width an LFO keeps moving, a sub under it, a four-pole
// filter and one envelope for filter and level. What made the instrument sound bigger than one
// oscillator was the ensemble it had built in. This synth's chorus is one shared effect with a
// send from each lane, so the fourth macro is the lane's chorus send: the one model that
// changes a mix setting, which the owner agreed to for this model alone.
function mapPolysix(params: SynthModelParams): Partial<SynthParameters> {
  const shared = { attack: 0.02, decay: 0.5, sustain: 0.7, release: 0.5 };
  const movement = Number(range(0, 0.8, params.macro1).toFixed(2));
  return {
    engine: 'subtractive',
    voiceMode: 'poly',
    oscillator: { type: 'square', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: false, type: 'sawtooth', semitones: 0, detune: 0, level: 0 },
    mixer: { sub: 0.4, noise: 0, osc: 1 },
    filter: {
      type: 'lowpass',
      frequency: Math.round(250 * (10000 / 250) ** clamp01(params.macro3)),
      q: Number(range(0.4, 6, params.macro2).toFixed(2)),
      envAmount: 0.25,
      keyTracking: 0.5,
      drive: 0.05,
      slope: 24,
    },
    filterEnvelope: { ...shared },
    envelope: { ...shared },
    velocity: { amp: 1, filter: 0.15 },
    portamento: { enabled: false, glide: 0.05 },
    lfo1: { sync: false, retrigger: false, enabled: movement > 0, target: 'pulseWidth', waveform: 'triangle', rate: 0.6, depth: movement },
    fxSends: { chorus: Number(range(0, 0.8, params.macro4).toFixed(2)) } as SynthParameters['fxSends'],
  };
}

// Two oscillators, mono, through a high-pass and then a two-pole low-pass. Both filters share one
// peak, and it is the instrument's voice: it does not ring cleanly, it distorts, harder the
// further it is pushed. One envelope opens the low-pass. The first macro is off at the bottom.
function mapMs20(params: SynthModelParams): Partial<SynthParameters> {
  const highpass = clamp01(params.macro1);
  return {
    engine: 'subtractive',
    voiceMode: 'mono',
    oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: true, type: 'square', semitones: 0, detune: 7, level: 0.7 },
    mixer: { sub: 0, noise: 0, osc: 1 },
    filter: {
      type: 'lowpass',
      model: 'ms20',
      slope: 12,
      highpass: highpass < 0.02 ? 0 : Math.round(30 * (1500 / 30) ** highpass),
      frequency: Math.round(150 * (9000 / 150) ** clamp01(params.macro2)),
      q: Number(range(0.7, 22, params.macro3).toFixed(2)),
      envAmount: Number(range(0, 0.85, params.macro4).toFixed(2)),
      keyTracking: 0.5,
      drive: 0.35,
    },
    filterEnvelope: { attack: 0.003, decay: 0.35, sustain: 0.25, release: 0.25 },
    envelope: { attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.2 },
    velocity: { amp: 1, filter: 0.3 },
    portamento: { enabled: true, glide: 0.03 },
    lfo1: { sync: false, retrigger: true, enabled: false, target: 'filter', waveform: 'triangle', rate: 0.5, depth: 0.1 },
  };
}

// Two oscillators with the second synced to the first. Sync is how far the second is tuned over
// the first, and how far the filter's envelope sweeps it from there, which is the sound sync is
// known for. Ring is how much of the two multiplied together there is. S&H steps the filter at
// random, six times a second: the first LFO is the clock for it and is sent nowhere itself.
function mapOdyssey(params: SynthModelParams): Partial<SynthParameters> {
  const sync = clamp01(params.macro1), stepped = clamp01(params.macro4);
  return {
    engine: 'subtractive',
    voiceMode: 'mono',
    oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: true, type: 'sawtooth', semitones: Math.round(range(0, 19, sync)), detune: 0, level: 0.9, sync: true },
    mixer: { sub: 0, noise: 0, osc: 1, ring: Number(clamp01(params.macro2).toFixed(2)) },
    filter: {
      type: 'lowpass',
      frequency: Math.round(150 * (10000 / 150) ** clamp01(params.macro3)),
      q: 2.5,
      envAmount: 0.35,
      keyTracking: 0.5,
      drive: 0.2,
      slope: 24,
    },
    filterEnvelope: { attack: 0.003, decay: 0.4, sustain: 0.2, release: 0.3 },
    envelope: { attack: 0.003, decay: 0.3, sustain: 0.75, release: 0.25 },
    velocity: { amp: 1, filter: 0.25 },
    portamento: { enabled: true, glide: 0.04 },
    lfo1: { sync: false, retrigger: false, enabled: false, target: 'filter', waveform: 'sawtooth', rate: 6, depth: 0 },
    modMatrix: [
      ...(sync > 0 ? [{ source: 'filterEnv' as const, destination: 'osc2Pitch' as const, depth: Number((sync * 0.5).toFixed(2)) }] : []),
      ...(stepped > 0 ? [{ source: 'random' as const, destination: 'filter' as const, depth: Number((stepped * 0.6).toFixed(2)) }] : []),
    ],
  };
}

// What a lane is given when it moves to a model: the model's macros, and anything another model
// may have left on the lane that this one does not set for itself. A lane that only has a macro
// turned gets the macros alone (mapSynthModelToEngineParams), so a slope or a unison someone
// chose on it stays. The plain engine takes nothing away: it is where a model's sound is taken
// to be changed by hand.
// The models whose instrument had a ladder filter. It is given when a lane moves to the model
// and not when a macro is turned, so a lane that was set to one of these before the ladder
// existed goes on sounding as it did until the model is chosen again.
const LADDER_MODELS: SynthModelId[] = ['minimoog-model-d', 'tb-303'];

export function enterSynthModel(modelId: SynthModelId, modelParams: SynthModelParams, leaving?: SynthModelId): Partial<SynthParameters> {
  const mapped = mapSynthModelToEngineParams(modelId, modelParams);
  if (modelId === 'generic') return mapped;
  const ladder = LADDER_MODELS.includes(modelId);
  return {
    ...mapped,
    unison: mapped.unison ?? { voices: 1, detune: 0.3, mix: 1 },
    // No routes, no sync and no ring modulation, unless the model sets its own.
    modMatrix: mapped.modMatrix ?? [],
    oscillator2: { ...mapped.oscillator2, sync: mapped.oscillator2?.sync ?? false } as SynthParameters['oscillator2'],
    mixer: { ...mapped.mixer, ring: mapped.mixer?.ring ?? 0 } as SynthParameters['mixer'],
    // No high-pass and the clean filter, unless the model is one that sets them for itself.
    filter: { slope: ladder ? 24 : 12, highpass: 0, ...mapped.filter, model: mapped.filter?.model ?? (ladder ? 'ladder' : 'svf') } as SynthParameters['filter'],
    // The Polysix's ensemble is the lane's chorus send. It goes when the lane leaves the Polysix;
    // a chorus send on any other lane is the person's own and is not touched.
    ...(leaving === 'polysix' && modelId !== 'polysix' ? { fxSends: { chorus: 0 } as SynthParameters['fxSends'] } : {}),
  };
}

export function mapSynthModelToEngineParams(modelId: SynthModelId, modelParams: SynthModelParams): Partial<SynthParameters> {
  if (modelId === 'generic') return {};
  if (modelId === 'jp-8000') return mapJp8000(modelParams);
  if (modelId === 'polysix') return mapPolysix(modelParams);
  if (modelId === 'ms-20') return mapMs20(modelParams);
  if (modelId === 'odyssey') return mapOdyssey(modelParams);
  if (modelId === 'mono-poly') {
    return {
      ...mapModel(modelParams, {
        oscillator: 'sawtooth', voiceMode: 'mono',
        detune: [0, 0], pulseWidth: 0.5,
        cutoff: [120, 8000], resonance: [0.8, 10],
        attack: [0.002, 0.05], decay: [0.05, 0.7], sustain: [0.2, 0.85], release: [0.05, 0.5],
        lfoRate: [0.1, 7], lfoDepth: [0.02, 0.25],
        envAmount: [0.15, 0.8], filterDecay: [0.06, 0.9], keyTracking: 0.5, drive: 0.3, accent: 0.3, glide: 0.04, slope: 24,
      }),
      // Its four oscillators, stacked on the one note and pulled apart by the first macro.
      unison: { voices: 4, detune: Number(range(0.05, 0.8, modelParams.macro1).toFixed(2)), mix: 1 },
    };
  }
  if (modelId === 'ob-xa') return mapObxa(modelParams);
  if (modelId === 'jupiter-8') {
    return mapModel(modelParams, {
      oscillator: 'sawtooth', voiceMode: 'poly',
      oscillator2: { type: 'square', semitones: 0, spread: [1, 12], level: 0.7 },
      detune: [0, 0], pulseWidth: 0.45,
      cutoff: [350, 12000], resonance: [0.4, 6],
      attack: [0.005, 0.5], decay: [0.12, 1.2], sustain: [0.4, 0.92], release: [0.2, 2],
      lfoRate: [0.1, 6], lfoDepth: [0.02, 0.25],
      envAmount: [0.05, 0.5], filterDecay: [0.15, 1.5], keyTracking: 0.5, drive: 0.05, accent: 0.2, slope: 24,
    });
  }
  if (modelId === 'dx7') return mapFmModel(modelParams);
  if (modelId === 'sh-101') return mapSh101(modelParams);
  if (modelId === 'pro-one') {
    return mapModel(modelParams, {
      oscillator: 'sawtooth', voiceMode: 'mono',
      oscillator2: { type: 'square', semitones: 0, spread: [2, 30], level: 0.8 },
      detune: [0, 0], pulseWidth: 0.5,
      cutoff: [120, 7000], resonance: [0.8, 12],
      attack: [0.001, 0.03], decay: [0.04, 0.6], sustain: [0.1, 0.8], release: [0.04, 0.4],
      lfoRate: [0.1, 8], lfoDepth: [0.02, 0.25],
      envAmount: [0.2, 0.9], filterDecay: [0.05, 0.8], keyTracking: 0.5, drive: 0.4, accent: 0.35, glide: 0.03, slope: 24,
    });
  }
  if (modelId === 'minimoog-model-d') {
    return mapModel(modelParams, {
      oscillator: 'sawtooth', voiceMode: 'mono',
      oscillator2: { type: 'sawtooth', semitones: 0, spread: [2, 28], level: 0.85 },
      sub: 0.35, detune: [0, 0],
      cutoff: [140, 5200], resonance: [0.9, 11],
      attack: [0.002, 0.08], decay: [0.03, 0.52], sustain: [0.18, 0.86], release: [0.04, 0.45],
      lfoRate: [0.1, 7.5], lfoDepth: [0.02, 0.3],
      envAmount: [0.15, 0.75], filterDecay: [0.06, 0.9], keyTracking: 0.5, drive: 0.35, accent: 0.25, glide: 0.04,
    });
  }
  if (modelId === 'juno-106') {
    return mapModel(modelParams, {
      oscillator: 'sawtooth', voiceMode: 'poly',
      oscillator2: { type: 'square', semitones: 0, spread: [1, 14], level: 0.5 },
      sub: 0.45, pulseWidth: 0.4, detune: [0, 0],
      cutoff: [400, 11000], resonance: [0.4, 5.2],
      attack: [0.01, 0.6], decay: [0.1, 1.4], sustain: [0.48, 0.96], release: [0.2, 1.8],
      lfoRate: [0.2, 8], lfoDepth: [0.03, 0.4],
      envAmount: [0, 0.4], filterDecay: [0.2, 1.6], keyTracking: 0.4, drive: 0.05, accent: 0.1,
    });
  }
  if (modelId === 'tb-303') {
    return mapModel(modelParams, {
      oscillator: modelParams.macro1 > 0.5 ? 'sawtooth' : 'square', voiceMode: 'mono',
      detune: [-16, 7], pulseWidth: 0.42,
      cutoff: [110, 3200], resonance: [2.5, 18],
      attack: [0.001, 0.003], decay: [0.12, 0.9], sustain: [0, 0.2], release: [0.03, 0.2],
      lfoRate: [0.1, 9], lfoDepth: [0, 0.12],
      envAmount: [0.35, 0.9], filterDecay: [0.05, 0.7], keyTracking: 0.3, drive: 0.55, accent: 0.8, glide: 0.06,
    });
  }
  return mapModel(modelParams, {
    oscillator: 'sawtooth', voiceMode: 'poly',
    oscillator2: { type: 'square', semitones: 0, spread: [3, 22], level: 0.75 },
    detune: [0, 0], pulseWidth: 0.35,
    cutoff: [300, 9000], resonance: [0.4, 7.2],
    attack: [0.01, 0.5], decay: [0.12, 1.05], sustain: [0.35, 0.9], release: [0.22, 2.2],
    lfoRate: [0.08, 5.5], lfoDepth: [0.03, 0.3],
    envAmount: [0.1, 0.55], filterDecay: [0.15, 1.4], keyTracking: 0.5, drive: 0.15, accent: 0.3,
  });
}
