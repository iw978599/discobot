import test from 'node:test';
import assert from 'node:assert/strict';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import {
  DRUM_AUTOMATABLE, copyDrumAutomationBar, hitSettings, layDrumAutomationAlong, rearrangeDrumAutomation, resizeDrumAutomationBars, resizeDrumAutomationEachBar,
  sanitizeDrumAutomation, splitDrumAutomated, withDrumAutomationValues, withoutDrumAutomation,
} from '../src/services/drumAutomation.ts';
import { DRUM_PARAMS } from '../src/services/paramTargets.ts';
import { sanitizeDrums, sanitizeScenes } from '../src/services/projectSanitization.ts';
import { sceneAsBars } from '../src/services/patternLength.ts';
import { sceneDrumState } from '../src/services/songPlayback.ts';
import { drumHits, renderDrums } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { STARTERS, starterDrums } from '../src/services/starters.ts';
import { defaults, ok, setup } from './helpers/store.ts';
import type { DrumState } from '../src/types.ts';

const none = (count = 16) => Array<number | null>(count).fill(null);
const at = (count: number, values: Record<number, number>) => none(count).map((_, step) => values[step] ?? null);
const SR = 44100;

test('automation from storage keeps only the settings that can be automated, held to the knob, as long as the steps', () => {
  const kept = sanitizeDrumAutomation({
    tune: [5, -5, 'x', null, 0.25], humanize: [1, 1], percType: [1], bogus: [1], pan: [], volume: [null, null], delaySend: [2],
    constructor: [1], __proto__: [1],
  }, 16)!;
  assert.deepEqual(Object.keys(kept).sort(), ['delaySend', 'tune']);
  assert.deepEqual(kept.tune, at(16, { 0: 1, 1: -1, 4: 0.25 }));
  assert.deepEqual(kept.delaySend, at(16, { 0: 1 }));
  assert.equal(kept.tune.length, 16);
  assert.equal(sanitizeDrumAutomation({ tune: [0.5, 0.5, 0.5] }, 2)!.tune.length, 2);
  for (const bad of [undefined, null, 4, 'tune', [], { tune: 'loud' }, { tune: [] }, { tune: [null, Number.NaN, Infinity] }]) {
    assert.equal(sanitizeDrumAutomation(bad, 16), undefined, JSON.stringify(bad));
  }
  assert.deepEqual(DRUM_AUTOMATABLE.slice().sort(), Object.keys(DRUM_PARAMS).sort(), 'the same settings the drum knobs and MIDI targets have');
});

test('a drum is stored with its automation only when it has some, and an older project is what it was', () => {
  const defaultsDrums = defaults().drumState;
  const plain = sanitizeDrums(defaultsDrums, defaultsDrums);
  for (const instrument of DRUM_INSTRUMENTS) assert.equal('stepAutomation' in plain[instrument], false);
  const hostile = sanitizeDrums({ ...plain, snare: { ...plain.snare, stepAutomation: { tune: Array(16).fill(null), nope: [1] } } }, defaultsDrums);
  assert.equal('stepAutomation' in hostile.snare, false, 'an empty one is dropped');
  const dressed = sanitizeDrums({ ...plain, snare: { ...plain.snare, stepAutomation: { tune: at(16, { 3: 0.4 }) } } }, defaultsDrums);
  assert.deepEqual(dressed.snare.stepAutomation, { tune: at(16, { 3: 0.4 }) });
  assert.deepEqual(sanitizeDrums(dressed, defaultsDrums), dressed, 'checking twice changes nothing');
  const scenes = sanitizeScenes([{ id: 'a', name: 'A', lanes: {}, drums: dressed }], defaultsDrums)!;
  assert.deepEqual(scenes[0].drums.snare.stepAutomation, { tune: at(16, { 3: 0.4 }) });
  assert.equal('stepAutomation' in scenes[0].drums.kick, false);
});

test('a hit plays with the step\'s value in place of the drum\'s own, and with nothing to put over it the settings are handed back as they are', () => {
  const settings = { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, pan: 0 };
  const track = { settings, stepAutomation: { tune: at(16, { 2: 0.5 }), volume: at(16, { 2: 0.1, 3: 0.2 }) } };
  assert.equal(hitSettings({ settings }, 2), settings);
  assert.equal(hitSettings(track, 0), settings);
  assert.deepEqual(hitSettings(track, 2), { ...settings, tune: 0.5, volume: 0.1 });
  assert.deepEqual(hitSettings(track, 3), { ...settings, volume: 0.2 });
  assert.deepEqual(hitSettings(track, 3, { volume: 0.9, pan: -1 }), { ...settings, volume: 0.9, pan: -1 }, 'what is being recorded plays over the pattern');
  assert.equal(settings.tune, 0, 'the drum\'s own settings are never changed');
});

test('a knob\'s change is split into what is recorded and what is kept', () => {
  const settings = { volume: 0.8, tone: 0.5, extra: 0.5 };
  assert.deepEqual(splitDrumAutomated({ tone: 0.7 }, settings), { moved: { tone: 0.7 }, rest: null });
  assert.deepEqual(splitDrumAutomated({ tone: 0.5 }, settings), { moved: {}, rest: { tone: 0.5 } });
  assert.deepEqual(splitDrumAutomated({ tone: 0.7, humanize: 0.2 }, settings), { moved: { tone: 0.7 }, rest: { humanize: 0.2 } });
  assert.deepEqual(splitDrumAutomated({ cymbalType: 'ride' }, settings), { moved: {}, rest: { cymbalType: 'ride' } });
  assert.deepEqual(splitDrumAutomated({ delaySend: 1 }, settings), { moved: {}, rest: { delaySend: 1 } }, 'all of a send is where a drum rests');
  assert.deepEqual(splitDrumAutomated({ pan: 0.5 }, settings).moved, { pan: 0.5 });
});

test('values are set and taken off one step at a time, and a setting with none left is gone', () => {
  let automation = withDrumAutomationValues(undefined, 'tune', [1, 2], [0.5, -0.5], 16);
  assert.deepEqual(automation, { tune: at(16, { 1: 0.5, 2: -0.5 }) });
  automation = withDrumAutomationValues(automation, 'tune', [1, 99, -1, 2.5], [null, 1, 1, 1], 16);
  assert.deepEqual(automation, { tune: at(16, { 2: -0.5 }) });
  assert.equal(withDrumAutomationValues(automation, 'tune', [2], [null], 16), undefined);
  assert.equal(withDrumAutomationValues(undefined, 'humanize', [1], [0.5], 16), undefined);
  assert.deepEqual(withoutDrumAutomation({ tune: at(16, { 1: 1 }), pan: at(16, { 1: 1 }) }, 'tune'), { pan: at(16, { 1: 1 }) });
});

test('every edit that moves, copies, cuts or resizes drum steps does the same to the automation', () => {
  const automation = { tune: at(16, { 0: 0.1, 5: 0.5 }) };
  assert.deepEqual(resizeDrumAutomationBars(automation, 16, 2)!.tune, [...automation.tune, ...automation.tune], 'growing repeats');
  assert.deepEqual(resizeDrumAutomationBars({ tune: [...automation.tune, ...none()] }, 16, 1)!.tune, automation.tune, 'shrinking keeps the first bars');
  assert.deepEqual(copyDrumAutomationBar({ tune: [...automation.tune, ...none()] }, 16, 0, [1])!.tune, [...automation.tune, ...automation.tune]);
  assert.deepEqual(resizeDrumAutomationEachBar(automation, 16, 12)!.tune, at(12, { 0: 0.1, 5: 0.5 }));
  assert.deepEqual(resizeDrumAutomationEachBar(automation, 16, 20)!.tune, at(20, { 0: 0.1, 5: 0.5 }));
  assert.deepEqual(layDrumAutomationAlong(automation, 32)!.tune, [...automation.tune, ...automation.tune]);
  assert.deepEqual(layDrumAutomationAlong(automation, 8)!.tune, at(8, { 0: 0.1, 5: 0.5 }));
  const shifted = rearrangeDrumAutomation(automation, 0, 16, step => (step + 15) % 16);
  assert.deepEqual(shifted!.tune, at(16, { 1: 0.1, 6: 0.5 }), 'shift right');
  assert.deepEqual(rearrangeDrumAutomation(automation, 0, 16, step => 15 - step)!.tune, at(16, { 15: 0.1, 10: 0.5 }), 'reverse');
  assert.deepEqual(rearrangeDrumAutomation({ tune: [...automation.tune, ...at(16, { 1: 1 })] }, 16, 16, step => 15 - step)!.tune, [...automation.tune, ...at(16, { 14: 1 })], 'only the bar on show');
  assert.equal(resizeDrumAutomationBars(undefined, 16, 2), undefined);
});

test('the store carries automation with the steps through bars, Copy bar, signature, scenes and Reset', () => {
  const service = setup();
  const snare = () => service.snapshot().drumState.snare.stepAutomation;
  ok(service.setDrumAutomation('snare', 'tune', [0, 5], [0.25, 0.5]));
  assert.deepEqual(snare(), { tune: at(16, { 0: 0.25, 5: 0.5 }) });

  ok(service.setDrumBars(2));
  assert.deepEqual(snare()!.tune, [...at(16, { 0: 0.25, 5: 0.5 }), ...at(16, { 0: 0.25, 5: 0.5 })], 'more bars repeat it');
  ok(service.setDrumAutomation('snare', 'tune', [16, 21], [null, null]));
  ok(service.copyDrumBar(0, [1]));
  assert.deepEqual(snare()!.tune, [...at(16, { 0: 0.25, 5: 0.5 }), ...at(16, { 0: 0.25, 5: 0.5 })], 'Copy bar copies it');
  ok(service.setDrumAutomation('snare', 'tune', [16, 21], [null, null]));
  ok(service.setDrumAutomation('snare', 'tune', [17], [-1]));

  const first = service.snapshot().currentSceneId as string;
  const other = ok(service.createScene({ empty: true })).currentSceneId as string;
  assert.equal('stepAutomation' in service.snapshot().drumState.snare, false, 'a new empty scene has none');
  ok(service.selectScene(first));
  assert.deepEqual(snare()!.tune, at(32, { 0: 0.25, 5: 0.5, 17: -1 }), 'opening a scene again puts it back');
  const stored = service.snapshot().scenes.find(scene => scene.id === first)!;
  assert.deepEqual(stored.drums.snare.stepAutomation!.tune, at(32, { 0: 0.25, 5: 0.5, 17: -1 }), 'the scene keeps it');

  ok(service.copyPartToScene(other, { drum: 'snare' }));
  assert.deepEqual(service.snapshot().scenes.find(scene => scene.id === other)!.drums.snare.stepAutomation!.tune, at(32, { 0: 0.25, 5: 0.5, 17: -1 }).slice(0, 16).concat(at(32, { 0: 0.25, 5: 0.5, 17: -1 }).slice(16)), 'Copy to scene copies it');

  ok(service.setDrumBars(1));
  assert.deepEqual(snare()!.tune, at(16, { 0: 0.25, 5: 0.5 }), 'fewer bars keep the first');
  ok(service.setSceneSignature('3/4'));
  assert.deepEqual(snare()!.tune, at(12, { 0: 0.25, 5: 0.5 }), 'a shorter bar loses the steps at its end');
  ok(service.setSceneSignature('4/4'));
  assert.deepEqual(snare()!.tune, at(16, { 0: 0.25, 5: 0.5 }));

  ok(service.resetDrums());
  assert.equal('stepAutomation' in service.snapshot().drumState.snare, false, 'Reset clears it');
});

test('undo takes a drawn value away, and it comes back with redo', () => {
  const service = setup();
  ok(service.setDrumAutomation('snare', 'tune', [3], [0.5]));
  assert.ok(service.undo());
  assert.equal('stepAutomation' in service.snapshot().drumState.snare, false);
  assert.ok(service.redo());
  assert.deepEqual(service.snapshot().drumState.snare.stepAutomation, { tune: at(16, { 3: 0.5 }) });
});

test('a project saved before drum automation opens and saves as it was', () => {
  const service = setup();
  ok(service.setDrumStep('snare', 4, true));
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  assert.ok(!JSON.stringify(file).includes('stepAutomation'));
  const again = setup();
  again.initialize(defaults());
  return again.importProject(file).then(result => {
    assert.ok(result.ok);
    assert.ok(!JSON.stringify(again.exportProject()).includes('stepAutomation'));
    assert.deepEqual(again.snapshot().drumState.snare.steps[4], true);
  });
});

const arrangementFor = (drumState: DrumState, extra: object = {}) => ({ tempo: 120, drumState, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, ...extra });
const withSnare = (patch: object): DrumState => {
  const state = JSON.parse(JSON.stringify(defaults().drumState)) as DrumState;
  state.snare = { ...state.snare, steps: Array.from({ length: 16 }, (_, step) => step % 4 === 0), settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, pan: 0 }, ...patch };
  return state;
};

test('live playback and WAV export build a hit\'s settings the same way', () => {
  const stepAutomation = { tune: at(16, { 4: 0.6, 8: -0.6 }), volume: at(16, { 12: 0.3 }), reverbSend: at(16, { 0: 0.25 }) };
  const state = withSnare({ stepAutomation });
  const track = state.snare;
  const hits = drumHits(arrangementFor(state, { drumMasterVolume: 0.5 }), 1).filter(hit => hit.instrument === 'snare');
  assert.equal(hits.length, 4);
  hits.forEach((hit, index) => {
    const step = index * 4, live = hitSettings(track, step);
    assert.deepEqual({ ...hit.settings, volume: hit.settings.volume / 0.5 }, { ...live, volume: live.volume }, `step ${step}`);
  });
  assert.deepEqual(hits.map(hit => hit.settings.tune), [0, 0.6, -0.6, 0]);
  assert.equal(hits[3].settings.volume, 0.3 * 0.5);
  assert.equal(hits[0].settings.reverbSend, 0.25);
  assert.equal(hits[1].settings.reverbSend, undefined, 'a step with none plays the drum\'s own');
});

test('a sliced song plays each bar\'s automation, and the render differs from the one without it', () => {
  const service = setup();
  ok(service.setDrumBars(2));
  ok(service.setDrumStep('snare', 0, true));
  ok(service.setDrumStep('snare', 16, true));
  ok(service.setDrumAutomation('snare', 'tune', [16], [0.8]));
  const first = service.snapshot().currentSceneId as string;
  ok(service.createScene({ empty: true }));
  ok(service.selectScene(first));
  const snapshot = service.snapshot();
  const scene = snapshot.scenes.find(entry => entry.id === first)!;
  const bars = sceneAsBars(scene);
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[1].drums.snare.stepAutomation!.tune, at(16, { 0: 0.8 }));
  assert.ok(bars[0].drums.snare.stepAutomation!.tune.every(value => value === null), 'a bar without any has no value');
  assert.deepEqual(sceneDrumState(bars[1], snapshot.drumState).snare.stepAutomation!.tune, at(16, { 0: 0.8 }));
  const plain = JSON.parse(JSON.stringify(snapshot.drumState)) as DrumState;
  delete plain.snare.stepAutomation;
  const hits = drumHits(arrangementFor(plain, { bars }), 2).filter(hit => hit.instrument === 'snare');
  assert.deepEqual(hits.map(hit => hit.settings.tune ?? 0), [0, 0.8]);

  const frames = SR * 2;
  const loud = (state: DrumState) => renderDrums(arrangementFor(state, { drumMasterVolume: 1 }), frames, SR)[0];
  const stateWith = withSnare({ stepAutomation: { tune: at(16, { 4: 1 }) } });
  const stateWithout = withSnare({});
  const a = loud(stateWith), b = loud(stateWithout);
  assert.ok(a.some((value, index) => Math.abs(value - b[index]) > 1e-4), 'the tuned hit sounds different');
  const same = loud(withSnare({ stepAutomation: { tune: at(16, { 4: 0 }) } }));
  assert.ok(same.every((value, index) => Math.abs(value - b[index]) < 1e-6), 'a value equal to the drum\'s own sounds the same');
});

test('a MIDI file hears a level automated on a step', () => {
  const quiet = withSnare({ stepAutomation: { volume: at(16, { 4: 0.1 }) } });
  const loud = withSnare({});
  const file = (state: DrumState) => Array.from(createMidiFile({ tempo: 120, synthLanes: [], drumState: state, drumMasterVolume: 1, drumSwing: 0 }));
  assert.notDeepEqual(file(quiet), file(loud));
});

test('a starting beat clears the automation of the steps it replaces', () => {
  const state = withSnare({ stepAutomation: { tune: at(16, { 4: 1 }) } });
  const next = starterDrums(STARTERS[0], state);
  assert.equal('stepAutomation' in next.snare, false);
});
