import type { DrumInstrument, DrumState, Pattern } from '../types';
import { laneBars } from './patternLength';
import { withStepNotes } from './noteScheduling';

// Something to change, offered on a project with nothing in it: a tempo, a bar of drums and a
// bar of bass for Synth 1. Steps are sixteenths of one bar, counted from 0. The notes stay in
// the octave the piano roll shows first, so the bass line can be seen where it is edited.
export interface Starter {
  id: string;
  name: string;
  hint: string;
  tempo: number;
  drums: Partial<Record<DrumInstrument, number[]>>;
  bass: Array<{ step: number; note: string; length?: number }>;
}

export const STARTERS: Starter[] = [
  {
    id: 'house',
    name: 'House Beat',
    hint: 'Four kicks to the bar, claps, hats between the beats and a bass note off each beat, at 124 BPM',
    tempo: 124,
    drums: { kick: [0, 4, 8, 12], clap: [4, 12], closedHH: [0, 4, 8, 12], openHH: [2, 6, 10, 14] },
    bass: [{ step: 2, note: 'C3' }, { step: 6, note: 'C3' }, { step: 10, note: 'C3' }, { step: 14, note: 'D#3' }],
  },
  {
    id: 'slow',
    name: 'Slow Groove',
    hint: 'A laid-back kick and snare with steady hats and a bass line that moves, at 88 BPM',
    tempo: 88,
    drums: { kick: [0, 7, 10], snare: [4, 12], closedHH: [0, 2, 4, 6, 8, 10, 12, 14] },
    bass: [{ step: 0, note: 'E3', length: 3 }, { step: 7, note: 'G3' }, { step: 10, note: 'A3', length: 2 }, { step: 14, note: 'G3' }],
  },
  {
    id: 'electro',
    name: 'Electro',
    hint: 'A broken kick, a snare on two and four, quick hats and a bass that follows the kick, at 110 BPM',
    tempo: 110,
    drums: { kick: [0, 3, 6, 10], snare: [4, 12], closedHH: [0, 2, 4, 6, 8, 10, 12, 14], openHH: [15] },
    bass: [{ step: 0, note: 'D3' }, { step: 3, note: 'D3' }, { step: 6, note: 'F3' }, { step: 10, note: 'D3' }, { step: 14, note: 'C3' }],
  },
];

// Nothing has been put in yet: one scene, no note on any lane and no drum hit.
export function projectIsEmpty(patterns: Array<Pattern | null | undefined>, drums: DrumState, sceneCount: number): boolean {
  return sceneCount <= 1
    && patterns.every(pattern => !pattern || pattern.steps.every(step => !step.active))
    && Object.values(drums).every(track => !track.steps.some(Boolean));
}

// The lane's pattern with the bass line in every bar, whatever its length and step size.
export function starterPattern(starter: Starter, pattern: Pattern): Pattern {
  const bars = laneBars(pattern.steps.length, pattern.bars);
  const perBar = pattern.steps.length / bars;
  const scale = perBar === 32 ? 2 : 1;
  const steps = pattern.steps.map(step => withStepNotes(step, []));
  for (let bar = 0; bar < bars; bar += 1) {
    for (const entry of starter.bass) {
      const at = bar * perBar + entry.step * scale;
      if (at >= steps.length) continue;
      const length = (entry.length ?? 1) * scale;
      steps[at] = { ...withStepNotes(steps[at], [entry.note]), ...(length > 1 ? { length } : {}) };
    }
  }
  return { ...pattern, steps };
}

// The drum grid with the starter's hits in every bar. Sounds, levels and mutes are left alone.
export function starterDrums(starter: Starter, drums: DrumState): DrumState {
  const next = {} as DrumState;
  for (const instrument of Object.keys(drums) as DrumInstrument[]) {
    const hits = starter.drums[instrument] ?? [];
    next[instrument] = { ...drums[instrument], steps: drums[instrument].steps.map((_, step) => hits.includes(step % 16)) };
  }
  return next;
}
