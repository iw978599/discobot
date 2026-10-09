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

// An earlier state of a project, kept so a mistake that undo cannot reach can be taken back.
export type VersionReason = 'opened' | 'auto' | 'before-sync' | 'before-restore';
export interface VersionRecord {
  id: string;
  projectId: string;
  at: number;
  name: string;
  reason: VersionReason;
  project: unknown;
}
export type VersionInfo = Omit<VersionRecord, 'project'>;

export interface ProjectLibrary {
  list(): Promise<ProjectInfo[]>;
  get(id: string): Promise<ProjectRecord | undefined>;
  put(record: ProjectRecord): Promise<void>;
  remove(id: string): Promise<void>;
  // Versions of one project, newest first.
  listVersions(projectId: string): Promise<VersionInfo[]>;
  getVersion(id: string): Promise<VersionRecord | undefined>;
  putVersion(version: VersionRecord): Promise<void>;
  removeVersion(id: string): Promise<void>;
}

const newestFirst = (a: ProjectInfo, b: ProjectInfo) => b.updatedAt - a.updatedAt;
const latestFirst = (a: VersionInfo, b: VersionInfo) => b.at - a.at;
const info = ({ project: _project, ...rest }: VersionRecord): VersionInfo => rest;

// Used where IndexedDB does not exist (some private windows, and tests). Nothing in it
// outlives the page.
export function createMemoryLibrary(): ProjectLibrary {
  const records = new Map<string, ProjectRecord>();
  const versions = new Map<string, VersionRecord>();
  return {
    list: async () => [...records.values()].map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort(newestFirst),
    get: async (id) => { const found = records.get(id); return found ? structuredClone(found) : undefined; },
    put: async (record) => { records.set(record.id, structuredClone(record)); },
    remove: async (id) => { records.delete(id); },
    listVersions: async (projectId) => [...versions.values()].filter(version => version.projectId === projectId).map(info).sort(latestFirst),
    getVersion: async (id) => { const found = versions.get(id); return found ? structuredClone(found) : undefined; },
    putVersion: async (version) => { versions.set(version.id, structuredClone(version)); },
    removeVersion: async (id) => { versions.delete(id); },
  };
}

export const hasIndexedDb = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

export function createIndexedDbLibrary(): ProjectLibrary {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (opening) return opening;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('discobot-projects', 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
        // Added in version 2.
        if (!database.objectStoreNames.contains('versions')) database.createObjectStore('versions', { keyPath: 'id' }).createIndex('project', 'projectId');
      };
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
  const run = async <T,>(name: 'projects' | 'versions', mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const request = work(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error('Project library write failed'));
    });
  };
  return {
    list: async () => (await run<ProjectRecord[]>('projects', 'readonly', store => store.getAll()))
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort(newestFirst),
    get: (id) => run<ProjectRecord | undefined>('projects', 'readonly', store => store.get(id)),
    put: async (record) => { await run('projects', 'readwrite', store => store.put(record)); },
    remove: async (id) => { await run('projects', 'readwrite', store => store.delete(id)); },
    listVersions: async (projectId) => (await run<VersionRecord[]>('versions', 'readonly', store => store.index('project').getAll(projectId))).map(info).sort(latestFirst),
    getVersion: (id) => run<VersionRecord | undefined>('versions', 'readonly', store => store.get(id)),
    putVersion: async (version) => { await run('versions', 'readwrite', store => store.put(version)); },
    removeVersion: async (id) => { await run('versions', 'readwrite', store => store.delete(id)); },
  };
}
