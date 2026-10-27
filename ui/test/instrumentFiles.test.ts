import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { SynthCore, createDefaultSynthParameters, toVoiceParams, type SynthSample } from '@discobot/engine';
import { BUILT_IN_WAVES, loadBuiltInWave, loadLaneSample, parseWaveBundle } from '../src/services/builtInWaves.ts';
import { BUNDLED_WAVES } from './helpers/presetAudit.ts';

const SR = 48000;
const instruments = BUILT_IN_WAVES.filter(entry => entry.file);
const fileUrl = (path: string) => new URL(`../public/${path}`, import.meta.url);
const read = (path: string) => { const bytes = readFileSync(fileUrl(path)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; };

test('the big instruments are files of their own, in the format of waves.bin, and not in it', () => {
  assert.equal(instruments.length, 8);
  for (const entry of instruments) {
    assert.match(entry.file!, /^sounds\/[a-z0-9-]+\.bin$/);
    assert.ok(!BUNDLED_WAVES.has(entry.id), `${entry.id} is not in waves.bin`);
    const waves = parseWaveBundle(read(entry.file!));
    assert.deepEqual([...waves.keys()], [entry.id]);
    const found = waves.get(entry.id)!;
    const zones = [found, ...(found.zones ?? [])];
    assert.ok(zones.length >= 4, `${entry.id} has a recording about every octave`);
    assert.deepEqual(zones.map(zone => zone.root), [...zones.map(zone => zone.root)].sort((a, b) => a - b), `${entry.id} is in order of pitch`);
    for (const zone of zones) {
      assert.ok(zone.rate === 22050 && zone.data.length > 1 && zone.data.every(value => Number.isFinite(value) && Math.abs(value) <= 1), entry.id);
      assert.ok(zone.data.some(value => Math.abs(value) > 0.5), `${entry.id} is not silent`);
    }
    assert.ok(statSync(fileUrl(entry.file!)).size < 600 * 1024, `${entry.id} is under 600 KB`);
  }
});

test('each instrument plays through the sample engine, each note from the recording nearest it', () => {
  for (const entry of instruments) {
    const sample = parseWaveBundle(read(entry.file!)).get(entry.id)!;
    for (const note of ['C2', 'A3', 'C5']) {
      const core = new SynthCore(SR);
      core.setParams(toVoiceParams({ ...createDefaultSynthParameters(), engine: 'sample', envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.05 } }));
      core.setSample(sample as SynthSample);
      core.noteOn({ note, velocity: 1 });
      const left = new Float32Array(SR / 2), right = new Float32Array(left.length);
      core.process(left, right);
      assert.ok(left.every(Number.isFinite), `${entry.id} ${note}`);
      assert.ok(left.subarray(0, SR / 10).some(value => Math.abs(value) > 0.02), `${entry.id} ${note} is heard`);
    }
  }
});

test('an instrument is fetched the first time it is asked for, once, and a lane plays its oscillators until it arrives', async () => {
  const asked: string[] = [];
  const original = globalThis.fetch;
  let offline = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input);
    asked.push(path);
    if (offline) throw new TypeError('offline');
    return new Response(read(path.replace(/^\//, '')), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await loadBuiltInWave('tenor-sax'), null, 'offline and never seen, there is nothing to play');
    assert.equal(await loadLaneSample({ ...createDefaultSynthParameters(), engine: 'sample', sample: { root: 60, loop: false, wave: 'tenor-sax' } }), null);
    assert.ok(asked.every(path => path === '/sounds/tenor-sax.bin'), `only its own file was asked for: ${asked.join(', ')}`);
    offline = false;
    asked.length = 0;
    const [first, second] = await Promise.all([loadBuiltInWave('tenor-sax'), loadBuiltInWave('tenor-sax')]);
    assert.ok(first && first === second);
    assert.equal(asked.length, 1, 'fetched once');
    await loadBuiltInWave('tenor-sax');
    assert.equal(asked.length, 1, 'and kept');
    assert.ok(await loadBuiltInWave('piano'), 'the small sounds still come from waves.bin');
    assert.deepEqual(asked, ['/sounds/tenor-sax.bin', '/waves.bin']);
    assert.equal(await loadBuiltInWave('not-a-sound'), null);
  } finally {
    globalThis.fetch = original;
  }
});
