import test from 'node:test';
import assert from 'node:assert/strict';
import { euclid, euclidCounts } from '../src/services/euclid.ts';

const draw = (steps: boolean[]) => steps.map(on => (on ? 'x' : '.')).join('');
// The same rhythm turned to start elsewhere.
const turns = (rhythm: string) => Array.from({ length: rhythm.length }, (_, index) => rhythm.slice(index) + rhythm.slice(0, index));

test('hits are spread as evenly as the steps allow, starting on the first', () => {
  assert.equal(draw(euclid(3, 8)), 'x..x..x.', 'the tresillo');
  assert.equal(draw(euclid(4, 16)), 'x...x...x...x...', 'four on the floor');
  assert.equal(draw(euclid(2, 12)), 'x.....x.....');
  assert.ok(turns('x.xx.xx.').includes(draw(euclid(5, 8))), 'the cinquillo, turned');
  assert.equal(draw(euclid(7, 16)), 'x..x.x.x..x.x.x.', 'seven in sixteen, as it is usually written');
});

test('every hit is there, and no two gaps differ by more than a step', () => {
  for (let steps = 2; steps <= 32; steps++) for (let hits = 1; hits <= steps; hits++) {
    const rhythm = euclid(hits, steps), places = rhythm.flatMap((on, index) => (on ? [index] : []));
    assert.equal(places.length, hits, `${hits} in ${steps}`);
    assert.equal(places[0], 0);
    const gaps = places.map((place, index) => (places[index + 1] ?? places[0] + steps) - place);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `${hits} in ${steps}: ${draw(rhythm)}`);
  }
});

test('nonsense asks for nothing, and the counts offered are two to one short of all', () => {
  assert.equal(draw(euclid(0, 8)), '........');
  assert.equal(draw(euclid(-3, 4)), '....');
  assert.equal(draw(euclid(9, 4)), 'xxxx');
  assert.deepEqual(euclid(3, 0), []);
  assert.deepEqual(euclidCounts(6), [2, 3, 4, 5]);
  assert.deepEqual(euclidCounts(2), []);
});
