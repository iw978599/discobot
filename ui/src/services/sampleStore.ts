export interface SampleRecord {
  id: string;
  name: string;
  type: string;
  data: ArrayBuffer;
}

const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a']);

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('discobot-samples', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('samples', { keyPath: 'id' }); };
    request.onsuccess = () => {
      const database = request.result;
      // Drop the cached handle when the browser closes it or another tab needs to upgrade.
      const forget = () => { if (dbPromise === opening) dbPromise = null; };
      database.onclose = forget;
      database.onversionchange = () => { database.close(); forget(); };
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('Sample storage unavailable'));
    request.onblocked = () => reject(new Error('Close other app tabs to upgrade sample storage'));
  });
  dbPromise = opening;
  // A failed open must not be cached, or storage would stay broken until reload.
  opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
  return opening;
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Sample storage is full. Delete some samples to free up space.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('samples', mode);
    const request = operation(tx.objectStore('samples'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error(describeError(tx.error || request.error, 'Sample storage failed')));
  });
}

export function listSamples(): Promise<SampleRecord[]> {
  return transaction('readonly', store => store.getAll());
}

export function getSample(id: string): Promise<SampleRecord | undefined> {
  return transaction('readonly', store => store.get(id));
}

export function isAudioFile(file: { name: string; type: string }): boolean {
  if (file.type.startsWith('audio/')) return true;
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 && AUDIO_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

export async function saveSample(file: File): Promise<SampleRecord> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Samples must be smaller than 50 MB');
  if (!isAudioFile(file)) throw new Error('Only audio files are supported (WAV, MP3, OGG, FLAC, M4A)');
  const sample: SampleRecord = { id: crypto.randomUUID(), name: file.name, type: file.type, data: await file.arrayBuffer() };
  await transaction('readwrite', store => store.put(sample));
  return sample;
}

export async function deleteSample(id: string): Promise<void> {
  await transaction('readwrite', store => store.delete(id));
}
