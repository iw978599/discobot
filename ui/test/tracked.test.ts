import test from 'node:test';
import assert from 'node:assert/strict';
import { createView } from '../src/studio/tracked.tsx';

interface Fake { tempo: number; level: number; name: string; describe: () => string }
const fake = (tempo: number, level: number, name = 'one'): Fake => ({ tempo, level, name, describe: () => `${name} at ${tempo}` });

test('a view only calls for a render when something the unit has read is different', () => {
  const first = fake(120, 0.5);
  const view = createView(first);
  assert.equal(view.changed(first), false, 'nothing has been read yet');

  assert.equal(view.proxy.tempo, 120);
  view.drawn(first);
  assert.equal(view.changed(fake(120, 0.9, 'two')), false, 'the level and the name were never read');
  assert.equal(view.changed(fake(121, 0.5)), true, 'the tempo was');

  // A value first read on a later render is watched from then on.
  const second = fake(120, 0.9);
  view.show(second);
  assert.equal(view.proxy.level, 0.9);
  view.drawn(second);
  assert.equal(view.changed(fake(120, 0.9)), false);
  assert.equal(view.changed(fake(120, 0.2)), true);
});

test('a render that never reached the screen does not count as drawn', () => {
  const first = fake(120, 0.5);
  const view = createView(first);
  void view.proxy.tempo;
  view.drawn(first);

  // React starts a render from a newer studio and throws it away before it is shown.
  const next = fake(140, 0.5);
  view.show(next);
  assert.equal(view.changed(next), true);
  assert.equal(view.proxy.tempo, 140, 'the abandoned render read the new value');
  assert.equal(view.changed(next), true, 'and the render that follows is still needed');

  view.drawn(next);
  assert.equal(view.changed(next), false);
});

test('a value read outside a render costs one render, and is then compared like any other', () => {
  const first = fake(120, 0.5);
  const view = createView(first);
  void view.proxy.tempo;
  view.drawn(first);

  assert.equal(view.proxy.name, 'one', 'read from a handler');
  assert.equal(view.changed(first), true, 'there is nothing to compare it with yet');
  view.drawn(first);
  assert.equal(view.changed(first), false);
  assert.equal(view.changed(fake(120, 0.5, 'two')), true);
});

test('a unit keeps the same handler, and it calls the newest studio\'s', () => {
  const view = createView(fake(120, 0.5));
  const describe = view.proxy.describe;
  assert.equal(describe(), 'one at 120');

  const next = fake(90, 0.5, 'two');
  assert.equal(view.changed(next), false, 'a handler made anew is not a change');
  view.show(next);
  assert.equal(view.proxy.describe, describe);
  assert.equal(describe(), 'two at 90');
});
