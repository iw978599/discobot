export interface SampleRecord {
  id: string;
  name: string;
  type: string;
  data: ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('discobot-samples', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('samples', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Sample storage unavailable'));
    request.onblocked = () => reject(new Error('Close other app tabs to upgrade sample storage'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('samples', mode);
    const request = operation(tx.objectStore('samples'));
    tx.oncomplete = () => { database.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { database.close(); reject(tx.error || request.error || new Error('Sample storage failed')); };
  });
}

export function listSamples(): Promise<SampleRecord[]> {
  return transaction('readonly', store => store.getAll());
}

export async function saveSample(file: File): Promise<SampleRecord> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Samples must be smaller than 50 MB');
  const sample = { id: crypto.randomUUID(), name: file.name, type: file.type, data: await file.arrayBuffer() };
  await transaction('readwrite', store => store.put(sample));
  return sample;
}

export async function deleteSample(id: string): Promise<void> {
  await transaction('readwrite', store => store.delete(id));
}
