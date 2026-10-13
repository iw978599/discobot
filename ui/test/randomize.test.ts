import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../src/services/drumScheduling.ts';
import { stepNotes } from '../src/services/noteScheduling.ts';
import { sanitizeSteps } from '../src/services/projectSanitization.ts';
import { DEFAULT_RANDOM_CHOICE, RANDOM_KEYS, RANDOM_SCALES, asRandomChoice, randomLine, randomPool, type RandomChoice, type RandomScale } from '../src/services/randomize.ts';
import { noteNameToMidi } from '../src/utils/midiExport.ts';
import type { Pattern, SequencerStep } from '../src/types.ts';

const pattern = (count = 16, extra: Partial<Pattern> = {}): Pattern => ({
  id: 'pattern-7', name: 'Verse', tempo: 97,
  steps: Array.from({ length: count }, (_, index): SequencerStep => (index % 3 === 0 ? { active: true, note: 'F#4', notes: ['A4'], velocity: 0.9, slide: true, probability: 0.5, ratchet: 2, offset: 0.5 } : { active: false, velocity: 0.7 })),
  ...extra,
});
const midi = (note: string) => noteNameToMidi(note)!;
const SCALES = Object.keys(RANDOM_SCALES) as RandomScale[];
const line = (choice: RandomChoice, seed: number, from = pattern(), octave = 3) => randomLine(from, choice, octave, seededRandom(seed));
const tune = (made: Pattern) => made.steps.map(step => stepNotes(step).join('+') || '-').join(' ');

test('every note is in the chosen scale, in every key and scale', () => {
  for (const key of RANDOM_KEYS) for (const scale of SCALES) for (let seed = 1; seed <= 20; seed += 1) {
    const root = RANDOM_KEYS.indexOf(key);
    const allowed = new Set(RANDOM_SCALES[scale].notes.map(note => (root + note) % 12));
    for (const step of line({ key, scale }, seed).steps) {
      for (const note of stepNotes(step)) assert.ok(allowed.has(midi(note) % 12), `${note} is not in ${key} ${scale}`);
    }
  }
});

test('the first step is always the key\'s root, in the lowest octave the lane shows', () => {
  for (const key of RANDOM_KEYS) for (const scale of SCALES) for (let seed = 1; seed <= 20; seed += 1) {
    assert.deepEqual(stepNotes(line({ key, scale }, seed).steps[0]), [`${key}3`]);
  }
  assert.deepEqual(stepNotes(line({ key: 'A', scale: 'minor' }, 5, pattern(), 1).steps[0]), ['A1']);
  assert.deepEqual(stepNotes(line({ key: 'A', scale: 'minor' }, 5, pattern(), 5).steps[0]), ['A5']);
});

test('the same seed gives the same line, and different seeds give different ones', () => {
  const choice: RandomChoice = { key: 'D', scale: 'minor' };
  assert.deepEqual(line(choice, 42), line(choice, 42));
  const tunes = new Set(Array.from({ length: 30 }, (_, seed) => tune(line(choice, seed + 1))));
  assert.ok(tunes.size >= 28, `${tunes.size} different lines from 30 seeds`);
});

test('the pattern keeps its length, its step size and everything that is not a step', () => {
  for (const [count, bars] of [[16, undefined], [32, undefined], [32, 2], [64, 4], [128, 8], [256, 8]] as const) {
    const before = pattern(count, bars ? { bars } : {});
    const copy = structuredClone(before);
    const made = line(DEFAULT_RANDOM_CHOICE, 9, before);
    assert.equal(made.steps.length, count);
    const { steps: _made, ...rest } = made, { steps: _before, ...was } = before;
    assert.deepEqual(rest, was);
    assert.deepEqual(before, copy, 'the pattern handed in is not changed');
  }
});

test('what was in the pattern is replaced: one note to a step, with no slide, chance, repeats or late start', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    for (const step of line({ key: 'E', scale: 'major' }, seed).steps) {
      assert.deepEqual(Object.keys(step).filter(key => !['active', 'note', 'velocity', 'length'].includes(key)), []);
      assert.equal(stepNotes(step).length, step.active ? 1 : 0);
      if (step.active) assert.ok(step.velocity >= 0.6 && step.velocity <= 0.95, `velocity ${step.velocity}`);
    }
  }
});

test('about half the steps are filled, and the notes stay within an octave and a bit above the root', () => {
  let filled = 0, total = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const made = line({ key: 'G', scale: 'minor-pentatonic' }, seed);
    total += made.steps.length;
    for (const step of made.steps) for (const note of stepNotes(step)) {
      filled += 1;
      assert.ok(midi(note) >= midi('G3') && midi(note) <= midi('G4') + 5, note);
    }
  }
  assert.ok(filled / total > 0.4 && filled / total < 0.6, `${Math.round(filled / total * 100)}% filled`);
});

test('neighbouring notes are mostly a second or a third apart', () => {
  const choice: RandomChoice = { key: 'C', scale: 'major' };
  const pool = randomPool(choice, 3);
  let near = 0, all = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const places = line(choice, seed).steps.flatMap(step => stepNotes(step)).map(note => pool.indexOf(note));
    for (let index = 1; index < places.length; index += 1) {
      all += 1;
      if (Math.abs(places[index] - places[index - 1]) <= 2) near += 1;
    }
  }
  assert.ok(near / all > 0.8, `${Math.round(near / all * 100)}% of moves are a third or less`);
});

test('a held note never runs into the next note or off the end, and some notes are held', () => {
  let held = 0;
  for (const count of [16, 32, 64]) for (let seed = 1; seed <= 100; seed += 1) {
    const { steps } = line(DEFAULT_RANDOM_CHOICE, seed, pattern(count, count === 64 ? { bars: 4 } : {}));
    steps.forEach((step, index) => {
      const length = step.length ?? 1;
      if (length > 1) held += 1;
      assert.ok(index + length <= steps.length);
      for (let over = 1; over < length; over += 1) assert.equal(steps[index + over].active, false);
    });
    assert.deepEqual(sanitizeSteps(steps, count === 64 ? 4 : 1), steps, 'the line is already what a reload would make of it');
  }
  assert.ok(held > 50);
});

test('a lane with finer steps gets the same rhythm on every second step', () => {
  const coarse = line({ key: 'C', scale: 'minor' }, 3, pattern(16));
  const fine = line({ key: 'C', scale: 'minor' }, 3, pattern(32));
  assert.deepEqual(fine.steps.filter((_, index) => index % 2 === 1).map(step => step.active), Array.from({ length: 16 }, () => false));
  assert.equal(tune({ ...fine, steps: fine.steps.filter((_, index) => index % 2 === 0) }), tune(coarse));
  fine.steps.forEach((step, index) => { if (step.active) assert.equal(step.length, (coarse.steps[index / 2].length ?? 1) * 2); });
});

test('the notes a line is drawn from start at the root and are all in the scale', () => {
  assert.deepEqual(randomPool({ key: 'C', scale: 'major-pentatonic' }, 3), ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4']);
  assert.deepEqual(randomPool({ key: 'A', scale: 'minor' }, 2), ['A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']);
});

test('a stored choice that is not a key and a scale falls back to the default', () => {
  assert.deepEqual(asRandomChoice(null), DEFAULT_RANDOM_CHOICE);
  assert.deepEqual(asRandomChoice({ key: 'H', scale: 'toString' }), DEFAULT_RANDOM_CHOICE);
  assert.deepEqual(asRandomChoice({ key: 'F#', scale: 'major' }), { key: 'F#', scale: 'major' });
});
