import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockFollower } from '../src/services/midiClockFollow.ts';
import { MIDI_DRUM_CHANNEL, createMidiOut, outChannel } from '../src/services/midiOutput.ts';

test('a clock\'s pulses give its tempo once a beat has been heard, steady through a little jitter', () => {
  const follower = createClockFollower();
  const perPulse = 60000 / 120 / 24;
  const answers = Array.from({ length: 25 }, (_, pulse) => follower.pulse(1000 + pulse * perPulse + (pulse % 2 ? 0.4 : -0.4)));
  assert.deepEqual(answers.slice(0, 24), Array(24).fill(null));
  assert.equal(answers[24], 120);
  // The clock speeds up: after another beat it reads the new tempo.
  let last: number | null = null;
  for (let pulse = 0; pulse < 24; pulse++) last = follower.pulse(1000 + 24 * perPulse + (pulse + 1) * (60000 / 140 / 24));
  assert.ok(Math.abs((last ?? 0) - 140) <= 0.1, `${last}`);
});

test('a clock that stopped, or a pulse out of order, begins a new count; tempos are held to 20 to 400', () => {
  const follower = createClockFollower(4);
  [0, 10, 20, 30].forEach(at => follower.pulse(at));
  assert.equal(follower.pulse(5000), null, 'after a gap of seconds');
  const fast = createClockFollower(2);
  fast.pulse(0); fast.pulse(0.1);
  assert.equal(fast.pulse(0.2), 400);
  const back = createClockFollower(2);
  back.pulse(100); back.pulse(110);
  assert.equal(back.pulse(50), null, 'out of order');
  assert.equal(back.pulse(Number.NaN), null);
});

test('each part goes out on its own channel, or the one chosen for it', () => {
  assert.equal(outChannel({}, 3), 3);
  assert.equal(outChannel({}, 'drums'), MIDI_DRUM_CHANNEL);
  assert.equal(outChannel({ 3: 9, drums: 2 }, 3), 9);
  assert.equal(outChannel({ drums: 2 }, 'drums'), 2);
  for (const bad of [0, 17, 2.5, Number.NaN]) assert.equal(outChannel({ 1: bad }, 1), 1);
});

test('notes played by hand are sent at once on their lane\'s channel, only while sending them is on, and let go when it is turned off', () => {
  const sent: number[][] = [];
  const out = createMidiOut();
  out.setPort({ id: 'synth', send: data => sent.push([...data]) });
  out.played({ kind: 'note', lane: 2, note: 'C4', velocity: 1, on: true });
  assert.deepEqual(sent, [], 'off to begin with');
  out.configure({ played: true, channels: { 2: 5, drums: 11 } });
  out.played({ kind: 'note', lane: 2, note: 'C4', velocity: 1, on: true });
  out.played({ kind: 'note', lane: 2, note: 'C4', velocity: 0, on: false });
  out.played({ kind: 'hit', drum: 'kick', velocity: 0.5 });
  assert.deepEqual(sent, [[0x94, 60, 127], [0x84, 60, 0], [0x9a, 36, 64], [0x8a, 36, 0]]);
  sent.length = 0;
  out.played({ kind: 'note', lane: 1, note: 'A4', velocity: 0.5, on: true });
  out.configure({ played: false });
  assert.deepEqual(sent, [[0x90, 69, 64], [0x80, 69, 0]], 'a key still down is let go');
  assert.equal(out.channelOf(2), 5);
});
