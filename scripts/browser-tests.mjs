// Runs the browser tests as several Playwright runs side by side instead of one after another.
//
// The tests cannot share one run with more workers: specs reset the same accounts API, and the
// guest tests record audio in real time. But playwright.config.ts takes its port from
// PLAYWRIGHT_PORT and derives the accounts API's port and the build folder from it, so runs on
// different ports each have an app and an API of their own.
//
//   npm run test:browser:fast                 everything, as two runs: desktop width and phone width
//   npm run test:browser:fast -- guests       only the specs whose path matches "guests"
//   BROWSER_TEST_SHARDS=2                     split each width in two, so four runs; up to 4
//   PLAYWRIGHT_PORT=4610                      the first port to use, when 4210 onwards are taken
//
// More runs are only quicker on a machine with cores to spare. Several tests time real audio,
// and on a laptop on battery, or one doing something else, four runs at once made them fail.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const PROJECTS = ['chromium', 'mobile-chromium'];
const shards = Math.max(1, Math.min(4, Math.round(Number(process.env.BROWSER_TEST_SHARDS)) || 1));
const firstPort = Number(process.env.PLAYWRIGHT_PORT) || 4210;
const filters = process.argv.slice(2);

const runs = PROJECTS.flatMap((project, index) => Array.from({ length: shards }, (_, shard) => ({
  name: shards > 1 ? `${project} ${shard + 1}/${shards}` : project,
  port: firstPort + 10 * (index * shards + shard),
  args: [
    'test', `--project=${project}`, ...(shards > 1 ? [`--shard=${shard + 1}/${shards}`] : []),
    // Each run empties its results folder when it starts, so they cannot share one.
    `--output=test-results/${project}-${shard + 1}`, '--pass-with-no-tests',
    // Tests that time real audio can lose out to the other runs for a moment. One more try, as
    // the run on GitHub gets; a test that needed it is counted as flaky in the summary.
    '--retries=1', ...filters,
  ],
  counts: { passed: 0, failed: 0, flaky: 0, skipped: 0 },
  failures: [],
})));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function start(run) {
  const child = spawn(process.execPath, [cli, ...run.args], {
    env: { ...process.env, PLAYWRIGHT_PORT: String(run.port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let pending = '';
  const read = (chunk) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const count = /^\s+(\d+) (passed|failed|flaky|skipped)/.exec(line);
      if (count) run.counts[count[2]] += Number(count[1]);
      if (/^\s+(✘|x|×)\s+\d+ /.test(line)) run.failures.push(line.trim());
      console.log(`[${run.name}] ${line}`);
    }
  };
  child.stdout.setEncoding('utf8').on('data', read);
  child.stderr.setEncoding('utf8').on('data', read);
  run.finished = new Promise(resolve => child.on('close', code => resolve(code ?? 1)));
}

// Resolves once the run's app is being served, which means its build has finished.
async function served(run) {
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${run.port}/discobot/`)).ok) return; } catch { /* not up yet */ }
    await sleep(300);
  }
}

const began = Date.now();
// One build at a time: every build rewrites ui/public/audio-worklet.js and then copies it, so
// two at once could give one of them half a file. The runs then test side by side.
for (const run of runs) {
  start(run);
  await Promise.race([served(run), run.finished]);
}
const codes = await Promise.all(runs.map(run => run.finished));

console.log('');
runs.forEach((run, index) => {
  const { passed, failed, flaky, skipped } = run.counts;
  const extras = [failed && `${failed} failed`, flaky && `${flaky} flaky`, skipped && `${skipped} skipped`].filter(Boolean).join(', ');
  console.log(`${codes[index] === 0 ? 'ok    ' : 'FAILED'} ${run.name.padEnd(20)} ${passed} passed${extras ? `, ${extras}` : ''}`);
  for (const failure of run.failures) console.log(`         ${failure}`);
});
const total = (key) => runs.reduce((sum, run) => sum + run.counts[key], 0);
const seconds = Math.round((Date.now() - began) / 1000);
console.log(`\n${total('passed')} passed, ${total('failed')} failed in ${Math.floor(seconds / 60)}m ${seconds % 60}s, as ${runs.length} runs side by side`);
process.exit(codes.some(code => code !== 0) ? 1 : 0);
