import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { expandStepNotes, noteLengths, stepNotes, withStepLength, withStepNotes } from '../src/services/noteScheduling.ts';
import { clampLengths } from '../src/services/patternLength.ts';
import { sanitizeSteps } from '../src/services/projectSanitization.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, SequencerStep } from '../src/types.ts';

const { importMidiFile } = createRequire(import.meta.url)('../src/utils/midiImport.ts') as typeof import('../src/utils/midiImport.ts');

const chord = (extra: Partial<SequencerStep> = {}): SequencerStep => ({ active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 0.8, ...extra });
const params = createDefaultSynthParameters();
const STEP = 0.125;
const durations = (step: SequencerStep) => Object.fromEntries(expandStepNotes(step, params, STEP, 120).map(note => [note.note, note.duration]));

test('a step saved before a note could have its own length is read and played as it was', () => {
  const old = chord({ length: 4 });
  assert.deepEqual(noteLengths(old), [4, 4, 4]);
  assert.deepEqual(noteLengths(chord()), [1, 1, 1]);
  assert.deepEqual(noteLengths({ active: false, velocity: 0.7 }), []);
  // Changing its notes keeps it in the shape it had: one length and no list.
  assert.deepEqual(withStepNotes(old, ['C3', 'E3']), { active: true, note: 'C3', notes: ['E3'], velocity: 0.8, length: 4 });
  assert.deepEqual(withStepNotes(old, [...stepNotes(old), 'B3']), { active: true, note: 'C3', notes: ['E3', 'G3', 'B3'], velocity: 0.8, length: 4 });
  // And it sounds the same: every note for the step's whole length.
  const all = durations(old);
  assert.equal(new Set(Object.values(all)).size, 1);
  assert.ok(Math.abs(all.C3 - (STEP * 3 + STEP * 0.92)) < 1e-9);
  assert.deepEqual(sanitizeSteps([old])[0], old, 'and storage leaves it alone');
});

test('one note of a chord can be made longer or shorter than the others', () => {
  const stretched = withStepLength(chord(), 4, 'G3');
  assert.deepEqual(stretched, { active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 0.8, length: 4, lengths: [1, 1, 4] });
  assert.deepEqual(noteLengths(stretched), [1, 1, 4]);
  const heard = durations(stretched);
  assert.ok(heard.G3 > heard.C3 * 3 && heard.C3 === heard.E3, 'the one note rings on and the others stop');

  // The step's own length is always its longest note's, so whatever only knows that still sees the whole of it.
  const shorter = withStepLength(stretched, 2, 'G3');
  assert.deepEqual([shorter.length, shorter.lengths], [2, [1, 1, 2]]);
  // Brought back level with the others, it needs no list of its own.
  assert.deepEqual(withStepLength(stretched, 1, 'G3'), chord());
  // Every note together, as before there was a choice.
  assert.deepEqual(withStepLength(stretched, 3), chord({ length: 3 }));
  assert.deepEqual(withStepLength(chord({ length: 3 }), 1), chord());
  // A note that is not in the step changes nothing; an empty step has no length.
  assert.deepEqual(withStepLength(stretched, 8, 'A9'), stretched);
  assert.deepEqual(withStepLength({ active: false, velocity: 0.7, length: 3 }, 2), { active: false, velocity: 0.7 });
});

test('a note keeps its own length as others come and go, and the step shrinks when its longest note leaves', () => {
  const stretched = withStepLength(chord(), 4, 'E3');
  assert.deepEqual(stretched.lengths, [1, 4, 1]);
  // A new note lasts as long as the step does.
  const joined = withStepNotes(stretched, [...stepNotes(stretched), 'D3']);
  assert.deepEqual([stepNotes(joined), noteLengths(joined)], [['C3', 'D3', 'E3', 'G3'], [1, 4, 4, 1]]);
  // Taking the long one out leaves a plain short chord.
  assert.deepEqual(withStepNotes(stretched, ['C3', 'G3']), { active: true, note: 'C3', notes: ['G3'], velocity: 0.8 });
  // Emptied, the step keeps nothing.
  assert.deepEqual(withStepNotes(stretched, []), { active: false, velocity: 0.8 });
});

test('lengths read from storage are checked, and held to the room left in the pattern', () => {
  const [kept, level, bad, short] = sanitizeSteps([
    chord({ length: 4, lengths: [1, 2, 4] }),
    chord({ length: 4, lengths: [4, 4, 4] }),
    chord({ length: 4, lengths: [99, -3, 'long', 2] as unknown as number[] }),
    chord({ length: 4, lengths: [2, 2, 1] }),
  ]);
  assert.deepEqual([kept.length, kept.lengths], [4, [1, 2, 4]]);
  assert.deepEqual([level.length, 'lengths' in level], [4, false], 'notes that all last alike need no list');
  assert.deepEqual([bad.length, bad.lengths], [4, [4, 1, 4]], 'each is held to between one step and the step\'s length');
  assert.deepEqual([short.length, short.lengths], [2, [2, 2, 1]], 'the step is as long as its longest note');

  const steps: SequencerStep[] = Array.from({ length: 16 }, () => ({ active: false, velocity: 0.7 }));
  steps[14] = chord({ length: 6, lengths: [1, 3, 6] });
  const clamped = clampLengths(steps)[14];
  assert.deepEqual([clamped.length, clamped.lengths], [2, [1, 2, 2]]);
  steps[15] = chord({ length: 6, lengths: [1, 3, 6] });
  assert.deepEqual(clampLengths(steps)[15], chord(), 'on the last step every note is one step long');
});

test('the arpeggiator and repeats use the step\'s whole length, and a MIDI file carries each note\'s own', () => {
  const stretched = withStepLength(chord(), 4, 'G3');
  const arp = { ...params, arpeggiator: { enabled: true, mode: 'up' as const, rate: '1/16' as const, gate: 0.5 } };
  assert.equal(expandStepNotes(stretched, arp, STEP, 120).length, 4, 'four sixteenths of arpeggio across the four steps');
  const repeated = expandStepNotes({ ...stretched, ratchet: 2 }, params, STEP, 120);
  assert.deepEqual([...new Set(repeated.map(note => note.offset))], [0, STEP * 2], 'repeats share out the whole length');

  const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), stepVelocities: Array(16).fill(1), muted: false, solo: false, settings: { volume: 1, tone: .5, extra: .5 },
  }])) as DrumState;
  const steps: SequencerStep[] = Array.from({ length: 16 }, () => ({ active: false, velocity: 0.7 }));
  steps[0] = withStepLength(withStepLength(chord(), 8, 'C3'), 2, 'E3');
  steps[8] = chord({ length: 4 });
  const bytes = createMidiFile({ tempo: 120, drumState: drums, drumSwing: 0, drumMasterVolume: 1, synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo: 120, steps } }] });
  const back = importMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).tracks.find(track => track.pattern)!.pattern!.steps;
  assert.deepEqual([stepNotes(back[0]), noteLengths(back[0])], [['C3', 'E3', 'G3'], [8, 2, 1]]);
  assert.deepEqual([back[8].length, 'lengths' in back[8]], [4, false], 'a chord whose notes last alike comes back as one');
});
