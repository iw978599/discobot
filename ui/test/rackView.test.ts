import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLDING_UNITS, RACK_UNITS, asRackUnit, foldedUnits, laneUnit, readFolded, storedRackUnit, unitLane } from '../src/services/rackView.ts';

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
  assert.equal(foldedUnits.get().size, 0, 'every unit starts unfolded');
});

test('which units are folded is read back, the mixer\'s Hide from before carried over, and only units that fold', () => {
  const store = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });
  assert.deepEqual([...readFolded(store({}))], []);
  assert.deepEqual([...readFolded(store({ discobot_mixer_hidden_v1: '1' }))], ['mixer'], 'the old Hide of the mixer');
  assert.deepEqual([...readFolded(store({ discobot_folded_units_v1: '["drums","synth-2"]', discobot_mixer_hidden_v1: '1' }))], ['drums', 'synth-2'], 'the new key wins');
  assert.deepEqual([...readFolded(store({ discobot_folded_units_v1: '["guests","all","nonsense",3,"effects"]' }))], ['effects'], 'guests never fold');
  assert.deepEqual([...readFolded(store({ discobot_folded_units_v1: 'not json' }))], []);
  assert.ok(!FOLDING_UNITS.includes('guests') && FOLDING_UNITS.includes('mixer'));
  foldedUnits.set('drums', true);
  assert.equal(foldedUnits.get().has('drums'), true, 'folded for the visit even without storage');
  foldedUnits.set('guests', true);
  assert.equal(foldedUnits.get().has('guests'), false);
  foldedUnits.set('drums', false);
});
