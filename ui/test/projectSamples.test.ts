import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { contentHash } from '../src/services/projectSync.ts';
import { decodeShare, encodeShare, slimProject } from '../src/services/shareLink.ts';
import {
  MAX_EMBEDDED_SAMPLE_BYTES, MAX_EMBEDDED_TOTAL_BYTES, MAX_PROJECT_FILE_BYTES, adoptSamples, embedSamples, fromBase64, readEmbeddedSamples,
  toBase64, usedSampleIds, type EmbeddedSample, type SampleStore,
} from '../src/services/projectSamples.ts';
import type { SampleRecord } from '../src/services/sampleStore.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35, pan: 0 },
}])) as DrumState;
const effectsLoop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};
const defaults = () => ({
  synthParams: createDefaultSynthParameters(), drumState: drums(),
  drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop,
});

// One browser: its own localStorage, project library and sample store.
async function browser() {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const held = new Map<string, SampleRecord>();
  const samples: SampleStore = {
    list: async () => [...held.values()],
    get: async id => held.get(id),
    put: async (sample) => { held.set(sample.id, sample); },
  };
  const library = createMemoryLibrary();
  const service = new LocalProjectService();
  service.initialize(defaults());
  await service.openLibrary(library);
  const keep = (bytes: Uint8Array, name = 'hit.wav', id = crypto.randomUUID()) => {
    held.set(id, { id, name, type: 'audio/wav', data: bytes.slice().buffer });
    return id;
  };
  const lane = (instrument: string, sampleId: string | null) => service.request('/drum/sample', { method: 'POST', body: JSON.stringify({ instrument, sampleId }) });
  // What Export Project writes, after the trip through a file.
  const save = async () => {
    const file = service.exportProject();
    const { samples: audio, skipped } = await embedSamples(file.project, samples);
    return { file: JSON.parse(JSON.stringify(audio.length ? { ...file, samples: audio } : file)) as Record<string, any>, skipped };
  };
  // What Import Project does with a file.
  const open = async (file: unknown) => {
    const adopted = await adoptSamples(file, samples);
    return { ...adopted, result: await service.importProject(adopted.file) };
  };
  const drumState = () => service.snapshot().drumState as DrumState;
  return { service, storage, library, samples, held, keep, lane, save, open, drumState };
}

// Bytes that are easy to tell apart and never all the same.
const noise = (length: number, seed = 1) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed * 97 + (index >> 8)) & 255);
const bytesOf = (sample: SampleRecord | undefined) => Array.from(new Uint8Array(sample!.data));

test('a project file carries its samples: saved in one browser, opened in another, the lanes find them', async () => {
  const first = await browser();
  const audio = noise(5000);
  const id = first.keep(audio, 'Snare one.wav');
  await first.lane('snare', id);
  await first.lane('clap', id);
  const { file } = await first.save();
  assert.equal(file.samples.length, 1, 'two lanes on one sample store it once');
  assert.deepEqual({ ...file.samples[0], data: '' }, { id, name: 'Snare one.wav', type: 'audio/wav', data: '' });
  assert.equal('samples' in file.project, false, 'the audio is beside the project, not in it');

  const second = await browser();
  const opened = await second.open(file);
  assert.deepEqual(opened.result, { ok: true, repaired: false });
  assert.deepEqual([opened.added, opened.dropped], [1, 0]);
  assert.equal(second.drumState().snare.sampleId, id);
  assert.equal(second.drumState().clap.sampleId, id);
  assert.equal(second.drumState().kick.sampleId, undefined);
  assert.deepEqual(bytesOf(second.held.get(id)), Array.from(audio), 'the audio arrives byte for byte');
  assert.equal(second.held.get(id)!.name, 'Snare one.wav');
  assert.equal(second.held.get(id)!.type, 'audio/wav');
});

test('opening the same file again stores nothing twice', async () => {
  const first = await browser();
  await first.lane('kick', first.keep(noise(3000)));
  const { file } = await first.save();
  const second = await browser();
  await second.open(file);
  const again = await second.open(file);
  assert.deepEqual([again.added, again.dropped, second.held.size], [0, 0, 1]);
  assert.equal(again.result.ok, true);
  // And in the browser that made it, where the sample already is.
  const home = await first.open(file);
  assert.deepEqual([home.added, first.held.size], [0, 1]);
});

test('the same audio already here under another id is used, not stored again', async () => {
  const first = await browser();
  const audio = noise(3000);
  const theirs = first.keep(audio);
  await first.lane('kick', theirs);
  const { file } = await first.save();
  const second = await browser();
  const mine = second.keep(audio, 'my copy.wav');
  const opened = await second.open(file);
  assert.deepEqual([opened.added, second.held.size], [0, 1]);
  assert.equal(second.drumState().kick.sampleId, mine, 'the lane points at the copy that was here');
  assert.equal(second.held.get(mine)!.name, 'my copy.wav');
});

test('an id already taken by different audio is not overwritten: the incoming sample gets a new id', async () => {
  const first = await browser();
  const incoming = noise(3000, 1), resident = noise(3000, 2);
  const id = first.keep(incoming, 'theirs.wav');
  await first.lane('kick', id);
  await first.lane('snare', id);
  const { file } = await first.save();
  const second = await browser();
  second.keep(resident, 'mine.wav', id);
  const opened = await second.open(file);
  assert.deepEqual([opened.added, opened.dropped, second.held.size], [1, 0, 2]);
  assert.deepEqual(bytesOf(second.held.get(id)), Array.from(resident), 'what was here is untouched');
  assert.equal(second.held.get(id)!.name, 'mine.wav');
  const moved = second.drumState().kick.sampleId!;
  assert.notEqual(moved, id);
  assert.match(moved, /^[0-9a-f-]{36}$/);
  assert.equal(second.drumState().snare.sampleId, moved, 'every lane that used it follows');
  assert.deepEqual(bytesOf(second.held.get(moved)), Array.from(incoming));
  // The same file again finds the sample it stored last time.
  const again = await second.open(file);
  assert.deepEqual([again.added, second.held.size], [0, 2]);
  assert.equal(second.drumState().kick.sampleId, moved);
});

test('every lane\'s sample is saved, whichever scene is open, and nothing the project does not use', async () => {
  const first = await browser();
  const used = first.keep(noise(2000, 1), 'used.wav'), unused = first.keep(noise(2000, 2), 'unused.wav');
  await first.lane('crash', used);
  // The crash plays only in the first scene; the file is saved with an empty second scene open.
  await first.service.request('/drum/step', { method: 'POST', body: JSON.stringify({ instrument: 'crash', step: 0, active: true }) });
  await first.service.request('/scenes/create', { method: 'POST', body: JSON.stringify({ empty: true }) });
  assert.equal(first.drumState().crash.steps[0], false, 'the open scene has no crash');
  const { file } = await first.save();
  assert.deepEqual(file.samples.map((sample: EmbeddedSample) => sample.id), [used]);
  assert.equal(JSON.stringify(file).includes(unused), false);
  assert.deepEqual(usedSampleIds(file.project), [used]);

  // A sample in a file that no lane uses is not taken in either.
  const stray = { id: crypto.randomUUID(), name: 'stray.wav', type: 'audio/wav', data: await toBase64(noise(100, 3)) };
  const second = await browser();
  const opened = await second.open({ ...file, samples: [...file.samples, stray] });
  assert.deepEqual([opened.added, opened.dropped], [1, 0]);
  assert.deepEqual([...second.held.keys()], [used]);
  // A sample that is not in this browser is left out without complaint.
  await second.lane('kick', crypto.randomUUID());
  const saved = await second.save();
  assert.deepEqual(saved.file.samples.map((sample: EmbeddedSample) => sample.id), [used]);
  assert.deepEqual(saved.skipped, []);
});

test('a project file from before samples were included opens exactly as it did', async () => {
  const first = await browser();
  const id = first.keep(noise(1000));
  await first.lane('kick', id);
  const old = JSON.parse(JSON.stringify(first.service.exportProject()));
  assert.equal('samples' in old, false);
  const second = await browser();
  const adopted = await adoptSamples(old, second.samples);
  assert.equal(adopted.file, old, 'the file is handed on untouched');
  assert.deepEqual([adopted.added, adopted.dropped], [0, 0]);
  assert.deepEqual(await second.service.importProject(adopted.file), { ok: true, repaired: false });
  assert.equal(second.drumState().kick.sampleId, id, 'the lane still names its sample, which is missing here');
  assert.equal(second.held.size, 0);
  // A project that uses no samples saves as the same file as before.
  const third = await browser();
  assert.equal('samples' in (await third.save()).file, false);
});

test('a version of the app from before this opens a new file as a project whose samples are missing', async () => {
  const first = await browser();
  const id = first.keep(noise(1000));
  await first.lane('kick', id);
  const { file } = await first.save();
  assert.equal(file.formatVersion, 1);
  // That version hands the whole parsed file to importProject, which reads only `project`.
  const second = await browser();
  assert.deepEqual(await second.service.importProject(file), { ok: true, repaired: false });
  assert.equal(second.drumState().kick.sampleId, id);
  second.service.flush();
  assert.equal([...second.storage.values()].join('').includes(file.samples[0].data.slice(0, 60)), false, 'and it keeps none of the audio');
  assert.ok(new Blob([JSON.stringify(file)]).size < MAX_PROJECT_FILE_BYTES);
});

test('bad audio in a file is dropped and the project still opens', async () => {
  const first = await browser();
  const ids = {
    kick: first.keep(noise(900, 1)), snare: first.keep(noise(900, 2)), clap: first.keep(noise(900, 3)), closedHH: first.keep(noise(900, 4)),
    openHH: first.keep(noise(900, 5)), snare2: first.keep(noise(900, 6)), ride: first.keep(noise(900, 7)), crash: first.keep(noise(900, 8)),
  };
  for (const [instrument, id] of Object.entries(ids)) await first.lane(instrument, id);
  const { file } = await first.save();
  assert.equal(file.samples.length, 8);
  const entry = (id: string) => file.samples.find((sample: EmbeddedSample) => sample.id === id);
  entry(ids.snare).data = 'not base64!!';
  entry(ids.clap).data = 'A'.repeat(Math.ceil((MAX_EMBEDDED_SAMPLE_BYTES + 1) / 3) * 4);
  entry(ids.closedHH).name = 'run-me.exe'; entry(ids.closedHH).type = 'application/x-msdownload';
  delete entry(ids.openHH).data;
  entry(ids.snare2).data = '';
  entry(ids.ride).data = { length: 4 };
  entry(ids.crash).name = 42;
  file.samples.push(null, 'text', { id: '../../etc/passwd', name: 'x.wav', type: 'audio/wav', data: 'AAAA' }, { ...entry(ids.kick), data: 'AAAA' });

  const second = await browser();
  const opened = await second.open(file);
  assert.deepEqual(opened.result, { ok: true, repaired: false });
  assert.deepEqual([opened.added, opened.dropped], [1, 7]);
  assert.deepEqual([...second.held.keys()], [ids.kick], 'the one good sample is kept, and its first entry wins');
  assert.equal(second.held.get(ids.kick)!.data.byteLength, 900);
  assert.equal(second.drumState().snare.sampleId, ids.snare, 'a lane whose audio was dropped keeps its choice and plays its own sound');
  assert.equal('samples' in (opened.file as object), false, 'no audio goes on to the project store');

  for (const samples of [null, 'x', 7, {}, [], [[]], [{}]]) {
    const third = await browser();
    const result = await third.open({ ...file, samples });
    assert.equal(result.result.ok, true, `samples: ${JSON.stringify(samples)}`);
    assert.equal(third.held.size, 0);
  }
  // A type that is not audio is not stored as given, and a store that refuses is not fatal.
  const typed = await readEmbeddedSamples({ ...file, samples: [{ ...entry(ids.kick), type: 'text/html' }] });
  assert.equal(typed.samples[0].type, '');
  const full = await browser();
  full.samples.put = async () => { throw new Error('Sample storage is full.'); };
  const refused = await full.open({ ...file, samples: [entry(ids.kick)] });
  assert.deepEqual([refused.result.ok, refused.added, refused.dropped], [true, 0, 1]);
  full.samples.list = async () => { throw new Error('Sample storage unavailable'); };
  const closed = await full.open({ ...file, samples: [entry(ids.kick)] });
  assert.deepEqual([closed.result.ok, closed.added, closed.dropped], [true, 0, 1]);
});

test('base64 round trips, and refuses what is malformed or over the limit before decoding it', async () => {
  for (const length of [1, 2, 3, 4, 0x8000, 3 * 0x40000 - 1, 3 * 0x40000, 3 * 0x40000 + 1]) {
    const bytes = noise(length, length), text = await toBase64(bytes);
    assert.equal(text, Buffer.from(bytes).toString('base64'), `${length} bytes encode as standard base64`);
    assert.deepEqual(Buffer.from(await fromBase64(text, length) as Uint8Array).equals(Buffer.from(bytes)), true, `${length} bytes decode`);
    assert.equal(await fromBase64(text, length - 1), null, `${length} bytes are over a limit of ${length - 1}`);
  }
  for (const bad of ['', 'A', 'AAA', 'AA=A', '====', 'AAA*', 'AAAA\n', 'QQ==QQ==', ' AAA']) assert.equal(await fromBase64(bad, 100), null, JSON.stringify(bad));
});

test('sizes: a sample at the limit travels, one over it does not, and a file stays small enough to import', async () => {
  const first = await browser();
  const lanes = DRUM_INSTRUMENTS.slice(0, 5);
  const big = [1, 2, 3, 4].map(seed => noise(MAX_EMBEDDED_SAMPLE_BYTES, seed));
  const ids = [...big.map((bytes, index) => first.keep(bytes, `big ${index + 1}.wav`)), first.keep(noise(MAX_EMBEDDED_SAMPLE_BYTES + 1, 5), 'too big.wav')];
  for (const [index, id] of ids.entries()) await first.lane(lanes[index], id);
  const started = performance.now();
  const { file, skipped } = await first.save();
  // Three samples of 4 MB are the 12 MB a file may hold; the fourth and the oversized one are named.
  assert.deepEqual(file.samples.map((sample: EmbeddedSample) => sample.name), ['big 1.wav', 'big 2.wav', 'big 3.wav']);
  assert.deepEqual(skipped, ['big 4.wav', 'too big.wav']);
  assert.equal(3 * MAX_EMBEDDED_SAMPLE_BYTES, MAX_EMBEDDED_TOTAL_BYTES);
  const size = new Blob([JSON.stringify(file)]).size;
  assert.ok(size < MAX_PROJECT_FILE_BYTES, `a full file is ${size} bytes`);

  const second = await browser();
  const opened = await second.open(file);
  assert.deepEqual([opened.result.ok, opened.added, opened.dropped], [true, 3, 0]);
  for (const index of [0, 1, 2]) assert.ok(Buffer.from(second.held.get(ids[index])!.data).equals(Buffer.from(big[index])), `4 MB sample ${index + 1} is intact`);
  assert.ok(performance.now() - started < 60000);

  // A hand-made file cannot get past the limits the app keeps to when it saves.
  const one = file.samples[0].data as string;
  const greedy = { ...file, samples: ids.slice(0, 4).map(id => ({ id, name: 'x.wav', type: 'audio/wav', data: one })) };
  const third = await browser();
  const limited = await third.open(greedy);
  assert.deepEqual([limited.result.ok, limited.added, limited.dropped], [true, 1, 1], 'the fourth is over the total, and the three alike are stored once');
  const fourth = await browser();
  const distinct = await readEmbeddedSamples({ ...file, samples: [...file.samples, { id: ids[3], name: 'x.wav', type: 'audio/wav', data: await toBase64(big[3]) }] });
  assert.deepEqual([distinct.samples.length, distinct.dropped], [3, 1], 'a fourth 4 MB sample is over the total');
  assert.equal(fourth.held.size, 0);
  // Less room, as when the project itself is large, means fewer samples and never a larger file.
  const tight = await embedSamples(file.project, first.samples, MAX_EMBEDDED_SAMPLE_BYTES);
  assert.deepEqual([tight.samples.length, tight.skipped.length], [1, 4]);
});

test('audio is in a saved file and nowhere else: not the working copy, the library, versions, sync, links or published songs', async () => {
  const first = await browser();
  const audio = noise(6000);
  const id = first.keep(audio);
  await first.lane('kick', id);
  const { file } = await first.save();
  const marker = (file.samples[0].data as string).slice(0, 80);
  assert.ok(JSON.stringify(file).includes(marker));

  const second = await browser();
  const before = second.service.exportProject();
  assert.equal((await second.open(file)).result.ok, true);
  await second.service.request('/tempo', { method: 'POST', body: JSON.stringify({ tempo: 97 }) });
  second.service.flush();
  await new Promise(resolve => setTimeout(resolve, 10));
  const clean = (what: string, value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    assert.equal(text.includes(marker), false, `${what} holds no audio`);
    assert.equal(text.includes('"samples"'), false, `${what} has no samples list`);
    assert.ok(text.length < 200_000, `${what} is ${text.length} characters`);
  };
  clean('the working copy in localStorage', [...second.storage.values()].join(''));
  const records = await second.service.syncRecords();
  assert.ok(records && records.length >= 2);
  const record = records.find(entry => entry.id === second.service.snapshot().projectId)!;
  clean('the library', records);
  const versions = await second.service.listVersions();
  assert.ok(versions.length >= 1);
  clean('the version history', await Promise.all(versions.map(version => second.library.getVersion(version.id))));
  clean('the file sync uploads', second.service.fileFor(record));
  clean('the file a link, a published song and a sync are made from', second.service.exportProject());
  clean('a published song', slimProject(second.service.exportProject()));
  const payload = await encodeShare(second.service.exportProject());
  assert.ok(payload.length < 20_000, `a share link is ${payload.length} characters`);
  clean('a share link', await decodeShare(payload));

  // What sync compares is the project, which is the same whether its file carried audio or not.
  const { samples: _audio, ...bare } = file;
  const third = await browser();
  assert.equal((await third.open(bare)).result.ok, true);
  const content = async (b: Awaited<ReturnType<typeof browser>>) => {
    const { projectId: _id, name: _name, createdAt: _made, ...project } = b.service.normalized(b.service.exportProject().project) as Record<string, unknown>;
    return contentHash(project);
  };
  await third.service.request('/tempo', { method: 'POST', body: JSON.stringify({ tempo: 97 }) });
  assert.equal(await content(second), await content(third), 'the content hash does not see the audio');
  assert.equal(before.project.drumState.kick.sampleId, undefined);
});
