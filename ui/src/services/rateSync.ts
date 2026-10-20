import { RATE_SYNCS, syncedRateHz, type RateSync } from '@discobot/engine';

export { RATE_SYNCS };
export const RATE_SYNC_LABELS: Record<RateSync, string> = {
  off: 'Free', '8bar': '8 bars', '4bar': '4 bars', '2bar': '2 bars', '1bar': '1 bar', '1/2': '1/2',
  '1/4d': 'Dotted 1/4', '1/4': '1/4', '1/4t': '1/4 triplet', '1/8d': 'Dotted 1/8', '1/8': '1/8', '1/8t': '1/8 triplet', '1/16': '1/16', '1/16t': '1/16 triplet',
};

// A stored sync, or undefined for anything that is not one. Off is stored as nothing at all.
export function storedRateSync(value: unknown): Exclude<RateSync, 'off'> | undefined {
  return value !== 'off' && RATE_SYNCS.includes(value as RateSync) ? value as Exclude<RateSync, 'off'> : undefined;
}

// An effect's rate in cycles a second: its own, or once each note value at this tempo. Live
// playback and WAV export both use it, so a synced sweep is in the same place in each.
export function rateHz(setting: { rate: number; sync?: RateSync } | undefined, tempo: number, fallback = 1): number {
  return syncedRateHz(setting?.sync, tempo) ?? setting?.rate ?? fallback;
}
