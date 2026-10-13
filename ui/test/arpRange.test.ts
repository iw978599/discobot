import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { expandStepNotes } from '../src/services/noteScheduling.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import type { SequencerStep, SynthParameters } from '../src/types.ts';

type Arp = SynthParameters['arpeggiator'];
const arp = (extra: Partial<Arp> = {}): SynthParameters => ({ ...createDefaultSynthParameters(), arpeggiator: { enabled: true, mode: 'up', rate: '1/16', gate: 0.5, ...extra } });
const single = (length: number): SequencerStep => ({ active: true, note: 'C3', velocity: 1, length });
const chord = (length: number): SequencerStep => ({ active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 1, length });
const played = (step: SequencerStep, params: SynthParameters) => expandStepNotes(step, params, 0.125, 120).map(note => note.note);

test('with no range chosen the arpeggiator is as it was: a note through three octaves, a chord through its own notes', () => {
  assert.deepEqual(played(single(6), arp()), ['C3', 'C4', 'C5', 'C3', 'C4', 'C5']);
  assert.deepEqual(played(chord(6), arp()), ['C3', 'E3', 'G3', 'C3', 'E3', 'G3']);
  assert.deepEqual(played(chord(6), arp({ mode: 'converge' })), ['C3', 'E3', 'G3', 'C3', 'E3', 'G3'], 'a chord took converge as up, and still does');
  assert.deepEqual(played(single(3), arp({ mode: 'converge' })), ['C3', 'C5', 'C4']);
  assert.deepEqual(played(single(3), arp({ mode: 'diverge' })), ['C4', 'C3', 'C5']);
});

test('a chosen range sets how many octaves a note or a chord runs through', () => {
  assert.deepEqual(played(single(4), arp({ octaves: 1 })), ['C3', 'C3', 'C3', 'C3'], 'one octave is the note itself, repeated');
  assert.deepEqual(played(single(4), arp({ octaves: 2 })), ['C3', 'C4', 'C3', 'C4']);
  assert.deepEqual(played(single(6), arp({ octaves: 3 })), played(single(6), arp()), 'three is what a single note always did');
  assert.deepEqual(played(chord(6), arp({ octaves: 1 })), played(chord(6), arp()), 'one is what a chord always did');
  assert.deepEqual(played(chord(6), arp({ octaves: 2 })), ['C3', 'E3', 'G3', 'C4', 'E4', 'G4']);
  assert.deepEqual(played(chord(6), arp({ octaves: 2, mode: 'down' })), ['G4', 'E4', 'C4', 'G3', 'E3', 'C3']);
  assert.deepEqual(played(single(4), arp({ octaves: 2, mode: 'updown' })), ['C3', 'C4', 'C3', 'C4']);
  assert.deepEqual(played(single(4), arp({ octaves: 3, mode: 'updown' })), ['C3', 'C4', 'C5', 'C4']);
  // From the ends inwards, and from the middle outwards.
  assert.deepEqual(played(chord(6), arp({ octaves: 2, mode: 'converge' })), ['C3', 'G4', 'E3', 'E4', 'G3', 'C4']);
  assert.deepEqual(played(chord(6), arp({ octaves: 2, mode: 'diverge' })), ['C4', 'G3', 'E4', 'E3', 'G4', 'C3']);
  // A note too high to name is left out, not played wrong.
  assert.ok(played({ active: true, note: 'C9', velocity: 1, length: 4 }, arp({ octaves: 3 })).every(note => note === 'C9'));
});

test('a stored range is 1 to 3 or nothing, and a sound saved before it has none', () => {
  const defaults = createDefaultSynthParameters();
  assert.equal('octaves' in sanitizeSynthParams(defaults, defaults).arpeggiator, false);
  assert.equal(sanitizeSynthParams({ ...defaults, arpeggiator: { ...defaults.arpeggiator, octaves: 2 } }, defaults).arpeggiator.octaves, 2);
  assert.equal(sanitizeSynthParams({ ...defaults, arpeggiator: { ...defaults.arpeggiator, octaves: 99 } }, defaults).arpeggiator.octaves, 3);
  for (const none of [0, -4, 'many', null, 0.2]) {
    assert.equal('octaves' in sanitizeSynthParams({ ...defaults, arpeggiator: { ...defaults.arpeggiator, octaves: none } }, defaults).arpeggiator, false, String(none));
  }
});
