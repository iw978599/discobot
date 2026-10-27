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

// Stage 2: everywhere else a drum is.
test('an added row has no pad until one is learnt, and then it takes the note from whatever had it', async () => {
  const { asPadMap, defaultPads, drumForNote, padsAreDefault, withPad } = await import('../src/services/midiDrums.ts');
  const pads = defaultPads();
  assert.equal(pads.extra1, undefined, 'no note to begin with');
  assert.equal(drumForNote(64, pads), null);
  const learnt = withPad(pads, 'extra1', 36);
  assert.deepEqual([learnt.extra1, learnt.kick, drumForNote(36, learnt)], [36, null, 'extra1'], 'the kick\'s note is the row\'s now');
  assert.equal(padsAreDefault(learnt), false);
  assert.deepEqual(asPadMap({ ...learnt, extra2: 36, extra3: 'x', extra4: 200 }).extra2, undefined, 'a note already given, or no note at all, is not kept');
  assert.equal(asPadMap(learnt).extra1, 36, 'and the row keeps its note between visits');
});

test('an added row is written on its recording\'s General MIDI note, or a note of its own, and the eight are as they were', async () => {
  const { createMidiFile, drumRowNote, DRUM_NOTE_MAP } = await import('../src/utils/midiExport.ts');
  assert.equal(drumRowNote('kick'), DRUM_NOTE_MAP.kick);
  assert.deepEqual([drumRowNote('extra1', { percType: 'cowbell' }), drumRowNote('extra2', { cymbalType: 'splash' }), drumRowNote('extra3')], [56, 55, 66]);
  const service = setup();
  ok(service.setDrumStep('kick', 0, true));
  const plain = createMidiFile({ tempo: 120, drumState: structuredClone(service.snapshot().drumState), drumMasterVolume: 1, synthLanes: [] });
  ok(service.addDrumRow('extra1'));
  const empty = createMidiFile({ tempo: 120, drumState: structuredClone(service.snapshot().drumState), drumMasterVolume: 1, synthLanes: [] });
  assert.deepEqual(Array.from(empty), Array.from(plain), 'a row with no steps writes nothing');
  ok(service.setDrumStep('extra1', 4, true));
  ok(service.setDrumSettings('extra1', { percType: 'cowbell' }));
  const file = createMidiFile({ tempo: 120, drumState: structuredClone(service.snapshot().drumState), drumMasterVolume: 1, synthLanes: [] });
  const struck = new Set<number>();
  for (let i = 0; i + 2 < file.length; i += 1) if (file[i] === 0x99 && file[i + 2] > 0) struck.add(file[i + 1]);
  assert.ok(struck.has(56) && struck.has(36));
});

test('the mixer, a live session, MIDI Learn and the guests know the added rows by their names', async () => {
  const { mixerChannels } = await import('../src/services/mixerChannels.ts');
  const { readJam } = await import('../src/services/liveSession.ts');
  const { listTargets, parseTarget, targetLabel } = await import('../src/services/paramTargets.ts');
  const { inputSources } = await import('../src/services/guestInput.ts');
  const { shownDrumRows } = await import('../src/services/drumKits.ts');
  const service = setup();
  ok(service.addDrumRow('extra2'));
  const drumState = service.snapshot().drumState;
  const strips = mixerChannels({ synths: [], drumState, drumMasterVolume: 1, guests: [], effectsLoop: { returns: { synth: 1, drums: 1 } } as never, browserVolume: 1 } as never);
  assert.deepEqual(strips.drums.map(strip => strip.id).slice(-2), ['crash', 'extra2'], 'a strip after the eight');
  assert.deepEqual(readJam({ kind: 'hit', drum: 'extra2', velocity: 0.5 }), { kind: 'hit', drum: 'extra2', velocity: 0.5 });
  assert.equal(readJam({ kind: 'hit', drum: 'extra9', velocity: 0.5 }), null);
  assert.equal(parseTarget('drum:extra2:volume')?.kind, 'drum');
  assert.equal(targetLabel('drum:extra2:volume'), 'Row 10: Volume');
  assert.ok(listTargets([1], shownDrumRows(drumState)).flatMap(group => group.targets).some(target => target.id === 'drum:extra2:volume'));
  assert.ok(inputSources([], shownDrumRows(drumState)).some(source => source.id === 'drum:extra2' && source.name === 'Row 10'));
});
