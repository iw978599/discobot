// Stage 0 of docs/SURGE_XT_PLAN.md: measures Surge XT's engine built for the browser.
// node measure.mjs <surge-trial.js> <patches_factory dir> <out dir>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const [moduleJs, patchRoot, out] = process.argv.slice(2);
mkdirSync(join(out, 'wav'), { recursive: true });
const require = createRequire(import.meta.url);
const started = performance.now();
const Module = await require(moduleJs)();
const startupMs = performance.now() - started;

const RATE = 48000, BLOCK = 128, BUDGET_MS = (BLOCK / RATE) * 1000;
const left = Module._malloc(BLOCK * 4), right = Module._malloc(BLOCK * 4);
const text = (pointer) => Module.UTF8ToString(pointer);
// A C++ exception that escaped, as words where Emscripten can say them.
function describe(error) {
  try { if (Module.getExceptionMessage && error instanceof WebAssembly.Exception) return Module.getExceptionMessage(error).join(': '); } catch { /* fall through */ }
  return String(error?.stack ?? error);
}

function create(seed = 7) {
  const t = performance.now();
  let engine;
  try { engine = Module._surge_create(RATE, seed); } catch (error) { throw new Error(`create threw: ${describe(error)}`); }
  if (!engine) throw new Error(text(Module._surge_last_error()));
  return { engine, ms: performance.now() - t };
}
function load(engine, bytes) {
  const pointer = Module._malloc(bytes.length);
  Module.HEAPU8.set(bytes, pointer);
  const t = performance.now();
  const result = Module._surge_load_fxp(engine, pointer, bytes.length);
  const ms = performance.now() - t;
  Module._free(pointer);
  return result === 3 ? { result, ms, error: text(Module._surge_last_error()) } : { result, ms };
}
// Plays notes for `hold` seconds and lets them ring for `tail`, 128 frames at a time as a worklet would.
function play(engine, notes, hold, tail, keep) {
  const frames = Math.round((hold + tail) * RATE), off = Math.round(hold * RATE);
  const outL = keep ? new Float32Array(frames) : null, outR = keep ? new Float32Array(frames) : null;
  const blockTimes = [];
  let peak = 0, sum = 0, nan = false;
  for (const note of notes) Module._surge_note_on(engine, note, 100);
  for (let at = 0; at < frames; at += BLOCK) {
    if (at <= off && off < at + BLOCK) for (const note of notes) Module._surge_note_off(engine, note, 64);
    const t = performance.now();
    Module._surge_render(engine, left, right, BLOCK);
    blockTimes.push(performance.now() - t);
    const l = new Float32Array(Module.HEAPF32.buffer, left, BLOCK), r = new Float32Array(Module.HEAPF32.buffer, right, BLOCK);
    for (let i = 0; i < BLOCK && at + i < frames; i++) {
      const a = l[i], b = r[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) nan = true;
      peak = Math.max(peak, Math.abs(a), Math.abs(b));
      sum += a * a + b * b;
      if (outL) { outL[at + i] = a; outR[at + i] = b; }
    }
  }
  const sorted = [...blockTimes].sort((a, b) => a - b);
  const total = blockTimes.reduce((a, b) => a + b, 0);
  return {
    cost: total / ((frames / RATE) * 1000), // share of real time
    p99: sorted[Math.floor(sorted.length * 0.99)] / BUDGET_MS,
    worst: sorted.at(-1) / BUDGET_MS,
    peak, rms: Math.sqrt(sum / (2 * frames)), nan, silent: peak < 1e-4,
    left: outL, right: outR,
  };
}
const same = (a, b) => a.left.length === b.left.length
  && a.left.every((v, i) => Object.is(v, b.left[i])) && a.right.every((v, i) => Object.is(v, b.right[i]));

function wav(path, l, r) {
  const data = Buffer.alloc(44 + l.length * 4);
  data.write('RIFF', 0); data.writeUInt32LE(36 + l.length * 4, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(l.length * 4, 40);
  for (let i = 0; i < l.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, data);
}

const results = { startupMs, budgetMs: BUDGET_MS, selected: [], sweep: [] };

// The module's size, raw and as a server would send it.
const wasm = readFileSync(moduleJs.replace(/\.js$/, '.wasm')), glue = readFileSync(moduleJs);
results.size = {
  wasm: wasm.length, wasmGzip: gzipSync(wasm, { level: 9 }).length,
  wasmBrotli: brotliCompressSync(wasm, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  glue: glue.length, glueGzip: gzipSync(glue, { level: 9 }).length,
};

// How much memory each engine takes, and how long one takes to make.
{
  const before = Module.HEAPU8.length, made = [];
  for (let i = 0; i < 5; i++) made.push(create());
  results.engine = { createMs: made.map(m => m.ms), heapBefore: before, heapAfterFive: Module.HEAPU8.length };
  for (const m of made) Module._surge_destroy(m.engine);
}

// Twenty patches of different kinds, in detail.
const CHORD = [48, 52, 55, 59, 62, 64, 67, 71];
const strip = ({ left: _l, right: _r, ...rest }) => rest;
const selected = JSON.parse(readFileSync(new URL('./patches.json', import.meta.url), 'utf8'));
for (const name of selected) {
  let bytes;
  try { bytes = readFileSync(join(patchRoot, name)); } catch { results.selected.push({ name, missing: true }); continue; }
  const row = { name };
  const a = create(7); const loaded = load(a.engine, bytes);
  row.load = loaded; row.patchName = text(Module._surge_patch_name(a.engine));
  row.macros = Array.from({ length: 8 }, (_, i) => text(Module._surge_macro_name(a.engine, i)));
  const one = play(a.engine, [48], 1.5, 1.5, true);
  const eight = play(a.engine, CHORD, 2, 2, true);
  Module._surge_destroy(a.engine);
  const b = create(7); load(b.engine, bytes); play(b.engine, [48], 1.5, 1.5, false);
  const eightAgain = play(b.engine, CHORD, 2, 2, true);
  Module._surge_destroy(b.engine);
  const c = create(8); load(c.engine, bytes); play(c.engine, [48], 1.5, 1.5, false);
  const eightOtherSeed = play(c.engine, CHORD, 2, 2, true);
  Module._surge_destroy(c.engine);
  const file = name.replace(/\//g, ' - ').replace(/\.fxp$/, '');
  wav(join(out, 'wav', `${file} - one note.wav`), one.left, one.right);
  wav(join(out, 'wav', `${file} - eight notes.wav`), eight.left, eight.right);
  Object.assign(row, { one: strip(one), eight: strip(eight), repeats: same(eight, eightAgain), seedMatters: !same(eight, eightOtherSeed) });
  results.selected.push(row);
  console.log(name, row.load.result, `one ${(one.cost * 100).toFixed(1)}%`, `eight ${(eight.cost * 100).toFixed(1)}% worst ${(eight.worst * 100).toFixed(0)}%`, row.repeats ? 'repeats' : 'DIFFERS');
}

// Every factory patch: does it load, make sound, repeat, and what do three notes cost.
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.fxp')) files.push(p);
  }
})(patchRoot);
for (const path of files.sort()) {
  const bytes = readFileSync(path), name = relative(patchRoot, path).replace(/\\/g, '/');
  try {
    const a = create(7); const loaded = load(a.engine, bytes);
    const named = Array.from({ length: 8 }, (_, i) => text(Module._surge_macro_name(a.engine, i))).filter(label => label && label !== '-').length;
    const first = play(a.engine, [48, 55, 64], 1.5, 1, true); Module._surge_destroy(a.engine);
    const b = create(7); load(b.engine, bytes);
    const second = play(b.engine, [48, 55, 64], 1.5, 1, true); Module._surge_destroy(b.engine);
    results.sweep.push({ name, result: loaded.result, loadMs: loaded.ms, cost: first.cost, worst: first.worst, peak: first.peak, nan: first.nan, silent: first.silent, repeats: same(first, second), named });
  } catch (error) {
    results.sweep.push({ name, error: describe(error).slice(0, 200) });
  }
}
results.heapEnd = Module.HEAPU8.length;
results.totalSeconds = (performance.now() - started) / 1000;
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
console.log('done', results.totalSeconds.toFixed(0), 's');
