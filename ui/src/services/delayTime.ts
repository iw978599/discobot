import type { DelaySync, EffectsLoopState } from '../types';

const BEATS: Record<Exclude<DelaySync, 'off'>, number> = { '1/4': 1, '1/8d': 0.75, '1/8': 0.5, '1/8t': 1 / 3, '1/16': 0.25 };

export const DELAY_SYNCS: DelaySync[] = ['off', '1/4', '1/8d', '1/8', '1/8t', '1/16'];
export const DELAY_SYNC_LABELS: Record<DelaySync, string> = {
  off: 'Free', '1/4': '1/4', '1/8d': 'Dotted 1/8', '1/8': '1/8', '1/8t': '1/8 triplet', '1/16': '1/16',
};

// The shared delay's time in seconds: its own setting, or a note value at this tempo.
// Live playback and WAV export both use it, so a synced echo lands the same in each.
export function delaySeconds(delay: EffectsLoopState['delay'], tempo: number): number {
  const beats = delay.sync && delay.sync !== 'off' ? BEATS[delay.sync] : undefined;
  const seconds = beats === undefined || !(tempo > 0) ? delay.time : beats * 60 / tempo;
  return Math.max(0.01, Math.min(2, seconds));
}
