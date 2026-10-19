import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveArp, type LiveArpLane } from '../src/services/liveArp.ts';

// A lane whose arpeggio is each held note in turn, a quarter of a beat apart, on a one-second beat.
const setup = () => {
  let now = 0;
  const played: Array<[string, number]> = [];
  const arp = new LiveArp(() => now, 60_000);
  const lane: LiveArpLane = {
    beat: () => 1,
    pulses: (notes, beat) => Array.from({ length: 4 }, (_, index) => ({ note: notes[index % notes.length], offset: index * beat / 4, duration: 0.1 })),
    play: (note, time) => { played.push([note, Math.round(time * 1000) / 1000]); },
  };
  const at = (seconds: number) => { now = seconds; arp.tick(); };
  return { arp, lane, played, at };
};

test('a held key is arpeggiated beat after beat until it is let go, and then stops at once', () => {
  const { arp, lane, played, at } = setup();
  arp.press(1, 'C4', 1, lane);
  for (let t = 0; t <= 2.5; t += 0.05) at(t);
  assert.deepEqual(played.map(([, time]) => time), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5], 'it runs past the first beat');
  arp.release(1, 'C4');
  const count = played.length;
  for (let t = 2.55; t <= 4; t += 0.05) at(t);
  assert.equal(played.length, count, 'nothing more after the key is let go');
  assert.equal(arp.holds(1), false);
  arp.stop();
});

test('keys pressed together are one chord with no note twice, and a key let go restarts the pattern with what is held', () => {
  const { arp, lane, played, at } = setup();
  arp.press(1, 'C4', 1, lane);
  at(0.02);
  arp.press(1, 'E4', 1, lane);
  for (let t = 0.02; t <= 0.9; t += 0.05) at(t);
  assert.deepEqual(played, [['C4', 0], ['E4', 0.25], ['C4', 0.5], ['E4', 0.75]], 'the second key joins the beat the first began');

  played.length = 0;
  at(1.3);
  arp.release(1, 'C4');
  for (let t = 1.3; t <= 1.9; t += 0.05) at(t);
  assert.deepEqual(played.filter(([, time]) => time >= 1.3).map(([note]) => note), ['E4', 'E4', 'E4'], 'only what is still held plays from the moment of letting go');
  arp.stop();
});

test('lanes run apart, a lane with nothing to play stops asking, and stop lets everything go', () => {
  const { arp, lane, played, at } = setup();
  const silent: LiveArpLane = { ...lane, pulses: () => [] };
  arp.press(1, 'C4', 1, lane);
  arp.press(2, 'G4', 1, silent);
  for (let t = 0; t <= 1; t += 0.05) at(t);
  assert.ok(played.length > 0 && played.every(([note]) => note === 'C4'));
  arp.stop();
  assert.equal(arp.holds(1), false);
  assert.equal(arp.holds(2), false);
});
