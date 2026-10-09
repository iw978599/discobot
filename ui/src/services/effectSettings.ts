import type { EffectsLoopState } from '../types';

// The effects added after the first four are optional in a project, so one saved before
// they existed loads unchanged. These are what the controls show until they are touched.
export const CHORUS_DEFAULT: NonNullable<EffectsLoopState['chorus']> = { enabled: false, rate: 0.6, depth: 0.5, mix: 0.6 };
export const EQ_DEFAULT: NonNullable<EffectsLoopState['eq']> = { enabled: false, low: 0, mid: 0, high: 0 };
export const EQ_RANGE_DB = 12;
export const MAX_PRE_DELAY = 0.25;

// What a new project starts with. Older projects keep the plain reverb they were made with.
export const NEW_PROJECT_REVERB = { preDelay: 0.02, damping: 0.35 };
