import type { EffectsLoopState } from '../types';

// Starting points for the shared delay and reverb. Choosing one sets every setting of that effect
// and switches it on, as one change. Free and Room are spelled out ('off', 'room') because the
// store's merge would keep a sync or a kind that was merely left out.
export interface EffectPreset<T> { name: string; title: string; settings: T }

type Delay = EffectsLoopState['delay'];
type Reverb = EffectsLoopState['reverb'];

export const DELAY_PRESETS: Array<EffectPreset<Omit<Delay, 'enabled'>>> = [
  { name: 'Slapback', title: 'One quick repeat, as on a rockabilly vocal', settings: { time: 0.11, feedback: 0.05, mix: 0.3, sync: 'off' } },
  { name: 'Dub delay', title: 'A dotted eighth that follows the tempo and keeps coming back', settings: { time: 0.375, feedback: 0.62, mix: 0.35, sync: '1/8d' } },
  { name: 'Quarter echo', title: 'A repeat on every beat, dying away over a bar or two', settings: { time: 0.5, feedback: 0.4, mix: 0.25, sync: '1/4' } },
];

export const REVERB_PRESETS: Array<EffectPreset<Omit<Reverb, 'enabled'>>> = [
  { name: 'Small room', title: 'A short, close room', settings: { kind: 'room', decay: 0.8, mix: 0.22, preDelay: 0.005, damping: 0.4 } },
  { name: 'Long hall', title: 'A large, smooth hall with a moment before it starts', settings: { kind: 'hall', decay: 4, mix: 0.32, preDelay: 0.03, damping: 0.3 } },
];
