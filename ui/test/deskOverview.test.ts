import test from 'node:test';
import assert from 'node:assert/strict';
import { drumLine, overviewColumns, strengthOpacity, toggledNotes } from '../src/services/deskOverview.ts';
import { drumSelection } from '../src/services/drumSelection.ts';
import { readDrumsOpen } from '../src/services/deskFrame.ts';

test('a pattern as long as the scene has no repeats, and a shorter one repeats from its start', () => {
  const whole = overviewColumns(32, 16, 2, '4/4');
  assert.equal(whole.length, 32);
  assert.ok(whole.every(cell => !cell.ghost));
  const short = overviewColumns(16, 16, 2, '4/4');
  assert.equal(short.length, 32);
  assert.deepEqual(short.slice(14, 18).map(cell => [cell.step, cell.ghost]), [[14, false], [15, false], [0, true], [1, true]]);
  assert.equal(short[20].step, 4);
});

test('a finer lane keeps its columns per bar and marks the beats of the scene\'s signature', () => {
  const fine = overviewColumns(32, 32, 1, '4/4');
  assert.deepEqual(fine.flatMap(cell => (cell.beat ? [cell.column] : [])), [0, 8, 16, 24]);
  const waltz = overviewColumns(12, 12, 2, '3/4');
  assert.equal(waltz.length, 24);
  assert.deepEqual(waltz.filter(cell => cell.barStart).map(cell => cell.column), [0, 12]);
  assert.deepEqual(waltz.filter(cell => cell.beat).map(cell => cell.column), [0, 4, 8, 12, 16, 20]);
});

test('nothing to draw for an empty pattern', () => {
  assert.deepEqual(overviewColumns(0, 16, 2), []);
});

test('a click puts a note on an empty step and takes the notes off a full one', () => {
  assert.deepEqual(toggledNotes(undefined, 0), { notes: ['C3'], on: true });
  assert.deepEqual(toggledNotes({ active: false, note: '', velocity: 0.7 } as never, 1), { notes: ['C4'], on: true });
  assert.deepEqual(toggledNotes({ active: true, note: 'E3', velocity: 0.7 } as never, 0), { notes: ['E3'], on: false });
  assert.equal(toggledNotes(undefined, 99).notes[0], 'C7');
});

test('the drums as one line are lit where any row hits, as strongly as the strongest', () => {
  const line = drumLine([
    { steps: [true, false, false, false], stepVelocities: [0.5, 1, 1, 1] },
    { steps: [true, false, true, false] },
  ], 4);
  assert.deepEqual(line, [{ on: true, velocity: 1 }, { on: false, velocity: 0 }, { on: true, velocity: 1 }, { on: false, velocity: 0 }]);
  assert.equal(strengthOpacity(0), 0.45);
  assert.equal(strengthOpacity(2), 1);
});

test('the drum selection tells watchers, and only counts a choice from outside the drum unit', () => {
  let heard = 0;
  const stop = drumSelection.subscribe(() => { heard += 1; });
  const before = drumSelection.get().outside;
  drumSelection.set({ row: 'snare', step: 3 });
  assert.deepEqual([drumSelection.get().row, drumSelection.get().step, drumSelection.get().outside], ['snare', 3, before]);
  drumSelection.set({ step: 3 });
  assert.equal(heard, 1, 'no change, no news');
  drumSelection.pick('kick', 5);
  assert.deepEqual([drumSelection.get().row, drumSelection.get().step, drumSelection.get().outside], ['kick', 5, before + 1]);
  stop();
});

test('the drums are folded unless this browser opened them', () => {
  assert.equal(readDrumsOpen(null), false);
  assert.equal(readDrumsOpen('closed'), false);
  assert.equal(readDrumsOpen('open'), true);
});
