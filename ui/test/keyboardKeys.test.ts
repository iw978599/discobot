import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardKeyTarget, keyboardNotes, octaveOnShow } from '../src/services/keyboardKeys.ts';

const notes = keyboardNotes([3, 4, 5]);

test('the keys run from the lowest to the highest, black keys in their places', () => {
  assert.equal(notes.length, 36);
  assert.deepEqual(notes.slice(0, 4), ['C3', 'C#3', 'D3', 'D#3']);
  assert.deepEqual(notes.slice(11, 13), ['B3', 'C4']);
  assert.equal(notes[35], 'B5');
});

test('left and right go a semitone, across an octave too, and stop at the ends', () => {
  assert.equal(keyboardKeyTarget('ArrowRight', notes, 'C3'), 'C#3');
  assert.equal(keyboardKeyTarget('ArrowRight', notes, 'E3'), 'F3');
  assert.equal(keyboardKeyTarget('ArrowRight', notes, 'B3'), 'C4');
  assert.equal(keyboardKeyTarget('ArrowLeft', notes, 'C4'), 'B3');
  assert.equal(keyboardKeyTarget('ArrowLeft', notes, 'C3'), null);
  assert.equal(keyboardKeyTarget('ArrowRight', notes, 'B5'), null);
});

test('Home and End go to the ends, and nowhere from them', () => {
  assert.equal(keyboardKeyTarget('Home', notes, 'F#4'), 'C3');
  assert.equal(keyboardKeyTarget('End', notes, 'F#4'), 'B5');
  assert.equal(keyboardKeyTarget('Home', notes, 'C3'), null);
  assert.equal(keyboardKeyTarget('End', notes, 'B5'), null);
});

test('any other key, or a note that is not on the keyboard, goes nowhere', () => {
  assert.equal(keyboardKeyTarget('ArrowUp', notes, 'C4'), null);
  assert.equal(keyboardKeyTarget(' ', notes, 'C4'), null);
  assert.equal(keyboardKeyTarget('ArrowRight', notes, 'C7'), null);
});

test('an octave that is off the strip is brought on show, and one that is on it moves nothing', () => {
  assert.equal(octaveOnShow(1, 1, 1), 1);
  assert.equal(octaveOnShow(2, 1, 1), 2);
  assert.equal(octaveOnShow(0, 1, 1), 0);
  assert.equal(octaveOnShow(2, 0, 2), 1);
  assert.equal(octaveOnShow(1, 0, 2), 0);
  assert.equal(octaveOnShow(0, 1, 2), 0);
  assert.equal(octaveOnShow(2, 0, 3), 0);
});
