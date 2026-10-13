import type { DrumInstrument, DrumState, Pattern } from '../types';
import { barSteps, laneBars } from './patternLength';
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
  // How hard a hit is played, by drum and step, where it is not full: the quiet hats between the
  // loud ones and the ghost notes are what make a beat move.
  velocities?: Partial<Record<DrumInstrument, Record<number, number>>>;
  bass: Array<{ step: number; note: string; length?: number; velocity?: number; slide?: boolean }>;
}

const quiet = (steps: number[], velocity: number) => Object.fromEntries(steps.map(step => [step, velocity]));

export const STARTERS: Starter[] = [
  {
    id: 'house',
    name: 'House Beat',
    hint: 'Four kicks to the bar, claps, open hats between the beats over quiet closed ones, and a bass note off each beat, at 124 BPM',
    tempo: 124,
    drums: { kick: [0, 4, 8, 12], clap: [4, 12], closedHH: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], openHH: [2, 6, 10, 14], snare: [15] },
    velocities: { closedHH: { ...quiet([0, 4, 8, 12], 0.6), ...quiet([1, 3, 5, 7, 9, 11, 13, 15], 0.3) }, openHH: quiet([2, 6, 10], 0.75), snare: { 15: 0.35 } },
    bass: [
      { step: 2, note: 'C3' }, { step: 6, note: 'C3' }, { step: 7, note: 'G3', velocity: 0.6 }, { step: 10, note: 'C3' },
      { step: 14, note: 'D#3' }, { step: 15, note: 'F3', velocity: 0.7 },
    ],
  },
  {
    id: 'slow',
    name: 'Slow Groove',
    hint: 'A laid-back kick and snare with ghost notes, steady hats and a bass line that slides, at 88 BPM',
    tempo: 88,
    drums: { kick: [0, 7, 10], snare: [4, 9, 12, 15], closedHH: [0, 2, 4, 6, 8, 10, 12], openHH: [14] },
    velocities: { snare: { 9: 0.3, 15: 0.35 }, closedHH: quiet([2, 6, 10], 0.5), openHH: { 14: 0.6 }, kick: { 7: 0.8 } },
    bass: [
      { step: 0, note: 'E3', length: 3 }, { step: 7, note: 'G3', velocity: 0.8, slide: true }, { step: 8, note: 'A3', velocity: 0.7 },
      { step: 10, note: 'A3', length: 2 }, { step: 14, note: 'G3', velocity: 0.8 },
    ],
  },
  {
    id: 'electro',
    name: 'Electro',
    hint: 'A broken kick, a snare on two and four, quick hats, a tom fill and a bass that follows the kick, at 110 BPM',
    tempo: 110,
    drums: {
      kick: [0, 3, 6, 10], snare: [4, 12], clap: [12], closedHH: [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14], openHH: [15],
      ride: [13], snare2: [14],
    },
    velocities: { closedHH: quiet([1, 5, 9, 13], 0.3), clap: { 12: 0.7 }, ride: { 13: 0.6 }, snare2: { 14: 0.7 }, kick: { 3: 0.8 } },
    bass: [
      { step: 0, note: 'D3' }, { step: 3, note: 'D3', velocity: 0.8 }, { step: 6, note: 'F3' }, { step: 8, note: 'A3', velocity: 0.6 },
      { step: 10, note: 'D3' }, { step: 13, note: 'D3', velocity: 0.6 }, { step: 14, note: 'C3' },
    ],
  },
];

// Nothing has been put in yet: one scene, no note on any lane and no drum hit.
export function projectIsEmpty(patterns: Array<Pattern | null | undefined>, drums: DrumState, sceneCount: number): boolean {
  return sceneCount <= 1
    && patterns.every(pattern => !pattern || pattern.steps.every(step => !step.active))
    && Object.values(drums).every(track => !track.steps.some(Boolean));
}

// The lane's pattern with the bass line in every bar, whatever its length and step size. A
// starter is written in 4/4: in a scene whose bar is shorter each bar takes as much as fits.
export function starterPattern(starter: Starter, pattern: Pattern, signature?: unknown): Pattern {
  const bars = laneBars(pattern.steps.length, pattern.bars, signature);
  const perBar = pattern.steps.length / bars;
  const scale = perBar > barSteps(signature) ? 2 : 1;
  const steps = pattern.steps.map(step => withStepNotes(step, []));
  for (let bar = 0; bar < bars; bar += 1) {
    for (const entry of starter.bass) {
      const at = bar * perBar + entry.step * scale;
      if (entry.step * scale >= perBar || at >= steps.length) continue;
      const length = (entry.length ?? 1) * scale;
      steps[at] = {
        ...withStepNotes(steps[at], [entry.note]), ...(length > 1 ? { length } : {}),
        ...(entry.velocity !== undefined ? { velocity: entry.velocity } : {}), ...(entry.slide ? { slide: true } : {}),
      };
    }
  }
  return { ...pattern, steps };
}

// The drum grid with the starter's hits in every bar, each at its own strength. Sounds, levels
// and mutes are left alone.
export function starterDrums(starter: Starter, drums: DrumState, signature?: unknown): DrumState {
  const next = {} as DrumState, perBar = barSteps(signature);
  for (const instrument of Object.keys(drums) as DrumInstrument[]) {
    const hits = starter.drums[instrument] ?? [];
    const strength = starter.velocities?.[instrument] ?? {};
    next[instrument] = {
      ...drums[instrument], steps: drums[instrument].steps.map((_, step) => hits.includes(step % perBar)),
      stepVelocities: drums[instrument].steps.map((_, step) => (hits.includes(step % perBar) ? strength[step % perBar] ?? 1 : 1)),
    };
  }
  return next;
}
