import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_FILE_GRACE_MS, MAX_GUEST_FILE_BYTES, MAX_GUEST_FILES_TOTAL_BYTES,
  adoptGuestFiles, createMemoryGuestFiles, embedGuestFiles, guestFileId, guestFileIds, guestFileType, isGuestFileId, pruneGuestFiles, storeGuestFile, tidyGuestFiles,
} from '../src/services/guestFiles.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const GUEST = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const bytes = (...values: number[]) => new Uint8Array(values);
const project = (guestState: unknown, sceneStates: Record<string, unknown> = {}) => ({
  guests: [{ id: GUEST, url: 'https://example.com/', state: guestState }, { id: OTHER, url: 'https://example.org/' }],
  scenes: [{ id: 'scene-1', guests: sceneStates }],
});

test('a file is kept under the SHA-256 of its bytes, and the same bytes are kept once', async () => {
  const store = createMemoryGuestFiles();
  const first = await storeGuestFile(store, bytes(1, 2, 3).buffer, 'audio/wav', 1000);
  assert.ok(first.ok);
  assert.equal(first.file, 'discobot-file:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
  assert.ok(isGuestFileId(first.file));
  const again = await storeGuestFile(store, new Uint8Array([9, 1, 2, 3]).subarray(1), 'audio/ogg', 2000);
  assert.deepEqual(again, first, 'a view of the same bytes is the same file');
  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual({ type: listed[0].type, size: listed[0].size, storedAt: listed[0].storedAt }, { type: 'audio/wav', size: 3, storedAt: 2000 }, 'kept once, dated anew');
  assert.deepEqual([...new Uint8Array((await store.get(first.file))!.data)], [1, 2, 3]);
});

test('a file that is empty, too large, not bytes, or past what all guests may keep is refused', async () => {
  const store = createMemoryGuestFiles();
  for (const data of [new ArrayBuffer(0), new ArrayBuffer(MAX_GUEST_FILE_BYTES + 1), 'abc', [1, 2], null, { byteLength: 3 }]) {
    assert.deepEqual(await storeGuestFile(store, data, 'audio/wav'), { ok: false, error: 'too-large' });
  }
  await store.put({ id: await guestFileId(bytes(7)), type: 'audio/wav', size: MAX_GUEST_FILES_TOTAL_BYTES - 2, storedAt: 0, data: bytes(7).buffer });
  assert.deepEqual(await storeGuestFile(store, bytes(1, 2, 3), 'audio/wav'), { ok: false, error: 'full' });
  assert.ok((await storeGuestFile(store, bytes(1, 2), 'audio/wav')).ok, 'what still fits is kept');
  assert.deepEqual(await storeGuestFile({ ...createMemoryGuestFiles(), list: () => Promise.reject(new Error('no')) }, bytes(1), ''), { ok: false, error: 'unavailable' });
});

test('a file\'s type is kept only when it looks like one', () => {
  assert.equal(guestFileType('audio/WAV'), 'audio/wav');
  assert.equal(guestFileType('application/x-tape+json'), 'application/x-tape+json');
  for (const bad of ['', 'wav', 'audio/', '<script>/x', 7, undefined, 'a/'.padEnd(200, 'b')]) assert.equal(guestFileType(bad), 'application/octet-stream');
});

test('the files a project uses are the ids found as whole strings in its guests\' settings, in any scene', async () => {
  const a = await guestFileId(bytes(1)), b = await guestFileId(bytes(2)), c = await guestFileId(bytes(3));
  const used = project({ tapes: [{ file: a, name: 'loop' }], note: `not ${b}` }, { [GUEST]: { tapes: [b] }, [OTHER]: { deep: { deeper: [c] } } });
  assert.deepEqual(guestFileIds(used).sort(), [a, b, c].sort());
  assert.deepEqual(guestFileIds(used, GUEST).sort(), [a, b].sort(), 'one guest\'s own');
  assert.deepEqual(guestFileIds(used, OTHER), [c]);
  assert.deepEqual(guestFileIds(null), []);
  assert.deepEqual(guestFileIds({ guests: 'x', scenes: [null, 3] }), []);
});

test('files no project uses are cleared away once their grace is over, and never on a failed read', async () => {
  const store = createMemoryGuestFiles();
  const used = await storeGuestFile(store, bytes(1), 'audio/wav', 0), old = await storeGuestFile(store, bytes(2), 'audio/wav', 0);
  const fresh = await storeGuestFile(store, bytes(3), 'audio/wav', GUEST_FILE_GRACE_MS);
  assert.ok(used.ok && old.ok && fresh.ok);
  const now = GUEST_FILE_GRACE_MS + 1;
  await assert.rejects(tidyGuestFiles(async () => { throw new Error('unreadable'); }, store, now));
  assert.equal((await store.list()).length, 3, 'nothing went when a project could not be read');
  assert.equal(await tidyGuestFiles(async (visit) => { visit(project({ tape: used.file })); visit(null); }, store, now), 1);
  assert.deepEqual((await store.list()).map(file => file.id).sort(), [used.file, fresh.file].sort());
  assert.equal(await pruneGuestFiles(store, [], now + GUEST_FILE_GRACE_MS), 2);
});

test('a project file carries the files its guests use, and opening it keeps only those whose bytes match their id', async () => {
  const here = createMemoryGuestFiles();
  const tape = await storeGuestFile(here, bytes(5, 6, 7), 'audio/wav'), big = await storeGuestFile(here, new Uint8Array(100).fill(1), 'audio/wav');
  assert.ok(tape.ok && big.ok);
  const saved = project({ tapes: [tape.file, big.file, 'discobot-file:' + 'f'.repeat(64)] });
  const embedded = await embedGuestFiles(saved, here, 50);
  assert.deepEqual(embedded.files.map(file => file.id), [tape.file]);
  assert.equal(embedded.skipped, 1, 'one did not fit; the one not in this browser is not counted');
  assert.equal(embedded.files[0].data, 'BQYH');

  const there = createMemoryGuestFiles();
  const forged = { id: big.file, type: 'audio/wav', data: 'BQYH' };
  const unused = { id: await guestFileId(bytes(9)), type: 'audio/wav', data: 'CQ==' };
  const file = { format: 'discobot-project', project: saved, guestFiles: [...embedded.files, forged, unused, 'junk'] };
  const opened = await adoptGuestFiles(file, there);
  assert.deepEqual({ added: opened.added, dropped: opened.dropped }, { added: 1, dropped: 1 });
  assert.equal('guestFiles' in (opened.file as object), false, 'the file is handed on without them');
  assert.deepEqual((await there.list()).map(entry => entry.id), [tape.file]);
  assert.deepEqual(await adoptGuestFiles({ project: saved }, there), { file: { project: saved }, added: 0, dropped: 0 });
});

test('the store hands over every project in this browser, so a file used only by another project or a kept version stays', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } } });
  const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
    steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35, pan: 0 },
  }])) as DrumState;
  const effectsLoop: EffectsLoopState = {
    enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
    phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
    delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
  };
  const service = new LocalProjectService();
  service.initialize({ synthParams: createDefaultSynthParameters(), drumState: drums, drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop });
  await service.openLibrary(createMemoryLibrary());
  const store = createMemoryGuestFiles();
  const first = await storeGuestFile(store, bytes(1), 'audio/wav', 0), second = await storeGuestFile(store, bytes(2), 'audio/wav', 0);
  const stray = await storeGuestFile(store, bytes(3), 'audio/wav', 0);
  assert.ok(first.ok && second.ok && stray.ok);
  service.addGuest('https://example.com/deck/');
  const guestId = service.snapshot().guests[0].id;
  service.changeGuest(guestId, { state: { tape: first.file } });
  service.flush();
  await service.newProject('Another');
  service.addGuest('https://example.com/deck/');
  service.changeGuest(service.snapshot().guests[0].id, { state: { tape: second.file } });
  const removed = await tidyGuestFiles(visit => service.visitStoredProjects(visit), store, GUEST_FILE_GRACE_MS + 1);
  assert.equal(removed, 1);
  assert.deepEqual((await store.list()).map(file => file.id).sort(), [first.file, second.file].sort(), 'the open project\'s and the other project\'s stay');
});
