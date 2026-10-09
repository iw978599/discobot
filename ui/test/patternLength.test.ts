import test from 'node:test';
import assert from 'node:assert/strict';
import { barOf, clampLengths, drumBars, laneBars, resizeBars, sceneAsBars, sceneBar, sceneBars, stepsPerBar } from '../src/services/patternLength.ts';
import { entryStartBar, sceneAtBar, songBars, songLengthBars } from '../src/services/songPlayback.ts';
import { sanitizeDrums, sanitizePattern, sanitizeScenes } from '../src/services/projectSanitization.ts';
import { renderPlan, renderSynthBars, renderDrums } from '../src/services/wavExport.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState, Scene, SequencerStep, Song } from '../src/types.ts';

const SR = 44100;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
const off = (): SequencerStep => ({ active: false, velocity: 0.7 });
const on = (note: string, extra: Partial<SequencerStep> = {}): SequencerStep => ({ active: true, note, velocity: 0.8, ...extra });
const steps = (count: number, notes: Record<number, SequencerStep> = {}) => Array.from({ length: count }, (_, index) => notes[index] ?? off());
const drums = (bars = 1, kicks: number[] = []): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array.from({ length: 16 * bars }, (_, index) => instrument === 'kick' && kicks.includes(index)), muted: false, solo: false,
  settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0, pan: 0 },
}])) as DrumState;
const scene = (id: string, lanes: Scene['lanes'], laneLengths: Record<number, number> = {}, drumPattern = drums()): Scene =>
  ({ id, name: id.toUpperCase(), lanes, drums: drumPattern, ...(Object.keys(laneLengths).length ? { laneBars: laneLengths } : {}) });

test('a lane is 1, 2, 4 or 8 bars of 16 or 32 steps, and anything else is one bar', () => {
  assert.deepEqual([laneBars(16, undefined), laneBars(32, undefined), laneBars(32, 2), laneBars(64, 2), laneBars(64, 4), laneBars(256, 8)], [1, 1, 2, 2, 4, 8]);
  assert.deepEqual([stepsPerBar(32, undefined), stepsPerBar(32, 2), stepsPerBar(64, 2)], [32, 16, 32], '32 steps is one fine bar unless it says it is two');
  assert.deepEqual([laneBars(48, 3), laneBars(16, 2), laneBars(64, 8), laneBars(32, '2'), laneBars(32, 2.5)], [1, 1, 1, 1, 1], 'a bar count that does not fit is not believed');
  assert.equal(drumBars(drums(4)), 4);
  assert.equal(drumBars({}), 1);
});

test('one bar is cut from a looping pattern, and patterns grow by repeating', () => {
  const two = [...Array(16).fill('a'), ...Array(16).fill('b')];
  assert.deepEqual([0, 1, 2, 5].map(bar => barOf(two, 16, bar)[0]), ['a', 'b', 'a', 'b']);
  assert.equal(barOf(two, 16, 3).length, 16);

  const one = steps(16, { 0: on('C3'), 4: on('E3', { notes: ['G3'] }) });
  const grown = resizeBars(one, 16, 4, off);
  assert.equal(grown.length, 64);
  assert.deepEqual([grown[0].note, grown[16].note, grown[52].note, grown[52].notes], ['C3', 'C3', 'E3', ['G3']], 'the loop is repeated, ready to vary');
  grown[16].note = 'D3';
  assert.equal(grown[0].note, 'C3', 'the copies are independent');
  assert.deepEqual(resizeBars(grown, 16, 1, off).map(step => step.note).filter(Boolean), ['C3', 'E3'], 'shrinking keeps the first bars');

  const long = clampLengths(steps(16, { 12: on('C3', { length: 8 }), 15: on('D3', { length: 3 }), 0: on('E3', { length: 16 }) }));
  assert.deepEqual([long[12].length, long[15].length, long[0].length], [4, undefined, 16], 'a note cannot run past the end of the pattern');
});

test('patterns, drums and scenes keep their length through storage checks', () => {
  const two = sanitizePattern({ id: 'p', name: 'p', bars: 2, steps: steps(32, { 20: on('C3') }) }, 120)!;
  assert.deepEqual([two.bars, two.steps.length, two.steps[20].note], [2, 32, 'C3']);
  const fine = sanitizePattern({ id: 'p', name: 'p', steps: steps(32) }, 120)!;
  assert.deepEqual([fine.bars, fine.steps.length], [undefined, 32], 'an old 32-step lane is still one bar');
  const eight = sanitizePattern({ id: 'p', name: 'p', bars: 8, steps: steps(256, { 255: on('C3') }) }, 120)!;
  assert.deepEqual([eight.bars, eight.steps.length, eight.steps[255].note], [8, 256, 'C3']);
  const wrong = sanitizePattern({ id: 'p', name: 'p', bars: 4, steps: steps(40) }, 120)!;
  assert.deepEqual([wrong.bars, wrong.steps.length], [undefined, 32], 'a length that fits nothing is cut to one bar');

  const state = drums(2, [0, 16, 30]) as unknown as Record<string, { steps: boolean[]; stepVelocities?: number[] }>;
  state.snare.steps = Array(16).fill(true);
  state.kick.stepVelocities = Array(32).fill(0.5);
  const clean = sanitizeDrums(state, drums());
  assert.equal(clean.kick.steps.length, 32);
  assert.deepEqual([clean.kick.steps[16], clean.kick.steps[30], clean.kick.stepVelocities?.length], [true, true, 32]);
  assert.deepEqual([clean.snare.steps.length, clean.snare.steps[15], clean.snare.steps[16]], [32, true, false], 'every drum lane is as long as the kick');
  assert.equal(sanitizeDrums({ ...state, kick: { ...state.kick, steps: Array(48).fill(true) } }, drums()).kick.steps.length, 16, 'three bars is not a length');

  const [kept] = sanitizeScenes([{ id: 's', name: 'S', lanes: { 1: steps(32, { 17: on('C3') }), 2: steps(32) }, laneBars: { 1: 2, 2: 9, 3: 2 }, drums: drums(4) }], drums())!;
  assert.deepEqual(kept.laneBars, { 1: 2 });
  assert.deepEqual([kept.lanes[1].length, kept.lanes[2].length, kept.drums.kick.steps.length], [32, 32, 64]);
  assert.equal(sceneBars(kept), 4, 'a scene lasts as long as its longest part');
});

test('a scene is cut into bars with each lane looping at its own length', () => {
  const s = scene('a', { 1: steps(16, { 0: on('C3') }), 2: steps(64, { 0: on('D3'), 16: on('E3'), 48: on('F3') }), 3: steps(64, { 32: on('G3') }) }, { 2: 4, 3: 2 }, drums(2, [0, 20]));
  assert.equal(sceneBars(s), 4);
  const bars = sceneAsBars(s);
  assert.equal(bars.length, 4);
  assert.ok(bars.every(bar => bar.lanes[1].length === 16 && bar.lanes[2].length === 16 && bar.lanes[3].length === 32 && bar.drums.kick.steps.length === 16 && !bar.laneBars));
  assert.deepEqual(bars.map(bar => bar.lanes[1][0].note), ['C3', 'C3', 'C3', 'C3'], 'a one-bar lane plays every bar');
  assert.deepEqual(bars.map(bar => bar.lanes[2][0].note), ['D3', 'E3', undefined, 'F3']);
  assert.deepEqual(bars.map(bar => bar.lanes[3][0].note), [undefined, 'G3', undefined, 'G3'], 'a two-bar lane of fine steps comes round twice');
  assert.deepEqual(bars.map(bar => [bar.drums.kick.steps[0], bar.drums.kick.steps[4]]), [[true, false], [false, true], [true, false], [false, true]]);
  assert.deepEqual(sceneBar(s, 5).lanes[2][0].note, 'E3');
});

test('a song counts each scene by its own length', () => {
  const song: Song = { entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }, { sceneId: 'c', repeats: 1 }], loop: false };
  const lengthOf = (id: string) => ({ a: 1, b: 4, c: 2 }[id] ?? 1);
  assert.equal(songLengthBars(song, lengthOf), 8);
  assert.deepEqual([0, 1, 2, 3].map(index => entryStartBar(song, index, lengthOf)), [0, 2, 6, 8]);
  assert.deepEqual([0, 1, 2, 5, 6, 7].map(bar => sceneAtBar(song, bar, lengthOf)), [
    { sceneId: 'a', entryIndex: 0, repeat: 0, bar: 0 }, { sceneId: 'a', entryIndex: 0, repeat: 1, bar: 0 },
    { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 0 }, { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 3 },
    { sceneId: 'c', entryIndex: 2, repeat: 0, bar: 0 }, { sceneId: 'c', entryIndex: 2, repeat: 0, bar: 1 },
  ]);
  assert.equal(sceneAtBar(song, 8, lengthOf), null);
  assert.deepEqual(sceneAtBar({ ...song, loop: true }, 13, lengthOf), { sceneId: 'b', entryIndex: 1, repeat: 0, bar: 3 });
  assert.deepEqual(sceneAtBar({ entries: [{ sceneId: 'b', repeats: 3 }], loop: false }, 9, lengthOf), { sceneId: 'b', entryIndex: 0, repeat: 2, bar: 1 });

  const scenes = [scene('a', { 1: steps(16, { 0: on('C3') }) }), scene('b', { 1: steps(32, { 0: on('D3'), 16: on('E3') }) }, { 1: 2 })];
  const flat = songBars({ entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 2 }], loop: false }, scenes);
  assert.deepEqual(flat.map(bar => bar.lanes[1][0].note), ['C3', 'C3', 'D3', 'E3', 'D3', 'E3']);
  assert.deepEqual(flat.map(bar => bar.name), ['A', 'A', 'B', 'B', 'B', 'B']);
});

test('a long pattern renders bar by bar, and a loop of it keeps the last whole pass', () => {
  const sound = createDefaultSynthParameters();
  sound.effects.reverb.wet = 0; sound.effects.delay.wet = 0;
  const s = scene('a', { 1: steps(32, { 16: on('C3') }) }, { 1: 2 }, drums(2, [0]));
  const bars = sceneAsBars(s);
  const barFrames = SR * 2;
  const synth = renderSynthBars(bars.map(bar => bar.lanes[1]), sound, 120, barFrames * 2, SR)[0];
  assert.ok(rms(synth.subarray(0, barFrames)) < 0.0005, 'the first bar of the lane is empty');
  assert.ok(rms(synth.subarray(barFrames, barFrames + SR / 4)) > 0.01, 'its note is at the start of the second bar');
  const kit = renderDrums({ tempo: 120, drumState: drums(), drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, bars }, barFrames * 2, SR)[0];
  assert.ok(rms(kit.subarray(0, SR / 8)) > 0.01 && rms(kit.subarray(barFrames, barFrames + SR / 8)) < 0.01, 'the kick is in the first bar only; what is left by the second is its tail');

  assert.deepEqual(renderPlan(120, 1, SR, false, 4), { bars: 4, barDuration: 2, frames: SR * 9, start: 0 });
  const loop = renderPlan(120, 3, SR, true, 2);
  assert.deepEqual([loop.bars, loop.frames, loop.start], [4, SR * 8, SR * 4], 'two passes of two bars; the second is kept');
  const short = renderPlan(120, 3, SR, true);
  assert.deepEqual([short.bars, short.start], [3, SR * 4], 'a one-bar loop is unchanged');
});

test('the project store keeps bar counts through scenes, drum resizing and a project file', async () => {
  const effectsLoop: EffectsLoopState = {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  };
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
  const service = new LocalProjectService();
  service.initialize({ synthParams: createDefaultSynthParameters(), drumState: drums(), drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop });
  await service.openLibrary(createMemoryLibrary());
  const post = (path: string, body: unknown, method = 'POST') => service.request(path, { method, body: JSON.stringify(body) });
  await post('/synth/1/ensure', {});
  const lane = () => service.snapshot().synths.find((synth: any) => synth.synthId === 1).pattern;

  await post(`/synth/1/patterns/${lane().id}`, { ...lane(), bars: 2, steps: steps(32, { 17: on('C3') }) }, 'PUT');
  assert.deepEqual([lane().bars, lane().steps.length, lane().steps[17].note], [2, 32, 'C3']);

  assert.equal((await post('/drum/bars', { bars: 3 })).status, 400);
  await post('/drum/step', { instrument: 'kick', step: 3, active: true });
  await post('/drum/step-velocity', { instrument: 'kick', step: 3, velocity: 0.4 });
  assert.equal((await post('/drum/step', { instrument: 'kick', step: 16, active: true })).status, 400, 'a one-bar grid has no step 17');
  await post('/drum/bars', { bars: 2 });
  const grid = () => service.snapshot().drumState;
  assert.deepEqual([grid().kick.steps.length, grid().snare.steps.length, grid().kick.steps[19], grid().kick.stepVelocities[19]], [32, 32, true, 0.4], 'growing repeats the bar, details included');
  assert.equal((await post('/drum/step', { instrument: 'kick', step: 19, active: false })).status, 200);
  assert.equal((await post('/drum/step', { instrument: 'kick', step: 32, active: true })).status, 400);

  // A second scene made empty keeps the lengths; switching back restores the first, bars and all.
  const first = service.snapshot().currentSceneId;
  await post('/scenes/create', { empty: true });
  assert.deepEqual([lane().bars, lane().steps.length, lane().steps[17].note, grid().kick.steps.length, grid().kick.steps[3]], [2, 32, undefined, 32, false]);
  await post(`/synth/1/patterns/${lane().id}`, { ...lane(), bars: 1, steps: steps(16) }, 'PUT');
  await post('/drum/bars', { bars: 1 });
  assert.deepEqual([lane().bars, lane().steps.length, grid().kick.steps.length], [undefined, 16, 16]);
  await post('/scenes/select', { sceneId: first });
  assert.deepEqual([lane().bars, lane().steps.length, lane().steps[17].note, grid().kick.steps.length, grid().kick.steps[3], grid().kick.steps[19]], [2, 32, 'C3', 32, true, false]);

  const file = service.exportProject();
  const other = new LocalProjectService();
  other.initialize({ synthParams: createDefaultSynthParameters(), drumState: drums(), drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop });
  const read = other.readProjectFile(JSON.parse(JSON.stringify(file)));
  assert.ok(read.ok);
  if (read.ok) {
    const stored = read.project.scenes.find(entry => entry.id === first)!;
    assert.deepEqual([stored.laneBars, stored.lanes[1].length, stored.drums.kick.steps.length, sceneBars(stored)], [{ 1: 2 }, 32, 32, 2]);
    assert.equal(sceneBars(read.project.scenes.find(entry => entry.id !== first)!), 1);
  }
});
