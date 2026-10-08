export interface SampleRecord {
  id: string;
  name: string;
  type: string;
  data: ArrayBuffer;
}

const AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/mpeg',
  'audio/ogg',
  'audio/flac',
  'audio/x-m4a',
  'audio/mp4',
]);

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a']);

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('discobot-samples', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('samples', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Sample storage unavailable'));
    request.onblocked = () => reject(new Error('Close other app tabs to upgrade sample storage'));
  });
  return dbPromise;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (isQuotaError(error)) {
    return 'Sample storage is full. Delete some samples to free up space.';
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('samples', mode);
    const request = operation(tx.objectStore('samples'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error(getErrorMessage(tx.error || request.error, 'Sample storage failed')));
  });
}

export function listSamples(): Promise<SampleRecord[]> {
  return transaction('readonly', store => store.getAll());
}

export async function saveSample(file: File): Promise<SampleRecord> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Samples must be smaller than 50 MB');
  const isAudioMime = AUDIO_MIME_TYPES.has(file.type);
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const isAudioExt = AUDIO_EXTENSIONS.has(ext);
  if (!isAudioMime && !isAudioExt) {
    throw new Error('Only audio files are supported (WAV, MP3, OGG, FLAC, M4A)');
  }
  const sample: SampleRecord = { id: crypto.randomUUID(), name: file.name, type: file.type, data: await file.arrayBuffer() };
  try {
    await transaction('readwrite', store => store.put(sample));
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to save sample'));
  }
  return sample;
}

export async function getSample(id: string): Promise<AudioBuffer> {
  const record = await transaction('readonly', store => store.get(id)) as SampleRecord | undefined;
  if (!record) throw new Error('Sample not found');
  const audioContext = new AudioContext();
  try {
    return await audioContext.decodeAudioData(record.data);
  } finally {
    audioContext.close();
  }
}

export async function deleteSample(id: string): Promise<void> {
  await transaction('readwrite', store => store.delete(id));
}

export function close(): void {
  if (dbPromise) {
    dbPromise.then(db => db.close()).catch(() => {});
    dbPromise = null;
  }
}
