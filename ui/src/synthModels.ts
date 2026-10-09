import { SynthModelId, SynthModelParams, SynthParameters } from './types';

type MacroKey = keyof SynthModelParams;

interface MacroDescriptor {
  key: MacroKey;
  label: string;
}

interface SynthModelDefinition {
  id: SynthModelId;
  name: string;
  subtitle: string;
  macros: MacroDescriptor[];
}

export const SYNTH_MODELS: SynthModelDefinition[] = [
  { id: 'generic', name: 'Generic', subtitle: 'Default engine controls', macros: [] },
  {
    id: 'minimoog-model-d',
    name: 'Minimoog Model D',
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
    subtitle: 'Mono acid bass: accent on loud steps, slide on tied steps',
    macros: [
      { key: 'macro1', label: 'Wave / Tune' },
      { key: 'macro2', label: 'Reso' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Decay' },
    ],
  },
  {
    id: 'prophet-5',
    name: 'Prophet-5',
    subtitle: 'Poly saw + pulse with filter envelope',
    macros: [
      { key: 'macro1', label: 'Detune' },
      { key: 'macro2', label: 'Resonance' },
      { key: 'macro3', label: 'Brightness' },
      { key: 'macro4', label: 'Contour' },
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
    },
    mixer: { sub: voicing.sub ?? 0, noise: voicing.noise ?? 0 },
    filter: {
      type: 'lowpass',
      frequency: Math.round(range(voicing.cutoff[0], voicing.cutoff[1], params.macro3)),
      q: Number(range(voicing.resonance[0], voicing.resonance[1], params.macro2).toFixed(2)),
      envAmount: Number(range(voicing.envAmount[0], voicing.envAmount[1], params.macro4).toFixed(2)),
      keyTracking: voicing.keyTracking,
      drive: voicing.drive,
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

export function mapSynthModelToEngineParams(modelId: SynthModelId, modelParams: SynthModelParams): Partial<SynthParameters> {
  if (modelId === 'generic') return {};
  if (modelId === 'dx7') return mapFmModel(modelParams);
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
