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

// The inversions the roll offers: which note of the chord is lowest.
export const INVERSIONS = ['Root', '1st', '2nd', '3rd'];

// The notes of a shape built on a root. A note off either end of what MIDI can name is left out;
// an unknown shape, or no shape, is the root alone. An inversion keeps the root where it is and
// takes the notes above it down an octave, so the one picked out is lowest: the first inversion
// has the third in the bass, the second the fifth. One past the shape's last note is its last.
export function chordNotes(root: string, shape: string | null | undefined, inversion = 0): string[] {
  const found = CHORD_SHAPES.find(entry => entry.id === shape);
  if (!found) return [root];
  const turn = Math.max(0, Math.min(found.semitones.length - 1, Math.round(inversion) || 0));
  return found.semitones.map((semitones, index) => transposeNote(root, turn > 0 && index >= turn ? semitones - 12 : semitones))
    .filter((note): note is string => note !== null);
}
