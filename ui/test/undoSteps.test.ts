import test from 'node:test';
import assert from 'node:assert/strict';
import { startsUndoStep } from '../src/studio/undoSteps.ts';

test('the first change to a control is an undo step, however soon after the page loaded', () => {
  // The clock a page keeps starts at zero when it loads. A level typed 239 ms in was once
  // taken for a change 239 ms after another, and got no undo step.
  assert.equal(startsUndoStep(undefined, 239, 250), true);
  assert.equal(startsUndoStep(undefined, 0, 250), true);
});

test('a run of changes close together is one step, and a pause starts the next', () => {
  assert.equal(startsUndoStep(1000, 1100, 250), false, 'a knob still being turned');
  assert.equal(startsUndoStep(1100, 1349, 250), false);
  assert.equal(startsUndoStep(1100, 1350, 250), true);
  assert.equal(startsUndoStep(0, 100, 250), false, 'a change at zero is still a change');
});
