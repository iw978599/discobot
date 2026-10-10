import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryPresetStore, openPresets } from '../src/services/presetStore.ts';

const KEY = 'discobot_synth_presets_v1';
function oldStorage(value: string | null) {
  const items = new Map<string, string>(value === null ? [] : [[KEY, value]]);
  return { items, getItem: (key: string) => items.get(key) ?? null, removeItem: (key: string) => { items.delete(key); } };
}
const preset = (id: string, name: string) => ({ id, name, params: { gain: 0.5 } });

test('presets saved before they were kept in IndexedDB are moved there once, and nothing is lost', async () => {
  const store = createMemoryPresetStore();
  const legacy = oldStorage(JSON.stringify([preset('user-1', 'Keys'), preset('user-2', 'Bass'), 'junk', null, { name: 'no id' }]));
  assert.deepEqual(await openPresets(store, legacy), [preset('user-1', 'Keys'), preset('user-2', 'Bass')], 'the readable ones, in their order');
  assert.deepEqual(await store.load(), [preset('user-1', 'Keys'), preset('user-2', 'Bass')]);
  assert.equal(legacy.items.has(KEY), false, 'the old copy goes once the new one is written');

  // A second visit finds nothing to move and leaves the store alone.
  assert.deepEqual(await openPresets(store, legacy), [preset('user-1', 'Keys'), preset('user-2', 'Bass')]);

  // Another tab on the old version wrote the old place again: what is new there is added, not doubled.
  legacy.items.set(KEY, JSON.stringify([preset('user-2', 'Bass, older'), preset('user-3', 'Pad')]));
  assert.deepEqual((await openPresets(store, legacy)).map(entry => (entry as { name: string }).name), ['Keys', 'Bass', 'Pad'], 'the stored one wins over an old one with the same id');
});

test('the old copy is kept when it cannot be moved', async () => {
  const failing = { load: async () => [], save: async () => { throw new Error('storage is full'); } };
  const legacy = oldStorage(JSON.stringify([preset('user-1', 'Keys')]));
  await assert.rejects(openPresets(failing, legacy), /storage is full/);
  assert.equal(legacy.items.has(KEY), true);

  const unreadable = oldStorage('{not json');
  assert.deepEqual(await openPresets(createMemoryPresetStore(), unreadable), []);
  assert.equal(unreadable.items.has(KEY), true, 'something unreadable is left for a person to look at');
});

test('a store keeps the order it was given, and with no old storage there is nothing to move', async () => {
  const store = createMemoryPresetStore();
  await store.save([preset('b', 'Second saved'), preset('a', 'First saved')]);
  assert.deepEqual((await openPresets(store, null)).map(entry => (entry as { id: string }).id), ['b', 'a']);
  await store.save([]);
  assert.deepEqual(await store.load(), []);
});
