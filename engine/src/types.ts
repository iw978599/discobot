export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface FxSendLevels {
  reverb: number;
  delay: number;
  drive: number;
  phaser: number;
  chorus?: number;
}

export type DelaySync = 'off' | '1/4' | '1/8d' | '1/8' | '1/8t' | '1/16';

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
    // a note value that sets the time from the tempo; absent or 'off' uses `time`
    sync?: DelaySync;
  };
  reverb: {
    enabled: boolean;
    decay: number;
    mix: number;
    // seconds of silence before the tail, and how fast its highs die away (0 to 1).
    // Both absent or zero is the plain reverb older projects were made with.
    preDelay?: number;
    damping?: number;
  };
  // Absent means off, so older projects still match the expected shape.
  chorus?: {
    enabled: boolean;
    rate: number;
    depth: number;
    mix: number;
  };
  // Three bands on the whole mix, in decibels.
  eq?: {
    enabled: boolean;
    low: number;
    mid: number;
    high: number;
  };
}

// 'pitch' is up to an octave either way; 'vibrato' is the same movement scaled to one semitone.
export type LfoTarget = 'pitch' | 'filter' | 'amp' | 'pulseWidth' | 'vibrato';
export type SynthEngineMode = 'subtractive' | 'fm';
export type SynthVoiceMode = 'poly' | 'mono';

export interface SynthLfo {
  enabled: boolean;
  target: LfoTarget;
  waveform: OscillatorType;
  rate: number;
  depth: number;
  sync?: boolean;
  // false keeps one free-running LFO for the lane instead of restarting it on every note
  retrigger?: boolean;
}

export interface SynthEnvelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface SynthParameters {
  hold: boolean;
  gain: number;
  fxReturn: number;
  pan: number;
  spread?: number;
  engine?: SynthEngineMode;
  voiceMode?: SynthVoiceMode;
  oscillator2?: {
    enabled: boolean;
    type: OscillatorType;
    semitones: number;
    detune: number;
    level: number;
  };
  mixer?: {
    sub: number;
    noise: number;
  };
  filterEnvelope?: SynthEnvelope;
  velocity?: {
    amp: number;
    filter: number;
  };
  // several detuned copies of the oscillators per note; 1 voice is off
  unison?: {
    voices: number;
    detune: number;
  };
  // how far a kick drum pulls this lane's level down, 0 to 1
  duck?: number;
  fm?: {
    algorithm: number;
    ratio: number;
    index: number;
    decay: number;
    feedback: number;
  };
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
    pulseWidth?: number;
  };
  lfo1: SynthLfo;
  lfo2: SynthLfo;
  filter: {
    frequency: number;
    q: number;
    type: BiquadFilterType;
    // signed filter-envelope depth, where 1 sweeps the cutoff up five octaves
    envAmount?: number;
    keyTracking?: number;
    drive?: number;
    // 12 or 24 dB per octave; 24 applies to low-pass, high-pass and band-pass
    slope?: number;
  };
  envelope: SynthEnvelope;
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
  // hold this note into the next step so a mono lane glides instead of retriggering
  slide?: boolean;
  // further notes sounding with `note`, making the step a chord
  notes?: string[];
  // how many steps the notes last; absent means one
  length?: number;
  // how often the step plays, 0 to 1; absent means always
  probability?: number;
  // hits packed evenly into the step's length; absent means one
  ratchet?: number;
  // how late the step starts, as a fraction of a step (0 to under 1); absent means on the step
  offset?: number;
}

export interface Pattern {
  id: string;
  name: string;
  steps: SequencerStep[];
  tempo: number;
  // how many bars the steps cover: 1, 2, 4 or 8. Absent means one.
  bars?: number;
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
  stepVelocities?: number[];
  // chance from 0 to 1 that a step plays each time round; missing means always
  stepProbabilities?: number[];
  // hits packed evenly into one step, 1 to 4; missing means one
  stepRatchets?: number[];
  settings: DrumSettings;
  muted?: boolean;
  solo?: boolean;
  // an imported sample this lane plays instead of its synthesized voice
  sampleId?: string;
}

export type DrumState = Record<DrumInstrument, DrumTrack>;

// The step data of one drum lane, without the kit's sound settings.
export interface DrumLanePattern {
  steps: boolean[];
  stepVelocities?: number[];
  stepProbabilities?: number[];
  stepRatchets?: number[];
}

// One bar of the whole arrangement: every synth lane's notes and the drum grid. Sounds,
// tempo and effects are not part of a scene; they belong to the project.
export interface Scene {
  id: string;
  name: string;
  // steps per synth lane id; a missing lane is silent in this scene
  lanes: Record<number, SequencerStep[]>;
  drums: Record<DrumInstrument, DrumLanePattern>;
  // bars per synth lane id, for lanes longer than one bar
  laneBars?: Record<number, number>;
  // each guest instrument's settings in this scene, by guest id. Opaque to Discobot.
  guests?: Record<string, unknown>;
  // each guest's level and mute in this scene, by guest id
  guestMix?: Record<string, { volume: number; muted: boolean }>;
}

// The order scenes play in when the transport is in song mode.
export interface Song {
  entries: Array<{ sceneId: string; repeats: number }>;
  loop: boolean;
}

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
  muted?: boolean;
  solo?: boolean;
  octaveShift?: number;
  keyboardMode?: 'keyboard' | 'piano-roll';
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
  drumSwing?: number;
  scenes?: Scene[];
  song?: Song;
  currentSceneId?: string;
}
