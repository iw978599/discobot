// Moving lanes (roadmap 20): the owner decided on 2026-10-20 that a lane moves only where it is shown.
// The order is a list of every lane once, kept with the project, and in plain order is kept as nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { laneOrderOf, movedLaneOrder, shownLanes } from '../src/services/lanes.ts';
import { mixerChannels } from '../src/services/mixerChannels.ts';
import { ok, setup } from './helpers/store.ts';

test('an order is every lane once; anything else, or plain order, is none', () => {
  assert.deepEqual(laneOrderOf([3, 1, 2, 4, 5]), [3, 1, 2, 4, 5]);
  for (const none of [[1, 2, 3, 4, 5], [1, 1, 2, 3, 4], [1, 2, 3], [0, 1, 2, 3, 4], [1, 2, 3, 4, 6], 'nope', null, [1.5, 2, 3, 4, 5]]) {
    assert.equal(laneOrderOf(none), undefined, JSON.stringify(none));
  }
});

test('the rack shows its lanes in the order, empty places included, and a moved lane takes another\'s place', () => {
  assert.deepEqual(shownLanes([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(shownLanes([1, 3, 4]), [1, 2, 3, 4], 'a removed standing lane still has its place');
  assert.deepEqual(shownLanes([1, 2, 3, 5], [5, 3, 1, 2, 4]), [5, 3, 1, 2]);
  // Synth 3 moved to the top, then Synth 4 added: it comes in after the others.
  const order = movedLaneOrder(undefined, [1, 2, 3], 3, 0);
  assert.deepEqual(order, [3, 1, 2, 4, 5]);
  assert.deepEqual(shownLanes([1, 2, 3, 4], order), [3, 1, 2, 4]);
  assert.deepEqual(movedLaneOrder(order, [3, 1, 2, 4], 3, 9), [1, 2, 4, 3, 5], 'a place past the end is the end');
  assert.deepEqual(movedLaneOrder(order, [3, 1, 2], 4, 0), order, 'a lane not on show does not move');
});

test('the mixer lists its lanes in the same order', () => {
  const lane = (id: number) => ({ id, synthModelId: 'generic' as const, synthParams: { gain: 1, pan: 0 } });
  const source = { synths: [lane(1), lane(2), lane(3)], drumState: {} as never, drumMasterVolume: 1, guests: [], effectsLoop: { returns: { synth: 1, drums: 1 } }, browserVolume: 1 };
  assert.deepEqual(mixerChannels(source).lanes.map(entry => entry.id), [1, 2, 3]);
  assert.deepEqual(mixerChannels({ ...source, laneOrder: [2, 3, 1, 4, 5] }).lanes.map(entry => entry.id), [2, 3, 1]);
});

test('the order is kept in a project file, a bad one is dropped, an older project has none, and undo takes it away', () => {
  const service = setup();
  ok(service.setLaneOrder([2, 1, 3, 4, 5]));
  const file = service.exportProject() as { project: Record<string, unknown> };
  const read = service.readProjectFile(file);
  assert.ok(read.ok && JSON.stringify(read.project.laneOrder) === '[2,1,3,4,5]');
  for (const hostile of [[9, 9, 9, 9, 9], 'top', { 0: 2 }]) {
    const bad = structuredClone(file);
    bad.project.laneOrder = hostile;
    const back = service.readProjectFile(bad);
    assert.ok(back.ok && !('laneOrder' in back.project), JSON.stringify(hostile));
  }
  const old = structuredClone(file);
  delete old.project.laneOrder;
  const opened = service.readProjectFile(old);
  assert.ok(opened.ok && !('laneOrder' in opened.project));

  // Undoing the first move leaves no order behind, rather than the one there is now.
  service.undo();
  assert.equal('laneOrder' in service.snapshot(), false);
  service.redo();
  assert.deepEqual(service.snapshot().laneOrder, [2, 1, 3, 4, 5]);
});
