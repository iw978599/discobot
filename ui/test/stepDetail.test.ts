import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { expandStepNotes, withStepNotes } from '../src/services/noteScheduling.ts';
import { seededRandom } from '../src/services/drumScheduling.ts';
import { delaySeconds } from '../src/services/delayTime.ts';
import { sanitizeEffects, sanitizeSteps, matchesShape } from '../src/services/projectSanitization.ts';
import { renderSynthLane } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, EffectsLoopState, Pattern, SequencerStep } from '../src/types.ts';

const { importMidiFile } = createRequire(import.meta.url)('../src/utils/midiImport.ts') as typeof import('../src/utils/midiImport.ts');

const SR = 44100;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const params = createDefaultSynthParameters();
const lane = (steps: Record<number, SequencerStep>, length = 16): Pattern =>
  ({ id: 'p', name: 'p', tempo: 120, steps: Array.from({ length }, (_, index) => steps[index] ?? { active: false, velocity: 0.7 }) });
const effects: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};

test('a step with a chance plays about that often, and the same way every time for a given seed', () => {
  const step: SequencerStep = { active: true, note: 'C3', velocity: 0.8, probability: 0.25 };
  const run = (seed: number) => { const random = seededRandom(seed); return Array.from({ length: 400 }, () => expandStepNotes(step, params, 0.125, 120, random).length); };
  const played = run(7).filter(Boolean).length;
  assert.ok(played > 70 && played < 130, `about a quarter of 400, got ${played}`);
  assert.deepEqual(run(7), run(7));
  assert.equal(expandStepNotes({ ...step, probability: 0 }, params, 0.125, 120, () => 0).length, 0);
  assert.equal(expandStepNotes({ ...step, probability: undefined }, params, 0.125, 120, () => 0.999).length, 1, 'no chance set means always');
});

test('repeats divide a step\'s length evenly, for every note of a chord', () => {
  const step: SequencerStep = { active: true, note: 'C3', notes: ['G3'], velocity: 0.8, ratchet: 4, length: 2 };
  const played = expandStepNotes(step, params, 0.125, 120);
  assert.deepEqual(played.map(note => [note.note, note.offset]), [['C3', 0], ['G3', 0], ['C3', 0.0625], ['G3', 0.0625], ['C3', 0.125], ['G3', 0.125], ['C3', 0.1875], ['G3', 0.1875]]);
  assert.ok(played.every(note => note.duration < 0.0625), 'each repeat ends before the next');
  assert.ok(expandStepNotes({ ...step, slide: true }, params, 0.125, 120).at(-1)!.duration > 0.0625, 'only the last repeat slides on');
  assert.equal(expandStepNotes({ ...step, ratchet: 99 }, params, 0.125, 120).length, 8, 'never more than four');
});

test('a late step starts between its step and the next, in audio and in MIDI', () => {
  const step: SequencerStep = { active: true, note: 'C3', velocity: 0.8, offset: 0.5 };
  assert.equal(expandStepNotes(step, params, 0.125, 120)[0].offset, 0.0625);
  assert.equal(expandStepNotes({ ...step, offset: 5 }, params, 0.125, 120)[0].offset, 0.125 * 0.95, 'never as late as the next step');
  assert.deepEqual(expandStepNotes({ ...step, ratchet: 2 }, params, 0.125, 120).map(note => note.offset), [0.0625, 0.125]);

  const frames = SR, stepFrames = SR * 0.125;
  const late = renderSynthLane(lane({ 4: step }), params, 120, frames, SR)[0];
  assert.ok(rms(late.subarray(stepFrames * 4, Math.round(stepFrames * 4.45))) < 0.0005, 'silent for the first half of its step');
  assert.ok(rms(late.subarray(Math.round(stepFrames * 4.55), stepFrames * 5)) > 0.01, 'sounding in the second half');

  const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), stepVelocities: Array(16).fill(1), muted: false, solo: false, settings: { volume: 1, tone: .5, extra: .5 },
  }])) as DrumState;
  const steps = lane({ 0: { active: true, note: 'C3', velocity: 0.8 }, 4: { active: true, note: 'E3', notes: ['G3'], velocity: 0.8, offset: 0.5 }, 8: { active: true, note: 'A3', velocity: 0.8, ratchet: 2 } }).steps;
  const bytes = createMidiFile({ tempo: 120, drumState: drums, drumSwing: 0, drumMasterVolume: 1, synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo: 120, steps } }] });
  const back = importMidiFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).tracks.find(track => track.pattern)!.pattern!.steps;
  // Half a sixteenth late is exactly a thirty-second, so the lane comes back at 32 steps with the note on the grid.
  assert.equal(back.length, 32);
  assert.deepEqual([back[9].note, back[9].notes, back[9].offset], ['E3', ['G3'], undefined]);
  assert.deepEqual([back[16].note, back[17].note], ['A3', 'A3'], 'both repeats arrive as notes');

  // A third of a step late is on no grid: it keeps its place as a late start.
  const swung = lane({ 0: { active: true, note: 'C3', velocity: 0.8 }, 4: { active: true, note: 'E3', velocity: 0.8, offset: 1 / 3 } }).steps;
  const swungBytes = createMidiFile({ tempo: 120, drumState: drums, drumSwing: 0, drumMasterVolume: 1, synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo: 120, steps: swung } }] });
  const swungBack = importMidiFile(swungBytes.buffer.slice(swungBytes.byteOffset, swungBytes.byteOffset + swungBytes.byteLength) as ArrayBuffer).tracks.find(track => track.pattern)!.pattern!.steps;
  const lateStep = swungBack.findIndex(entry => entry.note === 'E3');
  const position = (lateStep + (swungBack[lateStep].offset ?? 0)) / swungBack.length;
  assert.ok((swungBack[lateStep].offset ?? 0) > 0, 'it is not snapped onto a step');
  assert.ok(Math.abs(position - (4 + 1 / 3) / 16) < 0.003, 'and is where it was in the bar');
});

test('step details read from storage are checked, and cleared with the step', () => {
  const [good, bad, empty] = sanitizeSteps([
    { active: true, note: 'C3', velocity: 0.5, probability: 0.5, ratchet: 9, offset: 3 },
    { active: true, note: 'C3', velocity: 0.5, probability: 'half', ratchet: 1.5, offset: -1 },
    { active: false, velocity: 0.5, probability: 0.5, ratchet: 3, offset: 0.5 },
  ]);
  assert.deepEqual(good, { active: true, note: 'C3', velocity: 0.5, probability: 0.5, ratchet: 4, offset: 0.95 });
  assert.deepEqual(bad, { active: true, note: 'C3', velocity: 0.5 });
  assert.deepEqual(empty, { active: false, velocity: 0.5 });
  assert.deepEqual(withStepNotes({ active: true, note: 'C3', velocity: 0.5, probability: 0.5, ratchet: 2, offset: 0.5, length: 3 }, []), { velocity: 0.5, active: false });
  assert.deepEqual(withStepNotes({ active: true, note: 'C3', velocity: 0.5, probability: 0.5, ratchet: 2, offset: 0.5 }, ['D3']), { velocity: 0.5, offset: 0.5, probability: 0.5, ratchet: 2, active: true, note: 'D3' });
});

test('a synced delay follows the tempo; a free one does not', () => {
  assert.equal(delaySeconds(effects.delay, 120), 0.2);
  assert.equal(delaySeconds({ ...effects.delay, sync: 'off' }, 90), 0.2);
  assert.equal(delaySeconds({ ...effects.delay, sync: '1/8' }, 120), 0.25);
  assert.equal(delaySeconds({ ...effects.delay, sync: '1/8' }, 60), 0.5);
  assert.equal(delaySeconds({ ...effects.delay, sync: '1/8d' }, 120), 0.375);
  assert.ok(Math.abs(delaySeconds({ ...effects.delay, sync: '1/8t' }, 120) - 1 / 6) < 1e-9);
  assert.equal(delaySeconds({ ...effects.delay, sync: '1/4' }, 20), 2, 'capped at the longest delay the effect has');

  assert.equal(sanitizeEffects({ ...effects, delay: { ...effects.delay, sync: '1/8d' } }, effects).delay.sync, '1/8d');
  assert.equal('sync' in sanitizeEffects({ ...effects, delay: { ...effects.delay, sync: 'nonsense' } }, effects).delay, false);
  assert.equal('sync' in sanitizeEffects(effects, effects).delay, false);
  assert.equal(matchesShape(effects, effects), true, 'a project saved before sync existed is not reported as damaged');
});
