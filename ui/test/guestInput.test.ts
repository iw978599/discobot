// A voice of Discobot's handed to a guest (services/guestInput): which voices there are, who may
// have one, how early it is played, and what an export leaves out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_LEAD_EXTRA_MS, MAX_INPUT_LEAD_MS, createGuestInputs, inputSources, leaveOutHanded } from '../src/services/guestInput.ts';
import { DRUM_ROWS } from '../src/services/drumKits.ts';
import type { ExportArrangement } from '../src/services/wavExport.ts';
import type { DrumState, Scene } from '../src/types.ts';

// A drum grid of sixteen empty steps, as much as these tests need of one.
const createDefaultDrumState = () => Object.fromEntries(DRUM_ROWS.map(drum => [drum, { steps: Array<boolean>(16).fill(false) }])) as unknown as DrumState;

const lanes = [{ id: 1, model: 'Generic' }, { id: 2, model: 'Juno-60' }];

test('the voices on offer: each lane by its model, the kit, and each drum, by ids that do not change', () => {
  const sources = inputSources(lanes);
  assert.deepEqual(sources.slice(0, 3), [
    { id: 'synth:1', name: 'Synth 1 · Generic', kind: 'synth' },
    { id: 'synth:2', name: 'Synth 2 · Juno-60', kind: 'synth' },
    { id: 'drums', name: 'Drums', kind: 'drums' },
  ]);
  assert.deepEqual(sources.slice(3).map(source => source.id), ['drum:kick', 'drum:snare', 'drum:clap', 'drum:closedHH', 'drum:openHH', 'drum:snare2', 'drum:ride', 'drum:crash']);
  assert.equal(sources.find(source => source.id === 'drum:snare2')!.name, 'Low Tom');
});

test('a guest takes a voice on offer, nothing else, and never one another guest has', () => {
  const inputs = createGuestInputs();
  inputs.setSources(inputSources(lanes));
  assert.equal(inputs.select('a', 'Axis Stack', 'synth:3', 120), null, 'not on offer');
  assert.equal(inputs.select('a', 'Axis Stack', 42, 120), null, 'not an id at all');
  assert.equal(inputs.select('a', 'Axis Stack', 'synth:2', 120), 'synth:2');
  assert.equal(inputs.get('synth:2')!.leadMs, 120 + INPUT_LEAD_EXTRA_MS);
  assert.equal(inputs.select('b', 'Other', 'synth:2', 120), null, 'the first guest keeps it');
  assert.equal(inputs.current('a'), 'synth:2');
  assert.equal(inputs.select('a', 'Axis Stack', 'drum:kick', 120), 'drum:kick', 'one voice a guest: asking for another gives the first back');
  assert.equal(inputs.get('synth:2'), undefined);
  assert.equal(inputs.select('a', 'Axis Stack', null, 120), null);
  assert.deepEqual(inputs.all(), []);
});

test('a voice that goes away ends its hand-over, and the guest is named so it can be told', () => {
  const inputs = createGuestInputs();
  inputs.setSources(inputSources(lanes));
  inputs.select('a', 'Axis Stack', 'synth:2', 120);
  assert.deepEqual(inputs.setSources(inputSources(lanes.slice(0, 1))), ['a']);
  assert.equal(inputs.current('a'), null);
  inputs.select('a', 'Axis Stack', 'drums', 120);
  inputs.release('a');
  assert.equal(inputs.current('a'), null, 'a guest removed or reloaded gives its voice back');
});

test('the voice is played early by the lead, which grows when the guest is late or its latency grows, up to a limit', () => {
  const inputs = createGuestInputs();
  inputs.setSources(inputSources(lanes));
  assert.equal(inputs.reachSeconds(), 0, 'with nothing handed over the scheduler reaches no further');
  assert.equal(inputs.leadSeconds('synth:1'), 0);
  inputs.select('a', 'Axis Stack', 'synth:1', 120);
  assert.equal(inputs.leadSeconds('synth:1'), 0.24);
  inputs.late('a', 30);
  assert.equal(inputs.get('synth:1')!.leadMs, 240 + 30 + 20);
  inputs.late('a', 'soon');
  inputs.late('a', -5);
  assert.equal(inputs.get('synth:1')!.leadMs, 290, 'nonsense is ignored');
  inputs.latencyRaised('a', 60);
  assert.equal(inputs.get('synth:1')!.leadMs, 350);
  inputs.late('a', 5000);
  assert.equal(inputs.get('synth:1')!.leadMs, MAX_INPUT_LEAD_MS);
  assert.equal(inputs.reachSeconds(), MAX_INPUT_LEAD_MS / 1000);
});

test('a voice goes to its guest\'s tap once the guest has one, and listeners hear of every change', () => {
  const inputs = createGuestInputs();
  let heard = 0;
  inputs.subscribe(() => { heard++; });
  inputs.setSources(inputSources(lanes));
  inputs.select('a', 'Axis Stack', 'drums', 120);
  assert.equal(inputs.tapFor('drums'), null);
  const tap = {};
  inputs.setTap('a', tap);
  assert.equal(inputs.tapFor('drums'), tap);
  assert.equal(inputs.tapFor('synth:1'), null);
  assert.equal(heard, 3);
});

const step = (on: boolean) => ({ active: on, velocity: 0.8, note: 'C3' });
function bar(): Scene {
  const drums = createDefaultDrumState();
  drums.kick.steps = drums.kick.steps.map(() => true);
  drums.snare.steps = drums.snare.steps.map(() => true);
  return { id: 'a', name: 'A', lanes: { 1: [step(true)], 2: [step(true)] }, drums } as unknown as Scene;
}

test('an export leaves out, bar by bar, the voices a guest had when the bar was played', () => {
  const song = { bars: [bar(), bar(), bar()] } as unknown as ExportArrangement;
  const out = leaveOutHanded(song, [['synth:2'], ['drum:kick'], ['drums']]).bars!;
  assert.equal(out[0].lanes[2].length, 0);
  assert.equal(out[0].lanes[1].length, 1);
  assert.ok(out[0].drums.kick.steps.every(Boolean));
  assert.ok(out[1].drums.kick.steps.every(on => !on), 'the one drum');
  assert.ok(out[1].drums.snare.steps.every(Boolean));
  assert.ok(out[2].drums.snare.steps.every(on => !on), 'the whole kit');
  assert.equal(out[2].lanes[2].length, 1, 'the lane was given back');
  assert.equal(leaveOutHanded(song, [[]]), song, 'nothing handed over: the arrangement as it was');
});

test('a scene export leaves out any voice a guest had while it played', () => {
  const drums = createDefaultDrumState();
  drums.clap.steps = drums.clap.steps.map(() => true);
  const scene = { synths: [{ id: 1, muted: false }, { id: 2, muted: false }], drumState: drums } as unknown as ExportArrangement;
  const out = leaveOutHanded(scene, [['synth:1'], ['drum:clap']]);
  assert.deepEqual(out.synths.map(lane => lane.muted), [true, false]);
  assert.ok(out.drumState.clap.steps.every(on => !on));
});
