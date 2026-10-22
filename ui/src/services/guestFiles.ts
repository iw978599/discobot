import { record } from './projectSanitization';
import { fromBase64, toBase64 } from './projectSamples';

// Files a guest instrument keeps with a project (the protocol's optional `files`): recordings
// too large for its settings, such as Tape Loop Deck's tapes. A guest hands Discobot the bytes
// and gets back an id, which it keeps as a whole string anywhere in its settings. The id is the
// file's SHA-256, so the same file is stored once, and one that arrives in a project file can be
// checked against its bytes. Discobot never looks inside a file.
//
// Like a lane's sample, a guest's file stays in this browser and travels only in a saved project
// file: never in the project itself, so never in sync, links, published songs or live sessions.

export const GUEST_FILE_PREFIX = 'discobot-file:';
const FILE_ID = /^discobot-file:[0-9a-f]{64}$/;
export const isGuestFileId = (value: unknown): value is string => typeof value === 'string' && FILE_ID.test(value);

export const MAX_GUEST_FILE_BYTES = 8 * 1024 * 1024;
// All guests' files in this browser together, so a guest cannot fill the space projects need.
export const MAX_GUEST_FILES_TOTAL_BYTES = 256 * 1024 * 1024;
// A file no project refers to is kept this long after it was stored, then cleared away: a guest
// stores a file before Discobot next asks for its settings, and the tab may close in between.
export const GUEST_FILE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EMBEDDED_GUEST_FILES = 64;

export interface GuestFileInfo { id: string; type: string; size: number; storedAt: number }
export interface GuestFile extends GuestFileInfo { data: ArrayBuffer }

export interface GuestFileStore {
  list(): Promise<GuestFileInfo[]>;
  get(id: string): Promise<GuestFile | undefined>;
  put(file: GuestFile): Promise<void>;
  remove(id: string): Promise<void>;
}

const TYPE = /^[a-z0-9][\w.+-]{0,40}\/[\w.+-]{1,80}$/i;
export const guestFileType = (value: unknown) => (typeof value === 'string' && TYPE.test(value) ? value.toLowerCase() : 'application/octet-stream');

// The bytes of whatever a guest sent: an ArrayBuffer or a view of one. Anything else is null.
export function guestFileBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export async function guestFileId(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return GUEST_FILE_PREFIX + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Every file id in a value, found as whole strings. Settings are capped in size, so this is bounded.
function idsIn(value: unknown, found: Set<string>, depth = 0) {
  if (isGuestFileId(value)) found.add(value);
  else if (depth < 64 && value && typeof value === 'object') for (const entry of Object.values(value)) idsIn(entry, found, depth + 1);
}

// The files a project's guests refer to, in their project-wide settings and in every scene's;
// only one guest's when `guestId` is given.
export function guestFileIds(project: unknown, guestId?: string): string[] {
  const found = new Set<string>(), input = record(project);
  for (const guest of Array.isArray(input.guests) ? input.guests : []) {
    if (guestId === undefined || record(guest).id === guestId) idsIn(record(guest).state, found);
  }
  for (const scene of Array.isArray(input.scenes) ? input.scenes : []) {
    for (const [id, state] of Object.entries(record(record(scene).guests))) if (guestId === undefined || id === guestId) idsIn(state, found);
  }
  return [...found];
}

export type StoreAnswer = { ok: true; file: string } | { ok: false; error: 'too-large' | 'full' | 'unavailable' };

// Keeps a guest's file and answers its id. A file already kept is the same bytes, dated anew.
export async function storeGuestFile(store: GuestFileStore, data: unknown, type: unknown, now = Date.now()): Promise<StoreAnswer> {
  const bytes = guestFileBytes(data);
  if (!bytes || bytes.byteLength < 1 || bytes.byteLength > MAX_GUEST_FILE_BYTES) return { ok: false, error: 'too-large' };
  try {
    const id = await guestFileId(bytes), kept = await store.list(), twin = kept.find(file => file.id === id);
    if (!twin && kept.reduce((total, file) => total + file.size, 0) + bytes.byteLength > MAX_GUEST_FILES_TOTAL_BYTES) return { ok: false, error: 'full' };
    await store.put({ id, type: twin?.type ?? guestFileType(type), size: bytes.byteLength, storedAt: now, data: bytes.slice().buffer });
    return { ok: true, file: id };
  } catch (error) {
    return { ok: false, error: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'full' : 'unavailable' };
  }
}

// Clears away files that no project in this browser refers to (`kept`), once their grace is over.
export async function pruneGuestFiles(store: GuestFileStore, kept: Iterable<string>, now = Date.now()): Promise<number> {
  const wanted = new Set(kept);
  let removed = 0;
  for (const file of await store.list()) {
    if (wanted.has(file.id) || now - file.storedAt < GUEST_FILE_GRACE_MS) continue;
    await store.remove(file.id);
    removed++;
  }
  return removed;
}

// Clears away this browser's guest files that no project here uses. Run once, a while after
// start-up; any failure to read a project leaves every file where it is.
export async function tidyGuestFiles(visitProjects: (visit: (project: unknown) => void) => Promise<void>, store: GuestFileStore = browserGuestFiles(), now = Date.now()): Promise<number> {
  if ((await store.list()).length === 0) return 0;
  const used = new Set<string>();
  await visitProjects(project => { for (const id of guestFileIds(project)) used.add(id); });
  return pruneGuestFiles(store, used, now);
}

// ---- in a saved project file, as `guestFiles` beside `samples` (see projectSamples.ts)

export interface EmbeddedGuestFile { id: string; type: string; data: string }

// The files to put in a project file, up to `room` bytes. One that is not in this browser is
// left out, as it is already missing here; `skipped` counts those that did not fit.
export async function embedGuestFiles(project: unknown, store: GuestFileStore, room: number): Promise<{ files: EmbeddedGuestFile[]; skipped: number }> {
  const files: EmbeddedGuestFile[] = [];
  let skipped = 0;
  for (const id of guestFileIds(project).slice(0, MAX_EMBEDDED_GUEST_FILES)) {
    const kept = await store.get(id);
    if (!kept) continue;
    if (kept.data.byteLength > room) { skipped++; continue; }
    room -= kept.data.byteLength;
    files.push({ id, type: kept.type, data: await toBase64(new Uint8Array(kept.data)) });
  }
  return { files, skipped };
}

// Stores the files a project file brought, and returns the file without them. Everything in a
// file is untrusted: an entry no guest of the project refers to is ignored, and one whose bytes
// are not what its id says is dropped. This never throws.
export async function adoptGuestFiles(file: unknown, store: GuestFileStore, now = Date.now()): Promise<{ file: unknown; added: number; dropped: number }> {
  const input = record(file);
  if (!Array.isArray(input.guestFiles)) return { file, added: 0, dropped: 0 };
  const { guestFiles: entries, ...rest } = input as Record<string, unknown> & { guestFiles: unknown[] };
  const wanted = new Set(guestFileIds(input.project));
  let added = 0, dropped = 0;
  for (const value of entries.slice(0, MAX_EMBEDDED_GUEST_FILES)) {
    const entry = record(value), id = entry.id;
    if (!isGuestFileId(id) || !wanted.delete(id)) continue;
    const bytes = typeof entry.data === 'string' ? await fromBase64(entry.data, MAX_GUEST_FILE_BYTES) : null;
    if (!bytes || await guestFileId(bytes).catch(() => '') !== id) { dropped++; continue; }
    const answer = await storeGuestFile(store, bytes, entry.type, now);
    if (answer.ok) added++; else dropped++;
  }
  return { file: rest, added, dropped };
}

// ---- the browser's store

export function createMemoryGuestFiles(): GuestFileStore {
  const files = new Map<string, GuestFile>();
  return {
    async list() { return [...files.values()].map(({ data: _data, ...info }) => info); },
    async get(id) { return files.get(id); },
    async put(file) { files.set(file.id, file); },
    async remove(id) { files.delete(id); },
  };
}

// Two stores: `info` is small and read whole to add up sizes and clear away old files; `data`
// holds the bytes and is read one file at a time.
function createIndexedDbGuestFiles(): GuestFileStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('discobot-guest-files', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('info', { keyPath: 'id' });
        request.result.createObjectStore('data');
      };
      request.onsuccess = () => {
        const database = request.result;
        const forget = () => { if (opening === attempt) opening = null; };
        database.onclose = forget;
        database.onversionchange = () => { database.close(); forget(); };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Guest file storage unavailable'));
      request.onblocked = () => reject(new Error('Close other app tabs to upgrade guest file storage'));
    });
    opening = attempt;
    attempt.catch(() => { if (opening === attempt) opening = null; });
    return attempt;
  };
  const run = async <T>(mode: IDBTransactionMode, work: (info: IDBObjectStore, data: IDBObjectStore) => IDBRequest<T> | void): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(['info', 'data'], mode);
      const request = work(tx.objectStore('info'), tx.objectStore('data'));
      tx.oncomplete = () => resolve(request ? request.result : undefined as T);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Guest file storage failed'));
    });
  };
  return {
    list: () => run<GuestFileInfo[]>('readonly', info => info.getAll()),
    async get(id) {
      const database = await open();
      return new Promise<GuestFile | undefined>((resolve, reject) => {
        const tx = database.transaction(['info', 'data'], 'readonly');
        const about = tx.objectStore('info').get(id), bytes = tx.objectStore('data').get(id);
        tx.oncomplete = () => resolve(about.result && bytes.result instanceof ArrayBuffer ? { ...about.result as GuestFileInfo, data: bytes.result } : undefined);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Guest file storage failed'));
      });
    },
    put: ({ data, ...about }) => run<void>('readwrite', (info, bytes) => { info.put(about); bytes.put(data, about.id); }),
    remove: id => run<void>('readwrite', (info, bytes) => { info.delete(id); bytes.delete(id); }),
  };
}

let browserStore: GuestFileStore | null = null;
export function browserGuestFiles(): GuestFileStore {
  browserStore ??= typeof indexedDB !== 'undefined' && indexedDB !== null ? createIndexedDbGuestFiles() : createMemoryGuestFiles();
  return browserStore;
}
