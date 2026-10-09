import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { MAX_STEP_NOTES, expandStepNotes, stepNotes, withStepNotes } from '../src/services/noteScheduling.ts';
import { sanitizeSteps } from '../src/services/projectSanitization.ts';
import { renderSynthLane } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, Pattern, SequencerStep, SynthParameters } from '../src/types.ts';

const { importMidiFile } = createRequire(import.meta.url)('../src/utils/midiImport.ts') as typeof import('../src/utils/midiImport.ts');

const SR = 44100;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const empty = (): SequencerStep => ({ active: false, velocity: 0.7 });
const lane = (steps: Record<number, SequencerStep>, length = 16): Pattern =>
  ({ id: 'p', name: 'p', tempo: 120, steps: Array.from({ length }, (_, index) => steps[index] ?? empty()) });
const params = (patch: (value: SynthParameters) => void = () => {}) => { const value = createDefaultSynthParameters(); patch(value); return value; };

test('a step holds a chord, lowest note first, and never more than the limit', () => {
  const chord = withStepNotes({ active: false, velocity: 0.9, slide: true }, ['G3', 'C3', 'E3', 'C3']);
  assert.deepEqual(chord, { velocity: 0.9, slide: true, active: true, note: 'C3', notes: ['E3', 'G3'] });
  assert.deepEqual(stepNotes(chord), ['C3', 'E3', 'G3']);
  assert.deepEqual(withStepNotes(chord, ['E3']), { velocity: 0.9, slide: true, active: true, note: 'E3' }, 'one note leaves no chord list behind');
  assert.deepEqual(withStepNotes({ ...chord, length: 4 }, []), { velocity: 0.9, slide: true, active: false }, 'no notes is an empty step, and its length goes too');
  assert.equal(withStepNotes({ ...chord, length: 4 }, ['D3', 'A3']).length, 4, 'changing the chord keeps its length');
  assert.equal(stepNotes(withStepNotes(empty(), ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', 'C3'])).length, MAX_STEP_NOTES);
  assert.deepEqual(stepNotes({ active: false, note: 'C3', notes: ['E3'], velocity: 1 }), [], 'an inactive step plays nothing');
  assert.deepEqual(stepNotes({ active: true, note: 'C3', velocity: 1 }), ['C3'], 'steps saved before chords existed still play');
});

test('a chord plays every note for the step\'s whole length', () => {
  const step: SequencerStep = { active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 0.8, length: 4 };
  const played = expandStepNotes(step, params(), 0.125, 120);
  assert.deepEqual(played.map(note => note.note), ['C3', 'E3', 'G3']);
  for (const note of played) {
    assert.equal(note.offset, 0);
    assert.ok(note.duration > 0.125 * 3.5 && note.duration < 0.125 * 4, 'four steps long, ending just before the fifth');
  }
  const short = expandStepNotes({ ...step, length: undefined }, params(), 0.125, 120);
  assert.ok(short[0].duration < 0.125);
  assert.ok(expandStepNotes({ ...step, slide: true }, params(), 0.125, 120)[0].duration > 0.125 * 4, 'a slide still runs into the next step');
  assert.deepEqual(expandStepNotes(empty(), params(), 0.125, 120), []);
});

test('the arpeggiator runs through a chord\'s own notes, across its length', () => {
  const arp = params(value => { value.arpeggiator = { enabled: true, mode: 'up', rate: '1/16', gate: 0.5 }; });
  const step: SequencerStep = { active: true, note: 'C3', notes: ['D#3', 'G3'], velocity: 0.8, length: 4 };
  const up = expandStepNotes(step, arp, 0.125, 120);
  assert.deepEqual(up.map(note => note.note), ['C3', 'D#3', 'G3', 'C3'], 'minor chord, not the built-in major shape');
  assert.deepEqual(up.map(note => note.offset), [0, 0.125, 0.25, 0.375]);
  arp.arpeggiator.mode = 'down';
  assert.deepEqual(expandStepNotes(step, arp, 0.125, 120).map(note => note.note), ['G3', 'D#3', 'C3', 'G3']);
  arp.arpeggiator.mode = 'updown';
  assert.deepEqual(expandStepNotes({ ...step, length: 6 }, arp, 0.125, 120).map(note => note.note), ['C3', 'D#3', 'G3', 'D#3', 'C3', 'D#3']);
  arp.arpeggiator.mode = 'up';
  assert.deepEqual(expandStepNotes({ active: true, note: 'C3', velocity: 1, length: 4 }, arp, 0.125, 120).map(note => note.note), ['C3', 'E3', 'G3', 'C4'], 'a single note keeps the old behaviour');
});

test('chords and lengths read from storage are checked', () => {
  const [chord, junk, long, silent] = sanitizeSteps([
    { active: true, note: 'C3', notes: ['E3', 'C3', 'E3', 'nope', 7, 'G3'], velocity: 0.5, length: 3 },
    { active: true, note: 'C3', notes: 'E3', velocity: 0.5, length: 2.5 },
    { active: true, note: 'C3', notes: ['D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'], velocity: 0.5, length: 999 },
    { active: false, notes: ['E3'], velocity: 0.5, length: 4 },
  ]);
  assert.deepEqual(chord, { active: true, note: 'C3', velocity: 0.5, notes: ['E3', 'G3'], length: 3 });
  assert.deepEqual(junk, { active: true, note: 'C3', velocity: 0.5 });
  assert.equal(stepNotes(long).length, MAX_STEP_NOTES);
  assert.equal(long.length, 14, 'a note cannot be longer than what is left of the pattern');
  assert.deepEqual(silent, { active: false, velocity: 0.5 }, 'a step with no main note has no chord');
});

test('exported audio contains the chord and holds a long note', () => {
  const sound = params(value => { value.envelope = { attack: 0.002, decay: 0.05, sustain: 0.8, release: 0.03 }; value.effects.reverb.wet = 0; value.effects.delay.wet = 0; });
  const frames = SR * 2, step = SR * 0.125;
  const single = renderSynthLane(lane({ 0: { active: true, note: 'C3', velocity: 0.8 } }), sound, 120, frames, SR)[0];
  const chord = renderSynthLane(lane({ 0: { active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 0.8 } }), sound, 120, frames, SR)[0];
  const long = renderSynthLane(lane({ 0: { active: true, note: 'C3', velocity: 0.8, length: 8 } }), sound, 120, frames, SR)[0];
  assert.ok(chord.every(Number.isFinite));
  assert.ok(rms(chord.subarray(0, step)) > rms(single.subarray(0, step)) * 1.3, 'three notes are louder than one');
  const later = (samples: Float32Array) => rms(samples.subarray(Math.round(step * 5), Math.round(step * 7)));
  assert.ok(later(single) < 0.002, 'a one-step note is over by step 6');
  assert.ok(later(long) > 0.02, 'an eight-step note is still sounding');
  assert.ok(rms(long.subarray(Math.round(step * 10), Math.round(step * 12))) < 0.002, 'and has stopped by step 11');
  assert.deepEqual(renderSynthLane(lane({ 0: { active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 0.8 } }), sound, 120, frames, SR)[0], chord, 'the render is repeatable');
});

test('chords and note lengths survive a trip through a MIDI file', () => {
  const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), stepVelocities: Array(16).fill(1), muted: false, solo: false, settings: { volume: 1, tone: .5, extra: .5 },
  }])) as DrumState;
  const steps = lane({
    0: { active: true, note: 'C3', notes: ['E3', 'G3'], velocity: 0.8, length: 4 },
    4: { active: true, note: 'F3', velocity: 0.6 },
    8: { active: true, note: 'D3', notes: ['A3'], velocity: 0.8, length: 8 },
  }).steps;
  const bytes = createMidiFile({ tempo: 120, drumState: drums, drumSwing: 0, drumMasterVolume: 1, synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo: 120, steps } }] });
  const imported = importMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const back = imported.tracks.find(track => track.pattern)!.pattern!.steps;
  assert.deepEqual(stepNotes(back[0]), ['C3', 'E3', 'G3']);
  assert.equal(back[0].length, 4);
  assert.deepEqual(stepNotes(back[4]), ['F3']);
  assert.equal(back[4].length, undefined);
  assert.deepEqual(stepNotes(back[8]), ['D3', 'A3']);
  assert.equal(back[8].length, 8);
  assert.equal(back.filter(step => step.active).length, 3);
});
