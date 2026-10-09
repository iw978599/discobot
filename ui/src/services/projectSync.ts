import { AccountError, accountsEnabled, currentUser, projectsApi, subscribeAccount, type ProjectsApi } from './account';
import { localService } from './localService';
import type { ProjectRecord } from './projectLibrary';

// Keeps the projects in this browser and the ones in the signed-in account in step.
//
// The browser copy is always the working copy; the account holds a copy of each project
// with a revision number. A save names the revision it was based on. If the account has
// moved on since (the project was edited in another browser), nothing is merged and
// nothing is overwritten: this browser's edits move to a project of their own and the
// account's version is downloaded beside it.

export interface SyncStore {
  syncRecords(): Promise<ProjectRecord[] | null>;
  syncReceive(id: string, file: unknown): Promise<ProjectRecord | null>;
  syncFork(id: string, name: string): Promise<string | null>;
  deleteProject(id: string): Promise<unknown>;
  fileFor(record: ProjectRecord): unknown;
  normalized(project: unknown): unknown;
}

export interface SyncDeps {
  store: SyncStore;
  api: ProjectsApi;
  user: () => string | null;
  storage: { read(): string | null; write(text: string): void };
}

export interface SyncStatus {
  signedIn: boolean;
  state: 'idle' | 'syncing' | 'error';
  error: string;
  lastSyncedAt: number;
  // Project ids by where they live.
  inAccount: string[];
  browserOnly: string[];
  // Per-project reasons a project could not be uploaded (too large, account full).
  problems: Record<string, string>;
  // Names of projects whose edits here were moved aside because the account had a newer version.
  keptBoth: string[];
}

interface Linked { revision: number; hash: string }
interface UserMeta {
  // Projects that belong to the account: the account revision last seen, and what this
  // browser's copy looked like then. A revision of 0 means "not uploaded yet".
  projects: Record<string, Linked>;
  // Synced projects deleted here, waiting to be deleted from the account.
  deleted: Record<string, number>;
  // Projects that were here before signing in and have not been added to the account.
  localOnly: string[];
}

const KEPT_SUFFIX = ' (this browser\'s version)';

// Two saves of an unchanged project must hash the same, so fields that change on every
// write, or just by looking at another scene, are left out.
export async function contentHash(project: unknown): Promise<string> {
  const { revision: _revision, updatedAt: _updatedAt, currentSceneId: _scene, ...content } = project as Record<string, unknown>;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createProjectSync(deps: SyncDeps) {
  const { store, api } = deps;
  const listeners = new Set<() => void>();
  let status: SyncStatus = { signedIn: false, state: 'idle', error: '', lastSyncedAt: 0, inAccount: [], browserOnly: [], problems: {}, keptBoth: [] };
  let running: Promise<void> | null = null;
  let again = false;
  let knownUser: string | null = null;
  let started = false;

  // Hashing means rebuilding the project, so remember the answer until the project is saved again.
  const hashes = new Map<string, { stamp: string; hash: string }>();
  const hashOf = async (entry: ProjectRecord) => {
    const stamp = `${entry.revision}:${entry.updatedAt}:${entry.name}`, known = hashes.get(entry.id);
    if (known?.stamp === stamp) return known.hash;
    const hash = await contentHash(store.normalized(entry.project));
    hashes.set(entry.id, { stamp, hash });
    return hash;
  };

  const setStatus = (patch: Partial<SyncStatus>) => { status = { ...status, ...patch }; listeners.forEach(listener => listener()); };

  const readAll = (): Record<string, UserMeta> => {
    try {
      const stored: unknown = JSON.parse(deps.storage.read() || '{}');
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, UserMeta> : {};
    } catch { return {}; }
  };
  const load = (username: string): { meta: UserMeta; fresh: boolean } => {
    const found = readAll()[username.toLowerCase()];
    if (!found || typeof found !== 'object') return { meta: { projects: {}, deleted: {}, localOnly: [] }, fresh: true };
    return { meta: { projects: found.projects || {}, deleted: found.deleted || {}, localOnly: Array.isArray(found.localOnly) ? found.localOnly : [] }, fresh: false };
  };
  const save = (username: string, meta: UserMeta) => {
    try { deps.storage.write(JSON.stringify({ ...readAll(), [username.toLowerCase()]: meta })); } catch { /* sync state is rebuilt next time */ }
  };

  const describe = (meta: UserMeta, records: ProjectRecord[]) => {
    const ids = records.map(entry => entry.id);
    setStatus({ inAccount: ids.filter(id => meta.projects[id]), browserOnly: ids.filter(id => !meta.projects[id]) });
  };

  async function pass(username: string) {
    const loaded = load(username);
    const meta = loaded.meta;
    let records = await store.syncRecords();
    // Another tab has unresolved changes: leave everything alone until the user has chosen.
    if (!records) return;
    const problems: Record<string, string> = {};
    const keptBoth: string[] = [];

    // Signing in never uploads what was already here; those projects wait to be added by hand.
    // A page that loads already signed in is not a sign-in: projects made since the last pass
    // are the account's.
    if (loaded.fresh || (started && knownUser !== username)) {
      for (const entry of records) if (!meta.projects[entry.id] && !meta.localOnly.includes(entry.id)) meta.localOnly.push(entry.id);
      save(username, meta);
    }
    knownUser = username;
    started = true;

    const remote = await api.list();
    const remoteById = new Map(remote.map(entry => [entry.id, entry]));

    for (const [id, base] of Object.entries(meta.deleted)) {
      const there = remoteById.get(id);
      // If it changed elsewhere since, the deletion is dropped and the newer version comes back.
      if (there && !there.deleted && there.revision === base && await api.remove(id, base) === 'removed') there.deleted = true;
      delete meta.deleted[id];
    }

    // Anything made since signing in belongs to the account.
    const present = new Set(records.map(entry => entry.id));
    meta.localOnly = meta.localOnly.filter(id => present.has(id));
    for (const entry of records) if (!meta.projects[entry.id] && !meta.localOnly.includes(entry.id)) meta.projects[entry.id] = { revision: 0, hash: '' };

    const push = async (entry: ProjectRecord, base: number) => {
      const hash = await hashOf(entry);
      try {
        const revision = await api.put(entry.id, entry.name, base, store.fileFor(entry));
        if (revision === 'changed') again = true;
        else meta.projects[entry.id] = { revision, hash };
      } catch (error) {
        if (!(error instanceof AccountError) || (error.status !== 413 && error.status !== 507)) throw error;
        problems[entry.id] = error.message;
      }
    };
    const download = async (id: string, revision: number, file?: unknown) => {
      const received = await store.syncReceive(id, file ?? await api.get(id));
      if (received) meta.projects[id] = { revision, hash: await hashOf(received) };
    };

    for (const there of remote) {
      const here = records.find(entry => entry.id === there.id);
      const linked = meta.projects[there.id];
      if (there.deleted) {
        if (!linked) continue;
        delete meta.projects[there.id];
        // Deleted elsewhere. Unsent edits here are kept, as a project that is no longer in the account.
        if (here && linked.revision > 0 && await hashOf(here) === linked.hash) await store.deleteProject(there.id);
        else if (here) meta.localOnly.push(there.id);
        continue;
      }
      if (!here) { await download(there.id, there.revision); continue; }
      if (!linked) continue;
      const changedHere = linked.revision === 0 || await hashOf(here) !== linked.hash;
      if (there.revision === linked.revision) {
        if (changedHere) await push(here, there.revision);
        continue;
      }
      let file: unknown;
      if (changedHere) {
        file = await api.get(there.id);
        const theirs = (file as { project?: unknown } | null)?.project;
        // Both sides can look changed and still be the same, for instance after an app update
        // that every browser applied on its own. That is not a conflict.
        if (theirs && await contentHash(store.normalized({ ...(theirs as object), name: here.name })) === await hashOf(here)) {
          meta.projects[there.id] = { revision: there.revision, hash: await hashOf(here) };
          continue;
        }
        // Changed in both places: keep both.
        const forked = await store.syncFork(there.id, `${here.name.slice(0, 60 - KEPT_SUFFIX.length)}${KEPT_SUFFIX}`);
        if (!forked) continue;
        delete meta.projects[there.id];
        meta.projects[forked] = { revision: 0, hash: '' };
        keptBoth.push(here.name);
      } else {
        // Check again right before replacing it, in case it was edited while this pass was waiting on the network.
        const latest = (await store.syncRecords())?.find(entry => entry.id === there.id);
        if (!latest || await hashOf(latest) !== linked.hash) { again = true; continue; }
      }
      await download(there.id, there.revision, file);
    }

    records = await store.syncRecords() || [];
    for (const entry of records) {
      const linked = meta.projects[entry.id];
      if (linked && !remoteById.has(entry.id)) await push(entry, 0);
    }

    save(username, meta);
    describe(meta, await store.syncRecords() || records);
    setStatus({ problems, keptBoth: keptBoth.length ? keptBoth : status.keptBoth, lastSyncedAt: Date.now() });
  }

  async function run() {
    for (let round = 0; round < 3; round++) {
      again = false;
      const username = deps.user();
      if (!username) { knownUser = null; started = true; setStatus({ signedIn: false, state: 'idle', error: '', inAccount: [], browserOnly: [], problems: {}, keptBoth: [] }); return; }
      setStatus({ signedIn: true, state: 'syncing', error: '' });
      try {
        await pass(username);
      } catch (error) {
        // A session that ended is not an error to show: the account service has already signed out.
        if (!deps.user()) { again = true; continue; }
        setStatus({ state: 'error', error: error instanceof Error ? error.message : 'Sync failed.' });
        return;
      }
      if (!again) break;
    }
    setStatus({ state: 'idle', signedIn: deps.user() !== null });
  }

  const sync = (): Promise<void> => {
    if (running) { again = true; return running; }
    running = run().finally(() => { running = null; });
    return running;
  };

  return {
    sync,
    status: () => status,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dismissKeptBoth: () => setStatus({ keptBoth: [] }),
    // Moves projects that were here before signing in into the account.
    addToAccount: async (ids: string[]) => {
      const username = deps.user();
      if (!username) return;
      await running;
      const { meta } = load(username);
      meta.localOnly = meta.localOnly.filter(id => !ids.includes(id));
      for (const id of ids) meta.projects[id] ??= { revision: 0, hash: '' };
      save(username, meta);
      await sync();
    },
    // Call after deleting a project here, so it is deleted from the account too. Sync never
    // infers a deletion from a project being absent: lost browser storage must not empty the account.
    noteDeleted: async (id: string) => {
      const username = deps.user();
      if (!username) return;
      await running;
      const { meta } = load(username);
      const linked = meta.projects[id];
      if (linked && linked.revision > 0) meta.deleted[id] = linked.revision;
      delete meta.projects[id];
      meta.localOnly = meta.localOnly.filter(entry => entry !== id);
      save(username, meta);
      await sync();
    },
  };
}

export type ProjectSync = ReturnType<typeof createProjectSync>;

const SYNC_KEY = 'discobot_sync_v1';
// How long after the last edit a project is uploaded, and how often to look for changes
// made elsewhere while the page is in view.
const UPLOAD_DELAY_MS = 3000;
const CHECK_EVERY_MS = 120_000;

export const projectSync = createProjectSync({
  store: localService,
  api: projectsApi,
  user: () => currentUser()?.username ?? null,
  storage: {
    read: () => { try { return localStorage.getItem(SYNC_KEY); } catch { return null; } },
    write: (text) => { localStorage.setItem(SYNC_KEY, text); },
  },
});

let watching = false;

// Starts syncing for this page. Signed out it does nothing and contacts nobody.
export function startProjectSync() {
  if (watching || !accountsEnabled || typeof window === 'undefined') return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const now = () => { if (currentUser()) void projectSync.sync(); };
  subscribeAccount(() => { void projectSync.sync(); });
  localService.subscribeWrites(() => {
    if (!currentUser()) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(now, UPLOAD_DELAY_MS);
  });
  window.addEventListener('online', now);
  document.addEventListener('visibilitychange', now);
  setInterval(() => { if (!document.hidden) now(); }, CHECK_EVERY_MS);
  void projectSync.sync();
}
