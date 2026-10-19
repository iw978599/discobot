import test from 'node:test';
import assert from 'node:assert/strict';
import { CLICK_LEVEL, COUNT_IN_CHOICES, asMetronome, clickLevel, countInBars, clickAt, countInBeats, countInSeconds, storeMetronome, storedMetronome } from '../src/services/metronome.ts';

test('the metronome clicks on every beat, and marks the first of the bar', () => {
  // A tick is a 32nd note: thirty-two to the bar, a beat every eighth one.
  const clicks = Array.from({ length: 32 }, (_, step) => clickAt(step));
  assert.deepEqual(clicks.flatMap((kind, step) => (kind ? [[step, kind]] : [])), [[0, 'bar'], [8, 'beat'], [16, 'beat'], [24, 'beat']]);
});

test('a count-in is one bar unless more are chosen, each as long as a bar is at the tempo', () => {
  assert.equal(countInBars(asMetronome(null)), 1);
  assert.deepEqual(COUNT_IN_CHOICES, [1, 2, 4]);
  assert.equal(countInBeats(1), 4);
  assert.equal(countInBeats(4), 16);
  assert.equal(countInSeconds(2, 120), 4);
  assert.equal(countInSeconds(1, 120), 2);
  assert.equal(countInSeconds(1, 60), 4);
  assert.equal(countInSeconds(0, 120), 0, 'with no count-in nothing is put before the music');
  assert.ok(Number.isFinite(countInSeconds(1, 0)));
});

test('the settings are this browser\'s: kept between visits, off to begin with, and anything else stored is off', () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  assert.deepEqual(storedMetronome(), { click: false, countIn: false });
  storeMetronome({ click: true, countIn: false });
  assert.deepEqual(storedMetronome(), { click: true, countIn: false });
  storeMetronome({ click: true, countIn: true });
  assert.deepEqual(storedMetronome(), { click: true, countIn: true });
  for (const junk of ['not json', '7', '"on"', '{"click":"yes","countIn":1}', '[]', 'null']) {
    storage.set('discobot_metronome_v1', junk);
    assert.deepEqual(storedMetronome(), { click: false, countIn: false }, junk);
  }
  assert.deepEqual(asMetronome({ click: true, countIn: true, tempo: 900 }), { click: true, countIn: true });
  // The count-in's length and the click's level are kept only where they are not what they always were.
  assert.deepEqual(asMetronome({ countIn: true, bars: 4, level: 0.8 }), { click: false, countIn: true, bars: 4, level: 0.8 });
  assert.deepEqual(asMetronome({ bars: 1, level: CLICK_LEVEL }), { click: false, countIn: false });
  assert.deepEqual(asMetronome({ bars: 3, level: 7 }), { click: false, countIn: false, level: 1 });
  assert.deepEqual(asMetronome({ bars: '2', level: 'loud' }), { click: false, countIn: false });
  assert.equal(clickLevel(asMetronome({ level: 0 })), 0, 'a click can be turned right down');
  assert.equal(clickLevel(asMetronome(null)), CLICK_LEVEL);
  // A browser that refuses storage still works.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } } });
  assert.deepEqual(storedMetronome(), { click: false, countIn: false });
  assert.doesNotThrow(() => storeMetronome({ click: true, countIn: true }));
});
