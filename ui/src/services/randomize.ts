import type { Pattern, SequencerStep } from '../types';
import { transposeNote } from '../utils/midiExport';
import { barSteps, beatPosition, laneBars } from './patternLength';

export const RANDOM_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type RandomKey = typeof RANDOM_KEYS[number];

// Each scale as the semitones above its root. A scale is kept by its id, so an id is never renamed;
// new ones are added after the first four (the owner asked for more on 2026-10-20).
export const RANDOM_SCALES = {
  major: { name: 'Major', notes: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', notes: [0, 2, 3, 5, 7, 8, 10] },
  'major-pentatonic': { name: 'Major pentatonic', notes: [0, 2, 4, 7, 9] },
  'minor-pentatonic': { name: 'Minor pentatonic', notes: [0, 3, 5, 7, 10] },
  dorian: { name: 'Dorian', notes: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', notes: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', notes: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', notes: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { name: 'Locrian', notes: [0, 1, 3, 5, 6, 8, 10] },
  'harmonic-minor': { name: 'Harmonic minor', notes: [0, 2, 3, 5, 7, 8, 11] },
  'melodic-minor': { name: 'Melodic minor', notes: [0, 2, 3, 5, 7, 9, 11] },
  'phrygian-dominant': { name: 'Phrygian dominant', notes: [0, 1, 4, 5, 7, 8, 10] },
  'hungarian-minor': { name: 'Hungarian minor', notes: [0, 2, 3, 6, 7, 8, 11] },
  blues: { name: 'Blues', notes: [0, 3, 5, 6, 7, 10] },
  'whole-tone': { name: 'Whole tone', notes: [0, 2, 4, 6, 8, 10] },
  hirajoshi: { name: 'Hirajoshi', notes: [0, 2, 3, 7, 8] },
} as const;
export type RandomScale = keyof typeof RANDOM_SCALES;

export interface RandomChoice { key: RandomKey; scale: RandomScale }
export const DEFAULT_RANDOM_CHOICE: RandomChoice = { key: 'C', scale: 'minor-pentatonic' };

export function asRandomChoice(value: unknown): RandomChoice {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    key: RANDOM_KEYS.includes(input.key as RandomKey) ? input.key as RandomKey : DEFAULT_RANDOM_CHOICE.key,
    scale: Object.keys(RANDOM_SCALES).includes(input.scale as string) ? input.scale as RandomScale : DEFAULT_RANDOM_CHOICE.scale,
  };
}

// The key and scale last chosen are how the tool is being used, not part of a song: they are kept
// per browser, as the unit on show is, and never with the project.
const CHOICE_KEY = 'discobot_randomize_v1';

export function storedRandomChoice(): RandomChoice {
  try { return asRandomChoice(JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null')); } catch { return DEFAULT_RANDOM_CHOICE; }
}

export function storeRandomChoice(choice: RandomChoice) {
  try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* the next visit starts on the default */ }
}

// The notes a line is drawn from, lowest first: the scale from the key's root in this octave up to
// two notes past the root an octave above. Nothing is below the root, because the piano roll's
// lowest row is the C of that octave and a note under it would be off the roll.
export function randomPool(choice: RandomChoice, octave: number): string[] {
  const scale = RANDOM_SCALES[choice.scale].notes, root = RANDOM_KEYS.indexOf(choice.key);
  return Array.from({ length: scale.length + 3 }, (_, degree) => transposeNote(`C${octave}`, root + 12 * Math.floor(degree / scale.length) + scale[degree % scale.length]))
    .filter((note): note is string => note !== null);
}

// How likely each sixteenth of a beat is to hold a note: the beat, then the ones after it, the
// eighths more than the sixteenths between them. `into` is how many sixteenths into its beat a
// step is. A beat of four averages a half, so about half the steps of a bar are filled; a beat of
// six (6/8, 12/8) is the same pattern carried on.
const chance = (into: number) => (into === 0 ? 0.85 : into % 2 ? 0.3 : 0.55);
// How far the line moves from one note to the next, in notes of the scale, by how often.
const MOVES: Array<[number, number]> = [[0.1, 0], [0.6, 1], [0.9, 2], [1, 3]];

// A new line for a lane: this pattern with its steps replaced and everything else kept. Notes come
// only from the scale, one to a step, starting on the key's root on the first step; neighbours are
// mostly a second or a third apart, and now and then a note is held over the empty steps after it.
// `octave` is the lowest octave the lane's piano roll shows. `random` answers 0 to 1 (not 1): pass
// a seeded one to get the same line again. The rhythm follows the beats of the scene's time
// signature, which is 4/4 when none is given.
export function randomLine(pattern: Pattern, choice: RandomChoice, octave: number, random: () => number, signature?: unknown): Pattern {
  const count = pattern.steps.length, bar = barSteps(signature);
  const perBar = count / laneBars(count, pattern.bars, signature) || bar;
  // A lane with finer steps gets the same rhythm, on every second step, not one twice as busy.
  const stride = perBar > bar ? 2 : 1;
  // How many sixteenths into its beat a step is.
  const into = (index: number) => beatPosition(signature, (index / stride) % bar);
  const pool = randomPool(choice, octave);
  const filled = Array.from({ length: count }, (_, index) => {
    if (index % stride !== 0) return false;
    return index === 0 || random() < chance(into(index));
  });
  let at = 0;
  const steps: SequencerStep[] = filled.map((on, index) => {
    if (!on || pool.length === 0) return { active: false, velocity: 0.7 };
    if (index > 0) {
      const roll = random();
      const size = MOVES.find(([upTo]) => roll < upTo)?.[1] ?? 1;
      // Leaning back towards the root keeps the line from climbing to the top and staying there.
      const up = random() < (at === 0 ? 1 : at >= pool.length - 1 ? 0 : 0.5 - 0.3 * (at / (pool.length - 1) - 0.4));
      at = Math.max(0, Math.min(pool.length - 1, at + (up ? size : -size)));
    }
    const onBeat = into(index) === 0;
    const velocity = Math.round((0.66 + (onBeat ? 0.1 : 0) + random() * 0.14) * 100) / 100;
    const next = filled.indexOf(true, index + 1);
    const room = Math.floor(((next === -1 ? count : next) - index) / stride);
    const length = (room > 1 && random() < 0.3 ? Math.min(room, 4) : 1) * stride;
    return { active: true, note: pool[at], velocity, ...(length > 1 ? { length } : {}) };
  });
  return { ...pattern, steps };
}
