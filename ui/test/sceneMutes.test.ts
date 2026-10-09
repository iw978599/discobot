import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { applySceneMutes, audibleLanes, sceneDrumState, songBars } from '../src/services/songPlayback.ts';
import { sanitizeSceneMutes } from '../src/services/projectSanitization.ts';
import { drumHits } from '../src/services/wavExport.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, Scene } from '../src/types.ts';

const kit = () => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), settings: { volume: .5, tone: .5, extra: .5 }, muted: false, solo: false,
}])) as DrumState;

async function setup() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize({
    synthParams: createDefaultSynthParameters(), drumState: kit(),
    drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0, chorus: 0 }, returnLevel: .7 },
    effectsLoop: {
      enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
      phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
      delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
    },
  });
  await service.openLibrary(createMemoryLibrary());
  const post = (path: string, body: unknown, method = 'POST') => service.request(path, { method, body: JSON.stringify(body) });
  return { service, post };
}

test('each scene keeps its own mutes and solos for the synth lanes and the drums', async () => {
  const { service, post } = await setup();
  await post('/synth/create', { synthId: 2 });
  const lanes = () => Object.fromEntries(service.snapshot().synths.map(synth => [synth.synthId, [synth.muted, synth.solo]]));
  const verse = service.snapshot().currentSceneId;

  await post('/synth/2/mix', { muted: true });
  await post('/drum/mix', { instrument: 'kick', muted: true });
  await post('/scenes/create', { name: 'Chorus' });
  const chorus = service.snapshot().currentSceneId;
  assert.deepEqual(lanes(), { 1: [false, false], 2: [true, false] }, 'a new scene starts as a copy, mutes included');

  await post('/synth/2/mix', { muted: false });
  await post('/synth/1/mix', { solo: true });
  await post('/drum/mix', { instrument: 'kick', muted: false });
  await post('/drum/mix', { instrument: 'snare', solo: true });

  await post('/scenes/select', { sceneId: verse });
  assert.deepEqual(lanes(), { 1: [false, false], 2: [true, false] });
  assert.deepEqual([service.snapshot().drumState.kick.muted, service.snapshot().drumState.snare.solo], [true, false]);
  await post('/scenes/select', { sceneId: chorus });
  assert.deepEqual(lanes(), { 1: [false, true], 2: [false, false] });
  assert.deepEqual([service.snapshot().drumState.kick.muted, service.snapshot().drumState.snare.solo], [false, true]);

  // They travel in a project file and come back per scene.
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  const stored = file.project.scenes.find((scene: Scene) => scene.id === verse) as Scene;
  assert.deepEqual(stored.mutes!.lanes, { 1: { muted: false, solo: false }, 2: { muted: true, solo: false } });
  assert.deepEqual(stored.mutes!.drums!.kick, { muted: true, solo: false });

  // A scene saved before mutes were kept has none: opening it leaves the lanes as they are.
  delete file.project.scenes.find((scene: Scene) => scene.id === verse).mutes;
  assert.equal((await service.importProject(file)).ok, true);
  assert.deepEqual(lanes(), { 1: [false, true], 2: [false, false] }, 'the imported project opens on its last scene');
  await post('/scenes/select', { sceneId: verse });
  assert.deepEqual(lanes(), { 1: [false, true], 2: [false, false] }, 'nothing stored, so nothing changes');
  await post('/synth/1/mix', { solo: false });
  await post('/scenes/select', { sceneId: chorus });
  assert.deepEqual(lanes(), { 1: [false, true], 2: [false, false] }, 'and from then on it has its own');
  await post('/scenes/select', { sceneId: verse });
  assert.deepEqual(lanes(), { 1: [false, false], 2: [false, false] });
});

test('a song is exported with each scene\'s mutes, not the open scene\'s', () => {
  const steps = (note: string) => Array.from({ length: 16 }, (_, index) => ({ active: index === 0, velocity: .7, ...(index === 0 ? { note } : {}) }));
  const drums = (on: boolean) => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, { steps: Array.from({ length: 16 }, (_, index) => on && index === 0) }])) as Scene['drums'];
  const flags = (muted = false, solo = false) => ({ muted, solo });
  const scenes: Scene[] = [
    { id: 'a', name: 'A', lanes: { 1: steps('C3'), 2: steps('E3') }, drums: drums(true), mutes: { lanes: { 1: flags(), 2: flags(true) }, drums: { kick: flags(true) } } },
    { id: 'b', name: 'B', lanes: { 1: steps('C3'), 2: steps('E3') }, drums: drums(true), mutes: { lanes: { 1: flags(), 2: flags(false, true) }, drums: { snare: flags(false, true) } } },
    { id: 'c', name: 'Old', lanes: { 1: steps('C3'), 2: steps('E3') }, drums: drums(true) },
  ];
  // The open scene has lane 1 muted; only the scene without its own mutes should follow that.
  const project = [{ id: 1, muted: true, solo: false }, { id: 2, muted: false, solo: false }];
  assert.deepEqual([...audibleLanes(scenes[0], project)], [1]);
  assert.deepEqual([...audibleLanes(scenes[1], project)], [2], 'a solo silences the other lanes');
  assert.deepEqual([...audibleLanes(scenes[2], project)], [2]);
  assert.deepEqual([...audibleLanes(null, project)], [2]);

  const bars = applySceneMutes(songBars({ entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }, { sceneId: 'c', repeats: 1 }], loop: false }, scenes), project);
  assert.deepEqual(bars.map(bar => [bar.lanes[1].length, bar.lanes[2].length]), [[16, 0], [16, 0], [0, 16], [0, 16]]);

  const state = kit();
  state.crash.muted = true;
  assert.equal(sceneDrumState(scenes[0], state).kick.muted, true);
  assert.equal(sceneDrumState(scenes[0], state).crash.muted, true, 'a lane the scene says nothing about follows the project');
  assert.equal(sceneDrumState(scenes[2], state).kick.muted, false);
  const hits = drumHits({ tempo: 120, drumState: state, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, bars });
  const playedIn = (bar: number) => hits.filter(hit => Math.floor(hit.time / 2) === bar).map(hit => hit.instrument).sort();
  assert.equal(playedIn(0).includes('kick'), false, 'the kick is muted in the first scene');
  assert.equal(playedIn(0).length, DRUM_INSTRUMENTS.length - 2, 'along with the crash, muted for the whole project');
  assert.deepEqual(playedIn(2), ['snare'], 'the solo in the second scene applies to that scene only');
  assert.equal(playedIn(3).length, DRUM_INSTRUMENTS.length - 1);
});

test('mutes read from a file are checked', () => {
  assert.equal(sanitizeSceneMutes(undefined), undefined);
  assert.equal(sanitizeSceneMutes('all'), undefined);
  assert.deepEqual(sanitizeSceneMutes({ lanes: { 1: { muted: 'yes', solo: true }, 9: { muted: true }, x: 1 }, drums: { kick: { muted: true }, cowbell: { muted: true } }, extra: 1 }),
    { lanes: { 1: { muted: false, solo: true } }, drums: { kick: { muted: true, solo: false } } });
});
