// Writes Discobot's own Surge patches: each surge/patches/<name>.json, applied to Surge's blank
// patch by the built engine, saved as ui/public/surge/patches/<name>.fxp. Every value is read
// back, and the script stops on any Surge did not take as written. SURGE_PATCHES_OUT writes elsewhere.
//   node surge/patches/make.mjs [engine dir, default surge/dist]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const here = resolve('surge/patches'), out = resolve(process.env.SURGE_PATCHES_OUT ?? 'ui/public/surge/patches');
const dist = resolve(process.argv[2] ?? 'surge/dist');
const M = await createRequire(import.meta.url)(join(dist, 'surge-engine.js'))();
const text = (value) => { const bytes = new TextEncoder().encode(value + '\0'), at = M._malloc(bytes.length); M.HEAPU8.set(bytes, at); return at; };
const call = (fn, ...args) => { const made = args.map(a => typeof a === 'string' ? text(a) : a); const result = fn(...made); made.forEach((a, i) => typeof args[i] === 'string' && M._free(a)); return result; };
const number = (s) => Number.parseFloat(s);
// What Surge shows matches what was written: the same words, or the same number to within 1%.
const same = (shown, written) => shown.toLowerCase() === written.toLowerCase()
  || (Number.isFinite(number(written)) && Math.abs(number(shown) - number(written)) <= Math.abs(number(written)) * 0.01 + 1e-6);

mkdirSync(out, { recursive: true });
for (const file of readdirSync(here).filter(f => f.endsWith('.json')).sort()) {
  const patch = JSON.parse(readFileSync(join(here, file), 'utf8'));
  const engine = M._surge_create(48000, 1), left = M._malloc(512), right = M._malloc(512);
  const index = new Map(Array.from({ length: M._surge_param_count(engine) }, (_, i) => [M.UTF8ToString(M._surge_param_name(engine, i)), i]));
  const settle = () => { for (let i = 0; i < 8; i++) M._surge_render(engine, left, right, 128); };
  const entries = Object.entries(patch.set);
  // A type is changed on the next block, and what its other parameters mean follows it.
  for (const pass of [([name]) => /_type$/.test(name), ([name]) => !/_type$/.test(name)]) {
    for (const [name, value] of entries.filter(pass)) {
      // An on-off parameter shows On or Off and is set with on or off.
      const result = call(M._surge_param_set, engine, name, /^(On|Off)$/.test(value) ? value.toLowerCase() : value);
      if (result !== 0) throw new Error(`${file}: ${name} = ${value}: ${result === 1 ? 'no such parameter' : M.UTF8ToString(M._surge_last_error())}`);
    }
    settle();
  }
  for (const [name, value] of entries) {
    const shown = M.UTF8ToString(M._surge_param_display(engine, index.get(name)));
    if (!same(shown, value)) throw new Error(`${file}: ${name} is ${shown}, not ${value}`);
  }
  patch.macros.forEach((macro, at) => {
    call(M._surge_set_macro_name, engine, at, macro.name);
    for (const [name, depth] of Object.entries(macro.routes)) {
      const result = call(M._surge_route_macro, engine, at, name, depth);
      if (result !== 0) throw new Error(`${file}: macro ${macro.name} cannot move ${name}`);
    }
  });
  call(M._surge_set_patch_name, engine, patch.name);
  const size = M._surge_save_fxp(engine), at = M._surge_saved_data();
  writeFileSync(join(out, basename(file, '.json') + '.fxp'), M.HEAPU8.slice(at, at + size));
  console.log(`${patch.name}: ${size} bytes`);
  M._free(left); M._free(right);
  M._surge_destroy(engine);
}
