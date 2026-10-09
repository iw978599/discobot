import type { DrumTrack } from '../types';

export const MAX_RATCHET = 4;

// Deterministic generator for exports, so the same arrangement always renders the same file.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The hits one drum step plays this time round, as offsets in fractions of a step.
// Empty when the step is off, silent, or loses its probability roll. Live playback,
// WAV export and MIDI export all call this.
export function expandDrumStep(track: DrumTrack, step: number, random: () => number = Math.random): number[] {
  if (!track.steps[step] || (track.stepVelocities?.[step] ?? 1) <= 0) return [];
  const probability = track.stepProbabilities?.[step] ?? 1;
  if (probability < 1 && random() >= probability) return [];
  const repeats = Math.max(1, Math.min(MAX_RATCHET, Math.round(track.stepRatchets?.[step] ?? 1)));
  return Array.from({ length: repeats }, (_, index) => index / repeats);
}
