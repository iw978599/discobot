// Discobot's own Surge patches (surge/patches/): each .fxp in ui/public/surge/patches is what
// make.mjs writes from its definition, loads with its names, and plays below full scale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve(process.env.SURGE_DIST ?? 'surge/dist');
const definitions = readdirSync('surge/patches').filter(file => file.endsWith('.json')).sort();
const fxp = (file: string) => readFileSync(join('ui/public/surge/patches', file.replace(/\.json$/, '.fxp')));

test('every patch file is exactly what its definition makes', () => {
  const out = mkdtempSync(join(tmpdir(), 'surge-patches-'));
  execFileSync(process.execPath, ['surge/patches/make.mjs', dist], { env: { ...process.env, SURGE_PATCHES_OUT: out } });
  assert.ok(definitions.length >= 2);
  for (const file of definitions) assert.deepEqual(readFileSync(join(out, file.replace(/\.json$/, '.fxp'))), fxp(file), file);
});

test('every patch loads with its names and plays below full scale, its macros down and up', async () => {
  const M = await (createRequire(import.meta.url)(join(dist, 'surge-engine.js')) as () => Promise<any>)();
  for (const file of definitions) {
    const patch = JSON.parse(readFileSync(join('surge/patches', file), 'utf8')), bytes = fxp(file);
    for (const macro of [0, 1]) {
      const engine = M._surge_create(48000, 1), at = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, at);
      assert.equal(M._surge_load_fxp(engine, at, bytes.length), 0, file);
      M._free(at);
      assert.equal(M.UTF8ToString(M._surge_patch_name(engine)), patch.name);
      patch.macros.forEach((m: { name: string }, i: number) => {
        assert.equal(M.UTF8ToString(M._surge_macro_name(engine, i)), m.name);
        M._surge_set_macro(engine, i, macro);
      });
      const left = M._malloc(512), right = M._malloc(512);
      let peak = 0;
      for (const key of [45, 52, 57]) M._surge_note_on(engine, key, 127);
      for (let block = 0; block < 150; block++) {
        M._surge_render(engine, left, right, 128);
        for (const pointer of [left, right]) for (const value of new Float32Array(M.HEAPF32.buffer, pointer, 128)) peak = Math.max(peak, Math.abs(value));
      }
      assert.ok(peak > 0.05 && peak < 0.9, `${patch.name}, macros at ${macro}: peak ${peak}`);
      M._free(left); M._free(right);
      M._surge_destroy(engine);
    }
  }
});
