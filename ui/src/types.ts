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
}

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface SynthParameters {
  oscillator: {
    type: OscillatorType;
    detune: number;
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
