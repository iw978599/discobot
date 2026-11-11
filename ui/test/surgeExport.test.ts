// Surge XT lanes in an export (docs/SURGE_XT_PLAN.md, stage 3), with the engine in surge/dist
// (SURGE_DIST points at another build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { SurgeModule } from '../../engine/src/synth/SurgeVoice.ts';
import { renderSynthBars } from '../src/services/wavExport.ts';
import type { SurgeKit } from '../src/services/surgeEngine.ts';
import type { SequencerStep, SynthParameters } from '../src/types.ts';

const SR = 44100, TEMPO = 120, BAR = 2, BAR_FRAMES = BAR * SR;
const dist = resolve(process.env.SURGE_DIST ?? 'surge/dist');
const kit = (async (): Promise<SurgeKit> => ({
  module: await (createRequire(import.meta.url)(join(dist, 'surge-engine.js')) as () => Promise<SurgeModule>)(),
  patches: Object.fromEntries(['punk-bass', 'clipped-stab'].map(id => [id, new Uint8Array(readFileSync(join('ui/public/surge/patches', `${id}.fxp`)))])),
}))();

const off = (): SequencerStep => ({ active: false, velocity: 0.7 });
const bar = (notes: Record<number, string>) => Array.from({ length: 16 }, (_, step) => notes[step] ? { active: true, note: notes[step], velocity: 0.9 } : off());
const surgeSound = (patch: string, macros = [0, 0, 0, 0, 0, 0, 0, 0]): SynthParameters => ({ ...createDefaultSynthParameters(), engine: 'surge', surge: { patch, macros } });
const peak = (samples: Float32Array) => samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
const riff = bar({ 0: 'A1', 3: 'A1', 6: 'C2', 8: 'A1', 11: 'G1', 14: 'E1' });

test('a Surge lane is in the export, below full scale, and renders the same twice', async () => {
  const surge = { kit: await kit, lane: 1 };
  const once = renderSynthBars([riff, riff], surgeSound('punk-bass'), TEMPO, BAR_FRAMES * 2, SR, BAR, null, undefined, [], 0, 16, [], surge);
  const again = renderSynthBars([riff, riff], surgeSound('punk-bass'), TEMPO, BAR_FRAMES * 2, SR, BAR, null, undefined, [], 0, 16, [], surge);
  assert.ok(peak(once[0]) > 0.05 && peak(once[0]) < 1, `peak ${peak(once[0])}`);
  assert.deepEqual(again[0], once[0]);
  assert.deepEqual(again[1], once[1]);
});

test('a lane that never plays Surge renders bit for bit as it did, with Surge to hand or not', async () => {
  const sound = createDefaultSynthParameters();
  const without = renderSynthBars([riff], sound, TEMPO, BAR_FRAMES, SR, BAR);
  const withKit = renderSynthBars([riff], sound, TEMPO, BAR_FRAMES, SR, BAR, null, undefined, [], 0, 16, [], { kit: await kit, lane: 1 });
  assert.deepEqual(withKit[0], without[0]);
  // And a Surge lane with no Surge to hand is silent rather than another sound.
  assert.equal(peak(renderSynthBars([riff], surgeSound('punk-bass'), TEMPO, BAR_FRAMES, SR, BAR)[0]), 0);
});

test("a scene with a Surge patch of its own plays it from its bar, and the macros' automation moves the sound", async () => {
  const surge = { kit: await kit, lane: 2 };
  const own = surgeSound('punk-bass'), stab = surgeSound('clipped-stab');
  const throughout = renderSynthBars([riff, riff], own, TEMPO, BAR_FRAMES * 2, SR, BAR, null, undefined, [], 0, 16, [], surge);
  const changed = renderSynthBars([riff, riff], own, TEMPO, BAR_FRAMES * 2, SR, BAR, null, undefined, [], 0, 16, [undefined, { params: stab, sample: null }], surge);
  assert.deepEqual(changed[0].subarray(0, BAR_FRAMES), throughout[0].subarray(0, BAR_FRAMES), 'the first bar is the lane\'s own patch');
  assert.notDeepEqual(changed[0].subarray(BAR_FRAMES), throughout[0].subarray(BAR_FRAMES), 'the second is the scene\'s');

  const opened = renderSynthBars([riff], own, TEMPO, BAR_FRAMES, SR, BAR, null, undefined, [{ surgeMacro1: [null, null, null, null, null, null, null, null, 1, 1, 1, 1, 1, 1, 1, 1] }], 0, 16, [], surge);
  const plain = renderSynthBars([riff], own, TEMPO, BAR_FRAMES, SR, BAR, null, undefined, [], 0, 16, [], surge);
  const half = BAR_FRAMES / 2;
  assert.deepEqual(opened[0].subarray(0, half), plain[0].subarray(0, half), 'unchanged before the automation');
  assert.notDeepEqual(opened[0].subarray(half), plain[0].subarray(half), 'the cutoff opens where the macro is automated');
});
