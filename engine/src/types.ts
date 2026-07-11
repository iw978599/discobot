export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface SynthParameters {
  gain: number;
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

export interface DrumSettings {
  volume: number;
  tone: number;
  extra: number;
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

export interface SavedPatternFull {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  steps: SequencerStep[];
  synthParams: SynthParameters;
  tempo: number;
  drumState: DrumState;
  drumMasterVolume?: number;
}
