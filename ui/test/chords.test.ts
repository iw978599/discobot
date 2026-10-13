import test from 'node:test';
import assert from 'node:assert/strict';
import { CHORD_SHAPES, chordNotes } from '../src/services/chords.ts';
import { MAX_STEP_NOTES, withStepNotes, stepNotes } from '../src/services/noteScheduling.ts';

test('a chord shape is built on its root, lowest note first', () => {
  assert.deepEqual(chordNotes('C3', 'major'), ['C3', 'E3', 'G3']);
  assert.deepEqual(chordNotes('A3', 'minor'), ['A3', 'C4', 'E4']);
  assert.deepEqual(chordNotes('G3', 'seventh'), ['G3', 'B3', 'D4', 'F4']);
  assert.deepEqual(chordNotes('C3', 'major7'), ['C3', 'E3', 'G3', 'B3']);
  assert.deepEqual(chordNotes('D3', 'minor7'), ['D3', 'F3', 'A3', 'C4']);
  assert.deepEqual(chordNotes('C3', 'sus2'), ['C3', 'D3', 'G3']);
  assert.deepEqual(chordNotes('C3', 'sus4'), ['C3', 'F3', 'G3']);
  assert.deepEqual(chordNotes('B3', 'diminished'), ['B3', 'D4', 'F4']);
  assert.deepEqual(chordNotes('E3', 'power'), ['E3', 'B3']);
});

test('every shape has a name of its own, starts on its root, fits in a step, and no shape is the root alone', () => {
  assert.equal(new Set(CHORD_SHAPES.map(shape => shape.id)).size, CHORD_SHAPES.length);
  assert.equal(new Set(CHORD_SHAPES.map(shape => shape.name)).size, CHORD_SHAPES.length);
  for (const shape of CHORD_SHAPES) {
    assert.equal(shape.semitones[0], 0, shape.id);
    assert.ok(shape.semitones.length >= 2 && shape.semitones.length <= MAX_STEP_NOTES, shape.id);
    assert.deepEqual([...shape.semitones], [...shape.semitones].sort((a, b) => a - b), shape.id);
    // Put in a step, it is the chord and nothing more.
    const step = withStepNotes({ active: false, velocity: 1 }, chordNotes('C3', shape.id));
    assert.deepEqual(stepNotes(step), chordNotes('C3', shape.id), shape.id);
  }
  for (const none of ['off', '', 'jazz', null, undefined]) assert.deepEqual(chordNotes('C3', none), ['C3']);
  // At the very top of what MIDI can name, the notes that do not exist are left out.
  assert.deepEqual(chordNotes('G9', 'major'), ['G9']);
  assert.deepEqual(chordNotes('nonsense', 'major'), []);
});
