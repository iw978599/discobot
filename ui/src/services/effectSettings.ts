import type { EffectsLoopState, FxSendLevels } from '../types';

// The effects added after the first four are optional in a project, so one saved before
// they existed loads unchanged. These are what the controls show until they are touched.
// `sync` is not in the default: absent is off.
// The first four effects and the drums' sends as a project starts with them.
export const EFFECTS_DEFAULT: EffectsLoopState = {
  enabled: true,
  returns: { synth: 0.85, drums: 0.7 },
  drive: { enabled: true, amount: 0.18, tone: 0.65 },
  phaser: { enabled: false, rate: 0.45, depth: 0.45, feedback: 0.25, mix: 0.25 },
  delay: { enabled: true, time: 0.22, feedback: 0.35, mix: 0.3 },
  reverb: { enabled: true, decay: 2.1, mix: 0.38 },
};
export const DRUM_FX_DEFAULT: { sends: FxSendLevels; returnLevel: number } = {
  sends: { reverb: 0.35, delay: 0.15, drive: 0.2, phaser: 0.1, chorus: 0 },
  returnLevel: 0.7,
};
export const CHORUS_DEFAULT: NonNullable<EffectsLoopState['chorus']> = { enabled: false, rate: 0.6, depth: 0.5, mix: 0.6 };
export const EQ_DEFAULT: NonNullable<EffectsLoopState['eq']> = { enabled: false, low: 0, mid: 0, high: 0 };
export const EQ_RANGE_DB = 12;
export const MAX_PRE_DELAY = 0.25;

// What a new project starts with. Older projects keep the plain reverb they were made with.
export const NEW_PROJECT_REVERB = { preDelay: 0.02, damping: 0.35 };
