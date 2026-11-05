import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCK_DEFAULT, DOCK_MIN, asDeskTab, asDeskTrack, clampDockHeight, dockKeyHeight, dockMax, dockUnit, readDock, readDockHeight } from '../src/services/deskFrame.ts';

test('only a lane, the drums or the guests is a track for the dock', () => {
  for (const track of ['synth-1', 'synth-5', 'drums', 'guests']) assert.equal(asDeskTrack(track), track);
  for (const bad of ['song', 'mixer', 'effects', 'all', 'synth-6', '', null, 3]) assert.equal(asDeskTrack(bad), null);
  assert.equal(asDeskTab('mixer'), 'mixer');
  assert.equal(asDeskTab('drums'), null);
});

test('the dock shows the track on its first tab and the mixer or effects on the others', () => {
  assert.equal(dockUnit('synth-2', 'track'), 'synth-2');
  assert.equal(dockUnit('synth-2', 'mixer'), 'mixer');
  assert.equal(dockUnit('guests', 'effects'), 'effects');
});

test('a stored dock is read back, and anything else is the first tab on no track', () => {
  assert.deepEqual(readDock('{"track":"drums","tab":"mixer"}'), { track: 'drums', tab: 'mixer' });
  assert.deepEqual(readDock('{"track":"nonsense","tab":"nonsense"}'), { track: null, tab: 'track' });
  assert.deepEqual(readDock('not json'), { track: null, tab: 'track' });
  assert.deepEqual(readDock(null), { track: null, tab: 'track' });
  assert.deepEqual(readDock('3'), { track: null, tab: 'track' });
});

test('the dock height is held between a minimum and most of the screen', () => {
  assert.equal(dockMax(1000), 620);
  assert.equal(clampDockHeight(50, 1000), DOCK_MIN);
  assert.equal(clampDockHeight(5000, 1000), 620, 'room is kept for the bar, the song and the tracks');
  assert.equal(clampDockHeight(5000, 3000), 2550, 'on a very tall screen, 85% of it');
  assert.equal(clampDockHeight(400.4, 1000), 400);
  assert.equal(clampDockHeight(NaN, 1000), DOCK_DEFAULT);
  assert.equal(clampDockHeight(500, 100), DOCK_MIN, 'a very short screen still has a dock');
});

test('a stored height is a positive number, or the default', () => {
  assert.equal(readDockHeight('420'), 420);
  for (const bad of [null, '', 'tall', '-3', '0', 'NaN']) assert.equal(readDockHeight(bad), DOCK_DEFAULT);
});

test('keys move the handle: up is taller, down shorter, Home the least, End the most', () => {
  assert.equal(dockKeyHeight('ArrowUp', 300, 1000), 324);
  assert.equal(dockKeyHeight('ArrowDown', 300, 1000), 276);
  assert.equal(dockKeyHeight('ArrowDown', DOCK_MIN, 1000), DOCK_MIN);
  assert.equal(dockKeyHeight('ArrowUp', 610, 1000), 620);
  assert.equal(dockKeyHeight('Home', 300, 1000), DOCK_MIN);
  assert.equal(dockKeyHeight('End', 300, 1000), 620);
  assert.equal(dockKeyHeight('a', 300, 1000), null);
});
