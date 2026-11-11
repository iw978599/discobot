// Surge XT's engine as built for the browser (surge/, docs/SURGE_XT_PLAN.md), played in Node.
// SURGE_DIST points it at another build, which the Surge workflow uses to check a fresh one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.env.SURGE_DIST ?? 'surge/dist');
const require = createRequire(import.meta.url);

interface SurgeModule {
  HEAPU8: Uint8Array; HEAPF32: Float32Array;
  UTF8ToString(pointer: number): string;
  _malloc(bytes: number): number; _free(pointer: number): void;
  _surge_create(sampleRate: number, seed: number): number;
  _surge_destroy(engine: number): void;
  _surge_load_fxp(engine: number, data: number, size: number): number;
  _surge_note_on(engine: number, key: number, velocity: number): void;
  _surge_note_off(engine: number, key: number, velocity: number): void;
  _surge_pitch_bend(engine: number, value: number): void;
  _surge_render(engine: number, left: number, right: number, frames: number): void;
  _surge_block_size(): number;
  _surge_last_error(): number;
}

const load = async (): Promise<SurgeModule> => (require(resolve(dist, 'surge-engine.js')) as () => Promise<SurgeModule>)();

// One note held for half a second and let go, 128 frames at a time as the worklet asks.
function render(M: SurgeModule, seed: number, bend = 0) {
  const engine = M._surge_create(48000, seed);
  assert.ok(engine, M.UTF8ToString(M._surge_last_error()));
  const left = M._malloc(128 * 4), right = M._malloc(128 * 4);
  const out = new Float32Array(48000);
  M._surge_pitch_bend(engine, bend);
  M._surge_note_on(engine, 57, 100);
  for (let at = 0; at < out.length; at += 128) {
    if (at === 24064) M._surge_note_off(engine, 57, 64);
    M._surge_render(engine, left, right, 128);
    out.set(new Float32Array(M.HEAPF32.buffer, left, 128).subarray(0, Math.min(128, out.length - at)), at);
  }
  M._free(left); M._free(right);
  M._surge_destroy(engine);
  return out;
}

test('the built engine matches its record and works in blocks of 32', async () => {
  const record = JSON.parse(readFileSync(resolve(dist, 'BUILD.json'), 'utf8'));
  assert.equal(record.surge.commit, readFileSync('surge/SURGE_COMMIT', 'utf8').trim(), 'built from the pinned commit');
  const M = await load();
  assert.equal(M._surge_block_size(), 32);
});

test('a note makes sound, and the same seed makes the same sound', async () => {
  const M = await load();
  const first = render(M, 7), again = render(M, 7);
  const peak = first.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
  assert.ok(peak > 0.01 && peak < 4, `peak ${peak}`);
  assert.ok(first.every(Number.isFinite));
  assert.deepEqual(again, first, 'the same seed repeats sample for sample');
  // After the release the note dies away.
  const tail = first.subarray(46000).reduce((most, value) => Math.max(most, Math.abs(value)), 0);
  assert.ok(tail < peak / 10, `tail ${tail}`);
});

test('the pitch wheel moves the note', async () => {
  const M = await load();
  const crossings = (samples: Float32Array) => { let count = 0; for (let i = 1; i < 12000; i++) if (samples[i - 1] <= 0 && samples[i] > 0) count++; return count; };
  const level = crossings(render(M, 7)), up = crossings(render(M, 7, 8191));
  assert.ok(up > level, `${up} crossings bent up against ${level}`);
});

test('a file that is not a Surge patch is refused, and the engine plays on', async () => {
  const M = await load();
  const engine = M._surge_create(48000, 1);
  const send = (bytes: Uint8Array) => {
    const pointer = M._malloc(Math.max(1, bytes.length));
    M.HEAPU8.set(bytes, pointer);
    const result = M._surge_load_fxp(engine, pointer, bytes.length);
    M._free(pointer);
    return result;
  };
  assert.equal(send(new Uint8Array(10)), 2, 'too short');
  const notSurge = new Uint8Array(200);
  notSurge.set([...'CcnK'].map((c) => c.charCodeAt(0)), 0);
  notSurge.set([...'FPCh'].map((c) => c.charCodeAt(0)), 8);
  notSurge.set([...'abcd'].map((c) => c.charCodeAt(0)), 16);
  assert.equal(send(notSurge), 1, 'another plugin\'s file');
  const cut = new Uint8Array(200);
  cut.set([...'CcnK'].map((c) => c.charCodeAt(0)), 0);
  cut.set([...'FPCh'].map((c) => c.charCodeAt(0)), 8);
  cut.set([...'cjs3'].map((c) => c.charCodeAt(0)), 16);
  cut.set([0, 1, 0, 0], 56); // a chunk far longer than the file
  assert.equal(send(cut), 2, 'cut short');
  M._surge_destroy(engine);
});

// Discobot's own patches are written from the blank patch (surge/patches/).
interface PatchWriter extends SurgeModule {
  _surge_param_count(engine: number): number;
  _surge_param_name(engine: number, index: number): number;
  _surge_param_display(engine: number, index: number): number;
  _surge_param_set(engine: number, name: number, text: number): number;
  _surge_route_macro(engine: number, macro: number, name: number, depth: number): number;
  _surge_set_macro_name(engine: number, macro: number, name: number): void;
  _surge_set_patch_name(engine: number, name: number): void;
  _surge_save_fxp(engine: number): number;
  _surge_saved_data(): number;
  _surge_macro_name(engine: number, macro: number): number;
  _surge_patch_name(engine: number): number;
}

function text(M: SurgeModule, value: string) {
  const bytes = new TextEncoder().encode(value + '\0'), pointer = M._malloc(bytes.length);
  M.HEAPU8.set(bytes, pointer);
  return pointer;
}

test('a patch written from the blank one is saved, and loads back the same', async () => {
  const M = await load() as PatchWriter;
  const engine = M._surge_create(48000, 3);
  const names = Array.from({ length: M._surge_param_count(engine) }, (_, i) => M.UTF8ToString(M._surge_param_name(engine, i)));
  const shown = (on: number, name: string) => M.UTF8ToString(M._surge_param_display(on, names.indexOf(name)));
  assert.ok(names.includes('a_osc1_type') && names.includes('a_filter1_cutoff'), names.slice(0, 40).join(' '));
  const set = (name: string, value: string) => {
    const n = text(M, name), v = text(M, value), result = M._surge_param_set(engine, n, v);
    M._free(n); M._free(v);
    return result;
  };
  assert.equal(set('no_such_thing', '1'), 1);
  assert.equal(set('a_filter1_cutoff', 'loud'), 2, 'a value Surge cannot read');
  const blank = shown(engine, 'a_filter1_cutoff');
  assert.equal(set('a_filter1_cutoff', '200 Hz'), 0, M.UTF8ToString(M._surge_last_error()));
  assert.notEqual(shown(engine, 'a_filter1_cutoff'), blank);
  assert.match(shown(engine, 'a_filter1_cutoff'), /200/);
  const osc = shown(engine, 'a_osc1_type');
  assert.equal(set('a_osc1_type', osc), 0, 'a whole-number parameter by what Surge shows for it');
  const cutoff = text(M, 'a_filter1_cutoff');
  assert.equal(M._surge_route_macro(engine, 0, cutoff, 0.5), 0);
  M._free(cutoff);
  const label = text(M, 'Open'), title = text(M, 'Test Patch');
  M._surge_set_macro_name(engine, 0, label);
  M._surge_set_patch_name(engine, title);
  M._free(label); M._free(title);
  const size = M._surge_save_fxp(engine);
  const file = M.HEAPU8.slice(M._surge_saved_data(), M._surge_saved_data() + size);
  assert.equal(String.fromCharCode(...file.subarray(0, 4)), 'CcnK');

  const again = M._surge_create(48000, 3), pointer = M._malloc(file.length);
  M.HEAPU8.set(file, pointer);
  assert.equal(M._surge_load_fxp(again, pointer, file.length), 0);
  M._free(pointer);
  assert.equal(M.UTF8ToString(M._surge_patch_name(again)), 'Test Patch');
  assert.equal(M.UTF8ToString(M._surge_macro_name(again, 0)), 'Open');
  assert.equal(shown(again, 'a_filter1_cutoff'), shown(engine, 'a_filter1_cutoff'));
  M._surge_destroy(engine); M._surge_destroy(again);
});
