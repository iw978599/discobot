import test from 'node:test';
import assert from 'node:assert/strict';
import { RACK_UNITS, asRackUnit, laneUnit, storedMixerHidden, storedRackUnit, unitLane } from '../src/services/rackView.ts';

test('only a unit of the rack is accepted as the unit on show', () => {
  for (const unit of RACK_UNITS) assert.equal(asRackUnit(unit), unit);
  for (const bad of ['', 'synth-6', 'synth-0', 'Drums', 'guest', null, undefined, 3, {}]) assert.equal(asRackUnit(bad), null);
});

test('a lane and its unit are told apart from the other units', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(laneUnit), ['synth-1', 'synth-2', 'synth-3', 'synth-4', 'synth-5']);
  assert.equal(laneUnit(9), 'synth-1', 'a lane that cannot exist falls back to the first');
  assert.deepEqual(RACK_UNITS.map(unitLane), [null, 1, 2, 3, 4, 5, null, null, null, null, null]);
});

test('with no storage to read, nothing is remembered', () => {
  assert.equal(storedRackUnit(), null);
  assert.equal(storedMixerHidden(), false, 'the mixer starts shown');
});
