import { transposeNote } from '../utils/midiExport';

// The chord shapes the piano roll can put in with one press: the semitones above the root.
export const CHORD_SHAPES = [
  { id: 'major', name: 'Major', semitones: [0, 4, 7] },
  { id: 'minor', name: 'Minor', semitones: [0, 3, 7] },
  { id: 'seventh', name: 'Seventh', semitones: [0, 4, 7, 10] },
  { id: 'major7', name: 'Major 7th', semitones: [0, 4, 7, 11] },
  { id: 'minor7', name: 'Minor 7th', semitones: [0, 3, 7, 10] },
  { id: 'sus2', name: 'Sus 2', semitones: [0, 2, 7] },
  { id: 'sus4', name: 'Sus 4', semitones: [0, 5, 7] },
  { id: 'diminished', name: 'Diminished', semitones: [0, 3, 6] },
  { id: 'power', name: 'Fifth', semitones: [0, 7] },
] as const;
export type ChordShapeId = typeof CHORD_SHAPES[number]['id'];

// The notes of a shape built on a root, lowest first. A note off the top of what MIDI can name
// is left out; an unknown shape, or no shape, is the root alone.
export function chordNotes(root: string, shape: string | null | undefined): string[] {
  const found = CHORD_SHAPES.find(entry => entry.id === shape);
  if (!found) return [root];
  return found.semitones.map(semitones => transposeNote(root, semitones)).filter((note): note is string => note !== null);
}
