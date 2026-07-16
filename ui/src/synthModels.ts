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
    subtitle: 'Mono ladder-style lead/bass',
    macros: [
      { key: 'macro1', label: 'Drive' },
      { key: 'macro2', label: 'Ladder' },
      { key: 'macro3', label: 'Glide' },
      { key: 'macro4', label: 'Contour' },
    ],
  },
  {
    id: 'juno-106',
    name: 'Juno-106',
    subtitle: 'Poly analog chorus',
    macros: [
      { key: 'macro1', label: 'Sub' },
      { key: 'macro2', label: 'Chorus' },
      { key: 'macro3', label: 'LFO' },
      { key: 'macro4', label: 'Warmth' },
    ],
  },
  {
    id: 'dx7',
    name: 'DX7',
    subtitle: 'FM macro voice',
    macros: [
      { key: 'macro1', label: 'Ratio' },
      { key: 'macro2', label: 'Index' },
      { key: 'macro3', label: 'Bright' },
      { key: 'macro4', label: 'Pluck' },
    ],
  },
  {
    id: 'tb-303',
    name: 'TB-303',
    subtitle: 'Acid bassline',
    macros: [
      { key: 'macro1', label: 'Accent' },
      { key: 'macro2', label: 'Reso' },
      { key: 'macro3', label: 'Env Mod' },
      { key: 'macro4', label: 'Decay' },
    ],
  },
  {
    id: 'prophet-5',
    name: 'Prophet-5',
    subtitle: 'Classic analog poly',
    macros: [
      { key: 'macro1', label: 'Spread' },
      { key: 'macro2', label: 'Brass' },
      { key: 'macro3', label: 'Slop' },
      { key: 'macro4', label: 'Release' },
    ],
  },
];

export const DEFAULT_SYNTH_MODEL_ID: SynthModelId = 'generic';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

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

function mapModel(
  params: SynthModelParams,
  config: {
    oscillator: SynthParameters['oscillator']['type'];
    detune: [number, number];
    cutoff: [number, number];
    resonance: [number, number];
    attack: [number, number];
    decay: [number, number];
    sustain: [number, number];
    release: [number, number];
    lfoRate: [number, number];
    lfoDepth: [number, number];
  }
): Partial<SynthParameters> {
  return {
    oscillator: {
      type: config.oscillator,
      detune: Math.round(range(config.detune[0], config.detune[1], params.macro1)),
    },
    filter: {
      type: 'lowpass',
      frequency: Math.round(range(config.cutoff[0], config.cutoff[1], params.macro3)),
      q: Number(range(config.resonance[0], config.resonance[1], params.macro2).toFixed(2)),
    },
    envelope: {
      attack: Number(range(config.attack[0], config.attack[1], 1 - params.macro4).toFixed(3)),
      decay: Number(range(config.decay[0], config.decay[1], params.macro4).toFixed(3)),
      sustain: Number(range(config.sustain[0], config.sustain[1], 1 - params.macro2).toFixed(2)),
      release: Number(range(config.release[0], config.release[1], params.macro4).toFixed(3)),
    },
    lfo1: {
      enabled: params.macro3 > 0.12,
      target: 'filter',
      waveform: 'triangle',
      rate: Number(range(config.lfoRate[0], config.lfoRate[1], params.macro3).toFixed(2)),
      depth: Number(range(config.lfoDepth[0], config.lfoDepth[1], params.macro2).toFixed(2)),
    },
  };
}

export function mapSynthModelToEngineParams(modelId: SynthModelId, modelParams: SynthModelParams): Partial<SynthParameters> {
  if (modelId === 'generic') return {};
  if (modelId === 'minimoog-model-d') {
    return mapModel(modelParams, {
      oscillator: 'sawtooth',
      detune: [-24, 14],
      cutoff: [180, 8000],
      resonance: [0.9, 11],
      attack: [0.002, 0.08],
      decay: [0.03, 0.52],
      sustain: [0.18, 0.86],
      release: [0.04, 0.45],
      lfoRate: [0.1, 7.5],
      lfoDepth: [0.02, 0.42],
    });
  }
  if (modelId === 'juno-106') {
    return mapModel(modelParams, {
      oscillator: 'triangle',
      detune: [-8, 8],
      cutoff: [500, 14500],
      resonance: [0.2, 5.2],
      attack: [0.01, 0.6],
      decay: [0.1, 1.4],
      sustain: [0.48, 0.96],
      release: [0.2, 1.8],
      lfoRate: [0.2, 8],
      lfoDepth: [0.03, 0.6],
    });
  }
  if (modelId === 'dx7') {
    return mapModel(modelParams, {
      oscillator: 'sine',
      detune: [-2, 16],
      cutoff: [1800, 18000],
      resonance: [0.1, 3],
      attack: [0.002, 0.09],
      decay: [0.05, 0.55],
      sustain: [0.2, 0.74],
      release: [0.1, 1.4],
      lfoRate: [0.3, 14],
      lfoDepth: [0.08, 0.9],
    });
  }
  if (modelId === 'tb-303') {
    return mapModel(modelParams, {
      oscillator: modelParams.macro1 > 0.5 ? 'sawtooth' : 'square',
      detune: [-16, 7],
      cutoff: [120, 6100],
      resonance: [1.8, 18],
      attack: [0.001, 0.02],
      decay: [0.05, 0.72],
      sustain: [0.02, 0.3],
      release: [0.04, 0.3],
      lfoRate: [0.1, 9],
      lfoDepth: [0.02, 0.34],
    });
  }
  return mapModel(modelParams, {
    oscillator: 'square',
    detune: [-11, 11],
    cutoff: [400, 11000],
    resonance: [0.4, 7.2],
    attack: [0.01, 0.5],
    decay: [0.12, 1.05],
    sustain: [0.35, 0.9],
    release: [0.22, 2.2],
    lfoRate: [0.08, 5.5],
    lfoDepth: [0.03, 0.35],
  });
}
