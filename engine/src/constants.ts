/**
 * Audio synthesis constants
 * Extracted from magic numbers throughout codebase for maintainability
 */

/**
 * Master volume and mixing constants
 */
export const AUDIO_MIXING = {
  SYNTH_MASTER_VOLUME: 0.5,
  DRUM_BOOST_FACTOR: 4.0,
  SOFT_CLIP_THRESHOLD: 0.85,
  SOFT_CLIP_FACTOR: 0.15,
  MAX_PCM_VALUE: 32767,
} as const;

/**
 * Drum synthesis parameters
 */
export const DRUM_PARAMS = {
  KICK: {
    START_FREQ_BASE: 72,
    START_FREQ_RANGE: 150,
    END_FREQ_BASE: 34,
    END_FREQ_RANGE: 6,
    DURATION_BASE: 0.1,
    DURATION_RANGE: 0.36,
    BODY_DECAY_FACTOR: 4.4,
    CLICK_DECAY_BASE: 90,
    CLICK_DECAY_RANGE: 40,
    CLICK_AMOUNT_BASE: 0.2,
    CLICK_AMOUNT_RANGE: 0.16,
    DISTORTION_BASE: 1.7,
    DISTORTION_RANGE: 0.8,
    OUTPUT_VOLUME: 0.85,
  },
  SNARE: {
    BODY_START_BASE: 220,
    BODY_START_RANGE: 140,
    BODY_END_BASE: 140,
    BODY_END_RANGE: 70,
    SNAPPY_BASE: 0.35,
    SNAPPY_RANGE: 0.65,
    DURATION: 0.19,
    SWEEP_DURATION: 0.04,
    BODY_DECAY_BASE: 22,
    BODY_DECAY_RANGE: 8,
    NOISE_DECAY_BASE: 12,
    NOISE_DECAY_RANGE: 18,
  },
  HI_HAT_OPEN: {
    DURATION_BASE: 0.2,
    DURATION_RANGE: 0.6,
    BASE_FREQ: 3100,
    BASE_FREQ_RANGE: 3500,
    DECAY_FACTOR: 4.8,
    BRIGHTNESS_BASE: 0.45,
    BRIGHTNESS_RANGE: 0.55,
  },
  HI_HAT_CLOSED: {
    DURATION_BASE: 0.025,
    DURATION_RANGE: 0.12,
    BASE_FREQ: 4200,
    BASE_FREQ_RANGE: 4200,
    DECAY_FACTOR: 11.5,
    BRIGHTNESS_BASE: 0.4,
    BRIGHTNESS_RANGE: 0.6,
  },
  RIDE: {
    BASE_FREQ: 420,
    BASE_FREQ_RANGE: 260,
    DURATION_BASE: 0.9,
    DURATION_RANGE: 1.9,
    BELL_AMOUNT_BASE: 0.08,
    BELL_AMOUNT_RANGE: 0.14,
    SHIMMER_BASE: 0.42,
    SHIMMER_RANGE: 0.32,
    BODY_DECAY: 1.45,
    TAIL_DECAY: 0.72,
    STICK_DECAY: 72,
    BELL_DECAY: 4.2,
    OUTPUT_VOLUME: 0.78,
  },
  CRASH: {
    DURATION_BASE: 0.35,
    DURATION_RANGE: 1.65,
    BASE_FREQ: 1800,
    BASE_FREQ_RANGE: 1900,
    DECAY_FACTOR: 2.4,
    BRIGHTNESS_BASE: 0.35,
    BRIGHTNESS_RANGE: 0.65,
  },
  SNARE2: {
    BODY_START_BASE: 320,
    BODY_START_RANGE: 180,
    BODY_END_BASE: 180,
    BODY_END_RANGE: 80,
    SNAPPY_BASE: 0.45,
    SNAPPY_RANGE: 0.55,
    DURATION: 0.14,
    SWEEP_DURATION: 0.02,
    BODY_DECAY: 30,
    NOISE_DECAY_BASE: 14,
    NOISE_DECAY_RANGE: 16,
  },
  CLAP: {
    DURATION_BASE: 0.17,
    DURATION_RANGE: 0.16,
    BODY_FREQ_BASE: 170,
    BODY_FREQ_RANGE: 130,
    DECAY_BASE: 26,
    DECAY_RANGE: 10,
    ATTACK_TIME: 0.0018,
    BODY_DECAY: 42,
    OUTPUT_VOLUME: 0.82,
  },
} as const;

/**
 * Sequencer timing constants
 */
export const SEQUENCER = {
  DEFAULT_TEMPO: 120,
  MIN_TEMPO: 20,
  MAX_TEMPO: 400,
  DEFAULT_STEPS: 16,
  SCHEDULE_AHEAD_TIME: 0.1, // Schedule audio 100ms ahead
  SCHEDULE_INTERVAL: 25, // Check every 25ms
} as const;

/**
 * Audio context constants
 */
export const AUDIO_CONTEXT = {
  DEFAULT_SAMPLE_RATE: 44100,
  RENDER_SAMPLE_RATE: 48000,
  MAX_INSTANCES: 6, // Browser limit
} as const;

/**
 * WebSocket constants
 */
export const WEBSOCKET = {
  RECONNECT_DELAY: 3000,
  AUDIO_RENDER_THROTTLE: 300,
} as const;

/**
 * Default synthesis parameters
 */
export const DEFAULT_SYNTH_PARAMS = {
  GAIN: 1.0,
  OSCILLATOR: {
    TYPE: 'sine' as const,
    DETUNE: 0,
  },
  FILTER: {
    FREQUENCY: 20000,
    Q: 1,
    TYPE: 'lowpass' as const,
  },
  ENVELOPE: {
    ATTACK: 0.01,
    DECAY: 0.1,
    SUSTAIN: 0.7,
    RELEASE: 0.3,
  },
  EFFECTS: {
    REVERB: {
      ENABLED: false,
      WET: 0.3,
      DECAY: 2,
    },
    DELAY: {
      ENABLED: false,
      WET: 0.3,
      TIME: 0.25,
      FEEDBACK: 0.3,
    },
  },
} as const;
