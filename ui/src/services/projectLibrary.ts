// Every project the user has, one record each. The open project also has a working copy
// in localStorage (see localService.ts), which is written synchronously and so survives a
// closing tab; this is where the rest live, without localStorage's size limit.

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // goes up by one on every save; a later sync uses it to notice a project changed elsewhere
  revision: number;
  project: unknown;
}

export type ProjectInfo = Pick<ProjectRecord, 'id' | 'name' | 'updatedAt'>;

export interface ProjectLibrary {
  list(): Promise<ProjectInfo[]>;
  get(id: string): Promise<ProjectRecord | undefined>;
  put(record: ProjectRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const newestFirst = (a: ProjectInfo, b: ProjectInfo) => b.updatedAt - a.updatedAt;

// Used where IndexedDB does not exist (some private windows, and tests). Nothing in it
// outlives the page.
export function createMemoryLibrary(): ProjectLibrary {
  const records = new Map<string, ProjectRecord>();
  return {
    list: async () => [...records.values()].map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort(newestFirst),
    get: async (id) => { const found = records.get(id); return found ? structuredClone(found) : undefined; },
    put: async (record) => { records.set(record.id, structuredClone(record)); },
    remove: async (id) => { records.delete(id); },
  };
}

export const hasIndexedDb = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

export function createIndexedDbLibrary(): ProjectLibrary {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('discobot-projects', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('projects', { keyPath: 'id' }); };
      request.onsuccess = () => {
        const database = request.result;
        const forget = () => { if (opening === attempt) opening = null; };
        database.onclose = forget;
        database.onversionchange = () => { database.close(); forget(); };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Project library unavailable'));
      request.onblocked = () => reject(new Error('Close other app tabs to upgrade the project library'));
    });
    opening = attempt;
    // A failed open must not be cached, or the library would stay broken until reload.
    attempt.catch(() => { if (opening === attempt) opening = null; });
    return attempt;
  };
  const run = async <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('projects', mode);
      const request = work(transaction.objectStore('projects'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error('Project library write failed'));
    });
  };
  return {
    list: async () => (await run<ProjectRecord[]>('readonly', store => store.getAll()))
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort(newestFirst),
    get: (id) => run<ProjectRecord | undefined>('readonly', store => store.get(id)),
    put: async (record) => { await run('readwrite', store => store.put(record)); },
    remove: async (id) => { await run('readwrite', store => store.delete(id)); },
  };
}
