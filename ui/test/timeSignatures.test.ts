import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  TIME_SIGNATURES, barQuarters, barSteps, barTicks, barTimes, beatLength, beatPosition, beatStarts, drumBars, laneBars, layAlong, onBeat,
  relayBars, resizeEachBar, sceneAsBars, sceneBars, signatureFraction, stepsAcross, stepsPerBar, storedSignature, timeSignature, wholeNotes,
} from '../src/services/patternLength.ts';
import { entryStartTick, sceneAtTick, songBars, songLengthBars, songLengthTicks, songRows, songSeconds } from '../src/services/songPlayback.ts';
import { sanitizeDrums, sanitizePattern, sanitizeScenes, sanitizeSteps } from '../src/services/projectSanitization.ts';
import { arrangementWholes, drumHits, loopPass, renderPlan, renderSynthBars } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { clickAt, countInBeats, countInSeconds } from '../src/services/metronome.ts';
import { randomLine } from '../src/services/randomize.ts';
import { STARTERS, starterDrums, starterPattern } from '../src/services/starters.ts';
import { buildSampleSong } from '../src/services/sampleSong.ts';
import { createBuiltInPresets } from '../src/services/builtInPresets.ts';
import { seededRandom } from '../src/services/drumScheduling.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { defaults, ok, setup } from './helpers/store.ts';
import type { DrumState, Pattern, Scene, SequencerStep, Song, TimeSignature } from '../src/types.ts';

const off = (): SequencerStep => ({ active: false, velocity: 0.7 });
const on = (note: string, extra: Partial<SequencerStep> = {}): SequencerStep => ({ active: true, note, velocity: 0.8, ...extra });
const steps = (count: number, notes: Record<number, SequencerStep> = {}) => Array.from({ length: count }, (_, index) => notes[index] ?? off());
const drums = (count = 16, kicks: number[] = []): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array.from({ length: count }, (_, index) => instrument === 'kick' && kicks.includes(index)), muted: false, solo: false,
  settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0, pan: 0 },
}])) as DrumState;
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value as Uint8Array)).digest('hex');
const fresh = () => {
  setup();
  const service = new LocalProjectService();
  service.initialize(defaults());
  return service;
};
const lane = (service: LocalProjectService, id = 1) => service.snapshot().synths.find(synth => synth.synthId === id)!;
const openScene = (service: LocalProjectService) => { const { scenes, currentSceneId } = service.snapshot(); return scenes.find(scene => scene.id === currentSceneId)!; };

test('a bar is as many sixteenth steps as its time signature says, and anything else is 4/4', () => {
  assert.deepEqual(TIME_SIGNATURES, ['4/4', '3/4', '6/8', '5/4', '7/8', '12/8']);
  assert.deepEqual(TIME_SIGNATURES.map(signature => barSteps(signature)), [16, 12, 12, 20, 14, 24]);
  assert.deepEqual(TIME_SIGNATURES.map(signature => barTicks(signature)), [32, 24, 24, 40, 28, 48], 'a tick is a 32nd note');
  assert.deepEqual(TIME_SIGNATURES.map(signature => barQuarters(signature)), [4, 3, 3, 5, 3.5, 6]);
  for (const junk of [undefined, null, '', '9/8', '4/4 ', 44, {}, ['3/4']]) assert.equal(barSteps(junk), 16, String(junk));
  assert.equal(timeSignature('7/8'), '7/8');
  assert.equal(timeSignature('2/2'), '4/4');
  assert.equal(storedSignature('4/4'), undefined, '4/4 is stored as nothing, so a scene in it is what it was');
  assert.equal(storedSignature('nonsense'), undefined);
  assert.equal(storedSignature('12/8'), '12/8');
  assert.deepEqual(TIME_SIGNATURES.map(signature => signatureFraction(signature)), [
    { numerator: 4, denominator: 4 }, { numerator: 3, denominator: 4 }, { numerator: 6, denominator: 8 },
    { numerator: 5, denominator: 4 }, { numerator: 7, denominator: 8 }, { numerator: 12, denominator: 8 },
  ]);
});

test('3/4 and 6/8 are as long as each other and differ in where the beats fall', () => {
  assert.deepEqual(beatStarts('4/4'), [0, 4, 8, 12]);
  assert.deepEqual(beatStarts('3/4'), [0, 4, 8]);
  assert.deepEqual(beatStarts('6/8'), [0, 6]);
  assert.deepEqual(beatStarts('5/4'), [0, 4, 8, 12, 16]);
  assert.deepEqual(beatStarts('7/8'), [0, 4, 8], 'two, two, three');
  assert.deepEqual(beatStarts('12/8'), [0, 6, 12, 18]);
  const marks = (signature: TimeSignature, perBar = barSteps(signature)) => Array.from({ length: perBar }, (_, step) => step).filter(step => onBeat(signature, step, perBar));
  assert.deepEqual(marks('4/4'), [0, 4, 8, 12]);
  assert.deepEqual(marks('4/4', 32), [0, 8, 16, 24], 'finer steps: the same beats, twice as many steps apart');
  assert.deepEqual(marks('6/8', 24), [0, 12]);
  assert.deepEqual(marks('7/8', 28), [0, 8, 16], 'and the transport\'s ticks');
  assert.deepEqual([0, 1, 5, 6, 11].map(step => beatPosition('6/8', step)), [0, 1, 5, 0, 5]);
  assert.deepEqual([0, 3, 4, 8, 13].map(step => beatPosition('7/8', step)), [0, 3, 0, 0, 5]);
  assert.deepEqual(TIME_SIGNATURES.map(signature => beatLength(signature)), [4, 4, 6, 4, 4, 6]);
  assert.deepEqual(TIME_SIGNATURES.map(signature => stepsAcross(signature)), [8, 8, 6, 8, 8, 6], 'a narrow screen breaks a row where a beat ends');
});

test('how many bars a pattern is depends on the time signature, never on the step count alone', () => {
  assert.deepEqual([laneBars(12, undefined, '3/4'), laneBars(24, undefined, '3/4'), laneBars(24, 2, '3/4'), laneBars(48, 2, '3/4'), laneBars(96, 8, '6/8')], [1, 1, 2, 2, 8]);
  assert.deepEqual([stepsPerBar(24, undefined, '3/4'), stepsPerBar(24, 2, '3/4'), stepsPerBar(24, undefined, '12/8')], [24, 12, 24], '24 steps is a fine bar of 3/4, two bars of it, or one of 12/8');
  assert.equal(laneBars(32, 2, '3/4'), 1, 'a bar count that does not fit the signature is not believed');
  assert.equal(laneBars(32, 2), 2);
  assert.deepEqual([drumBars(drums(24), '3/4'), drumBars(drums(24), '12/8'), drumBars(drums(28), '7/8'), drumBars(drums(24)), drumBars({}, '5/4')], [2, 1, 2, 1, 1]);
  const scene: Scene = { id: 's', name: 'S', signature: '7/8', lanes: { 1: steps(28), 2: steps(56, { 30: on('C3') }) }, laneBars: { 1: 2, 2: 2 }, drums: drums(14, [0]) };
  assert.equal(sceneBars(scene), 2);
  const bars = sceneAsBars(scene);
  assert.deepEqual(bars.map(bar => [bar.signature, bar.lanes[1].length, bar.lanes[2].length, bar.drums.kick.steps.length]), [['7/8', 14, 28, 14], ['7/8', 14, 28, 14]], 'a bar cut from a scene carries its signature');
  assert.equal(bars[1].lanes[2][2].note, 'C3');
  assert.equal('signature' in sceneAsBars({ ...scene, signature: undefined, lanes: { 1: steps(16) }, laneBars: {}, drums: drums() })[0], false);
});

test('a new bar length keeps the bars: a shorter bar loses its end, a longer one gains empty steps', () => {
  const two = Array.from({ length: 32 }, (_, index) => index);
  assert.deepEqual(resizeEachBar(two, 16, 12, () => -1), [...two.slice(0, 12), ...two.slice(16, 28)]);
  assert.deepEqual(resizeEachBar(two, 16, 20, () => -1), [...two.slice(0, 16), -1, -1, -1, -1, ...two.slice(16), -1, -1, -1, -1], 'nothing is repeated');
  assert.deepEqual(resizeEachBar(two, 16, 16, () => -1), two);
  const notes = [on('C3'), off()];
  assert.notEqual(resizeEachBar(notes, 2, 2, off)[0], notes[0], 'a copy of each step');
  assert.deepEqual(layAlong([1, 2, 3], 7), [1, 2, 3, 1, 2, 3, 1]);
  assert.deepEqual(layAlong([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(relayBars(two, 12, () => -1), { bars: 4, items: [...two, ...Array(16).fill(-1)] }, '32 sixteenths need three bars of 3/4, and four is the next length there is');
  assert.deepEqual(relayBars(Array(128).fill(1), 12, () => 0).items.length, 96, 'past the eighth bar is left out');
});

test('each bar of a run starts where the one before ended, and bars of 4/4 are as they were', () => {
  const whole = 240 / 97;
  assert.deepEqual(barTimes(['4/4', undefined, '4/4'], whole), [0, 1, 2].map(bar => ({ start: bar * whole, duration: whole })), 'exactly the old arithmetic');
  assert.deepEqual(barTimes(['3/4', '7/8', '4/4'], 2), [{ start: 0, duration: 1.5 }, { start: 1.5, duration: 1.75 }, { start: 3.25, duration: 2 }]);
  assert.equal(wholeNotes(['3/4', '7/8', '4/4']), 2.625);
  assert.equal(wholeNotes([undefined, undefined]), 2);
});

test('only the six signatures are kept, and a scene\'s lanes and drums are held to its bar length', () => {
  const kit = defaults().drumState;
  const raw = (signature: unknown, count: number, laneLengths?: Record<number, number>) => ({
    id: `s-${String(signature)}`, name: 'S', signature, lanes: { 1: steps(count, { 1: on('C3') }) }, ...(laneLengths ? { laneBars: laneLengths } : {}),
    drums: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { steps: Array(count).fill(instrument === 'kick') }])),
  });
  const scenes = sanitizeScenes([raw('3/4', 12), raw('4/4', 16), raw('13/8', 16), raw('6/8', 16), raw('7/8', 28, { 1: 2 }), raw(['5/4'], 16)], kit)!;
  assert.deepEqual(scenes.map(scene => scene.signature), ['3/4', undefined, undefined, '6/8', '7/8', undefined]);
  assert.deepEqual(scenes.map(scene => 'signature' in scene), [true, false, false, true, true, false], '4/4 and nonsense leave nothing behind');
  assert.deepEqual(scenes.map(scene => [scene.lanes[1].length, scene.drums.kick.steps.length]), [[12, 12], [16, 16], [16, 16], [24, 12], [28, 28], [16, 16]]);
  assert.deepEqual(scenes[4].laneBars, { 1: 2 });
  assert.equal(scenes[3].lanes[1][1].note, 'C3', 'steps that fit are kept');

  assert.equal(sanitizeSteps(steps(12), 1, '3/4').length, 12);
  assert.equal(sanitizeSteps(steps(12), 1).length, 16, 'without a signature twelve steps are padded to a bar of 4/4, as before');
  assert.equal(sanitizeSteps(steps(20), 1, '3/4').length, 24);
  assert.deepEqual(sanitizePattern({ id: 'p', steps: steps(40), bars: 2 }, 120, '5/4')!.bars, 2);
  assert.equal(sanitizePattern({ id: 'p', steps: steps(40), bars: 2 }, 120)!.bars, undefined);
  assert.equal(sanitizeDrums(drums(24, [20]), kit, '3/4').kick.steps.length, 24);
  assert.equal(sanitizeDrums(drums(24, [20]), kit, '12/8').kick.steps[20], true);
  assert.equal(sanitizeDrums(drums(24, [20]), kit).kick.steps.length, 16);
});

test('a scene\'s time signature resizes every lane and the drums, keeps the bar count, and survives the next edit', () => {
  const service = fresh();
  ok(service.createLane(2));
  const first = lane(service), second = lane(service, 2);
  ok(service.writePattern(1, first.pattern.id, { steps: steps(32, { 3: on('C3'), 13: on('D3'), 16: on('E3', { length: 16 }), 31: on('F3') }), bars: 2 }));
  ok(service.writePattern(2, second.pattern.id, { steps: steps(32, { 25: on('G3') }) }));
  ok(service.setDrumBars(2));
  ok(service.setDrumStep('kick', 11, true));
  ok(service.setDrumStep('kick', 12, true));
  ok(service.setDrumStepVelocity('kick', 16, 0.4));
  ok(service.setDrumStepDetail('snare', 17, { ratchet: 3, probability: 0.5 }));

  const answer = ok(service.setSceneSignature('3/4'));
  assert.equal(answer.scenes[0].signature, '3/4');
  assert.equal(openScene(service).signature, '3/4');
  const cut = lane(service).pattern;
  assert.equal(cut.steps.length, 24);
  assert.equal(cut.bars, 2, 'still two bars');
  assert.deepEqual([cut.steps[3].note, cut.steps[12].note, cut.steps[12].length, cut.steps[23].note], ['C3', 'E3', 12, undefined], 'each bar keeps its start; the note at 13 and the one at the end of bar two are cut off, and a long note is held to the end');
  assert.equal(lane(service, 2).pattern.steps.length, 24, 'a lane of finer steps is still one bar of them');
  assert.equal(lane(service, 2).pattern.steps[25], undefined);
  const grid = service.snapshot().drumState;
  assert.deepEqual(DRUM_INSTRUMENTS.map(instrument => grid[instrument].steps.length), Array(DRUM_INSTRUMENTS.length).fill(24));
  assert.deepEqual([grid.kick.steps[11], grid.kick.steps[12], grid.kick.stepVelocities![12]], [true, false, 0.4], 'step 12 of the old bar is gone; old step 16 is now step 12');
  assert.deepEqual([grid.snare.stepRatchets![13], grid.snare.stepProbabilities![13]], [3, 0.5], 'a step\'s details move with it');

  // The trap: commitScene rebuilds the open scene from the live lanes on every edit.
  ok(service.setDrumStep('snare', 2, true));
  ok(service.writePattern(1, cut.id, { steps: cut.steps.map((step, index) => (index === 5 ? on('A3') : step)) }));
  assert.equal(openScene(service).signature, '3/4');
  assert.equal(lane(service).pattern.steps.length, 24, 'a pattern written in the scene is held to its bar');
  assert.equal(service.exportProject().project.scenes[0].signature, '3/4');

  ok(service.setSceneSignature('5/4'));
  const grown = lane(service).pattern;
  assert.equal(grown.steps.length, 40);
  assert.deepEqual([grown.steps[3].note, grown.steps[12].active, grown.steps[20].note, grown.steps[39].active], ['C3', false, 'E3', false], 'a longer bar gains empty steps at its end, not a repeat');
  assert.equal(service.snapshot().drumState.kick.steps.length, 40);

  ok(service.setSceneSignature('4/4'));
  assert.equal('signature' in openScene(service), false, '4/4 is stored as nothing');
  assert.equal(lane(service).pattern.steps.length, 32);

  const refused = service.setSceneSignature('9/8');
  assert.deepEqual(refused, { ok: false, status: 400, error: 'A scene is in 4/4, 3/4, 6/8, 5/4, 7/8, 12/8' });
  assert.equal(service.apply({ type: 'scene.signature', signature: 7 as never }).ok, false);
});

test('each scene has its own signature: a new scene takes the open one\'s, and going between them keeps both', () => {
  const service = fresh();
  const first = service.snapshot().currentSceneId;
  ok(service.setSceneSignature('7/8'));
  ok(service.setDrumStep('kick', 13, true));
  const made = ok(service.createScene({ empty: true }));
  const second = made.currentSceneId;
  assert.equal(openScene(service).signature, '7/8', 'a new scene is in the signature of the one it was made from');
  assert.equal(lane(service).pattern.steps.length, 14);
  ok(service.setSceneSignature('12/8'));
  ok(service.setDrumStep('snare', 23, true));
  ok(service.selectScene(first));
  assert.equal(service.snapshot().drumState.kick.steps.length, 14);
  assert.equal(service.snapshot().drumState.kick.steps[13], true);
  ok(service.selectScene(second));
  assert.equal(service.snapshot().drumState.snare.steps[23], true);
  assert.deepEqual(service.snapshot().scenes.map(scene => [scene.signature, scene.lanes[1].length, scene.drums.kick.steps.length]), [['7/8', 14, 14], ['12/8', 24, 24]]);

  // A lane added in a scene is a bar of that scene, and a scene that has nothing for it gets one of its own.
  ok(service.createLane(2));
  assert.equal(lane(service, 2).pattern.steps.length, 24);
  ok(service.selectScene(first));
  assert.equal(lane(service, 2).pattern.steps.length, 14);
  ok(service.resetDrums());
  assert.deepEqual(DRUM_INSTRUMENTS.map(instrument => service.snapshot().drumState[instrument].steps.length), Array(DRUM_INSTRUMENTS.length).fill(14), 'resetting the drums leaves one empty bar of the scene');
  ok(service.setDrumBars(2));
  assert.equal(service.snapshot().drumState.kick.steps.length, 28);
  ok(service.setDrumStep('clap', 3, true));
  ok(service.copyDrumBar(0, [1]));
  assert.equal(service.snapshot().drumState.clap.steps[17], true, 'a bar is copied by the scene\'s own bar length');
});

test('a part copied into a scene of another signature is laid along that scene\'s bars', () => {
  const service = fresh();
  const first = service.snapshot().currentSceneId;
  ok(service.createScene({ empty: true }));
  const second = service.snapshot().currentSceneId;
  ok(service.setSceneSignature('3/4'));
  ok(service.selectScene(first));
  const pattern = lane(service).pattern;
  ok(service.writePattern(1, pattern.id, { steps: steps(32, { 0: on('C3'), 10: on('D3', { length: 8 }), 14: on('E3'), 30: on('F3') }), bars: 2 }));
  ok(service.setDrumStep('kick', 0, true));
  ok(service.setDrumStep('kick', 14, true));
  ok(service.copyPartToScene(second, { synthId: 1 }));
  ok(service.copyPartToScene(second, { drum: 'kick' }));
  const other = service.snapshot().scenes[1];
  assert.equal(other.lanes[1].length, 24, 'the lane keeps its two bars, of the other scene\'s length');
  assert.equal(other.laneBars?.[1], 2);
  assert.deepEqual([other.lanes[1][0].note, other.lanes[1][10].note, other.lanes[1][14].note, other.lanes[1][23].active], ['C3', 'D3', 'E3', false], 'laid from the start, not cut bar by bar');
  assert.deepEqual(other.drums.kick.steps.flatMap((hit, index) => (hit ? [index] : [])), [0], 'a drum row stops short, as it always did');

  // The other way: a short bar goes round again along a longer one.
  ok(service.selectScene(second));
  ok(service.setDrumStep('snare', 4, true));
  ok(service.copyPartToScene(first, { drum: 'snare' }));
  assert.deepEqual(service.snapshot().scenes[0].drums.snare.steps.flatMap((hit, index) => (hit ? [index] : [])), [4]);
  // 3/4 and 6/8 are as long as each other, so between them a lane is copied as it is.
  ok(service.createScene({ empty: true }));
  const third = service.snapshot().currentSceneId;
  ok(service.setSceneSignature('6/8'));
  ok(service.selectScene(second));
  ok(service.copyPartToScene(third, { synthId: 1 }));
  assert.deepEqual(service.snapshot().scenes[2].lanes[1], service.snapshot().scenes[1].lanes[1]);
});

test('a signature is kept through a reload, a project file and a version that never heard of it', async () => {
  const service = fresh();
  ok(service.setSceneSignature('6/8'));
  ok(service.setDrumStep('kick', 6, true));
  const pattern = lane(service).pattern;
  ok(service.writePattern(1, pattern.id, { steps: steps(12, { 6: on('C3') }) }));
  service.flush();
  const reloaded = new LocalProjectService();
  reloaded.initialize(defaults());
  assert.equal(openScene(reloaded).signature, '6/8');
  assert.equal(lane(reloaded).pattern.steps.length, 12, 'the live lane is read as a bar of the open scene, not padded to sixteen');
  assert.equal(lane(reloaded).pattern.steps[6].note, 'C3');
  assert.equal(reloaded.snapshot().drumState.kick.steps.length, 12);

  const file = JSON.parse(JSON.stringify(service.exportProject()));
  const target = fresh();
  assert.deepEqual(await target.importProject(JSON.parse(JSON.stringify(file))), { ok: true, repaired: false }, 'not reported as damaged');
  assert.equal(openScene(target).signature, '6/8');
  assert.equal(lane(target).pattern.steps.length, 12);
  assert.equal(lane(target).pattern.steps[6].note, 'C3');

  // A hostile file: a signature that is not one, with lanes of no length that fits.
  const hostile = JSON.parse(JSON.stringify(file));
  hostile.project.scenes[0].signature = { toString: '3/4' };
  const bounded = fresh().readProjectFile(hostile);
  assert.ok(bounded.ok);
  assert.equal('signature' in bounded.project.scenes[0], false);
  assert.equal(bounded.project.synths[0].pattern.steps.length, 16);
  assert.equal(bounded.project.drumState.kick.steps.length, 16);
});

test('a project saved before there were time signatures opens exactly as it was', async () => {
  const service = fresh();
  ok(service.createLane(2));
  ok(service.writePattern(1, lane(service).pattern.id, { steps: steps(64, { 3: on('C3'), 40: on('D3', { length: 5 }) }), bars: 2 }));
  ok(service.writePattern(2, lane(service, 2).pattern.id, { steps: steps(32, { 7: on('E3') }), bars: 2 }));
  ok(service.setDrumBars(4));
  ok(service.setDrumStep('kick', 50, true));
  ok(service.createScene());
  ok(service.setDrumStep('snare', 9, true));
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  for (const scene of file.project.scenes) assert.equal('signature' in scene, false, 'a project in 4/4 stores nothing new');
  const target = fresh();
  assert.deepEqual(await target.importProject(JSON.parse(JSON.stringify(file))), { ok: true, repaired: false });
  const plain = (project: any) => JSON.parse(JSON.stringify({ scenes: project.scenes, song: project.song, synths: project.synths.map((synth: any) => synth.pattern), drumState: project.drumState }));
  assert.deepEqual(plain(target.snapshot()), plain(file.project));
});

// The older arithmetic, written out: a bar of 4/4 is 240 / tempo seconds and starts at its number
// times that. These hold the exporters to it for a project with no signature, and for one that
// says 4/4, which must be the same thing.
test('a project in 4/4 is rendered and exported as it was before a bar could be another length', () => {
  const tempo = 133, sampleRate = 22050, whole = 240 / tempo;
  const params = createDefaultSynthParameters();
  const line = [steps(16, { 0: on('C3'), 5: on('E3', { length: 3 }), 15: on('G3') }), steps(32, { 9: on('A3') }), steps(16, { 2: on('C4', { ratchet: 2 }) })];
  const frames = Math.ceil(3.5 * whole * sampleRate);
  const before = renderSynthBars(line, params, tempo, frames, sampleRate);
  const after = renderSynthBars(line, params, tempo, frames, sampleRate, whole, null, barTimes(['4/4', undefined, '4/4'], whole));
  assert.deepEqual(after[0], before[0], 'sample for sample');
  assert.deepEqual(after[1], before[1]);
  assert.ok(before[0].some(sample => sample !== 0));

  const kit = drums(16, [0, 4, 10]);
  kit.snare.steps[4] = true;
  kit.closedHH.steps = kit.closedHH.steps.map((_, index) => index % 2 === 1);
  kit.snare.stepRatchets = Array.from({ length: 16 }, (_, index) => (index === 4 ? 3 : 1));
  const arrangement = { tempo, drumState: kit, drumKitId: 'clean-analog', drumMasterVolume: 0.9, drumSwing: 0.3 };
  const hits = drumHits(arrangement, 3);
  assert.deepEqual(drumHits({ ...arrangement, signature: '4/4' as const }, 3), hits);
  const kicks = hits.filter(hit => hit.instrument === 'kick').map(hit => hit.time);
  assert.deepEqual(kicks, [0, 1, 2].flatMap(bar => [0, 4, 10].map(step => bar * whole + step * (whole / 16))), 'bar times the bar\'s length, plus the step');
  const hats = hits.filter(hit => hit.instrument === 'closedHH').map(hit => hit.time);
  assert.equal(hats[0], (1 + 0.3) * (whole / 16), 'swing as before');
  assert.equal(hits.length, 3 * (3 + 3 + 8));

  assert.deepEqual(renderPlan(tempo, 1.5, 44100, false, 4), { bars: 4, barDuration: whole, frames: Math.ceil((4 * whole + 1.5) * 44100), start: 0 });
  const barFrames = Math.round(whole * 44100), passes = 1 + Math.ceil(1.5 * 44100 / (barFrames * 2));
  assert.deepEqual(renderPlan(tempo, 1.5, 44100, true, 2), { bars: passes * 2, barDuration: barFrames / 44100, frames: passes * 2 * barFrames, start: (passes - 1) * 2 * barFrames });
  assert.equal(arrangementWholes({ bars: [{ id: 'a', name: 'A', lanes: {}, drums: kit }, { id: 'a', name: 'A', lanes: {}, drums: kit }] }), 2);
  assert.equal(arrangementWholes({}), 1);

  const midi = (signature?: string) => createMidiFile({
    tempo, drumState: kit, drumSwing: 0.3, drumMasterVolume: 0.9, ...(signature ? { signature } : {}),
    synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo, steps: line[0] } }, { id: 2, pattern: { id: 'q', name: 'Bass', tempo, steps: line[1] } }],
  });
  assert.deepEqual(midi('4/4'), midi());
  const song = (signature?: string) => createMidiFile({
    tempo, drumState: kit, drumSwing: 0.3, drumMasterVolume: 0.9,
    synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Lead', tempo, steps: line[0] } }],
    bars: [{ name: 'A', lanes: { 1: line[0] }, drumState: kit, ...(signature ? { signature } : {}) }, { name: 'B', lanes: { 1: line[2] }, drumState: drums() }, { name: 'B', lanes: { 1: line[1] }, drumState: kit }],
  });
  assert.deepEqual(song('4/4'), song());
  // The bytes these two files had on main before this change (the same test run there).
  assert.equal(sha(midi()), PINNED.midi);
  assert.equal(sha(song()), PINNED.song);
  assert.equal(sha(JSON.stringify(hits)), PINNED.hits);
});
const PINNED = {
  midi: '666645ebe0c52b86a547759776b688c503168fd5c7820bc23d8accc2b2b1c013',
  song: '12413ae6fa0f9c17615b74ea15277f7724b472485b690f2f3e26b3dfad3cf816',
  hits: '56f45b48364ae2409678746144c2b2d13db8d2b62b9357c9dbe55ee3766b8151',
};

test('a bar of another signature is rendered at its own length, and drums play only its steps', () => {
  const tempo = 120, whole = 2;
  const scene = (id: string, signature: TimeSignature | undefined, kicks: number[]): Scene => ({ id, name: id, ...(signature ? { signature } : {}), lanes: {}, drums: drums(barSteps(signature), kicks) });
  const arrangement = { tempo, drumState: drums(), drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, bars: [scene('a', '3/4', [0, 11]), scene('b', '7/8', [0, 13]), scene('c', undefined, [0, 15])] };
  assert.deepEqual(drumHits(arrangement, 3, whole).map(hit => hit.time), [0, 11 / 8, 1.5, 1.5 + 13 / 8, 3.25, 3.25 + 15 / 8], 'a step is a sixteenth in every signature');
  assert.equal(arrangementWholes(arrangement), 2.625);
  assert.deepEqual(drumHits({ ...arrangement, bars: undefined, signature: '3/4', drumState: drums(12, [0, 11]) }, 2, whole).map(hit => hit.time), [0, 11 / 8, 1.5, 1.5 + 11 / 8]);
  assert.equal(drumHits({ ...arrangement, bars: undefined, signature: '3/4', drumState: drums(16, [0, 14]) }, 1, whole).length, 1, 'a step past the end of the bar is not played');

  const plan = renderPlan(tempo, 1, 44100, false, 3, 2.625);
  assert.equal(plan.frames, Math.ceil((2.625 * whole + 1) * 44100));
  const one = renderPlan(tempo, 1, 44100, false, 1, 0.75);
  assert.equal(one.frames, Math.ceil((1.5 + 1) * 44100), 'one bar of 3/4 at 120 is a second and a half, plus the tail');

  // A loop is a whole number of samples however long its bars are, so it starts on a bar line.
  for (const [bpm, wholes] of [[120, 0.75], [97, 0.875], [133, 2.625], [171, 1.5]] as const) {
    const pass = loopPass(bpm, 44100, wholes);
    assert.ok(Number.isInteger(pass.frames), `${bpm} ${wholes}`);
    assert.ok(Math.abs(pass.frames - 240 / bpm * 44100 * wholes) <= 0.5);
    assert.ok(Math.abs(pass.barDuration * wholes * 44100 - pass.frames) < 1e-6);
    const loop = renderPlan(bpm, 2, 44100, true, 1, wholes);
    assert.equal(loop.frames % pass.frames, 0);
    assert.equal(loop.frames - loop.start, pass.frames, 'the pass kept is one pass long');
  }

  // A lane's steps fill their own bar: twelve steps of 3/4 are the same sixteenths as sixteen of 4/4.
  const params = createDefaultSynthParameters();
  const sampleRate = 22050, frames = Math.ceil(4 * sampleRate);
  const waltz = renderSynthBars([steps(12, { 0: on('C3') }), steps(12, { 0: on('C4') })], params, tempo, frames, sampleRate, whole, null, barTimes(['3/4', '3/4'], whole));
  const laid = renderSynthBars([steps(24, { 0: on('C3'), 12: on('C4') })], params, tempo, frames, sampleRate, 1.5 * whole);
  const far = (a: Float32Array, b: Float32Array) => a.reduce((most, sample, index) => Math.max(most, Math.abs(sample - b[index])), 0);
  assert.ok(far(waltz[0], laid[0]) < 1e-6, 'the second bar starts a bar of 3/4 after the first');
});

test('a MIDI file says its time signature, and says it again where a song changes it', () => {
  const kit = drums(12, [0]);
  const find = (bytes: Uint8Array, event: number[]) => {
    const places: number[] = [];
    for (let at = 0; at + event.length <= bytes.length; at++) if (event.every((byte, index) => bytes[at + index] === byte)) places.push(at);
    return places;
  };
  const one = (signature?: string, count = 16) => createMidiFile({ tempo: 120, drumState: drums(count, [0]), ...(signature ? { signature } : {}), synthLanes: [{ id: 1, pattern: { id: 'p', name: 'L', tempo: 120, steps: steps(count, { 0: on('C3') }) } }] });
  // FF 58 04, numerator, the denominator as a power of two, MIDI clocks to a click, 32nds to a quarter.
  assert.equal(find(one(), [0xff, 0x58, 0x04, 4, 2, 24, 8]).length, 1, '4/4, as every file said before');
  assert.equal(find(one('3/4', 12), [0xff, 0x58, 0x04, 3, 2, 24, 8]).length, 1);
  assert.equal(find(one('6/8', 12), [0xff, 0x58, 0x04, 6, 3, 36, 8]).length, 1, 'a dotted quarter to the click');
  assert.equal(find(one('5/4', 20), [0xff, 0x58, 0x04, 5, 2, 24, 8]).length, 1);
  assert.equal(find(one('7/8', 14), [0xff, 0x58, 0x04, 7, 3, 12, 8]).length, 1);
  assert.equal(find(one('12/8', 24), [0xff, 0x58, 0x04, 12, 3, 36, 8]).length, 1);
  for (const signature of ['3/4', '6/8', '5/4', '7/8', '12/8']) assert.equal(find(one(signature, barSteps(signature)), [0xff, 0x58, 0x04, 4, 2, 24, 8]).length, 0, signature);

  // A song: 3/4, 3/4, 7/8, 4/4. A step is 120 ticks, so the bars start at 0, 1440, 2880 and 4560.
  const bar = (name: string, signature: string | undefined, note: string) => ({ name, ...(signature ? { signature } : {}), lanes: { 1: steps(barSteps(signature), { 0: on(note) }) }, drumState: signature === '3/4' ? kit : drums(barSteps(signature)) });
  const bytes = createMidiFile({
    tempo: 120, drumState: kit, synthLanes: [{ id: 1, pattern: { id: 'p', name: 'L', tempo: 120, steps: steps(12) } }],
    bars: [bar('A', '3/4', 'C3'), bar('A', '3/4', 'D3'), bar('B', '7/8', 'E3'), bar('C', undefined, 'F3')],
  });
  const vlq = (value: number) => (value < 128 ? [value] : [0x80 | (value >> 7), value & 0x7f]);
  assert.equal(find(bytes, [0xff, 0x58, 0x04, 3, 2, 24, 8]).length, 1, 'once for the two bars of 3/4');
  assert.equal(find(bytes, [...vlq(2880), 0xff, 0x58, 0x04, 7, 3, 12, 8]).length, 1, 'the change to 7/8 is on its bar line');
  assert.equal(find(bytes, [...vlq(4560 - 2880), 0xff, 0x58, 0x04, 4, 2, 24, 8]).length, 1, 'and back to 4/4 on its bar line');
  assert.equal(find(bytes, [0xff, 0x58, 0x04]).length, 3, 'three signatures in all');
  // The lane's notes: note-ons for C3 (48), D3 (50), E3 (52), F3 (53), each on its bar line.
  const track = bytes.subarray(find(bytes, [0x90, 48])[0] - 1);
  const ons: Array<[number, number]> = [];
  let tick = 0, at = 0;
  while (at < track.length && ons.length < 4) {
    let delta = 0;
    while (track[at] & 0x80) delta = (delta << 7) | (track[at++] & 0x7f);
    delta = (delta << 7) | track[at++];
    tick += delta;
    if (track[at] === 0x90) ons.push([track[at + 1], tick]);
    at += 3;
  }
  assert.deepEqual(ons, [[48, 0], [50, 1440], [52, 2880], [53, 4560]]);
  assert.equal(find(bytes, [0x99, 36]).length, 2, 'the kick of each 3/4 bar');
});

test('a song of scenes in different signatures is walked by ticks, each scene at its own bar length', () => {
  const song: Song = { entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }, { sceneId: 'c', repeats: 3 }], loop: false };
  const lengthOf = (id: string) => ({ a: 1, b: 2, c: 1 }[id] ?? 1);
  const signatureOf = (id: string) => ({ a: undefined, b: '7/8', c: '6/8' }[id]);
  // a: 2 bars of 32 ticks; b: one pass of 2 bars of 28; c: 3 bars of 24.
  assert.equal(songLengthBars(song, lengthOf), 7);
  assert.equal(songLengthTicks(song, lengthOf, signatureOf), 64 + 56 + 72);
  assert.equal(songLengthTicks(song, lengthOf), 7 * 32, 'with no signatures every bar is 4/4');
  assert.deepEqual([0, 1, 2, 3].map(entry => entryStartTick(song, entry, lengthOf, signatureOf)), [0, 64, 120, 192]);
  const at = (tick: number) => sceneAtTick(song, tick, lengthOf, signatureOf);
  assert.deepEqual(at(0), { sceneId: 'a', entryIndex: 0, repeat: 0, bar: 0, tick: 0 });
  assert.deepEqual(at(33), { sceneId: 'a', entryIndex: 0, repeat: 1, bar: 0, tick: 1 });
  assert.deepEqual(at(64), { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 0, tick: 0 });
  assert.deepEqual(at(64 + 27), { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 0, tick: 27 });
  assert.deepEqual(at(64 + 28), { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 1, tick: 0 }, 'the second bar of a two-bar scene starts 28 ticks in');
  assert.deepEqual(at(120), { sceneId: 'c', entryIndex: 2, repeat: 0, bar: 0, tick: 0 });
  assert.deepEqual(at(120 + 24 * 2 + 23), { sceneId: 'c', entryIndex: 2, repeat: 2, bar: 0, tick: 23 });
  assert.equal(at(192), null, 'the song has ended');
  assert.equal(at(-1), null);
  assert.deepEqual(sceneAtTick({ ...song, loop: true }, 192 + 65, lengthOf, signatureOf), { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 0, tick: 1 }, 'a looping song goes round');
  assert.equal(sceneAtTick({ entries: [], loop: true }, 0), null);
  // Every tick of the song belongs to exactly one bar, and each bar starts on tick 0.
  const starts = Array.from({ length: 192 }, (_, tick) => at(tick)!).filter(position => position.tick === 0);
  assert.deepEqual(starts.map(position => position.sceneId).join(''), 'aabbccc');

  const rows = songRows(song, lengthOf, 120, signatureOf);
  assert.deepEqual(rows.map(row => [row.bars, row.startBar, row.startSeconds, row.seconds]), [[2, 0, 0, 4], [2, 2, 4, 3.5], [3, 4, 7.5, 4.5]], 'a bar of 7/8 at 120 is 1.75 seconds, one of 6/8 is 1.5');
  assert.equal(songSeconds(song, lengthOf, 120, signatureOf), 12);
  assert.equal(songSeconds(song, lengthOf, 120), 14, 'all in 4/4');
  assert.deepEqual(songRows(song, lengthOf, 97).map(row => [row.startSeconds, row.seconds]), [[0, 2 * (240 / 97)], [2 * (240 / 97), 2 * (240 / 97)], [4 * (240 / 97), 3 * (240 / 97)]], 'in 4/4 the times are what they were');

  const scenes: Scene[] = [
    { id: 'a', name: 'A', lanes: { 1: steps(16) }, drums: drums() },
    { id: 'b', name: 'B', signature: '7/8', lanes: { 1: steps(28) }, laneBars: { 1: 2 }, drums: drums(14) },
    { id: 'c', name: 'C', signature: '6/8', lanes: { 1: steps(12) }, drums: drums(12) },
  ];
  const bars = songBars(song, scenes);
  assert.deepEqual(bars.map(bar => `${bar.name}${barSteps(bar.signature)}:${bar.lanes[1].length}`), ['A16:16', 'A16:16', 'B14:14', 'B14:14', 'C12:12', 'C12:12', 'C12:12']);
  assert.equal(wholeNotes(bars.map(bar => bar.signature)) * 32, 192, 'the bars an export plays are as long as the ticks playback counts');
});

test('the metronome clicks the signature\'s beats, and a count-in is one bar of it', () => {
  const clicks = (signature?: TimeSignature) => Array.from({ length: barTicks(signature) }, (_, tick) => clickAt(tick, signature)).flatMap((kind, tick) => (kind ? [`${tick}${kind === 'bar' ? '!' : ''}`] : []));
  assert.deepEqual(clicks(), ['0!', '8', '16', '24']);
  assert.deepEqual(clicks('3/4'), ['0!', '8', '16']);
  assert.deepEqual(clicks('6/8'), ['0!', '12'], 'two beats of three eighths');
  assert.deepEqual(clicks('5/4'), ['0!', '8', '16', '24', '32']);
  assert.deepEqual(clicks('7/8'), ['0!', '8', '16']);
  assert.deepEqual(clicks('12/8'), ['0!', '12', '24', '36']);
  assert.equal(countInBeats(1, '6/8'), 3, 'counted in quarter notes, which is what guests are told');
  assert.equal(countInBeats(1, '7/8'), 3.5);
  assert.equal(countInSeconds(1, 120, '3/4'), 1.5);
  assert.equal(countInSeconds(1, 120), 2);
});

test('a random line follows the beats of the signature, and in 4/4 is the line it always was', () => {
  const pattern = (count: number, bars?: number): Pattern => ({ id: 'p', name: 'P', tempo: 120, steps: steps(count), ...(bars ? { bars } : {}) });
  const choice = { key: 'C', scale: 'minor-pentatonic' } as const;
  assert.deepEqual(randomLine(pattern(32, 2), choice, 3, seededRandom(7), '4/4'), randomLine(pattern(32, 2), choice, 3, seededRandom(7)));
  // Over many lines, the first step of each beat is filled most often, and in 6/8 the beats are six steps.
  const counts = (signature: TimeSignature) => {
    const filled = Array(barSteps(signature)).fill(0);
    for (let seed = 1; seed <= 300; seed++) randomLine(pattern(barSteps(signature)), choice, 3, seededRandom(seed), signature).steps.forEach((step, index) => { if (step.active) filled[index] += 1; });
    return filled;
  };
  const compound = counts('6/8');
  assert.equal(compound.length, 12);
  assert.ok(compound[6] > 220 && compound[6] > compound[4] && compound[4] > compound[5] && compound[2] > compound[3], JSON.stringify(compound));
  const waltz = counts('3/4');
  assert.ok(waltz[4] > 220 && waltz[8] > 220 && waltz[6] < 200 && waltz[6] > waltz[5], JSON.stringify(waltz));
  const fine = randomLine(pattern(48, 2), choice, 3, seededRandom(3), '3/4');
  assert.equal(fine.steps.length, 48);
  assert.ok(fine.steps.every((step, index) => !step.active || index % 2 === 0), 'finer steps get the same rhythm on every second step');
});

test('a starting beat in a shorter bar takes as much as fits, and the sample song is in 4/4', () => {
  const starter = STARTERS[0];
  const laid = starterDrums(starter, drums(24), '3/4');
  for (const instrument of DRUM_INSTRUMENTS) {
    assert.equal(laid[instrument].steps.length, 24);
    assert.deepEqual(laid[instrument].steps.slice(12), laid[instrument].steps.slice(0, 12), 'the same in every bar');
    assert.deepEqual(laid[instrument].steps.slice(0, 12), starterDrums(starter, drums(16))[instrument].steps.slice(0, 12), 'the start of the bar it was written for');
  }
  const bass = starterPattern(starter, { id: 'p', name: 'P', tempo: 120, steps: steps(24), bars: 2 }, '3/4');
  assert.equal(bass.steps.length, 24);
  assert.deepEqual(bass.steps.slice(12).map(step => step.note), bass.steps.slice(0, 12).map(step => step.note));
  assert.deepEqual(starterPattern(starter, { id: 'p', name: 'P', tempo: 120, steps: steps(16) }), starterPattern(starter, { id: 'p', name: 'P', tempo: 120, steps: steps(16) }, '4/4'));

  const built = buildSampleSong(fresh().exportProject(), createBuiltInPresets()) as any;
  assert.ok(built.project.scenes.length > 1);
  for (const scene of built.project.scenes) assert.equal('signature' in scene, false);
});
