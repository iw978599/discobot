import { hasIndexedDb } from './projectLibrary';

// Where the user's own synth presets are kept: IndexedDB, like projects and samples. They used
// to be in localStorage, which is small and shared with the open project's working copy.
// What comes out of a store is unchecked; the caller sanitizes it like anything else read from storage.

export interface PresetStore {
  load(): Promise<unknown[]>;
  // Replaces everything stored with this list, keeping its order.
  save(presets: Array<{ id: string }>): Promise<void>;
}

const LEGACY_KEY = 'discobot_synth_presets_v1';

export function createMemoryPresetStore(): PresetStore {
  let kept: unknown[] = [];
  return {
    load: async () => structuredClone(kept),
    save: async (presets) => { kept = structuredClone(presets); },
  };
}

// For a browser with no IndexedDB (some private windows): where presets have always been.
export function createLocalStoragePresetStore(): PresetStore {
  return {
    load: async () => {
      const stored: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      return Array.isArray(stored) ? stored : [];
    },
    save: async (presets) => { localStorage.setItem(LEGACY_KEY, JSON.stringify(presets)); },
  };
}

export function createIndexedDbPresetStore(): PresetStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('discobot-presets', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('presets', { keyPath: 'id' }); };
      request.onsuccess = () => {
        const database = request.result;
        const forget = () => { if (opening === attempt) opening = null; };
        database.onclose = forget;
        database.onversionchange = () => { database.close(); forget(); };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Preset storage unavailable'));
      request.onblocked = () => reject(new Error('Close other app tabs to upgrade preset storage'));
    });
    opening = attempt;
    // A failed open must not be cached, or presets would stay unreadable until reload.
    attempt.catch(() => { if (opening === attempt) opening = null; });
    return attempt;
  };
  const run = async <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('presets', mode);
      const request = work(transaction.objectStore('presets'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request?.error || new Error('Preset storage failed'));
    });
  };
  return {
    load: async () => {
      const records = await run<Array<{ position?: number }>>('readonly', store => store.getAll()) ?? [];
      return records.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(({ position: _position, ...preset }) => preset);
    },
    // One transaction, so a list is never left half replaced.
    save: async (presets) => {
      await run('readwrite', (store) => {
        store.clear();
        presets.forEach((preset, position) => store.put({ ...preset, position }));
        return null;
      });
    },
  };
}

// The stored presets, after moving any from localStorage into the store. The old copy is only
// removed once the new one has been written, so a failure part-way loses nothing.
export async function openPresets(store: PresetStore, legacy: Pick<Storage, 'getItem' | 'removeItem'> | null): Promise<unknown[]> {
  const stored = await store.load();
  if (!legacy) return stored;
  let old: unknown = null;
  try { old = JSON.parse(legacy.getItem(LEGACY_KEY) || 'null'); } catch { /* unreadable: left where it is */ }
  if (!Array.isArray(old)) return stored;
  const have = new Set(stored.map(preset => (preset as { id?: unknown } | null)?.id));
  const moved = old.filter((preset): preset is { id: string } => Boolean(preset) && typeof preset.id === 'string' && !have.has(preset.id));
  const all = [...stored, ...moved];
  if (moved.length > 0) await store.save(all as Array<{ id: string }>);
  legacy.removeItem(LEGACY_KEY);
  return all;
}

export const presetStore: PresetStore = hasIndexedDb() ? createIndexedDbPresetStore() : createLocalStoragePresetStore();

export function loadStoredPresets(): Promise<unknown[]> {
  let legacy: Storage | null = null;
  // Without IndexedDB the store is localStorage itself, and there is nothing to move.
  try { if (hasIndexedDb()) legacy = localStorage; } catch { /* storage is blocked */ }
  return openPresets(presetStore, legacy);
}
