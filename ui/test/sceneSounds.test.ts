import test from 'node:test';
import assert from 'node:assert/strict';
import { ok, setup } from './helpers/store.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { renderSynthBars } from '../src/services/wavExport.ts';
import { usedSampleIds } from '../src/services/projectSamples.ts';
import { soundIn } from '../src/services/sceneSounds.ts';
import { SynthCore } from '../../engine/src/synth/SynthCore.ts';
import { createDefaultSynthParameters, toVoiceParams } from '../../engine/src/synth/voiceParams.ts';
import type { SequencerStep } from '../src/types.ts';

// A lane's instrument chosen per scene (docs/SCENE_SOUNDS_PLAN.md).

function twoScenes() {
  const service = setup();
  const first = service.getScenes().currentSceneId;
  ok(service.createScene());
  const second = service.getScenes().currentSceneId;
  return { service, first, second };
}
const lane = (service: ReturnType<typeof setup>) => service.snapshot().synths[0];
const PLAIN = createDefaultSynthParameters().oscillator.type;

test('a scene with a sound of its own plays it, level, pan and sends too, and the others the shared sound', () => {
  const { service, first, second } = twoScenes();
  ok(service.setSceneSound(1, true));
  ok(service.setSynthParams(1, { oscillator: { type: 'square' }, filter: { frequency: 400 } } as never));
  ok(service.setSynthModel(1, { modelId: 'juno-106' }));
  ok(service.setSynthParams(1, { gain: 0.3, pan: -0.5, fxSends: { reverb: 0.6 } } as never));
  ok(service.selectScene(first));
  assert.equal(lane(service).synthParams.oscillator.type, PLAIN, 'the shared sound');
  assert.equal(lane(service).synthModelId, 'generic');
  assert.notDeepEqual([lane(service).synthParams.gain, lane(service).synthParams.pan, lane(service).synthParams.fxSends.reverb], [0.3, -0.5, 0.6], 'the level, pan and sends were the scene\'s');
  assert.equal('shared' in lane(service), false);
  ok(service.setSynthParams(1, { gain: 0.7 } as never));
  ok(service.selectScene(second));
  assert.deepEqual([lane(service).synthParams.oscillator.type, lane(service).synthParams.filter.frequency, lane(service).synthModelId], ['square', 400, 'juno-106']);
  assert.deepEqual([lane(service).synthParams.gain, lane(service).synthParams.pan, lane(service).synthParams.fxSends.reverb], [0.3, -0.5, 0.6], 'a level set in another scene is that one\'s alone');
  assert.equal(lane(service).shared?.synthParams.gain, 0.7);
  assert.equal(lane(service).shared?.synthParams.oscillator.type, PLAIN);
});

test('a new scene copies the open one\'s own sounds, and a lane taken away takes its sounds with it', () => {
  const { service } = twoScenes();
  ok(service.setSceneSound(1, true));
  ok(service.setSynthParams(1, { oscillator: { type: 'triangle' } } as never));
  ok(service.createLane(2));
  ok(service.setSceneSound(2, true));
  ok(service.createScene());
  assert.equal(lane(service).synthParams.oscillator.type, 'triangle');
  const scenes = service.getScenes().scenes;
  assert.deepEqual(scenes.map(scene => Object.keys(scene.sounds ?? {})), [[], ['1', '2'], ['1', '2']]);
  ok(service.removeLane(2));
  assert.deepEqual(service.getScenes().scenes.map(scene => Object.keys(scene.sounds ?? {})), [[], ['1'], ['1']]);
});

// Each edit in a turn of its own: undo takes back a whole turn.
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
test('turning a scene\'s own sound off gives the lane its shared sound back, and undo puts the scene\'s back', async () => {
  const { service } = twoScenes();
  ok(service.setSceneSound(1, true));
  ok(service.setSynthParams(1, { oscillator: { type: 'square' } } as never));
  await turn();
  ok(service.setSceneSound(1, false));
  assert.equal(lane(service).synthParams.oscillator.type, PLAIN);
  assert.equal(service.undo(), true);
  assert.equal(lane(service).synthParams.oscillator.type, 'square');
  assert.ok(lane(service).shared);
});

test('a project with scene sounds is saved and read whole; one whose open scene has a sound and no shared one takes it', async () => {
  const { service } = twoScenes();
  await service.openLibrary(createMemoryLibrary());
  ok(service.setSceneSound(1, true));
  ok(service.setSynthParams(1, { oscillator: { type: 'square' } } as never));
  const file = service.exportProject() as { project: any };
  const opened = await service.importProject(file);
  assert.deepEqual([opened.ok, opened.ok && opened.repaired], [true, false]);
  assert.equal(lane(service).synthParams.oscillator.type, 'square');
  ok(service.selectScene(service.getScenes().scenes[0].id));
  assert.equal(lane(service).synthParams.oscillator.type, PLAIN);

  // Written by hand (a sample song): the open scene names a sound, the lane is the shared one.
  const handmade = structuredClone(file);
  const open = handmade.project.scenes.find((scene: any) => scene.id === handmade.project.currentSceneId);
  delete handmade.project.synths[0].shared;
  handmade.project.synths[0].synthParams.oscillator.type = 'sawtooth';
  const again = await service.importProject(handmade);
  assert.equal(again.ok, true);
  assert.equal(lane(service).synthParams.oscillator.type, 'square', 'the open scene\'s own');
  assert.equal(lane(service).shared?.synthParams.oscillator.type, 'sawtooth');
  assert.ok(open.sounds[1]);
});

test('a scene\'s sounds that are not sounds, or are out of range, are left out or held to what a sound can be', async () => {
  const service = setup();
  await service.openLibrary(createMemoryLibrary());
  const file = service.exportProject() as { project: any };
  file.project.scenes[0].sounds = { 1: { synthParams: { gain: 50, filter: { frequency: -4 } }, synthModelId: 'nonsense' }, 7: { synthParams: {} }, 2: 'loud' };
  const opened = await service.importProject(file);
  assert.equal(opened.ok, true);
  const scene = service.getScenes().scenes[0];
  assert.deepEqual(Object.keys(scene.sounds ?? {}), ['1']);
  assert.ok(lane(service).synthParams.filter.frequency > 0);
  assert.equal(lane(service).synthModelId, 'generic');
  assert.ok(lane(service).synthParams.gain <= 2);
});

test('replacing the scenes (Reset All) keeps the lanes as they now sound', () => {
  const { service } = twoScenes();
  ok(service.setSceneSound(1, true));
  ok(service.setSynthParams(1, { oscillator: { type: 'square' } } as never));
  ok(service.replaceScenes());
  assert.equal(lane(service).synthParams.oscillator.type, 'square');
  assert.equal('shared' in lane(service), false);
  assert.equal(service.getScenes().scenes.some(scene => scene.sounds), false);
});

test('the samples a project plays include those of its scenes\' own sounds and a shared sound', () => {
  const project = {
    synths: [{ synthParams: { sample: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, shared: { synthParams: { sample: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } } } }],
    scenes: [{ sounds: { 1: { synthParams: { sample: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } } } } }],
  };
  assert.equal(usedSampleIds(project).length, 3);
});

test('what a lane plays in a scene that is not open', () => {
  const shared = createDefaultSynthParameters(), own = { ...createDefaultSynthParameters(), gain: 0.1, oscillator: { type: 'square' as const, detune: 0 } };
  const live = { ...createDefaultSynthParameters(), gain: 0.9 };
  const studioLane = { synthParams: live, synthModelId: 'generic' as const, synthModelParams: { macro1: .5, macro2: .5, macro3: .5, macro4: .5 } };
  assert.equal(soundIn(null, 1, studioLane), live, 'a lane without a scene of its own');
  const scene = { sounds: { 1: { synthParams: own, synthModelId: 'generic' as const, synthModelParams: studioLane.synthModelParams } } };
  assert.deepEqual([soundIn(scene, 1, studioLane).oscillator.type, soundIn(scene, 1, studioLane).gain], ['square', 0.1]);
  const withShared = { ...studioLane, shared: { synthParams: shared, synthModelId: 'generic' as const, synthModelParams: studioLane.synthModelParams } };
  assert.equal(soundIn({}, 1, withShared), shared);
});

const steps = (note: string): SequencerStep[] => Array.from({ length: 16 }, (_, index) => ({ active: index % 4 === 0, note, velocity: 0.8 }));
const SR = 8000;

test('a render changes instrument at the first bar of a scene with a sound of its own, and is as it was without one', () => {
  const params = createDefaultSynthParameters(), bars = [steps('C3'), steps('C3')];
  const plain = renderSynthBars(bars, params, 120, SR * 4, SR, 2);
  const none = renderSynthBars(bars, params, 120, SR * 4, SR, 2, null, undefined, [], 0, 16, [undefined, undefined]);
  assert.deepEqual([...none[0]], [...plain[0]], 'no sounds of its own: sample for sample');
  const square = { ...params, oscillator: { ...params.oscillator, type: 'square' as const } };
  const changed = renderSynthBars(bars, params, 120, SR * 4, SR, 2, null, undefined, [], 0, 16, [undefined, { params: square, sample: null }]);
  assert.deepEqual([...changed[0].subarray(0, SR * 2 - 200)], [...plain[0].subarray(0, SR * 2 - 200)], 'the first bar is as it was');
  assert.notDeepEqual([...changed[0].subarray(SR * 2 + 200, SR * 3)], [...plain[0].subarray(SR * 2 + 200, SR * 3)], 'the second is the other instrument');
});

test('a scene\'s own sound brings its own sends to the export, bar by bar', async () => {
  const { sendTimeline } = await import('../src/services/wavExport.ts');
  const params = createDefaultSynthParameters(), times = [{ start: 0, duration: 2 }, { start: 2, duration: 2 }];
  const wet = { ...params, fxSends: { ...params.fxSends, reverb: 0.8 } };
  assert.deepEqual(sendTimeline([steps('C3'), steps('C3')], params, [], times), [], 'nothing to follow');
  const timeline = sendTimeline([steps('C3'), steps('C3')], params, [], times, [undefined, { params: wet }]);
  assert.deepEqual([timeline[0].sends.reverb, timeline[16].sends.reverb], [params.fxSends.reverb, 0.8]);
});

test('a timed sound or recording is not forgotten when the waiting changes are cleared: it is made at once', () => {
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams(createDefaultSynthParameters(), 120));
  core.setParams({ oscType: 'square' } as never, 10, true);
  core.setParams({ filterFreq: 300 } as never, 10);
  core.clearScheduledParams();
  const params = (core as unknown as { params: Record<string, unknown> }).params;
  assert.equal(params.oscType, 'square');
  assert.notEqual(params.filterFreq, 300);
  const sample = { data: new Float32Array(400).fill(0.2), rate: SR };
  core.setSample(sample, 10);
  assert.equal((core as unknown as { sample: unknown }).sample, null, 'not yet');
  core.clearScheduledParams();
  assert.equal((core as unknown as { sample: unknown }).sample, sample);
});
