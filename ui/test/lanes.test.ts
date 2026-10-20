import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LANES, laneName, nextExtraLane, shownLanes, storedLaneName } from '../src/services/lanes.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { setup } from './helpers/store.ts';

test('the rack shows the standing three lanes, then any more, and offers the next until there are five', () => {
  assert.equal(MAX_LANES, 5);
  assert.deepEqual(shownLanes([1]), [1, 2, 3], 'a removed lane keeps its place, to be added back');
  assert.deepEqual(shownLanes([5, 1, 2, 3]), [1, 2, 3, 5]);
  assert.equal(nextExtraLane([1, 2, 3]), 4);
  assert.equal(nextExtraLane([1, 2, 3, 4]), 5);
  assert.equal(nextExtraLane([1, 2, 3, 4, 5]), null);
  assert.equal(nextExtraLane([1]), 4, 'a removed standing lane is added back from its own place, not from here');
});

test('a lane is called by its name, or by its number when it has none; a name is tidied before it is kept', () => {
  assert.equal(laneName(2), 'Synth 2');
  assert.equal(laneName(2, '  '), 'Synth 2');
  assert.equal(laneName(2, 'Bass'), 'Bass');
  assert.equal(storedLaneName('  Big   bass '), 'Big bass');
  assert.equal(storedLaneName('x'.repeat(40))!.length, 24);
  for (const nothing of ['', '   ', 7, null, undefined, {}]) assert.equal(storedLaneName(nothing), undefined);
});

test('lanes four and five and a lane\'s name are saved, travel in a file and are checked on the way in', async () => {
  const service = setup();
  await service.openLibrary(createMemoryLibrary());
  for (const id of [2, 3, 4, 5]) assert.ok(service.createLane(id).ok);
  assert.equal(service.createLane(6).ok, false);
  assert.ok(service.setSynthName(4, 'Strings').ok);
  assert.equal('name' in service.snapshot().synths[0], false, 'a lane never named stores nothing, so older projects are unchanged');
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  const read = service.readProjectFile(file);
  assert.ok(read.ok);
  if (read.ok) {
    assert.deepEqual(read.project.synths.map(lane => lane.synthId).sort(), [1, 2, 3, 4, 5]);
    assert.equal(read.project.synths.find(lane => lane.synthId === 4)!.name, 'Strings');
  }
  file.project.synths.find((lane: { synthId: number }) => lane.synthId === 4).name = { evil: true };
  file.project.synths.push({ ...file.project.synths[0], synthId: 6 });
  const hostile = service.readProjectFile(file);
  assert.ok(hostile.ok);
  if (hostile.ok) {
    assert.equal('name' in hostile.project.synths.find(lane => lane.synthId === 4)!, false);
    assert.equal(hostile.project.synths.some(lane => lane.synthId === 6), false, 'a sixth lane is not kept');
  }
});
