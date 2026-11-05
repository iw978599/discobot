import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asDeskView, barMarks, clipEndTick, drumsPlaying, guestPlaying, initials, lanesPlaying, liveSceneOf, presenceSelector, songLayout,
} from '../src/services/deskSong.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, Scene, SequencerStep, Song } from '../src/types.ts';

const drums = (on: Partial<Record<string, number[]>> = {}, flags: Partial<Record<string, { muted?: boolean; solo?: boolean }>> = {}): DrumState =>
  Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array.from({ length: 16 }, (_, step) => on[instrument]?.includes(step) ?? false),
    muted: flags[instrument]?.muted ?? false, solo: flags[instrument]?.solo ?? false, settings: { volume: 0.8, tone: 0.5, extra: 0.5 },
  }])) as DrumState;
const steps = (at: number[] = []): SequencerStep[] => Array.from({ length: 16 }, (_, i) => (at.includes(i) ? { active: true, note: 'C3', velocity: 0.8 } : { active: false, velocity: 0.7 }));
const scene = (id: string, extra: Partial<Scene> = {}): Scene => ({ id, name: id, lanes: { 1: steps([0]), 2: steps() }, drums: drums({ kick: [0] }) as Scene['drums'], ...extra });

test('the song is laid end to end at each scene\'s own bar length, repeats included', () => {
  const song: Song = { entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }, { sceneId: 'a', repeats: 1 }], loop: false };
  const lengths: Record<string, number> = { a: 2, b: 1 };
  const signatures: Record<string, unknown> = { b: '3/4' };
  const layout = songLayout(song, [{ id: 'a', name: 'Verse', color: 'red' }, { id: 'b', name: 'Break' }], id => lengths[id], id => signatures[id]);
  assert.deepEqual(layout.entries.map(entry => [entry.startBar, entry.bars, entry.startTick, entry.ticks, entry.perBar]), [
    [0, 4, 0, 128, 32],
    [4, 1, 128, 24, 24],
    [5, 2, 152, 64, 32],
  ]);
  assert.equal(layout.bars, 7);
  assert.equal(layout.ticks, 216);
  assert.equal(layout.entries[0].name, 'Verse');
  assert.equal(layout.entries[0].color, 'red');
  assert.equal(layout.entries[1].color, undefined);
});

test('a scene the song names but the project lacks is still laid out, called ?', () => {
  const layout = songLayout({ entries: [{ sceneId: 'gone', repeats: 1 }], loop: false }, [], () => 1, () => undefined);
  assert.equal(layout.entries[0].name, '?');
  assert.equal(layout.ticks, 32);
});

test('a long song labels only some bars, each at the tick its bar starts', () => {
  const song: Song = { entries: [{ sceneId: 'a', repeats: 3 }, { sceneId: 'b', repeats: 1 }], loop: false };
  const layout = songLayout(song, [], id => (id === 'a' ? 1 : 1), id => (id === 'b' ? '3/4' : undefined));
  assert.deepEqual(barMarks(layout), [{ bar: 0, tick: 0 }, { bar: 1, tick: 32 }, { bar: 2, tick: 64 }, { bar: 3, tick: 96 }]);
  const long = songLayout({ entries: [{ sceneId: 'a', repeats: 64 }], loop: false }, [], () => 4, () => undefined);
  const marks = barMarks(long, 40);
  assert.equal(long.bars, 256);
  assert.ok(marks.length <= 40);
  assert.deepEqual(marks.slice(0, 2), [{ bar: 0, tick: 0 }, { bar: 7, tick: 224 }]);
});

test('a lane plays in a scene when it is heard there and has a note', () => {
  const lanes = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual([...lanesPlaying(scene('a'), lanes)], [1]);
  assert.deepEqual([...lanesPlaying(scene('a', { mutes: { lanes: { 1: { muted: true, solo: false } } } }), lanes)], []);
  assert.deepEqual([...lanesPlaying(scene('a', { lanes: { 1: steps([0]), 2: steps([4]) }, mutes: { lanes: { 2: { muted: false, solo: true } } } }), lanes)], [2]);
  assert.deepEqual([...lanesPlaying(scene('a'), [{ id: 1, muted: true }])], [], 'without scene mutes the project\'s apply');
});

test('the drums play in a scene when a row is heard and has a hit', () => {
  const kit = drums();
  assert.equal(drumsPlaying(scene('a'), kit), true);
  assert.equal(drumsPlaying(scene('a', { drums: drums() as Scene['drums'] }), kit), false);
  assert.equal(drumsPlaying(scene('a', { mutes: { drums: { kick: { muted: true, solo: false } } } }), kit), false);
  assert.equal(drumsPlaying(scene('a', { drums: drums({ kick: [0], snare: [4] }) as Scene['drums'], mutes: { drums: { snare: { muted: false, solo: true } } } }), kit), true);
});

test('a guest plays in the scenes where its level is up and it is not muted, carrying on where a scene says nothing', () => {
  const guest = { id: 'g', volume: 0.7, muted: false };
  const scenes = [scene('a'), scene('b', { guestMix: { g: { volume: 0.7, muted: true } } }), scene('c'), scene('d', { guestMix: { g: { volume: 0, muted: false } } })];
  assert.deepEqual(guestPlaying(scenes, guest), [true, false, false, false]);
});

test('the open scene is read from the live lanes, drums and guests, not its stored copy', () => {
  const stored = scene('a', { mutes: { lanes: { 1: { muted: true, solo: false } } }, guestMix: { g: { volume: 1, muted: true } } });
  const live = liveSceneOf(stored, [{ id: 1, pattern: { steps: steps([2]) } }, { id: 2, pattern: null }], drums({ snare: [1] }), [
    { id: 'g', url: 'https://example.test', name: 'G', volume: 0.5, muted: false },
  ]);
  assert.deepEqual(live.lanes[1].map(step => step.active).indexOf(true), 2);
  assert.deepEqual(live.lanes[2], []);
  assert.equal(live.mutes, undefined);
  assert.deepEqual(live.guestMix, { g: { volume: 0.5, muted: false } });
  assert.equal(drumsPlaying(live, drums({ snare: [1] })), true);
  assert.deepEqual(guestPlaying([live], { id: 'g', volume: 0.5, muted: false }), [true]);
});

test('a clip ends where its seconds run out, and at least a tick after it starts', () => {
  const secondsOf = (tick: number) => tick * 0.1;
  const tickAt = (seconds: number) => Math.round(seconds / 0.1);
  const clip = { id: 'c', sampleId: 's', at: 10, length: 2 };
  assert.equal(clipEndTick(clip, secondsOf, tickAt), 30);
  assert.equal(clipEndTick({ ...clip, length: 0 }, secondsOf, tickAt), 11);
});

test('the view is one of two words', () => {
  assert.equal(asDeskView('song'), 'song');
  assert.equal(asDeskView('patterns'), 'patterns');
  assert.equal(asDeskView('grid'), null);
  assert.equal(asDeskView(null), null);
});

test('initials come from the start of one or two parts of a name', () => {
  assert.equal(initials('alex'), 'AL');
  assert.equal(initials('alex_jones'), 'AJ');
  assert.equal(initials('mo'), 'MO');
  assert.equal(initials('x'), 'X');
  assert.equal(initials('---'), '?');
});

test('a place marks the unit, its switch on the bar and the track header, and only a plain unit name marks anything', () => {
  const selector = presenceSelector('synth-2')!;
  assert.ok(selector.includes('.rack [data-unit="synth-2"]'));
  assert.ok(selector.includes('.unit-bar [data-tab="synth-2"]'));
  assert.ok(selector.includes('.desk-tracks .desk-track[data-track="synth-2"] > .desk-track-head'));
  assert.equal(presenceSelector('drums') !== null, true);
  assert.equal(presenceSelector('guests') !== null, true);
  assert.equal(presenceSelector('"] , body, ["x'), null);
  assert.equal(presenceSelector(''), null);
});
