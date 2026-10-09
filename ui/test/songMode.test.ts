import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { BrowserTransport } from '../src/services/browserTransport.ts';
import { entryStartBar, sceneAtBar, sceneDrumState, songBars, songLengthBars } from '../src/services/songPlayback.ts';
import { sanitizeScenes, sanitizeSong } from '../src/services/projectSanitization.ts';
import { drumHits, renderSynthBars, renderSynthLane } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState, Pattern, Scene, SequencerStep, Song } from '../src/types.ts';

const SR = 44100;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5 },
}])) as DrumState;
const effectsLoop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};
const defaults = () => ({
  synthParams: createDefaultSynthParameters(), drumState: drums(),
  drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop,
});
const steps = (notes: Record<number, string> = {}, length = 16): SequencerStep[] =>
  Array.from({ length }, (_, i) => (notes[i] ? { active: true, note: notes[i], velocity: 0.8 } : { active: false, velocity: 0.7 }));

const storage = new Map<string, string>();
function service(fresh = true) {
  if (fresh) storage.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const created = new LocalProjectService();
  created.initialize(defaults());
  return created;
}
const post = async (target: LocalProjectService, path: string, body: unknown = {}, method = 'POST') => {
  const response = await target.request(path, { method, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};
const setNote = (target: LocalProjectService, note: string | undefined, index = 0) => {
  const pattern = target.snapshot().synths[0].pattern;
  pattern.steps[index] = note ? { active: true, note, velocity: 0.8 } : { active: false, velocity: 0.7 };
  return post(target, `/synth/1/patterns/${pattern.id}`, pattern, 'PUT');
};
const firstNote = (target: LocalProjectService) => target.snapshot().synths[0].pattern.steps[0].note;

test('a bar number maps to the right scene, repeat and block; a song ends unless it loops', () => {
  const song: Song = { loop: false, entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }, { sceneId: 'a', repeats: 3 }] };
  assert.equal(songLengthBars(song), 6);
  assert.deepEqual([0, 1, 2, 3, 5].map(bar => sceneAtBar(song, bar)), [
    { sceneId: 'a', entryIndex: 0, repeat: 0 }, { sceneId: 'a', entryIndex: 0, repeat: 1 },
    { sceneId: 'b', entryIndex: 1, repeat: 0 }, { sceneId: 'a', entryIndex: 2, repeat: 0 }, { sceneId: 'a', entryIndex: 2, repeat: 2 },
  ]);
  assert.equal(sceneAtBar(song, 6), null, 'past the end');
  assert.equal(sceneAtBar(song, -1), null);
  assert.deepEqual(sceneAtBar({ ...song, loop: true }, 8), { sceneId: 'b', entryIndex: 1, repeat: 0 }, 'a looping song wraps');
  assert.deepEqual([0, 1, 2, 3].map(index => entryStartBar(song, index)), [0, 2, 3, 6]);
  assert.equal(sceneAtBar({ entries: [], loop: true }, 0), null);
  const scenes = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] as Scene[];
  assert.deepEqual(songBars(song, scenes).map(scene => scene.name), ['A', 'A', 'B', 'A', 'A', 'A']);
});

test('the transport counts bars from when it starts', () => {
  let time = 0;
  const ticks: Array<{ step: number; bar: number }> = [];
  const transport = new BrowserTransport(() => time, () => 120, tick => ticks.push(tick));
  transport.start();
  for (let i = 1; i <= 260; i++) { time = i * 0.02; transport.pump(); }
  transport.stop();
  assert.deepEqual(ticks.slice(0, 3).map(tick => [tick.bar, tick.step]), [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(ticks.filter(tick => tick.step === 0).map(tick => tick.bar), [0, 1, 2]);
  assert.deepEqual([ticks[31].bar, ticks[32].bar], [0, 1]);
  transport.start();
  transport.stop();
  assert.equal(ticks.at(-1)!.bar, 0, 'starting again counts from the first bar');
});

test('a project from before scenes existed becomes one scene and a one-block song', async () => {
  const old = service();
  await setNote(old, 'C3');
  await post(old, '/drum/step', { instrument: 'kick', step: 4, active: true });
  old.flush();
  const stored = JSON.parse(storage.get('discobot_browser_project_v1')!);
  delete stored.scenes; delete stored.song; delete stored.currentSceneId; stored.schema = 3;
  storage.set('discobot_browser_project_v1', JSON.stringify(stored));
  const upgraded = service(false);
  const messages: string[] = [];
  upgraded.subscribe(message => messages.push(message.type));
  assert.deepEqual(messages, ['init'], 'an upgrade is not reported as damage');
  const state = upgraded.snapshot();
  assert.equal(state.scenes.length, 1);
  assert.equal(state.scenes[0].lanes[1][0].note, 'C3');
  assert.equal(state.scenes[0].drums.kick.steps[4], true);
  assert.deepEqual(state.song, { entries: [{ sceneId: state.scenes[0].id, repeats: 1 }], loop: false });
  assert.equal(firstNote(upgraded), 'C3', 'and it plays exactly as before');
});

test('each scene keeps its own notes and drum hits; sounds stay shared', async () => {
  const store = service();
  await setNote(store, 'C3');
  await post(store, '/drum/step', { instrument: 'kick', step: 0, active: true });
  await post(store, '/drum/step-detail', { instrument: 'kick', step: 0, ratchet: 2 });
  const first = store.snapshot().currentSceneId;

  const copy = (await post(store, '/scenes/create', {})).data;
  assert.equal(copy.scenes.length, 2);
  assert.notEqual(copy.currentSceneId, first);
  assert.equal(firstNote(store), 'C3', 'a new scene starts as a copy of the open one');
  await setNote(store, 'G3');
  await post(store, '/drum/step', { instrument: 'kick', step: 0, active: false });
  await post(store, '/drum/step', { instrument: 'snare', step: 4, active: true });
  await post(store, '/synth/1/parameters', { filter: { frequency: 900 } });
  await post(store, '/drum/settings', { instrument: 'kick', settings: { tone: 0.9 } });

  const back = (await post(store, '/scenes/select', { sceneId: first })).data;
  assert.equal(firstNote(store), 'C3');
  assert.deepEqual([back.drumState.kick.steps[0], back.drumState.kick.stepRatchets[0], back.drumState.snare.steps[4]], [true, 2, false]);
  assert.equal(store.snapshot().synths[0].synthParams.filter.frequency, 900, 'the sound did not change with the scene');
  assert.equal(back.drumState.kick.settings.tone, 0.9, 'nor did the kit');

  await post(store, '/scenes/select', { sceneId: copy.currentSceneId });
  const second = store.snapshot();
  assert.equal(firstNote(store), 'G3');
  assert.deepEqual([second.drumState.kick.steps[0], second.drumState.snare.steps[4]], [false, true]);
  assert.equal(second.drumState.kick.stepRatchets![0], 2, 'the copy brought its step details with it');

  const empty = (await post(store, '/scenes/create', { empty: true, name: '  Break  ' })).data;
  assert.equal(empty.scenes.at(-1).name, 'Break');
  assert.equal(firstNote(store), undefined);
  assert.equal(store.snapshot().drumState.snare.steps[4], false);
  assert.equal(store.snapshot().drumState.kick.stepRatchets, undefined, 'an empty scene has no step details left over');
  assert.equal(store.snapshot().synths[0].pattern.steps.length, 16);
  assert.equal((await post(store, '/scenes/select', { sceneId: 'nope' })).status, 404);

  store.flush();
  const reloaded = service(false).snapshot();
  assert.deepEqual(reloaded.scenes.map(scene => scene.name), ['Scene 1', 'Scene 2', 'Break']);
  assert.equal(reloaded.currentSceneId, empty.currentSceneId, 'the open scene is remembered');
  assert.equal(reloaded.scenes[1].lanes[1][0].note, 'G3');
});

test('scenes can be renamed and deleted, and the song follows', async () => {
  const store = service();
  const a = store.snapshot().currentSceneId;
  await setNote(store, 'C3');
  const b = (await post(store, '/scenes/create', {})).data.currentSceneId;
  await setNote(store, 'E3');
  const song = (await post(store, '/song', { entries: [{ sceneId: a, repeats: 2 }, { sceneId: b, repeats: 500 }, { sceneId: 'gone', repeats: 1 }, { sceneId: a, repeats: 0 }], loop: true })).data.song;
  assert.deepEqual(song, { entries: [{ sceneId: a, repeats: 2 }, { sceneId: b, repeats: 64 }, { sceneId: a, repeats: 1 }], loop: true }, 'repeats are clamped and unknown scenes dropped');
  assert.deepEqual((await post(store, '/song', { loop: false })).data.song.entries.length, 3, 'changing one setting keeps the other');

  assert.equal((await post(store, '/scenes/rename', { sceneId: b, name: '   ' })).status, 400);
  assert.equal((await post(store, '/scenes/rename', { sceneId: b, name: 'Chorus' })).data.scenes[1].name, 'Chorus');

  const afterDelete = (await post(store, '/scenes/delete', { sceneId: b })).data;
  assert.deepEqual(afterDelete.scenes.map((scene: Scene) => scene.id), [a]);
  assert.equal(afterDelete.currentSceneId, a, 'deleting the open scene opens its neighbour');
  assert.equal(firstNote(store), 'C3');
  assert.deepEqual(afterDelete.song.entries, [{ sceneId: a, repeats: 2 }, { sceneId: a, repeats: 1 }]);
  assert.equal((await post(store, '/scenes/delete', { sceneId: a })).status, 400, 'the last scene cannot be deleted');
});

test('scenes and songs from a file are repaired or refused', () => {
  const kit = drums();
  assert.equal(sanitizeScenes('nope', kit), null);
  assert.equal(sanitizeScenes([{ name: 'no id' }, null, 7], kit), null);
  const scenes = sanitizeScenes([
    { id: 'a', name: '', lanes: { 1: [{ active: true, note: 'C3', velocity: 9 }, { active: true, note: 'zzz' }], 7: [{ active: true, note: 'C3' }] }, drums: { kick: { steps: 'x', stepRatchets: [9] } } },
    { id: 'a', name: 'duplicate id' },
    { id: 'b', name: 'x'.repeat(100), lanes: null, drums: null },
  ], kit)!;
  assert.deepEqual(scenes.map(scene => scene.id), ['a', 'b']);
  assert.equal(scenes[0].name, 'Scene');
  assert.deepEqual([scenes[0].lanes[1].length, scenes[0].lanes[1][0].velocity, scenes[0].lanes[1][1].active, scenes[0].lanes[7]], [16, 1, false, undefined]);
  assert.deepEqual([scenes[0].drums.kick.steps.length, scenes[0].drums.kick.stepRatchets![0]], [16, 4]);
  assert.equal(scenes[1].name.length, 40);
  assert.equal(Object.keys(scenes[1].drums).length, 8);
  assert.deepEqual(sanitizeSong({ entries: 'x' }, scenes), { entries: [{ sceneId: 'a', repeats: 1 }], loop: false });
  assert.equal(sanitizeSong({ entries: Array(500).fill({ sceneId: 'b', repeats: 2 }) }, scenes).entries.length, 128);
});

test('a scene supplies the steps and the kit supplies the sound', () => {
  const kit = drums();
  kit.kick.settings.tone = 0.9; kit.snare.muted = true; kit.kick.steps[3] = true;
  const scene = { id: 's', name: 'S', lanes: {}, drums: Object.fromEntries(DRUM_INSTRUMENTS.map(i => [i, { steps: Array(16).fill(false) }])) } as unknown as Scene;
  scene.drums.kick.steps[0] = true;
  scene.drums.kick.stepRatchets = Array(16).fill(2);
  const state = sceneDrumState(scene, kit);
  assert.deepEqual([state.kick.steps[0], state.kick.steps[3], state.kick.settings.tone, state.snare.muted, state.kick.stepRatchets![0]], [true, false, 0.9, true, 2]);
  assert.equal(state.kick.stepVelocities, undefined);
});

test('a song renders its scenes end to end, the same as playing each bar in turn', () => {
  const params = { ...createDefaultSynthParameters(), envelope: { attack: 0.002, decay: 0.05, sustain: 0.6, release: 0.05 } };
  const verse = steps({ 0: 'C3' }), chorus = steps({ 8: 'G3' }, 32);
  const pattern = (lane: SequencerStep[]): Pattern => ({ id: 'p', name: 'p', tempo: 120, steps: lane });
  const song = renderSynthBars([verse, chorus, []], params, 120, SR * 6, SR)[0];
  const first = renderSynthLane(pattern(verse), params, 120, SR * 2, SR)[0];
  assert.deepEqual(song.subarray(0, SR * 2), first, 'bar one is the first scene');
  const window = (from: number, to: number) => rms(song.subarray(Math.round(from * SR), Math.round(to * SR)));
  assert.ok(window(2, 2.4) < 1e-4, 'the first scene\'s note does not repeat in bar two');
  assert.ok(window(2.5, 2.7) > 0.01, 'the second scene plays its own note, on its own 32-step grid');
  assert.ok(window(4, 6) < 1e-4, 'a scene with nothing on this lane is silent');

  const kit = drums();
  const scene = (name: string, instrument: 'kick' | 'snare', step: number): Scene => ({
    id: name, name, lanes: {},
    drums: Object.fromEntries(DRUM_INSTRUMENTS.map(i => [i, { steps: Array(16).fill(false).map((_, s) => i === instrument && s === step) }])) as Scene['drums'],
  });
  const hits = drumHits({ tempo: 120, drumState: kit, drumKitId: 'tr-808', drumMasterVolume: 1, drumSwing: 0, bars: [scene('A', 'kick', 0), scene('B', 'snare', 4), scene('A', 'kick', 0)] });
  assert.deepEqual(hits.map(hit => [hit.instrument, hit.time]), [['kick', 0], ['snare', 2.5], ['kick', 4]]);
});

test('a song exports to MIDI bar after bar, with a marker where each section starts', () => {
  const kit = drums();
  const withKick = structuredClone(kit); withKick.kick.steps[0] = true;
  const lane = { id: 1, pattern: { id: 'p', name: 'p', tempo: 120, steps: steps({ 0: 'A4' }) } };
  const bytes = createMidiFile({
    tempo: 120, synthLanes: [lane], drumState: kit, drumSwing: 0, drumMasterVolume: 1,
    bars: [
      { name: 'Verse', lanes: { 1: steps({ 0: 'C4' }) }, drumState: withKick },
      { name: 'Verse', lanes: { 1: steps({ 0: 'C4' }) }, drumState: withKick },
      { name: 'Chorus', lanes: { 1: steps({ 4: 'E4' }) }, drumState: kit },
    ],
  });
  const text = Buffer.from(bytes).toString('latin1');
  const count = (needle: string) => text.split(needle).length - 1;
  assert.deepEqual([count('\xff\x06\x05Verse'), count('\xff\x06\x06Chorus')], [1, 1], 'one marker per section, not per bar');
  const noteOns = (status: number, note: number) => { let n = 0; for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === status && bytes[i + 1] === note && bytes[i + 2] > 0) n++; return n; };
  assert.deepEqual([noteOns(0x90, 60), noteOns(0x90, 64), noteOns(0x90, 69), noteOns(0x99, 36)], [2, 1, 0, 2], 'the lane\'s own pattern is not used when bars are given');
  const single = createMidiFile({ tempo: 120, synthLanes: [lane], drumState: withKick, drumSwing: 0, drumMasterVolume: 1 });
  assert.ok(bytes.length > single.length);
  assert.equal(Buffer.from(single).toString('latin1').includes('\xff\x06'), false, 'a single scene has no markers');
});
