export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface FxSendLevels {
  reverb: number;
  delay: number;
  drive: number;
  phaser: number;
}

export interface EffectsLoopState {
  enabled: boolean;
  returns: {
    synth: number;
    drums: number;
  };
  drive: {
    enabled: boolean;
    amount: number;
    tone: number;
  };
  phaser: {
    enabled: boolean;
    rate: number;
    depth: number;
    feedback: number;
    mix: number;
  };
  delay: {
    enabled: boolean;
    time: number;
    feedback: number;
    mix: number;
  };
  reverb: {
    enabled: boolean;
    decay: number;
    mix: number;
  };
}

export interface SynthParameters {
  hold: boolean;
  gain: number;
  fxReturn: number;
  pan: number;
  portamento: {
    enabled: boolean;
    glide: number;
  };
  arpeggiator: {
    enabled: boolean;
    mode: 'up' | 'down' | 'updown' | 'downup' | 'random' | 'converge' | 'diverge';
    rate: '1/4' | '1/8' | '1/16' | '1/32';
    gate: number;
  };
  oscillator: {
    type: OscillatorType;
    detune: number;
  };
  lfo1: {
    enabled: boolean;
    target: 'pitch' | 'filter';
    waveform: OscillatorType;
    rate: number;
    depth: number;
  };
  lfo2: {
    enabled: boolean;
    target: 'pitch' | 'filter';
    waveform: OscillatorType;
    rate: number;
    depth: number;
  };
  filter: {
    frequency: number;
    q: number;
    type: BiquadFilterType;
  };
  envelope: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  fxSends: FxSendLevels;
  effects: {
    reverb: {
      enabled: boolean;
      wet: number;
      decay: number;
    };
    delay: {
      enabled: boolean;
      wet: number;
      time: number;
      feedback: number;
    };
  };
}

export type SynthModelId = 'generic' | 'minimoog-model-d' | 'juno-106' | 'dx7' | 'tb-303' | 'prophet-5';

export interface SynthModelParams {
  macro1: number;
  macro2: number;
  macro3: number;
  macro4: number;
}

export interface SequencerStep {
  active: boolean;
  note?: string;
  velocity: number;
}

export interface Pattern {
  id: string;
  name: string;
  steps: SequencerStep[];
  tempo: number;
}

export type DrumInstrument = 'kick' | 'snare' | 'openHH' | 'closedHH' | 'ride' | 'crash' | 'snare2' | 'clap';
export type DrumKitId = 'clean-analog' | 'punchy-modern' | 'lofi-dirty' | 'tr-808' | 'tr-909' | 'linndrum' | 'oberheim-dmx' | 'tr-707';
export type DrumKitModelVariant = 'analog' | 'modern' | 'dirty';

export type CymbalType = 'crash' | 'ride';

export interface DrumSettings {
  volume: number;
  tone: number;
  extra: number;
  tune?: number;
  humanize?: number;
  pan?: number;
  cymbalType?: CymbalType;
}

export type DrumInstrumentDefaults = Record<DrumInstrument, DrumSettings>;

export interface DrumKitMetadata {
  id: DrumKitId;
  name: string;
  description: string;
  modelVariant: DrumKitModelVariant;
}

export interface DrumKitDefinition extends DrumKitMetadata {
  instrumentDefaults: DrumInstrumentDefaults;
}

export interface DrumKitSelectionState {
  selectedKitId: DrumKitId;
}

export interface DrumTrack {
  steps: boolean[];
  settings: DrumSettings;
  muted?: boolean;
  solo?: boolean;
}

export type DrumState = Record<DrumInstrument, DrumTrack>;

export interface Sample {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  url?: string;
}

export interface AudioExportOptions {
  format: 'wav' | 'mp3';
  duration: number;
  pattern?: Pattern;
}

/**
 * UI-specific types for pattern persistence
 */
export interface SavedPatternInfo {
  id: string;
  name: string;
  updatedAt: number;
}

export interface SavedSynthData {
  id: number;
  steps: SequencerStep[];
  synthParams: SynthParameters;
  synthModelId?: SynthModelId;
  synthModelParams?: SynthModelParams;
}

export interface SavedPatternFull {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  steps: SequencerStep[];
  synthParams: SynthParameters;
  synthModelId?: SynthModelId;
  synthModelParams?: SynthModelParams;
  tempo: number;
  drumState: DrumState;
  drumMasterVolume?: number;
  drumKitId?: DrumKitId;
  drumFx?: {
    sends: FxSendLevels;
    returnLevel: number;
  };
  effectsLoop?: EffectsLoopState;
  synths?: SavedSynthData[];
}
