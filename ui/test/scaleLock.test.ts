// The scale lock (roadmap 16): which notes are in a key and scale, where a note outside it goes, the
// chords made of its notes, and the one store every lane and the keyboard read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inScale, keyChord, scaleLock, toScale } from '../src/services/scaleLock.ts';
import { chordNotes } from '../src/services/chords.ts';

const C_MAJOR = { key: 'C', scale: 'major' } as const;
const A_MINOR_PENTATONIC = { key: 'A', scale: 'minor-pentatonic' } as const;

test('a note is in the scale when its pitch class is, in any octave', () => {
  assert.deepEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C#4', 'F#2', 'A#6'].map(note => inScale(note, C_MAJOR)), [true, true, true, true, true, true, true, false, false, false]);
  assert.deepEqual(['A3', 'C5', 'D1', 'E4', 'G7', 'B4', 'F4'].map(note => inScale(note, A_MINOR_PENTATONIC)), [true, true, true, true, true, false, false]);
  assert.equal(inScale('not a note', C_MAJOR), false);
});

test('a note outside the scale goes to the nearest note in it, the lower when two are as near', () => {
  assert.equal(toScale('E4', C_MAJOR), 'E4', 'a note in the scale stays');
  assert.equal(toScale('C#4', C_MAJOR), 'C4', 'a semitone either way: the lower');
  assert.equal(toScale('F#3', C_MAJOR), 'F3');
  // In A minor pentatonic (A C D E G), B is a tone above A and a semitone below C: C is nearer.
  assert.equal(toScale('B4', A_MINOR_PENTATONIC), 'C5');
  assert.equal(toScale('F4', A_MINOR_PENTATONIC), 'E4');
  assert.equal(toScale('not a note', C_MAJOR), 'not a note');
});

test('a chord in the key is every other note of the scale from its root, and the menu builds it', () => {
  assert.deepEqual(keyChord('C4', C_MAJOR, 3), ['C4', 'E4', 'G4']);
  assert.deepEqual(keyChord('D4', C_MAJOR, 3), ['D4', 'F4', 'A4'], 'a minor triad, from the key');
  assert.deepEqual(keyChord('B3', C_MAJOR, 4), ['B3', 'D4', 'F4', 'A4'], 'the seventh chord on the seventh degree');
  assert.deepEqual(keyChord('C#4', C_MAJOR, 3), ['C4', 'E4', 'G4'], 'a root outside the key is moved into it first');
  assert.deepEqual(keyChord('A3', A_MINOR_PENTATONIC, 3), ['A3', 'D4', 'G4'], 'wider in a pentatonic scale');
  assert.deepEqual(chordNotes('D4', 'key-triad', 0, C_MAJOR), ['D4', 'F4', 'A4']);
  assert.deepEqual(chordNotes('D4', 'key-triad', 1, C_MAJOR), ['D4', 'F3', 'A3'], 'an inversion takes the notes above down an octave');
  assert.deepEqual(chordNotes('D4', 'key-seventh', 0, C_MAJOR), ['D4', 'F4', 'A4', 'C5']);
  assert.deepEqual(chordNotes('D4', 'key-triad'), ['D4'], 'with no key, the root alone');
  assert.deepEqual(chordNotes('D4', 'minor'), ['D4', 'F4', 'A4'], 'the fixed shapes are as they were');
});

test('the store is one for the whole studio: a change is seen by everyone reading it', () => {
  const seen: boolean[] = [];
  const stop = scaleLock.subscribe(() => seen.push(scaleLock.get().locked));
  const before = scaleLock.get();
  scaleLock.setLocked(true);
  scaleLock.choose({ key: 'D', scale: 'minor' });
  assert.deepEqual(scaleLock.get(), { key: 'D', scale: 'minor', locked: true });
  assert.notEqual(scaleLock.get(), before, 'a new object when something changes');
  assert.equal(scaleLock.get(), scaleLock.get(), 'and the same one until then');
  scaleLock.choose({ scale: 'nonsense' as never });
  assert.equal(scaleLock.get().scale, 'minor-pentatonic', 'a scale it does not have is the default');
  scaleLock.setLocked(false);
  stop();
  assert.deepEqual(seen, [true, true, true, false]);
});

test('a ninth in the key is five of its notes, every other one upwards', () => {
  assert.deepEqual(chordNotes('C4', 'key-ninth', 0, C_MAJOR), ['C4', 'E4', 'G4', 'B4', 'D5']);
  assert.deepEqual(keyChord('D4', { key: 'D', scale: 'dorian' }, 5), ['D4', 'F4', 'A4', 'C5', 'E5']);
  assert.deepEqual(keyChord('A3', { key: 'A', scale: 'harmonic-minor' }, 4), ['A3', 'C4', 'E4', 'G#4']);
  assert.equal(inScale('F#4', { key: 'C', scale: 'lydian' }), true);
  assert.equal(inScale('F4', { key: 'C', scale: 'lydian' }), false);
});
