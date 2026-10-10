import test from 'node:test';
import assert from 'node:assert/strict';
import { playhead } from '../src/services/playhead.ts';

test('the playhead tells a lane\'s listeners when its step changes, and only then', () => {
  const heard: string[] = [];
  const stopOne = playhead.subscribe(1, () => heard.push(`lane 1 at ${playhead.get(1)}`));
  const stopDrums = playhead.subscribe('drums', () => heard.push(`drums at ${playhead.get('drums')}`));

  assert.equal(playhead.get(1), 0, 'a lane that has not played is on its first step');
  playhead.set(1, 4);
  playhead.set(1, 4);
  playhead.set('drums', 2);
  playhead.set(2, 9);
  assert.deepEqual(heard, ['lane 1 at 4', 'drums at 2'], 'no word of a step that did not change, or of another lane');
  assert.equal(playhead.get(2), 9);

  heard.length = 0;
  playhead.reset();
  assert.deepEqual(heard, ['lane 1 at 0', 'drums at 0']);
  assert.deepEqual([playhead.get(1), playhead.get(2), playhead.get('drums')], [0, 0, 0]);

  stopOne();
  stopDrums();
  playhead.set(1, 7);
  assert.deepEqual(heard, ['lane 1 at 0', 'drums at 0'], 'nothing after a listener has left');
  playhead.reset();
});
