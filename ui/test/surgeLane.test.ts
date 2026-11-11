// A lane played by Surge XT's engine in the one lanes processor (docs/SURGE_XT_PLAN.md, stage 2),
// with the engine as built in surge/dist (SURGE_DIST points at another build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LaneHost, MAX_SURGE_LANES } from '../../engine/src/synth/LaneHost.ts';
import type { SurgeModule } from '../../engine/src/synth/SurgeVoice.ts';
import { createDefaultSynthParameters, toVoiceParams, type VoiceParams } from '../../engine/src/synth/voiceParams.ts';
import type { LanesWorkletEvent, SynthWorkletMessage } from '../../engine/src/workletMessages.ts';
import { MAX_LANES } from '../src/services/lanes.ts';
import { SURGE_PATCHES } from '../src/services/surgePatches.ts';

const SR = 48000, BLOCK = 128;
const dist = resolve(process.env.SURGE_DIST ?? 'surge/dist');
const module = (createRequire(import.meta.url)(join(dist, 'surge-engine.js')) as () => Promise<SurgeModule>)();
const patchFile = (id: string) => new Uint8Array(readFileSync(join('ui/public/surge/patches', `${id}.fxp`)));

const surgeSound = (patch = 'punk-bass', macros = [0, 0, 0, 0, 0, 0, 0, 0]): VoiceParams => {
  const params = createDefaultSynthParameters();
  params.engine = 'surge';
  params.surge = { patch, macros };
  return toVoiceParams(params, 120);
};

async function hostWith(events: LanesWorkletEvent[] = []) {
  const host = new LaneHost(SR, MAX_LANES, event => events.push(event));
  host.useSurge(await module);
  return host;
}

// Runs the host for `blocks` blocks, sending each message before its block; lane 1's left channel.
function play(host: LaneHost, blocks: number, script: Array<{ block: number; lane?: number; message: SynthWorkletMessage }>, lane = 1) {
  const out = new Float32Array(blocks * BLOCK);
  for (let block = 0; block < blocks; block++) {
    for (const step of script.filter(entry => entry.block === block)) host.receive({ lane: step.lane ?? 1, message: step.message });
    const outputs = Array.from({ length: MAX_LANES }, () => [new Float32Array(BLOCK), new Float32Array(BLOCK)]);
    host.process(block * BLOCK, outputs);
    out.set(outputs[lane - 1][0], block * BLOCK);
  }
  return out;
}
const peak = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
const firstSound = (samples: Float32Array) => samples.findIndex(value => Math.abs(value) > 1e-6);

test('every patch on the list is a file that loads', async () => {
  const M = await module;
  for (const patch of SURGE_PATCHES) {
    const engine = M._surge_create(SR, 1), bytes = patchFile(patch.id), at = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, at);
    assert.equal(M._surge_load_fxp(engine, at, bytes.length), 0, patch.id);
    M._free(at);
    M._surge_destroy(engine);
  }
});

// Surge works in blocks of 32 samples, so a note starts on the first block boundary at or after its sample.
test('a lane on Surge plays its patch, starting within 32 samples of its note, below full scale', async () => {
  const at = (5 * BLOCK + 40) / SR;
  const out = play(await hostWith(), 320, [
    { block: 0, message: { type: 'params', params: surgeSound() } },
    { block: 0, message: { type: 'surgePatch', patch: 'punk-bass', bytes: patchFile('punk-bass') } },
    { block: 0, message: { type: 'noteOn', note: 'A1', velocity: 1, id: 1, duration: 0.5, time: at } },
  ]);
  const start = firstSound(out), due = 5 * BLOCK + 40;
  assert.ok(start >= due && start <= due + 32, `started at ${start}, due at ${due}`);
  assert.ok(peak(out) > 0.05 && peak(out) < 1, `peak ${peak(out)}`);
  // The note's length lets it go: by the end the lane is quiet.
  assert.ok(peak(out.subarray(out.length - 2000)) < peak(out) / 20, 'released');
});

test('the same messages make the same sound, and the macros change it', async () => {
  const script = (macros: number[]) => [
    { block: 0, message: { type: 'params', params: surgeSound('clipped-stab', macros) } as SynthWorkletMessage },
    { block: 0, message: { type: 'surgePatch', patch: 'clipped-stab', bytes: patchFile('clipped-stab') } as SynthWorkletMessage },
    ...['A3', 'C4', 'E4'].map(note => ({ block: 1, message: { type: 'noteOn', note, velocity: 0.9 } as SynthWorkletMessage })),
  ];
  const once = play(await hostWith(), 80, script([0, 0, 0, 0, 0, 0, 0, 0]));
  const again = play(await hostWith(), 80, script([0, 0, 0, 0, 0, 0, 0, 0]));
  const bright = play(await hostWith(), 80, script([1, 1, 0, 0, 0, 0, 0, 0]));
  assert.deepEqual(again, once);
  assert.notDeepEqual(bright, once);
});

test('a lane moved onto Surge at a beat plays the built-in synth before it and Surge after', async () => {
  const change = (40 * BLOCK) / SR;
  const builtIn = toVoiceParams(createDefaultSynthParameters(), 120);
  const host = await hostWith();
  const out = play(host, 120, [
    { block: 0, message: { type: 'params', params: builtIn } },
    { block: 0, message: { type: 'noteOn', note: 'A2', velocity: 1, id: 1, duration: 0.05 } },
    { block: 0, message: { type: 'surgePatch', patch: 'punk-bass', bytes: patchFile('punk-bass') } },
    { block: 1, message: { type: 'params', params: surgeSound(), time: change, keep: true } },
    { block: 1, message: { type: 'noteOn', note: 'A1', velocity: 1, id: 2, time: change + 0.01, duration: 0.3 } },
  ]);
  assert.ok(peak(out.subarray(0, 2000)) > 0.01, 'the built-in synth before the beat');
  assert.ok(peak(out.subarray(40 * BLOCK, 40 * BLOCK + 470)) < 1e-6, 'from the beat the built-in synth is silent, until the Surge note');
  const start = firstSound(out.subarray(40 * BLOCK)), due = Math.round(0.01 * SR);
  assert.ok(start >= due && start <= due + 32, `Surge from its note after the beat: ${start}, due ${due}`);
});

test(`a lane past ${MAX_SURGE_LANES} on Surge is refused and silent, and the page told`, async () => {
  const events: LanesWorkletEvent[] = [];
  const host = await hostWith(events);
  const script = [1, 2, 3].flatMap(lane => [
    { block: 0, lane, message: { type: 'params', params: surgeSound() } as SynthWorkletMessage },
    { block: 0, lane, message: { type: 'surgePatch', patch: 'punk-bass', bytes: patchFile('punk-bass') } as SynthWorkletMessage },
    { block: 1, lane, message: { type: 'noteOn', note: 'A1', velocity: 1 } as SynthWorkletMessage },
  ]);
  assert.ok(peak(play(host, 30, script, 2)) > 0.01, 'the second plays');
  assert.equal(peak(play(await hostWith(), 30, script, 3).fill(0)), 0);
  assert.deepEqual(events.filter(event => event.type === 'surgeRefused'), [{ type: 'surgeRefused', lane: 3 }]);
});

test('the watchdog holds Surge lanes to fewer notes when blocks run late, then mutes the newest', async () => {
  const events: LanesWorkletEvent[] = [];
  const host = await hostWith(events);
  play(host, 2, [1, 2].flatMap(lane => [
    { block: 0, lane, message: { type: 'params', params: surgeSound() } as SynthWorkletMessage },
    { block: 0, lane, message: { type: 'surgePatch', patch: 'punk-bass', bytes: patchFile('punk-bass') } as SynthWorkletMessage },
  ]));
  const second = (milliseconds: number) => { for (let block = 0; block < 375; block++) host.watch(milliseconds, BLOCK); };
  second(1);
  assert.deepEqual(events, [], 'a second on time changes nothing');
  second(2.5);
  assert.deepEqual(events.at(-1), { type: 'surgeShed', lanes: [1, 2] });
  second(2.5);
  assert.equal(events.length, 2, 'eight notes, then four, then two');
  assert.deepEqual(events.at(-1), { type: 'surgeShed', lanes: [1, 2] });
  second(2.5);
  assert.deepEqual(events.at(-1), { type: 'surgeMuted', lane: 2 });
  // A new patch for the muted lane gives it another go.
  host.receive({ lane: 2, message: { type: 'surgePatch', patch: 'punk-bass', bytes: patchFile('punk-bass') } });
  assert.ok(peak(play(host, 20, [{ block: 0, lane: 2, message: { type: 'noteOn', note: 'A1', velocity: 1 } }], 2)) > 0.01);
});

test('a project file keeps a Surge lane, a hostile one is bounded, and one from before Surge opens as it was', async () => {
  const { setup, ok } = await import('./helpers/store.ts');
  const { createMemoryLibrary } = await import('../src/services/projectLibrary.ts');
  const { sanitizeSynthParams } = await import('../src/services/projectSanitization.ts');
  const fresh = async () => { const service = setup(); await service.openLibrary(createMemoryLibrary()); return service; };
  const synthOf = (service: any, id = 1) => service.snapshot().synths.find((synth: any) => synth.synthId === id).synthParams;

  // A file from before Surge: no lane has the field. It opens undamaged, with the sound it had.
  const before = await fresh();
  const old = JSON.parse(JSON.stringify(before.exportProject()));
  for (const synth of old.project.synths) delete synth.synthParams.surge;
  assert.equal(old.project.schema, 26);
  old.project.schema = 25;
  const target = await fresh();
  assert.deepEqual(await target.importProject(JSON.parse(JSON.stringify(old))), { ok: true, repaired: false }, 'not reported as damaged');
  const sound = toVoiceParams(synthOf(target), 120), was = toVoiceParams(old.project.synths[0].synthParams, 120);
  assert.deepEqual(sound, was, 'the voice is sent what it was');

  // A Surge lane goes through a file as it was.
  const service = await fresh();
  ok(service.setSynthParams(1, { engine: 'surge', surge: { patch: 'clipped-stab', macros: [0.25, 1, 0, 0, 0, 0, 0, 0] } }));
  const other = await fresh();
  assert.deepEqual(await other.importProject(JSON.parse(JSON.stringify(service.exportProject()))), { ok: true, repaired: false });
  assert.equal(synthOf(other).engine, 'surge');
  assert.deepEqual(synthOf(other).surge, { patch: 'clipped-stab', macros: [0.25, 1, 0, 0, 0, 0, 0, 0] });

  // Anything else is held to what can be.
  const defaults = createDefaultSynthParameters();
  const hostile = sanitizeSynthParams({ ...defaults, engine: 'surge', surge: { patch: '../../etc', macros: [5, -1, 'a', null] } }, defaults);
  assert.deepEqual(hostile.surge, { patch: SURGE_PATCHES[0].id, macros: [1, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(sanitizeSynthParams({ ...defaults, engine: 'banjo' }, defaults).engine, 'subtractive');
});
