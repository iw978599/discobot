// Walks the trial page in Chrome (on GitHub, never on the owner's machine): every patch on its
// list played as a short tune and a held chord on 1, 2 and 5 Surge lanes, with the page's meter
// noted and what one lane played saved as a WAV. node walk.mjs <web dir> <out dir>
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const [web, out] = process.argv.slice(2);
await mkdir(join(out, 'wav'), { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (path.includes('..')) { response.writeHead(400).end(); return; }
  try { response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(await readFile(join(web, path))); }
  catch { response.writeHead(404).end(); }
}).listen(8791);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (message) => { if (message.type() === 'error') console.log('page error:', message.text()); });
page.on('pageerror', (error) => console.log('page threw:', error.message));
await page.goto('http://localhost:8791/');
await page.click('#start');
await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Running'), null, { timeout: 60000 });
const status = await page.textContent('#status');
console.log(status);

// A tap after the Surge node that keeps what it hears, and a copy of every meter reading.
await page.evaluate(() => {
  const context = node.context;
  const tap = context.createScriptProcessor(4096, 2, 2);
  const silent = context.createGain(); silent.gain.value = 0;
  node.connect(tap); tap.connect(silent).connect(context.destination);
  window.recording = null;
  tap.onaudioprocess = (event) => {
    if (!window.recording) return;
    window.recording.left.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    window.recording.right.push(new Float32Array(event.inputBuffer.getChannelData(1)));
  };
  window.loads = [];
  const shown = node.port.onmessage;
  node.port.onmessage = (event) => { if (event.data.type === 'load') window.loads.push(event.data); shown(event); };
  window.sampleRate = context.sampleRate;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (type, n) => page.evaluate(([type, n]) => node.port.postMessage({ type, note: n }), [type, n]);
const TUNE = [48, 52, 55, 60, 64, 67, 72, 67, 64, 60];
const CHORD = [48, 52, 55, 59, 62, 64, 67, 71];
const patches = await page.$$eval('#patch option', (options) => options.map((option) => option.value));
const rows = [];

for (const patch of patches) {
  await page.selectOption('#patch', patch);
  await page.waitForFunction((name) => document.querySelector('#patchInfo').textContent.length > 0 && document.querySelector('#patch').value === name, patch);
  await wait(300);
  const row = { patch, info: await page.textContent('#patchInfo'), lanes: {} };
  for (const lanes of [1, 2, 5]) {
    await page.selectOption('#lanes', String(lanes));
    await wait(200);
    const recording = lanes === 1;
    await page.evaluate((on) => { window.loads = []; window.recording = on ? { left: [], right: [] } : null; }, recording);
    if (recording) {
      for (const n of TUNE) { await note('on', n); await wait(220); await note('off', n); await wait(30); }
      await wait(400);
    }
    for (const n of CHORD) await note('on', n);
    await wait(3000);
    for (const n of CHORD) await note('off', n);
    await wait(2000);
    const result = await page.evaluate(() => {
      const loads = window.loads;
      const take = window.recording;
      window.recording = null;
      return {
        average: loads.length ? loads.reduce((sum, l) => sum + l.share, 0) / loads.length : null,
        busiest: loads.length ? Math.max(...loads.map((l) => l.share)) : null,
        worst: loads.length ? Math.max(...loads.map((l) => l.worst)) : null,
        late: loads.filter((l) => l.worst > 1).length,
        seconds: loads.length,
        precise: loads.every((l) => l.precise),
        take: take ? { left: take.left.map((b) => Array.from(b)), right: take.right.map((b) => Array.from(b)) } : null,
      };
    });
    if (result.take) {
      const left = result.take.left.flat(), right = result.take.right.flat();
      const rate = await page.evaluate(() => window.sampleRate);
      const data = Buffer.alloc(44 + left.length * 4);
      data.write('RIFF', 0); data.writeUInt32LE(36 + left.length * 4, 4); data.write('WAVEfmt ', 8);
      data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(rate, 24);
      data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(left.length * 4, 40);
      let peak = 0;
      for (let i = 0; i < left.length; i++) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), 44 + i * 4);
        data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
      }
      await writeFile(join(out, 'wav', `${patch.replace(/\//g, ' - ').replace(/\.fxp$/, '')} - in Chrome.wav`), data);
      result.recordedSeconds = left.length / rate;
      result.peak = peak;
    }
    delete result.take;
    row.lanes[lanes] = result;
  }
  rows.push(row);
  const f = (v) => (v == null ? '-' : `${(v * 100).toFixed(0)}%`);
  console.log(patch, [1, 2, 5].map((n) => `${n} lanes ${f(row.lanes[n].average)} avg, ${f(row.lanes[n].worst)} worst, ${row.lanes[n].late} late seconds`).join(' | '));
}

await writeFile(join(out, 'walk.json'), JSON.stringify({ status, rows }, null, 1));
const lines = ['# Surge XT trial: the page walked in Chrome', '', `On GitHub's machine, headless Chrome. ${status}`, '',
  'Average and worst are shares of the audio time while a chord of eight notes is held, measured by the worklet. "Late seconds" are seconds in which at least one block took longer than it had.', '',
  '| Patch | 1 lane | 2 lanes | 5 lanes | Peak (1 lane) |', '|---|---|---|---|---|'];
const cell = (r) => (r.average == null ? 'no readings' : `${(r.average * 100).toFixed(0)}% avg, ${(r.worst * 100).toFixed(0)}% worst, ${r.late} late`);
for (const row of rows) lines.push(`| ${row.patch} | ${cell(row.lanes[1])} | ${cell(row.lanes[2])} | ${cell(row.lanes[5])} | ${row.lanes[1].peak?.toFixed(2) ?? '-'} |`);
lines.push('', `Clock in the worklet: ${rows[0]?.lanes[1].precise ? 'performance.now() was available' : 'only Date.now() (coarse, so worst figures are rough)'}.`);
await writeFile(join(out, 'walk.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await browser.close();
server.close();
