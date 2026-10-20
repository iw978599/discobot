import type { EffectsLoopState } from '../types';

// Starting points for the shared effects. Choosing one sets every setting of that effect and switches
// it on, as one change. What a setting is when it is off is spelled out ('off', 'room', 'classic', a
// colour and wow of 0) because the store's merge would keep a value that was merely left out.
//
// Some are clones: the app's own effect set up to behave like a well-known unit, the way a synth
// model is, and named "… style" for that reason (the owner chose the units on 2026-10-19; what each
// is finally called is still the owner's). They are the app's effects, not those units' circuits.
export interface EffectPreset<T> { name: string; title: string; settings: T }

type Delay = EffectsLoopState['delay'];
type Reverb = EffectsLoopState['reverb'];
type Chorus = NonNullable<EffectsLoopState['chorus']>;
type Phaser = EffectsLoopState['phaser'];
// The drive's kind as a menu sends it: 'classic' is its own smooth curve, stored as nothing.
type Drive = Omit<EffectsLoopState['drive'], 'enabled' | 'kind'> & { kind: NonNullable<EffectsLoopState['drive']['kind']> | 'classic' };

export const DELAY_PRESETS: Array<EffectPreset<Omit<Delay, 'enabled'>>> = [
  { name: 'Slapback', title: 'One quick repeat, as on a rockabilly vocal', settings: { time: 0.11, feedback: 0.05, mix: 0.3, sync: 'off', color: 0, wow: 0 } },
  { name: 'Dub delay', title: 'A dotted eighth that follows the tempo and keeps coming back', settings: { time: 0.375, feedback: 0.62, mix: 0.35, sync: '1/8d', color: 0, wow: 0 } },
  { name: 'Quarter echo', title: 'A repeat on every beat, dying away over a bar or two', settings: { time: 0.5, feedback: 0.4, mix: 0.25, sync: '1/4', color: 0, wow: 0 } },
  { name: 'Space Echo style', title: 'A tape echo after the Roland Space Echo: each repeat darker than the last, and the time wavering as worn tape does', settings: { time: 0.32, feedback: 0.55, mix: 0.35, sync: 'off', color: 0.55, wow: 0.45 } },
  { name: 'Memory Man style', title: 'An analogue delay after the Electro-Harmonix Memory Man: warm, dark repeats with a slight shimmer', settings: { time: 0.38, feedback: 0.5, mix: 0.3, sync: 'off', color: 0.7, wow: 0.15 } },
];

export const REVERB_PRESETS: Array<EffectPreset<Omit<Reverb, 'enabled'>>> = [
  { name: 'Small room', title: 'A short, close room', settings: { kind: 'room', decay: 0.8, mix: 0.22, preDelay: 0.005, damping: 0.4 } },
  { name: 'Long hall', title: 'A large, smooth hall with a moment before it starts', settings: { kind: 'hall', decay: 4, mix: 0.32, preDelay: 0.03, damping: 0.3 } },
  { name: 'Spring style', title: 'The drip of a guitar amplifier\'s spring tank: short, dark and boingy', settings: { kind: 'spring', decay: 2, mix: 0.3, preDelay: 0, damping: 0.35 } },
  { name: 'Plate', title: 'A bright, dense plate that starts at once, as a studio plate reverb does', settings: { kind: 'room', decay: 2.2, mix: 0.3, preDelay: 0, damping: 0 } },
];

export const CHORUS_PRESETS: Array<EffectPreset<Omit<Chorus, 'enabled'>>> = [
  { name: 'Juno I style', title: 'The Roland Juno\'s first chorus: a slow, gentle sweep', settings: { rate: 0.5, depth: 0.4, mix: 0.5, sync: 'off' } },
  { name: 'Juno II style', title: 'The Juno\'s second chorus: quicker and deeper, the classic thick pad', settings: { rate: 0.83, depth: 0.55, mix: 0.5, sync: 'off' } },
  { name: 'Dimension style', title: 'After the Roland Dimension D: very slow and shallow, a widening more than a wobble', settings: { rate: 0.25, depth: 0.2, mix: 0.45, sync: 'off' } },
];

export const PHASER_PRESETS: Array<EffectPreset<Omit<Phaser, 'enabled'>>> = [
  { name: 'Small Stone style', title: 'After the Electro-Harmonix Small Stone: a deep, slow sweep with its colour turned up', settings: { rate: 0.5, depth: 0.85, feedback: 0.6, mix: 0.6, sync: 'off' } },
  { name: 'Phase 90 style', title: 'After the MXR Phase 90: a quicker, gentler swirl with little feedback', settings: { rate: 0.7, depth: 0.65, feedback: 0.25, mix: 0.5, sync: 'off' } },
];

export const DRIVE_PRESETS: Array<EffectPreset<Drive>> = [
  { name: 'Tube Screamer style', title: 'An overdrive after the Ibanez Tube Screamer: soft, warm clipping with the lows held back', settings: { kind: 'overdrive', amount: 0.45, tone: 0.55 } },
  { name: 'RAT style', title: 'A distortion after the ProCo RAT: hard clipping, gritty and bright', settings: { kind: 'distortion', amount: 0.7, tone: 0.45 } },
  { name: 'Big Muff style', title: 'A fuzz after the Electro-Harmonix Big Muff: the most clipping of all, thick and sustaining', settings: { kind: 'fuzz', amount: 0.8, tone: 0.35 } },
];
