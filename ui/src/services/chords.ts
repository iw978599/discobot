import { transposeNote } from '../utils/midiExport';
import { keyChord } from './scaleLock';
import type { RandomChoice } from './randomize';

// The chord shapes the piano roll can put in with one press: the semitones above the root, and the
// group the Chord menu shows each in. The shape chosen is view state, never stored.
export const CHORD_GROUPS = ['Triads', 'Sixths and sevenths', 'Ninths and added notes'] as const;
export const CHORD_SHAPES = [
  { id: 'major', name: 'Major', group: 'Triads', semitones: [0, 4, 7] },
  { id: 'minor', name: 'Minor', group: 'Triads', semitones: [0, 3, 7] },
  { id: 'diminished', name: 'Diminished', group: 'Triads', semitones: [0, 3, 6] },
  { id: 'augmented', name: 'Augmented', group: 'Triads', semitones: [0, 4, 8] },
  { id: 'sus2', name: 'Sus 2', group: 'Triads', semitones: [0, 2, 7] },
  { id: 'sus4', name: 'Sus 4', group: 'Triads', semitones: [0, 5, 7] },
  { id: 'power', name: 'Fifth', group: 'Triads', semitones: [0, 7] },
  { id: 'sixth', name: '6th', group: 'Sixths and sevenths', semitones: [0, 4, 7, 9] },
  { id: 'minor6', name: 'Minor 6th', group: 'Sixths and sevenths', semitones: [0, 3, 7, 9] },
  { id: 'seventh', name: 'Seventh', group: 'Sixths and sevenths', semitones: [0, 4, 7, 10] },
  { id: 'major7', name: 'Major 7th', group: 'Sixths and sevenths', semitones: [0, 4, 7, 11] },
  { id: 'minor7', name: 'Minor 7th', group: 'Sixths and sevenths', semitones: [0, 3, 7, 10] },
  { id: 'minor-major7', name: 'Minor major 7th', group: 'Sixths and sevenths', semitones: [0, 3, 7, 11] },
  { id: 'half-diminished', name: 'Half-diminished', group: 'Sixths and sevenths', semitones: [0, 3, 6, 10] },
  { id: 'diminished7', name: 'Diminished 7th', group: 'Sixths and sevenths', semitones: [0, 3, 6, 9] },
  { id: 'seventh-sus4', name: '7th sus 4', group: 'Sixths and sevenths', semitones: [0, 5, 7, 10] },
  { id: 'add9', name: 'Add 9', group: 'Ninths and added notes', semitones: [0, 4, 7, 14] },
  { id: 'minor-add9', name: 'Minor add 9', group: 'Ninths and added notes', semitones: [0, 3, 7, 14] },
  { id: 'ninth', name: '9th', group: 'Ninths and added notes', semitones: [0, 4, 7, 10, 14] },
  { id: 'major9', name: 'Major 9th', group: 'Ninths and added notes', semitones: [0, 4, 7, 11, 14] },
  { id: 'minor9', name: 'Minor 9th', group: 'Ninths and added notes', semitones: [0, 3, 7, 10, 14] },
  { id: 'six-nine', name: '6/9', group: 'Ninths and added notes', semitones: [0, 4, 7, 9, 14] },
  { id: 'eleventh', name: '11th', group: 'Ninths and added notes', semitones: [0, 7, 10, 14, 17] },
] as const;
// Chords made of the notes of the chosen key and scale (`scaleLock.ts`) rather than of fixed steps:
// every other note of the scale upwards, three, four or five of them.
export const KEY_CHORD_SHAPES = [
  { id: 'key-triad', name: 'Triad in key', size: 3 },
  { id: 'key-seventh', name: 'Seventh in key', size: 4 },
  { id: 'key-ninth', name: 'Ninth in key', size: 5 },
] as const;
export type ChordShapeId = typeof CHORD_SHAPES[number]['id'] | typeof KEY_CHORD_SHAPES[number]['id'];

// The inversions the roll offers: which note of the chord is lowest.
export const INVERSIONS = ['Root', '1st', '2nd', '3rd', '4th'];

// The notes of a shape built on a root. A note off either end of what MIDI can name is left out;
// an unknown shape, or no shape, is the root alone. An inversion keeps the root where it is and
// takes the notes above it down an octave, so the one picked out is lowest: the first inversion
// has the third in the bass, the second the fifth. One past the shape's last note is its last.
// A chord in the key is built from `key`, and is the root alone without one.
export function chordNotes(root: string, shape: string | null | undefined, inversion = 0, key?: RandomChoice): string[] {
  const inKey = KEY_CHORD_SHAPES.find(entry => entry.id === shape);
  if (inKey) {
    if (!key) return [root];
    const notes = keyChord(root, key, inKey.size);
    const turn = Math.max(0, Math.min(notes.length - 1, Math.round(inversion) || 0));
    return notes.map((note, index) => (turn > 0 && index >= turn ? transposeNote(note, -12) : note)).filter((note): note is string => note !== null);
  }
  const found = CHORD_SHAPES.find(entry => entry.id === shape);
  if (!found) return [root];
  const turn = Math.max(0, Math.min(found.semitones.length - 1, Math.round(inversion) || 0));
  return found.semitones.map((semitones, index) => transposeNote(root, turn > 0 && index >= turn ? semitones - 12 : semitones))
    .filter((note): note is string => note !== null);
}
