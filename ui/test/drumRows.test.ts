import test from 'node:test';
import assert from 'node:assert/strict';
import { ok, setup } from './helpers/store.ts';
import { renderDrums } from '../src/services/wavExport.ts';
import { drumRowsOf } from '../src/services/drumKits.ts';
import type { DrumState } from '../src/types.ts';

// Rows after the eight drums (docs/DRUM_ROWS_PLAN.md): they play a sample only, and a project
// without any is what it was.

const SR = 8000;
const loudest = (out: Float32Array[]) => Math.max(...out.map(channel => channel.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)));
const render = (drumState: DrumState, cymbals: Record<string, { data: Float32Array; rate: number }> = {}) =>
  renderDrums({ tempo: 120, drumState, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, drumCymbals: cymbals }, SR * 2, SR);
const tone = { data: Float32Array.from({ length: 800 }, (_, i) => Math.sin(i / 3) * 0.5), rate: SR };

test('an added row plays the recording it is given, and nothing without one', () => {
  const service = setup();
  ok(service.addDrumRow('extra1'));
  ok(service.setDrumStep('extra1', 0, true));
  const silent = structuredClone(service.snapshot().drumState);
  assert.equal(loudest(render(silent, { 'perc-cowbell': tone })), 0, 'with nothing chosen it is silent, and never the kit\'s synthesized voice');
  ok(service.setDrumSettings('extra1', { percType: 'cowbell' }));
  assert.ok(loudest(render(structuredClone(service.snapshot().drumState), { 'perc-cowbell': tone })) > 0.05, 'a percussion recording');
  ok(service.setDrumSettings('extra1', { percType: 'none' as never, cymbalType: 'splash' }));
  const cymbal = structuredClone(service.snapshot().drumState);
  delete cymbal.extra1!.settings.percType;
  assert.ok(loudest(render(cymbal, { splash: tone })) > 0.05, 'or a cymbal');
});

test('the rows of a drum state are the eight, then the added ones in their order', () => {
  const service = setup();
  ok(service.addDrumRow('extra3'));
  ok(service.addDrumRow('extra1'));
  assert.deepEqual(drumRowsOf(service.snapshot().drumState).slice(8), ['extra1', 'extra3']);
});

test('a project with added rows is saved and opened again whole, and one without them is not reported damaged', async () => {
  const service = setup();
  await service.openLibrary((await import('../src/services/projectLibrary.ts')).createMemoryLibrary());
  ok(service.addDrumRow('extra2'));
  ok(service.setDrumStep('extra2', 5, true));
  ok(service.setDrumSettings('extra2', { percType: 'shaker', volume: 0.4 }));
  const file = service.exportProject();
  const opened = await service.importProject(file);
  assert.deepEqual([opened.ok, opened.ok && opened.repaired], [true, false]);
  const { drumState, scenes } = service.snapshot();
  assert.equal(drumState.extra2?.steps[5], true);
  assert.deepEqual([drumState.extra2?.settings.percType, drumState.extra2?.settings.volume], ['shaker', 0.4]);
  assert.ok(scenes.every((scene: { drums: Record<string, unknown> }) => scene.drums.extra2), 'in every scene');

  const plain = setup();
  await plain.openLibrary((await import('../src/services/projectLibrary.ts')).createMemoryLibrary());
  const before = plain.exportProject() as { project: Record<string, unknown> };
  const again = await plain.importProject(before);
  assert.deepEqual([again.ok, again.ok && again.repaired], [true, false], 'a project from before added rows opens as it was');
  assert.deepEqual(drumRowsOf(plain.snapshot().drumState).length, 8);
});

test('a file\'s rows that cannot be added, or are not rows at all, are left out', async () => {
  const service = setup();
  await service.openLibrary((await import('../src/services/projectLibrary.ts')).createMemoryLibrary());
  const file = service.exportProject() as { project: { drumState: Record<string, unknown> } };
  file.project.drumState.extra9 = { steps: [true], settings: {} };
  file.project.drumState.extra4 = 'loud';
  file.project.drumState.extra5 = { steps: 'all', settings: { percType: 'gong', volume: 9 } };
  const opened = await service.importProject(file);
  assert.equal(opened.ok, true);
  const { drumState } = service.snapshot();
  assert.equal('extra9' in drumState || 'extra4' in drumState, false);
  assert.deepEqual([drumState.extra5?.steps.some(Boolean), drumState.extra5?.settings.volume, 'percType' in (drumState.extra5?.settings ?? {})], [false, 1, false], 'held to what a row can be');
});
