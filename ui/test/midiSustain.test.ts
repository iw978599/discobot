import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiSustain, SUSTAIN_PEDAL, pedalDown } from '../src/services/midiSustain.ts';

test('the sustain pedal is controller 64, down from the middle of its travel', () => {
  assert.equal(SUSTAIN_PEDAL, 64);
  assert.equal(pedalDown(127), true);
  assert.equal(pedalDown(64), true);
  assert.equal(pedalDown(63), false);
  assert.equal(pedalDown(0), false);
});

test('with the pedal down a key let go keeps sounding, until the pedal comes up', () => {
  const sustain = new MidiSustain();
  assert.equal(sustain.keep('keys', 'C4'), false, 'with the pedal up a key is let go as usual');
  assert.deepEqual(sustain.pedal('keys', true), []);
  assert.equal(sustain.keep('keys', 'C4'), true);
  assert.equal(sustain.keep('keys', 'E4'), true);
  assert.deepEqual(sustain.pedal('keys', true), [], 'the pedal held still lets nothing go');
  assert.deepEqual(sustain.pedal('keys', false).sort(), ['C4', 'E4']);
  assert.equal(sustain.keep('keys', 'C4'), false);
  assert.deepEqual(sustain.pedal('keys', false), []);
});

test('each controller has a pedal of its own', () => {
  const sustain = new MidiSustain();
  sustain.pedal('keys', true);
  assert.equal(sustain.keep('pads', 'C4'), false);
  assert.equal(sustain.keep('keys', 'C4'), true);
  assert.deepEqual(sustain.pedal('pads', false), []);
  assert.deepEqual(sustain.pedal('keys', false), ['C4']);
});

test('a key played again while the pedal keeps it is let go first, and an unplugged controller lets go of all it kept', () => {
  const sustain = new MidiSustain();
  sustain.pedal('keys', true);
  sustain.keep('keys', 'C4');
  assert.equal(sustain.struck('keys', 'C4'), true, 'the note it kept is let go before it sounds again');
  assert.equal(sustain.struck('keys', 'C4'), false);
  sustain.keep('keys', 'C4');
  sustain.keep('keys', 'G4');
  assert.deepEqual(sustain.forget('keys').sort(), ['C4', 'G4']);
  assert.equal(sustain.keep('keys', 'C4'), false, 'and its pedal is up again');
});
