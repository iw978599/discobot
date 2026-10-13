import test from 'node:test';
import assert from 'node:assert/strict';
import { drumsMuted, drumsSound, laneHeard, laneSounds, type ActivityLane } from '../src/services/unitActivity.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState, SequencerStep } from '../src/types.ts';

const kit = () => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
}])) as DrumState;

const steps = (...notes: Array<string | null>): SequencerStep[] => notes.map(note => ({ active: note !== null, note, velocity: 100 }) as SequencerStep);
const lane = (id: number, more: Partial<ActivityLane> = {}): ActivityLane => ({ id, isPlaying: true, pattern: { steps: steps('C3', null, 'E3', null) }, ...more });

test('a lane sounds on the steps that hold a note, while it plays', () => {
  const lanes = [lane(1)];
  assert.deepEqual([0, 1, 2, 3].map(step => laneSounds(lanes, 1, step)), [true, false, true, false]);
  assert.equal(laneSounds(lanes, 1, -1), false, 'the count-in is on no step');
  assert.equal(laneSounds(lanes, 1, 99), false, 'a step past the end of the pattern');
  assert.equal(laneSounds([lane(1, { isPlaying: false })], 1, 0), false, 'a stopped lane');
  assert.equal(laneSounds([lane(1, { pattern: null })], 1, 0), false, 'a lane with no pattern');
  assert.equal(laneSounds(lanes, 2, 0), false, 'a lane that is not there');
});

test('a muted lane, or one another lane is soloed over, does not sound', () => {
  assert.equal(laneSounds([lane(1, { muted: true })], 1, 0), false);
  const soloed = [lane(1), lane(2, { solo: true })];
  assert.equal(laneHeard(soloed, 1), false);
  assert.equal(laneHeard(soloed, 2), true);
  assert.equal(laneSounds(soloed, 1, 0), false);
  assert.equal(laneSounds(soloed, 2, 0), true);
  assert.equal(laneHeard([lane(1, { muted: true, solo: true })], 1), false, 'mute wins over solo, as it does in the scheduler');
});

test('the drums sound on a step that any heard drum plays', () => {
  const state = kit();
  assert.equal(drumsSound(state, 0), false);
  state.kick.steps[0] = true;
  state.snare.steps[4] = true;
  assert.equal(drumsSound(state, 0), true);
  assert.equal(drumsSound(state, 1), false);
  assert.equal(drumsSound(state, -1), false);
  state.kick.muted = true;
  assert.equal(drumsSound(state, 0), false, 'its only drum is muted');
  state.kick.muted = false;
  state.snare.solo = true;
  assert.equal(drumsSound(state, 0), false, 'the snare is soloed over the kick');
  assert.equal(drumsSound(state, 4), true);
});

test('the drums are muted as a unit only when every drum is', () => {
  const state = kit();
  assert.equal(drumsMuted(state), false);
  state.kick.muted = true;
  assert.equal(drumsMuted(state), false);
  for (const instrument of DRUM_INSTRUMENTS) state[instrument].muted = true;
  assert.equal(drumsMuted(state), true);
});
