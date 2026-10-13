import test from 'node:test';
import assert from 'node:assert/strict';
import { noteLengths, stepNotes } from '../src/services/noteScheduling.ts';
import { TRANSPOSE_MOVES, canTranspose, transposeSteps } from '../src/services/transpose.ts';
import type { SequencerStep } from '../src/types.ts';

const empty = (): SequencerStep => ({ active: false, velocity: 0.7 });
const lane = (...steps: SequencerStep[]): SequencerStep[] => [...steps, ...Array.from({ length: 16 - steps.length }, empty)];
const notes = (steps: SequencerStep[]) => steps.map(step => stepNotes(step));

test('every note moves by the same amount, chords together, and empty steps stay empty', () => {
  const before = lane({ active: true, note: 'C3', velocity: 0.8 }, empty(), { active: true, note: 'A3', notes: ['C4', 'E4'], velocity: 0.5 });
  const up = transposeSteps(before, 1)!;
  assert.deepEqual(notes(up).slice(0, 3), [['C#3'], [], ['A#3', 'C#4', 'F4']]);
  assert.deepEqual(notes(transposeSteps(before, 12)!).slice(0, 3), [['C4'], [], ['A4', 'C5', 'E5']]);
  assert.deepEqual(notes(transposeSteps(before, -12)!).slice(0, 3), [['C2'], [], ['A2', 'C3', 'E3']]);
  assert.deepEqual(notes(transposeSteps(before, -1)!).slice(0, 3), [['B2'], [], ['G#3', 'B3', 'D#4']]);
  assert.equal(up.length, before.length);
  assert.deepEqual(up[1], before[1]);
});

test('a move and its opposite give back exactly what was there', () => {
  const before = lane(
    { active: true, note: 'C3', notes: ['C#3', 'G3'], velocity: 0.8, length: 4, lengths: [1, 4, 2], slide: true, probability: 0.5, ratchet: 2, offset: 0.25 },
    { active: true, note: 'B8', velocity: 0.3 },
    { active: true, note: 'C0', velocity: 1 },
  );
  for (const move of [1, 12]) {
    const high = before.map(step => (step.note === 'B8' ? { ...step, note: 'B5' } : step));
    assert.deepEqual(transposeSteps(transposeSteps(high, move)!, -move), high);
    const low = before.map(step => (step.note === 'C0' ? { ...step, note: 'C3' } : step));
    assert.deepEqual(transposeSteps(transposeSteps(low, -move)!, move), low);
  }
});

test('nothing but the notes changes: velocity, slide, chance, repeats, timing and length are kept', () => {
  const step: SequencerStep = { active: true, note: 'D3', velocity: 0.42, slide: true, length: 3, probability: 0.5, ratchet: 3, offset: 0.5 };
  const [moved] = transposeSteps(lane(step), 12)!;
  assert.deepEqual(moved, { ...step, note: 'D4' });
});

test('each note of a chord keeps its own length when the move gives one note the name another had', () => {
  // C3 lasts one step and C#3 four. Up a semitone, the note now called C#3 is the short one.
  const step: SequencerStep = { active: true, note: 'C3', notes: ['C#3', 'E3'], velocity: 0.8, length: 4, lengths: [1, 4, 2] };
  const [up] = transposeSteps(lane(step), 1)!;
  assert.deepEqual(stepNotes(up), ['C#3', 'D3', 'F3']);
  assert.deepEqual(noteLengths(up), [1, 4, 2]);
  assert.equal(up.length, 4);
  const [down] = transposeSteps(lane({ ...step, note: 'C#3', notes: ['D3', 'F3'] }), -1)!;
  assert.deepEqual(stepNotes(down), ['C3', 'C#3', 'E3']);
  assert.deepEqual(noteLengths(down), [1, 4, 2]);
  // An octave, where no name is shared, keeps them too.
  assert.deepEqual(noteLengths(transposeSteps(lane(step), 12)![0]), [1, 4, 2]);
});

test('a chord whose notes all last the same gains no lengths of its own', () => {
  const [moved] = transposeSteps(lane({ active: true, note: 'C3', notes: ['C#3'], velocity: 0.8, length: 2 }), 1)!;
  assert.equal(moved.lengths, undefined);
  assert.equal(moved.length, 2);
});

test('a move that would take any note below C0 or above B8 moves nothing', () => {
  const low = lane({ active: true, note: 'C0', velocity: 0.8 }, { active: true, note: 'C4', velocity: 0.8 });
  assert.equal(canTranspose(low, -1), false);
  assert.equal(canTranspose(low, -12), false);
  assert.equal(transposeSteps(low, -1), null);
  assert.equal(canTranspose(low, 12), true);
  const high = lane({ active: true, note: 'C4', notes: ['B8'], velocity: 0.8 });
  assert.equal(canTranspose(high, 1), false);
  assert.equal(transposeSteps(high, 12), null);
  assert.equal(canTranspose(high, -1), true);
  // Eleven semitones of room is room for a semitone and not for an octave.
  const near = lane({ active: true, note: 'C8', velocity: 0.8 });
  assert.equal(canTranspose(near, 1), true);
  assert.equal(canTranspose(near, 12), false);
  assert.deepEqual(notes(transposeSteps(lane({ active: true, note: 'B7', velocity: 0.8 }), 12)!)[0], ['B8']);
  assert.deepEqual(notes(transposeSteps(lane({ active: true, note: 'C1', velocity: 0.8 }), -12)!)[0], ['C0']);
});

test('a note already outside the range, as a MIDI file can bring, can still be moved and moved back', () => {
  const outside = lane({ active: true, note: 'C-1', velocity: 0.8 });
  assert.equal(canTranspose(outside, -1), false);
  const up = transposeSteps(outside, 1)!;
  assert.deepEqual(notes(up)[0], ['C#-1']);
  assert.deepEqual(transposeSteps(up, -1), outside);
});

test('an empty pattern has nothing to move, and a move of nothing is refused', () => {
  for (const move of TRANSPOSE_MOVES) assert.equal(canTranspose(lane(), move), false);
  assert.equal(transposeSteps(lane(), 1), null);
  assert.equal(canTranspose(lane({ active: true, note: 'C3', velocity: 0.8 }), 0), false);
  assert.deepEqual([...TRANSPOSE_MOVES], [-12, -1, 1, 12]);
});

test('the steps handed in are not changed', () => {
  const before = lane({ active: true, note: 'C3', notes: ['E3'], velocity: 0.8, length: 2, lengths: [1, 2] });
  const copy = structuredClone(before);
  transposeSteps(before, 12);
  assert.deepEqual(before, copy);
});
