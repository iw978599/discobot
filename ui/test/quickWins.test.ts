import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { LocalProjectService } from '../src/services/localService.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { expandDrumStep, seededRandom } from '../src/services/drumScheduling.ts';
import { sanitizeDrums } from '../src/services/projectSanitization.ts';
import { renderDrums, renderPlan, renderSynthLane, stemParts } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { crc32, createZip } from '../src/utils/zip.ts';
import { noteForKey } from '../src/hooks/useComputerKeyboard.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState, Pattern } from '../src/types.ts';

const SR = 44100;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false,
  settings: { volume: 0.8, tone: 0.5, extra: 1, tune: 0, humanize: 0, pan: 0 },
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

const storage = new Map<string, string>();
function service() {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const created = new LocalProjectService();
  created.initialize(defaults());
  return created;
}
const post = (target: LocalProjectService, path: string, body: unknown, method = 'POST') =>
  target.request(path, { method, body: JSON.stringify(body) });

test('the computer keyboard maps the home row to a chromatic octave and a bit, by physical key', () => {
  assert.equal(noteForKey('KeyA', 0), 'C4');
  assert.equal(noteForKey('KeyW', 0), 'C#4');
  assert.equal(noteForKey('KeyT', 0), 'F#4');
  assert.equal(noteForKey('KeyJ', 0), 'B4');
  assert.equal(noteForKey('KeyK', 0), 'C5');
  assert.equal(noteForKey('Semicolon', 0), 'E5');
  assert.equal(noteForKey('KeyA', -2), 'C2');
  assert.equal(noteForKey('KeyL', 2), 'D7');
  assert.equal(noteForKey('KeyQ', 0), null);
  assert.equal(noteForKey('KeyZ', 0), null, 'Z and X are octave keys, not notes');
});

test('a drum step expands into its repeats and obeys its chance', () => {
  const track = drums().kick;
  assert.deepEqual(expandDrumStep(track, 0), [], 'an inactive step plays nothing');
  track.steps[0] = true;
  assert.deepEqual(expandDrumStep(track, 0), [0], 'old projects with no chance or repeat data play every time, once');
  track.stepRatchets = Array(16).fill(1);
  track.stepRatchets[0] = 3;
  assert.deepEqual(expandDrumStep(track, 0), [0, 1 / 3, 2 / 3]);
  track.stepRatchets[0] = 99;
  assert.equal(expandDrumStep(track, 0).length, 4, 'repeats are capped');
  track.stepProbabilities = Array(16).fill(1);
  track.stepProbabilities[0] = 0;
  assert.deepEqual(expandDrumStep(track, 0), []);
  track.stepProbabilities[0] = 0.25;
  const random = seededRandom(7);
  let played = 0;
  for (let i = 0; i < 4000; i++) if (expandDrumStep(track, 0, random).length) played++;
  assert.ok(Math.abs(played / 4000 - 0.25) < 0.03, `a 25% step plays about a quarter of the time (${played})`);
  track.stepProbabilities[0] = 1;
  track.stepVelocities = Array(16).fill(0);
  assert.deepEqual(expandDrumStep(track, 0), [], 'a zero-velocity step is silent');
  assert.deepEqual([1, 2, 3].map(seededRandom(3)), [1, 2, 3].map(seededRandom(3)), 'the export generator is repeatable');
});

test('drum chance and repeats are clamped on load and absent from untouched projects', () => {
  const clean = sanitizeDrums(drums(), drums());
  assert.equal(clean.kick.stepProbabilities, undefined);
  assert.equal(clean.kick.stepRatchets, undefined);
  const hostile = drums() as any;
  hostile.kick.stepProbabilities = [2, -1, 'x', 0.5];
  hostile.kick.stepRatchets = [0, 9, 2.6, null];
  const repaired = sanitizeDrums(hostile, drums());
  assert.deepEqual(repaired.kick.stepProbabilities!.slice(0, 5), [1, 0, 1, 0.5, 1]);
  assert.deepEqual(repaired.kick.stepRatchets!.slice(0, 5), [1, 4, 3, 1, 1]);
  assert.equal(repaired.kick.stepRatchets!.length, 16);
});

test('the project store saves drum chance and repeats per step', async () => {
  const store = service();
  await post(store, '/drum/step', { instrument: 'snare', step: 4, active: true });
  await post(store, '/drum/step-detail', { instrument: 'snare', step: 4, probability: 0.5 });
  await post(store, '/drum/step-detail', { instrument: 'snare', step: 4, ratchet: 3 });
  assert.equal((await post(store, '/drum/step-detail', { instrument: 'snare', step: 16, ratchet: 2 })).status, 400);
  const reloaded = new LocalProjectService();
  reloaded.initialize(defaults());
  const snare = reloaded.snapshot().drumState.snare;
  assert.equal(snare.stepProbabilities![4], 0.5);
  assert.equal(snare.stepRatchets![4], 3);
  assert.equal(snare.stepRatchets![0], 1);
});

test('exported drums play repeats inside the step and skip steps with no chance', () => {
  // 60 BPM: a step is 250 ms, so a tight closed hat has died away before the half-step repeat.
  const render = (state: DrumState) =>
    renderDrums({ tempo: 60, drumState: state, drumKitId: 'tr-909', drumMasterVolume: 1, drumSwing: 0 }, SR, SR)[0];
  const single = drums(); single.closedHH.steps[0] = true;
  const doubled = drums(); doubled.closedHH.steps[0] = true;
  doubled.closedHH.stepRatchets = Array(16).fill(1); doubled.closedHH.stepRatchets[0] = 2;
  const a = render(single), b = render(doubled);
  const half = Math.round(SR * 0.125), step = Math.round(SR * 0.25);
  assert.deepEqual(b.subarray(0, half - 64), a.subarray(0, half - 64), 'the first hit is unchanged');
  assert.ok(rms(b.subarray(half, step)) > rms(a.subarray(half, step)) * 3, 'a second hit lands half-way through the step');
  const never = drums(); never.closedHH.steps[0] = true;
  never.closedHH.stepProbabilities = Array(16).fill(0);
  assert.equal(rms(render(never)), 0);
  assert.deepEqual(render(doubled), b, 'export is repeatable');
});

test('MIDI export writes one note per repeat and none for a step with no chance', () => {
  const kicks = (state: DrumState) => {
    const bytes = createMidiFile({ tempo: 120, synthLanes: [], drumState: state, drumSwing: 0, drumMasterVolume: 1 });
    let count = 0;
    for (let i = 0; i < bytes.length - 1; i++) if (bytes[i] === 0x99 && bytes[i + 1] === 36) count++;
    return count;
  };
  const state = drums(); state.kick.steps[0] = true; state.kick.steps[8] = true;
  assert.equal(kicks(state), 2);
  state.kick.stepRatchets = Array(16).fill(1); state.kick.stepRatchets[8] = 4;
  assert.equal(kicks(state), 5);
  state.kick.stepProbabilities = Array(16).fill(1); state.kick.stepProbabilities[0] = 0;
  assert.equal(kicks(state), 4);
});

test('a loop render covers enough bars for the tail to wrap, and keeps exactly the last one', () => {
  const once = renderPlan(120, 2.5, SR, false);
  assert.deepEqual([once.bars, once.start, once.frames], [1, 0, Math.ceil(4.5 * SR)]);
  const loop = renderPlan(120, 2.5, SR, true);
  assert.equal(loop.bars, 3, 'one kept bar plus two bars of lead-in for a 2.5 s tail');
  assert.equal(loop.frames - loop.start, 2 * SR, 'the kept part is exactly one bar');
  assert.equal(loop.barDuration, 2);
  const odd = renderPlan(133, 1, SR, true);
  assert.ok(Number.isInteger(odd.barDuration * SR), 'a bar is a whole number of samples at any tempo');
  assert.equal(odd.frames, odd.bars * Math.round(240 / 133 * SR));
});

test('a multi-bar render repeats the pattern and lets a tail ring across the bar line', () => {
  const params = { ...createDefaultSynthParameters(), envelope: { attack: 0.002, decay: 0.05, sustain: 0.8, release: 0.6 } };
  const steps: Pattern['steps'] = Array.from({ length: 16 }, () => ({ active: false, velocity: 0.7 }));
  steps[15] = { active: true, note: 'C3', velocity: 0.8 };
  const pattern: Pattern = { id: 'p', name: 'p', tempo: 120, steps };
  const one = renderSynthLane(pattern, params, 120, SR * 4, SR)[0];
  const two = renderSynthLane(pattern, params, 120, SR * 4, SR, 2, 2)[0];
  assert.deepEqual(two.subarray(0, SR * 2), one.subarray(0, SR * 2), 'the first bar is the same as a single-bar render');
  const lastStep = (samples: Float32Array, bar: number) => rms(samples.subarray(Math.round((bar * 2 + 1.875) * SR), Math.round((bar * 2 + 2) * SR)));
  assert.ok(lastStep(two, 1) > 0.01, 'the note plays again in the second bar');
  assert.ok(Math.abs(lastStep(one, 1)) < 1e-4, 'and not when only one bar was asked for');
  assert.ok(rms(two.subarray(SR * 2, Math.round(SR * 2.1))) > 0.001, 'the release from bar one is heard at the start of bar two');
});

test('stems are offered only for parts that have something in them', () => {
  const lane = (id: number, note?: string) => ({
    id, muted: true, solo: false, synthParams: createDefaultSynthParameters(),
    pattern: { id: `p${id}`, name: 'p', tempo: 120, steps: [{ active: Boolean(note), note, velocity: 0.7 }] },
  });
  const base = { tempo: 120, drumKitId: 'tr-808', drumMasterVolume: 1, drumSwing: 0, drumFx: defaults().drumFx, effectsLoop };
  assert.deepEqual(stemParts({ ...base, synths: [lane(1), lane(2)], drumState: drums() }), []);
  const withKick = drums(); withKick.kick.steps[3] = true;
  assert.deepEqual(
    stemParts({ ...base, synths: [lane(1, 'C3'), lane(2), lane(3, 'E3')], drumState: withKick }).map(part => part.name),
    ['synth-1.wav', 'synth-3.wav', 'drums.wav'], 'a muted lane with notes still gets a stem',
  );
});

test('the zip writer produces a readable stored archive', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const first = new Uint8Array([1, 2, 3, 4, 5]), second = new TextEncoder().encode('hello');
  const zip = createZip([{ name: 'a.wav', data: first }, { name: 'drums.wav', data: second }]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.deepEqual(zip.subarray(30 + 5, 30 + 5 + 5), first, 'file bytes follow the local header and name');
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const central = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  assert.equal(view.getUint32(central + 16, true), crc32(first));
  assert.equal(central + view.getUint32(end + 12, true), end, 'the central directory runs up to the end record');
  const secondEntry = central + 46 + 5;
  const secondOffset = view.getUint32(secondEntry + 42, true);
  assert.equal(view.getUint32(secondOffset, true), 0x04034b50);
  assert.equal(new TextDecoder().decode(zip.subarray(secondOffset + 30, secondOffset + 39)), 'drums.wav');
});

test('a project file round-trips the whole project into another browser profile', async () => {
  const source = service();
  await post(source, '/synth/create', { synthId: 2 });
  await post(source, '/synth/2/parameters', { filter: { frequency: 777 } });
  await post(source, '/tempo', { tempo: 97 });
  await post(source, '/drum/step', { instrument: 'kick', step: 2, active: true });
  await post(source, '/drum/step-detail', { instrument: 'kick', step: 2, ratchet: 2 });
  const steps = source.snapshot().synths[0].pattern.steps;
  await post(source, '/patterns/save', { name: 'Keeper', steps, synthParams: createDefaultSynthParameters(), tempo: 97, drumState: source.snapshot().drumState });
  await post(source, '/sequencer/play', { synthId: 1 });
  const file = JSON.parse(JSON.stringify(source.exportProject()));
  assert.equal(file.format, 'discobot-project');
  assert.equal(file.project.synths[0].isPlaying, false, 'a file never carries a running transport');
  assert.equal(source.snapshot().synths[0].isPlaying, true, 'exporting does not disturb the live project');

  const target = service();
  await post(target, '/synth/create', { synthId: 3 });
  const messages: string[] = [];
  target.subscribe(message => messages.push(message.type));
  messages.length = 0;
  assert.deepEqual(target.importProject(file), { ok: true, repaired: false });
  assert.deepEqual(messages, ['init', 'savedPatternsChanged']);
  const state = target.snapshot();
  assert.deepEqual(state.synths.map(synth => synth.synthId), [1, 2], 'lanes not in the file are gone');
  assert.equal(state.synths[1].synthParams.filter.frequency, 777);
  assert.equal(state.tempo, 97);
  assert.equal(state.drumState.kick.steps[2], true);
  assert.equal(state.drumState.kick.stepRatchets![2], 2);
  assert.equal(state.savedPatterns[0].name, 'Keeper');
  const reloaded = new LocalProjectService();
  reloaded.initialize(defaults());
  assert.equal(reloaded.snapshot().tempo, 97, 'the imported project is what is stored');
});

test('a bad project file is refused and leaves the current project alone', async () => {
  const store = service();
  await post(store, '/tempo', { tempo: 150 });
  const good = JSON.parse(JSON.stringify(store.exportProject()));
  await post(store, '/tempo', { tempo: 88 });
  for (const bad of [null, [], 'text', {}, { format: 'other', formatVersion: 1, project: good.project },
    { ...good, formatVersion: 2 }, { ...good, project: { version: 1 } }, { ...good, project: null }]) {
    const result = store.importProject(bad);
    assert.equal(result.ok, false);
    assert.equal(store.snapshot().tempo, 88);
  }
  const hostile = structuredClone(good);
  hostile.project.tempo = 1e9;
  hostile.project.synths[0].synthParams.gain = 'loud';
  hostile.project.synths.push({ synthId: 9 });
  assert.deepEqual(store.importProject(hostile), { ok: true, repaired: true });
  assert.equal(store.snapshot().tempo, 400, 'values from a file are clamped like values from storage');
  assert.equal(store.snapshot().synths.length, 1);

  await post(store, '/tempo', { tempo: 88 });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { throw new Error('QuotaExceededError'); } } });
  assert.equal(store.importProject(good).ok, false);
  assert.equal(store.snapshot().tempo, 88, 'a project that cannot be stored is not half-applied');
});

test('the app ships a web manifest, icons and a service worker built from the real file list', () => {
  const root = new URL('../', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '.', 'relative, so it works under the /discobot/ base path');
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(`public/${icon.src}`, root)), icon.src);
  assert.ok(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable'));
  assert.match(read('index.html'), /rel="manifest" href="\/manifest\.webmanifest"/);
  const worker = read('pwa/service-worker.js');
  assert.equal(worker.split('__FILES__').length, 2, 'one placeholder each, so the build fills in the right spot');
  assert.equal(worker.split('__VERSION__').length, 2);
  assert.match(read('vite.config.ts'), /fileName: 'sw\.js'/);
  assert.match(read('src/main.tsx'), /serviceWorker\.register/);
});
