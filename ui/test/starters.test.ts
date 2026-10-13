import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, projectIsEmpty, starterDrums, starterPattern } from '../src/services/starters';
import { stepNotes } from '../src/services/noteScheduling';
import type { DrumInstrument, DrumState, Pattern } from '../src/types';

const blank = (count: number, bars?: number): Pattern => ({
  id: 'p', name: 'Pattern', tempo: 120, ...(bars ? { bars } : {}),
  steps: Array.from({ length: count }, () => ({ active: false, velocity: 100 })),
});

const DRUMS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const emptyDrums = (count = 16) => Object.fromEntries(DRUMS.map(drum => [drum, {
  steps: Array.from({ length: count }, () => false),
  settings: { volume: 0.8 },
}])) as unknown as DrumState;

const FIRST_OCTAVE = ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3'];

test('every starting point is a bar of drums and a bar of bass the piano roll shows', () => {
  assert.ok(STARTERS.length >= 3);
  assert.equal(new Set(STARTERS.map(starter => starter.id)).size, STARTERS.length);
  for (const starter of STARTERS) {
    assert.ok(starter.tempo >= 60 && starter.tempo <= 180, starter.name);
    assert.ok(starter.drums.kick?.length, `${starter.name} has a kick`);
    assert.ok(starter.bass.length > 0, `${starter.name} has a bass line`);
    for (const hits of Object.values(starter.drums)) for (const step of hits) assert.ok(Number.isInteger(step) && step >= 0 && step < 16);
    // A strength, a chance or a repeat is only ever given to a hit that is there.
    for (const detail of [starter.velocities, starter.chances, starter.repeats]) {
      for (const [drum, steps] of Object.entries(detail ?? {})) {
        for (const step of Object.keys(steps)) assert.ok(starter.drums[drum as DrumInstrument]?.includes(Number(step)), `${starter.name}: ${drum} step ${step} is a hit`);
      }
    }
    for (const steps of Object.values(starter.chances ?? {})) for (const chance of Object.values(steps)) assert.ok(chance >= 0.5 && chance < 1, `${starter.name}: a hit left to chance still plays at least half the time`);
    for (const steps of Object.values(starter.repeats ?? {})) for (const count of Object.values(steps)) assert.ok(Number.isInteger(count) && count >= 2 && count <= 4);
    for (const drum of ['kick', 'clap'] as const) assert.equal(starter.chances?.[drum], undefined, `${starter.name}: the ${drum} is never left to chance`);
    assert.ok(Object.keys(starter.chances ?? {}).length > 0 && Object.keys(starter.repeats ?? {}).length > 0, `${starter.name} has a hit left to chance and a repeat`);
    for (const entry of starter.bass) {
      assert.ok(FIRST_OCTAVE.includes(entry.note), `${starter.name}: ${entry.note} is in the octave from C3`);
      assert.ok(entry.step + (entry.length ?? 1) <= 16, `${starter.name}: a note ends inside the bar`);
    }
  }
});

test('a starting point fills an empty project, and then it is not empty', () => {
  const drums = emptyDrums();
  const pattern = blank(16);
  assert.equal(projectIsEmpty([pattern, null], drums, 1), true);
  assert.equal(projectIsEmpty([pattern], drums, 2), false, 'a project with a second scene is not a fresh one');
  const starter = STARTERS[0];
  const filled = starterPattern(starter, pattern);
  const beat = starterDrums(starter, drums);
  assert.deepEqual(filled.steps.flatMap((step, index) => (step.active ? [index] : [])), starter.bass.map(entry => entry.step));
  assert.deepEqual(stepNotes(filled.steps[starter.bass[0].step]), [starter.bass[0].note]);
  assert.deepEqual(beat.kick.steps.flatMap((on, index) => (on ? [index] : [])), starter.drums.kick);
  assert.equal(beat.kick.settings, drums.kick.settings, 'the kit is left as it was');
  assert.equal(projectIsEmpty([filled], drums, 1), false);
  assert.equal(projectIsEmpty([pattern], beat, 1), false);
});

test('a beat brings its chances and repeats, and leaves none behind from the beat tried before it', () => {
  const [house, slow] = STARTERS;
  const first = starterDrums(house, emptyDrums());
  assert.equal(first.snare.stepProbabilities?.[15], house.chances!.snare![15]);
  assert.equal(first.closedHH.stepRatchets?.[15], house.repeats!.closedHH![15]);
  assert.equal(first.kick.stepProbabilities, undefined, 'a drum with nothing left to chance is given no list');
  assert.equal(first.snare.stepProbabilities?.filter(chance => chance !== 1).length, 1);
  const second = starterDrums(slow, first);
  assert.ok(second.closedHH.stepRatchets?.every(count => count === 1), 'the first beat\u2019s repeat is gone');
  assert.equal(second.snare.stepProbabilities?.[15], 1);
  assert.equal(second.snare.stepProbabilities?.[9], slow.chances!.snare![9]);
  assert.equal(second.snare.stepRatchets?.[15], slow.repeats!.snare![15]);
  const twoBars = starterDrums(house, emptyDrums(32));
  assert.equal(twoBars.snare.stepProbabilities?.[31], house.chances!.snare![15], 'in every bar');
});

test('a longer or finer pattern gets the bass line in every bar, at the same places in the bar', () => {
  const starter = STARTERS.find(entry => entry.bass.some(note => (note.length ?? 1) > 1))!;
  const held = starter.bass.find(note => (note.length ?? 1) > 1)!;
  const twoBars = starterPattern(starter, blank(32, 2));
  assert.equal(twoBars.steps.filter(step => step.active).length, starter.bass.length * 2);
  assert.equal(twoBars.steps[16 + held.step].length, held.length);
  const fine = starterPattern(starter, blank(32));
  assert.equal(fine.steps.filter(step => step.active).length, starter.bass.length);
  assert.equal(fine.steps[held.step * 2].length, held.length! * 2, 'a held note lasts as long in finer steps');
  const beat = starterDrums(starter, emptyDrums(32));
  assert.deepEqual(beat.kick.steps.slice(16), beat.kick.steps.slice(0, 16));
});
