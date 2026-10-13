import type { SequencerStep } from '../types';
import { noteNameToMidi, transposeNote } from '../utils/midiExport';
import { noteLengths, stepNotes, withStepLength, withStepNotes } from './noteScheduling';

// The moves the Transpose buttons offer, in semitones.
export const TRANSPOSE_MOVES = [-12, -1, 1, 12] as const;

// The lowest and highest notes a transpose will carry a note to: C0 and B8.
export const LOWEST_NOTE = 12;
export const HIGHEST_NOTE = 119;

// Whether a note may make this move. It may not cross out of C0 to B8. A note that is already
// outside (a MIDI file can bring one) may move anywhere a note can be named, so the opposite
// move still takes it back.
function mayMove(note: string, semitones: number): boolean {
  const from = noteNameToMidi(note);
  if (from === null || transposeNote(note, semitones) === null) return false;
  const to = from + semitones;
  if (semitones < 0) return to >= LOWEST_NOTE || from < LOWEST_NOTE;
  return to <= HIGHEST_NOTE || from > HIGHEST_NOTE;
}

// Whether every note in these steps can move by this much. With no notes there is nothing to move.
export function canTranspose(steps: SequencerStep[], semitones: number): boolean {
  const notes = steps.flatMap(step => stepNotes(step));
  return notes.length > 0 && Number.isInteger(semitones) && semitones !== 0 && notes.every(note => mayMove(note, semitones));
}

function transposeStep(step: SequencerStep, semitones: number): SequencerStep {
  const notes = stepNotes(step);
  if (notes.length === 0) return step;
  const lengths = noteLengths(step);
  const moved = notes.map(note => transposeNote(note, semitones) ?? note);
  // withStepNotes keeps a length by the note's name, and after a move a name can belong to a
  // different note of the chord. Every note moves by the same amount, so the order is unchanged
  // and each length goes back by position.
  return moved.reduce((next, note, index) => withStepLength(next, lengths[index], note), withStepNotes(step, moved));
}

// The steps with every note moved by this many semitones, chords together, and nothing else
// changed. Nothing at all is moved, and null is answered, if any note could not make the move:
// a transpose that moved only some notes could not be undone by the opposite one.
export function transposeSteps(steps: SequencerStep[], semitones: number): SequencerStep[] | null {
  return canTranspose(steps, semitones) ? steps.map(step => transposeStep(step, semitones)) : null;
}
