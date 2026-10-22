import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SWING, SWING_GROUPS, SWING_TEMPLATES, currentTemplate, swingGridOf, swingSteps } from '../src/services/grooves.ts';
import { swingLate } from '../src/services/drumScheduling.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

test('on sixteenths every second step is late by the amount, as swing always was', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 11].map(step => swingSteps(step, .3)), [0, .3, 0, .3, 0, .3, .3]);
  assert.deepEqual([0, 1, 2, 3].map(step => swingSteps(step, 0)), [0, 0, 0, 0], 'no swing, nothing moves');
  for (let step = 0; step < 32; step++) for (const swing of [0, .1, .5, .75]) {
    const before = swing > 0 && Math.floor(step + 1e-6) % 2 === 1 ? swing : 0;
    assert.equal(swingSteps(step, swing, 16), before, 'the old rule, step for step');
  }
});

test('on eighths the second eighth of a beat is late by twice the amount, and the sixteenths beside it by the amount', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(step => swingSteps(step, .25, 8)), [0, .25, .5, .25, 0, .25, .5, .25]);
  // The steps stay in order and evenly spaced inside the swung eighths.
  const places = [0, 1, 2, 3, 4].map(step => step + swingSteps(step, MAX_SWING, 8));
  for (let index = 1; index < places.length; index++) assert.ok(places[index] > places[index - 1]);
  assert.equal(places[1] - places[0], places[2] - places[1]);
});

test('a lane is swung by the same rule, in its own time unit', () => {
  assert.equal(swingLate(1 * 0.125, 0.125, .3), .3 * 0.125);
  assert.equal(swingLate(2 * 0.125, 0.125, .3), 0);
  assert.equal(swingLate(2 * 0.125, 0.125, .3, 8), .6 * 0.125);
  assert.equal(swingLate(240, 120, .5, 8), 1 * 120, 'in ticks too');
});

test('a grid is eighths only when it says 8', () => {
  assert.equal(swingGridOf(8), 8);
  for (const other of [16, '8', 4, null, undefined, {}]) assert.equal(swingGridOf(other), 16);
});

test('every template is a swing the drums can have, with a name of its own, in a group by its grid', () => {
  assert.equal(new Set(SWING_TEMPLATES.map(template => template.name)).size, SWING_TEMPLATES.length);
  assert.equal(new Set(SWING_TEMPLATES.map(template => template.id)).size, SWING_TEMPLATES.length);
  for (const template of SWING_TEMPLATES) assert.ok(template.swing >= 0 && template.swing <= MAX_SWING, template.name);
  assert.deepEqual(SWING_GROUPS.flatMap(group => group.templates), SWING_TEMPLATES);
  for (const group of SWING_GROUPS) assert.equal(new Set(group.templates.map(template => template.grid)).size, 1);
  assert.equal(SWING_TEMPLATES.find(template => template.name === '16ths 66%')?.swing, .32, '66% of the way across the pair');
});

test('the template shown is the one the swing matches, or none when it was turned by hand', () => {
  assert.equal(currentTemplate(0, 8)?.name, 'Straight');
  assert.equal(currentTemplate(.16, 16)?.name, '16ths 58%');
  assert.equal(currentTemplate(.16, 8)?.name, '8ths 58%');
  assert.equal(currentTemplate(1 / 3, 8)?.name, '8ths shuffle');
  assert.equal(currentTemplate(.2, 16), undefined);
});

test('a template sets the swing and its grid as one undo step, and a project without a grid stays as it was', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
  const drumState = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35, pan: 0 },
  }])) as DrumState;
  const effectsLoop: EffectsLoopState = {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  };
  const service = new LocalProjectService();
  service.initialize({ synthParams: createDefaultSynthParameters(), drumState, drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop });
  const plain = service.exportProject();
  assert.equal('drumSwingGrid' in plain.project, false, 'a new project stores no grid');

  const events: unknown[] = [];
  service.subscribe(message => { if (message.type === 'drumSwing') events.push(message.data); });
  service.setDrumSwing(.5, 8);
  assert.deepEqual(events.at(-1), { swing: .5, grid: 8 });
  assert.equal(service.exportProject().project.drumSwingGrid, 8);
  service.setDrumSwing(.2);
  assert.equal(service.exportProject().project.drumSwingGrid, 8, 'turning the amount keeps the grid');
  service.setDrumSwing(.16, 16);
  assert.equal('drumSwingGrid' in service.exportProject().project, false, 'sixteenths are stored as nothing');

  // Changes to one control within a moment of each other are one undo step, as a knob's drag is.
  await new Promise(resolve => setTimeout(resolve, 350));
  service.setDrumSwing(.24, 8);
  service.undo();
  assert.equal('drumSwingGrid' in service.snapshot(), false, 'undo takes the grid away with the amount');
  assert.equal(service.snapshot().drumSwing, .16);

  for (const hostile of [8.5, '8', 4, -1, { grid: 8 }]) {
    const copy = { ...service.exportProject(), project: { ...service.exportProject().project, drumSwingGrid: hostile } };
    const read = service.readProjectFile(copy);
    assert.ok(read.ok);
    assert.equal('drumSwingGrid' in read.project, false, `nothing kept of ${JSON.stringify(hostile)}`);
  }
  const eighths = service.readProjectFile({ ...plain, project: { ...plain.project, drumSwingGrid: 8 } });
  assert.ok(eighths.ok && eighths.project.drumSwingGrid === 8);
});
