export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface FxSendLevels {
  reverb: number;
  delay: number;
  drive: number;
  phaser: number;
  chorus?: number;
}

// A rate that follows the tempo: once every so many bars, or once every note of this length.
export type RateSync = 'off' | '8bar' | '4bar' | '2bar' | '1bar' | '1/2' | '1/4' | '1/8' | '1/16';
export const RATE_SYNCS: RateSync[] = ['off', '8bar', '4bar', '2bar', '1bar', '1/2', '1/4', '1/8', '1/16'];

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
    // follow the tempo instead of `rate`; absent means off, as before it existed
    sync?: RateSync;
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
    // follow the tempo instead of `rate`; absent means off
    sync?: RateSync;
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
// Something that moves, and something it can move. A route sends one to the other by an amount.
export type ModSource = 'lfo1' | 'lfo2' | 'ampEnv' | 'filterEnv' | 'velocity' | 'key' | 'random';
export type ModDestination = 'pitch' | 'osc2Pitch' | 'filter' | 'amp' | 'pulseWidth' | 'pan' | 'fmIndex';
export interface ModRoute {
  source: ModSource;
  destination: ModDestination;
  // -1 to 1. At 1 a source swings the pitch an octave, the second oscillator three octaves,
  // the filter four octaves, the level from nothing to full, the pan from side to side.
  depth: number;
}
export const MAX_MOD_ROUTES = 4;
export const MOD_SOURCES: ModSource[] = ['lfo1', 'lfo2', 'ampEnv', 'filterEnv', 'velocity', 'key', 'random'];
export const MOD_DESTINATIONS: ModDestination[] = ['pitch', 'osc2Pitch', 'filter', 'amp', 'pulseWidth', 'pan', 'fmIndex'];

export type FilterModel = 'svf' | 'ladder' | 'ms20';
export type SynthEngineMode = 'subtractive' | 'fm' | 'sample';
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
    // hard sync: the second oscillator starts its wave again each time the first does, so it
    // takes the first one's pitch and its own tuning becomes its tone. Absent means off.
    sync?: boolean;
  };
  mixer?: {
    sub: number;
    noise: number;
    // how loud the first oscillator is, 0 to 1. Absent means 1, as it always was before it
    // could be turned down; at 0 a sound can be made of noise, the sub or the second oscillator alone.
    osc?: number;
    // ring modulation: how much of the two oscillators multiplied together is in the sound,
    // 0 to 1. Absent means none. It needs the second oscillator switched on.
    ring?: number;
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
    // how loud the copies either side of the middle one are, 0 to 1. Absent means 1: all alike,
    // as they always were. It only does anything with an odd number of copies, which has a middle.
    mix?: number;
  };
  // the imported sample a lane set to the sample engine plays in place of its oscillators.
  // Absent, or with no id, means none, and the lane plays its oscillators. The audio itself is
  // in this browser's sample store, as a drum lane's is.
  sample?: {
    id?: string;
    // the MIDI note at which the sample plays at the pitch it was recorded, 0 to 127
    root: number;
    // go round again from the start while the note is held, instead of playing once
    loop: boolean;
    // one of the sounds that come with the app, by name, played instead of an imported sample.
    // Absent means none. A name this copy of the app does not have plays the oscillators.
    wave?: string;
    // for a built-in sound that is a sequence of waves: how many it steps through a second,
    // and how much of each step is spent crossfading into the next, 0 (none) to 1 (all of it)
    scan?: number;
    fade?: number;
    // step through the sequence in time with the tempo instead of at `scan`; absent means off
    sync?: RateSync;
  };
  // a second layer on every note: the same sound again, tuned, filtered, faded in and placed
  // differently. Absent or not enabled means one layer, as there always was. Two layers take
  // two voices a note, so half as many notes can sound at once.
  layer?: {
    enabled: boolean;
    // the balance between the two, 0 (the first alone) to 1 (the second alone)
    mix: number;
    // the second layer's tuning against the first, in cents
    detune: number;
    // the second layer's filter against the first's, in octaves
    brightness: number;
    // seconds added to the second layer's attack, so it swells in under the first
    attack: number;
    // how far apart the two are placed, 0 (together) to 1 (one each side)
    width: number;
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
  // further routes from a source to a destination, on top of where each LFO is already sent.
  // Absent or empty means none, as there were none before routes existed. At most MAX_MOD_ROUTES.
  modMatrix?: ModRoute[];
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
    // which filter the low-pass is: 'svf', the clean state-variable one every sound had before
    // there was a choice; 'ladder', a four-pole ladder; or 'ms20', a two-pole whose resonance
    // distorts. Absent means 'svf'. A ladder is always four poles and an 'ms20' always two, and
    // both are low-passes only: any other type uses the state-variable filter.
    model?: FilterModel;
    // the cutoff in Hz of a high-pass the sound goes through before the filter above. Absent or
    // under 20 means there is none, as there was not before it existed.
    highpass?: number;
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

export type SynthModelId = 'generic' | 'minimoog-model-d' | 'juno-106' | 'dx7' | 'tb-303' | 'prophet-5' | 'sh-101' | 'pro-one' | 'jupiter-8' | 'ob-xa' | 'jp-8000' | 'mono-poly' | 'polysix' | 'ms-20' | 'odyssey' | 'virus' | 'cs-80' | 'm1' | 'd-50' | 'wavestation';

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
  // how many steps each note lasts, lowest note first, where the notes of a chord differ. Absent
  // means every note lasts `length`, as they all did before a note could have its own. `length`
  // is then the longest of them, so anything that only knows `length` still gets the step's extent.
  lengths?: number[];
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

export type CymbalType = 'crash' | 'ride' | 'bell' | 'splash';
export const CYMBAL_TYPES: CymbalType[] = ['crash', 'ride', 'bell', 'splash'];

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
  // the name of the colour the scene is marked with in the scene strip and the song. Absent
  // means none, as every scene was before scenes had colours.
  color?: string;
  // steps per synth lane id; a missing lane is silent in this scene
  lanes: Record<number, SequencerStep[]>;
  drums: Record<DrumInstrument, DrumLanePattern>;
  // bars per synth lane id, for lanes longer than one bar
  laneBars?: Record<number, number>;
  // each guest instrument's settings in this scene, by guest id. Opaque to Discobot.
  guests?: Record<string, unknown>;
  // each guest's level and mute in this scene, by guest id
  guestMix?: Record<string, { volume: number; muted: boolean }>;
  // which synth lanes and drum lanes are muted or soloed in this scene. A scene saved before
  // mutes were kept per scene has none, and plays with whatever the project has at the time.
  mutes?: SceneMutes;
}

export interface MuteFlags { muted: boolean; solo: boolean }
export interface SceneMutes {
  lanes?: Record<number, MuteFlags>;
  drums?: Partial<Record<DrumInstrument, MuteFlags>>;
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
