// Turns the trial's measurements into results.md: node report.mjs <out dir>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const r = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
const base = existsSync(join(out, 'baseline.json')) ? JSON.parse(readFileSync(join(out, 'baseline.json'), 'utf8')) : null;
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const pc = (n) => `${(n * 100).toFixed(1)}%`;
const lines = [];
const say = (s = '') => lines.push(s);

say('# Surge XT trial: results');
say();
say('Measured on a GitHub runner in Node, 48 kHz, 128 frames a block (as a browser asks). "Cost" is the share of real time the engine took; 100% would be all of it.');
say();
say('## Size');
say(`- WebAssembly: ${mb(r.size.wasm)} raw, ${mb(r.size.wasmGzip)} gzip, ${mb(r.size.wasmBrotli)} brotli.`);
say(`- Glue script: ${mb(r.size.glue)} raw, ${mb(r.size.glueGzip)} gzip.`);
say(`- Start-up (compile and instantiate): ${r.startupMs.toFixed(0)} ms.`);
say(`- One engine: made in ${r.engine.createMs.map(ms => ms.toFixed(0)).join(', ')} ms; memory ${mb(r.engine.heapBefore)} before five engines, ${mb(r.engine.heapAfterFive)} with them; ${mb(r.heapEnd)} at the end.`);
say();
say('## Twenty patches in detail');
if (base) say(`Discobot's own synth on the same notes: one note ${pc(base.one.cost)}, eight notes ${pc(base.eight.cost)} (worst block ${pc(base.eight.worst)} of its time).`);
say();
say('| Patch | Loads | Load ms | One note | Eight notes | Worst block (8) | Peak | Repeats | Seed matters | Macros |');
say('|---|---|---|---|---|---|---|---|---|---|');
for (const row of r.selected) {
  if (row.missing) { say(`| ${row.name} | missing | | | | | | | | |`); continue; }
  say(`| ${row.name} | ${row.load.result === 0 ? 'yes' : `no (${row.load.result})`} | ${row.load.ms.toFixed(1)} | ${pc(row.one.cost)} | ${pc(row.eight.cost)} | ${pc(row.eight.worst)} | ${row.eight.peak.toFixed(2)}${row.eight.nan ? ' NaN' : ''}${row.eight.silent ? ' silent' : ''} | ${row.repeats ? 'yes' : 'NO'} | ${row.seedMatters ? 'yes' : 'no'} | ${row.macros.filter(Boolean).join(', ')} |`);
}
say();
const ok = r.sweep.filter(s => !s.error && s.result === 0);
const costs = ok.map(s => s.cost).sort((a, b) => a - b);
const at = (q) => costs[Math.min(costs.length - 1, Math.floor(costs.length * q))];
say(`## Every factory patch (${r.sweep.length}), three notes each`);
say(`- Loaded: ${ok.length}. Refused: ${r.sweep.filter(s => !s.error && s.result !== 0).length}. Crashed: ${r.sweep.filter(s => s.error).length}.`);
say(`- Silent: ${ok.filter(s => s.silent).length}. Not a number in the output: ${ok.filter(s => s.nan).length}. Louder than full scale: ${ok.filter(s => s.peak > 1).length}.`);
say(`- Same output twice with the same seed: ${ok.filter(s => s.repeats).length} of ${ok.length}.`);
if (costs.length) say(`- Cost: median ${pc(at(0.5))}, 90th percentile ${pc(at(0.9))}, worst ${pc(costs.at(-1))}. Load time: median ${ok.map(s => s.loadMs).sort((a, b) => a - b)[ok.length >> 1].toFixed(1)} ms.`);
const list = (title, rows) => { if (!rows.length) return; say(); say(`${title}:`); for (const s of rows.slice(0, 40)) say(`- ${s.name}${s.error ? `: ${s.error}` : ''}`); if (rows.length > 40) say(`- and ${rows.length - 40} more`); };
list('Crashed', r.sweep.filter(s => s.error));
list('Silent', ok.filter(s => s.silent));
list('Not repeatable', ok.filter(s => !s.repeats));
list('Costliest ten', [...ok].sort((a, b) => b.cost - a.cost).slice(0, 10).map(s => ({ name: `${s.name} (${pc(s.cost)})` })));
say();
say(`Total run: ${r.totalSeconds.toFixed(0)} s.`);
writeFileSync(join(out, 'results.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
