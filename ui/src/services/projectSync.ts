import { AccountError, accountsEnabled, currentUser, projectsApi, sharingApi, subscribeAccount, type ProjectsApi, type SharedProject, type SharingApi } from './account';
import { localService } from './localService';
import type { ProjectRecord } from './projectLibrary';

// Keeps the projects in this browser and the ones in the signed-in account in step.
//
// The browser copy is always the working copy; the account holds a copy of each project
// with a revision number. A save names the revision it was based on. If the account has
// moved on since (the project was edited in another browser), nothing is merged and
// nothing is overwritten: this browser's edits move to a project of their own and the
// account's version is downloaded beside it.
//
// A project shared by someone else is kept in step the same way, against the owner's copy
// instead of this account's. That is all working together is: two people saving one project
// in turns, with the same rule when they both change it at once.

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
  // Left out, nothing is ever asked about shared projects.
  sharing?: Pick<SharingApi, 'list' | 'get' | 'put' | 'leave'>;
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
  // Projects in this browser that someone else shared: whose each is, and who saved it last.
  shared: Record<string, { owner: string; savedBy: string }>;
  // Shared with this account and not opened in this browser yet. Nothing is downloaded until asked.
  offered: SharedProject[];
  // This account's own projects that are shared: with how many people, and who saved last.
  sharedByMe: Record<string, { people: number; savedBy: string }>;
  // Projects another person's save has just replaced here, and projects that stopped being shared.
  updates: Array<{ name: string; by: string }>;
  ended: string[];
}

interface Linked { revision: number; hash: string }
// Where the other copy of a project is: this account, or the account of whoever shared it.
interface Place {
  linked(id: string): Linked | undefined;
  link(id: string, linked: Linked): void;
  unlink(id: string): void;
  get(id: string): Promise<unknown>;
  put(entry: ProjectRecord, base: number): Promise<number | 'changed'>;
}
interface UserMeta {
  // Projects that belong to the account: the account revision last seen, and what this
  // browser's copy looked like then. A revision of 0 means "not uploaded yet".
  projects: Record<string, Linked>;
  // Synced projects deleted here, waiting to be deleted from the account.
  deleted: Record<string, number>;
  // Projects that were here before signing in and have not been added to the account.
  localOnly: string[];
  // Projects someone else shared that have been opened here, linked to the owner's copy.
  shared: Record<string, Linked & { owner: string }>;
  // Shared projects removed here, whose owners are still to be told this account has left.
  left: Record<string, string>;
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
  const NOTHING_SHARED = { shared: {}, offered: [], sharedByMe: {}, updates: [], ended: [] };
  let status: SyncStatus = { signedIn: false, state: 'idle', error: '', lastSyncedAt: 0, inAccount: [], browserOnly: [], problems: {}, keptBoth: [], ...NOTHING_SHARED };
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
    if (!found || typeof found !== 'object') return { meta: { projects: {}, deleted: {}, localOnly: [], shared: {}, left: {} }, fresh: true };
    return { meta: { projects: found.projects || {}, deleted: found.deleted || {}, localOnly: Array.isArray(found.localOnly) ? found.localOnly : [], shared: found.shared || {}, left: found.left || {} }, fresh: false };
  };
  const save = (username: string, meta: UserMeta) => {
    try { deps.storage.write(JSON.stringify({ ...readAll(), [username.toLowerCase()]: meta })); } catch { /* sync state is rebuilt next time */ }
  };

  const describe = (meta: UserMeta, records: ProjectRecord[]) => {
    const ids = records.map(entry => entry.id);
    setStatus({ inAccount: ids.filter(id => meta.projects[id]), browserOnly: ids.filter(id => !meta.projects[id] && !meta.shared[id]) });
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
      for (const entry of records) if (!meta.projects[entry.id] && !meta.shared[entry.id] && !meta.localOnly.includes(entry.id)) meta.localOnly.push(entry.id);
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
    // A project someone else shared is theirs, not this account's, however it got here.
    for (const entry of records) if (!meta.projects[entry.id] && !meta.shared[entry.id] && !meta.localOnly.includes(entry.id)) meta.projects[entry.id] = { revision: 0, hash: '' };

    const mine: Place = {
      linked: id => meta.projects[id],
      link: (id, linked) => { meta.projects[id] = linked; },
      unlink: (id) => { delete meta.projects[id]; },
      get: id => api.get(id),
      put: (entry, base) => api.put(entry.id, entry.name, base, store.fileFor(entry)),
    };
    const push = async (entry: ProjectRecord, base: number, place: Place = mine) => {
      const hash = await hashOf(entry);
      try {
        const revision = await place.put(entry, base);
        if (revision === 'changed') again = true;
        else place.link(entry.id, { revision, hash });
      } catch (error) {
        if (!(error instanceof AccountError) || (error.status !== 413 && error.status !== 507)) throw error;
        problems[entry.id] = error.message;
      }
    };
    const download = async (id: string, revision: number, file?: unknown, place: Place = mine) => {
      const received = await store.syncReceive(id, file ?? await place.get(id));
      if (received) place.link(id, { revision, hash: await hashOf(received) });
      return received;
    };
    const updates: SyncStatus['updates'] = [];
    // Brings one project and its other copy back in step, whichever side changed.
    const settle = async (there: { id: string; revision: number; savedBy?: string }, place: Place) => {
      const here = records!.find(entry => entry.id === there.id);
      if (!here) { await download(there.id, there.revision, undefined, place); return; }
      const linked = place.linked(there.id);
      if (!linked) return;
      const changedHere = linked.revision === 0 || await hashOf(here) !== linked.hash;
      if (there.revision === linked.revision) {
        if (changedHere) await push(here, there.revision, place);
        return;
      }
      let file: unknown;
      if (changedHere) {
        file = await place.get(there.id);
        const theirs = (file as { project?: unknown } | null)?.project;
        // Both sides can look changed and still be the same, for instance after an app update
        // that every browser applied on its own. That is not a conflict.
        if (theirs && await contentHash(store.normalized({ ...(theirs as object), name: here.name })) === await hashOf(here)) {
          place.link(there.id, { revision: there.revision, hash: await hashOf(here) });
          return;
        }
        // Changed in both places: keep both. The copy kept from here is this account's own.
        const forked = await store.syncFork(there.id, `${here.name.slice(0, 60 - KEPT_SUFFIX.length)}${KEPT_SUFFIX}`);
        if (!forked) return;
        place.unlink(there.id);
        meta.projects[forked] = { revision: 0, hash: '' };
        keptBoth.push(here.name);
      } else {
        // Check again right before replacing it, in case it was edited while this pass was waiting on the network.
        const latest = (await store.syncRecords())?.find(entry => entry.id === there.id);
        if (!latest || await hashOf(latest) !== linked.hash) { again = true; return; }
      }
      const received = await download(there.id, there.revision, file, place);
      // Worth saying when it was another person: their save has just replaced what was here.
      if (received && there.savedBy && there.savedBy.toLowerCase() !== username.toLowerCase()) updates.push({ name: received.name, by: there.savedBy });
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
      // Only the owner's saves are attributed when the project is shared with nobody.
      await settle(there.sharedWith ? there : { id: there.id, revision: there.revision }, mine);
    }

    records = await store.syncRecords() || [];
    for (const entry of records) {
      const linked = meta.projects[entry.id];
      if (linked && !remoteById.has(entry.id)) await push(entry, 0);
    }

    const ended: string[] = [];
    let theirs: SharedProject[] | null = null;
    if (deps.sharing) {
      try {
        theirs = await deps.sharing.list();
      } catch (error) {
        // A server from before sharing existed says "not found". That means nothing is shared,
        // and it must not be read as every shared project having been taken away.
        if (!(error instanceof AccountError) || error.status !== 404) throw error;
      }
    }
    if (deps.sharing && theirs) {
      const sharing = deps.sharing;
      for (const [id, owner] of Object.entries(meta.left)) {
        try { await sharing.leave(owner, id); } catch (error) { if (!(error instanceof AccountError) || error.status !== 404) throw error; }
        delete meta.left[id];
        theirs = theirs.filter(entry => entry.id !== id);
      }
      // No longer shared with this account: unshared, deleted, or its owner gone. The copy here
      // stays, as a project that is in this browser only.
      for (const [id, link] of Object.entries(meta.shared)) {
        if (theirs.some(entry => entry.id === id && entry.owner.toLowerCase() === link.owner.toLowerCase())) continue;
        delete meta.shared[id];
        const kept = records.find(entry => entry.id === id);
        if (kept) { meta.localOnly.push(id); ended.push(kept.name); }
      }
      for (const there of theirs) {
        const link = meta.shared[there.id];
        if (!link) continue;
        const owner = there.owner;
        try {
          await settle(there, {
            linked: id => meta.shared[id],
            link: (id, linked) => { meta.shared[id] = { ...linked, owner }; },
            unlink: () => { /* the owner's version is about to be downloaded under this id */ },
            get: id => sharing.get(owner, id),
            put: (entry, base) => sharing.put(owner, entry.id, entry.name, base, store.fileFor(entry)),
          });
        } catch (error) {
          // Unshared while this pass was at work: the next pass sees that and lets go of it.
          if (!(error instanceof AccountError) || error.status !== 404) throw error;
          again = true;
        }
      }
    }

    save(username, meta);
    describe(meta, await store.syncRecords() || records);
    const savedBy = new Map((theirs ?? []).map(entry => [entry.id, entry.savedBy]));
    setStatus({
      problems, keptBoth: keptBoth.length ? keptBoth : status.keptBoth, lastSyncedAt: Date.now(),
      shared: Object.fromEntries(Object.entries(meta.shared).map(([id, link]) => [id, { owner: link.owner, savedBy: savedBy.get(id) ?? link.owner }])),
      offered: (theirs ?? []).filter(entry => !meta.shared[entry.id]),
      sharedByMe: Object.fromEntries(remote.filter(entry => entry.sharedWith && !entry.deleted).map(entry => [entry.id, { people: entry.sharedWith!, savedBy: entry.savedBy ?? username }])),
      updates: updates.length ? updates : status.updates,
      ended: ended.length ? ended : status.ended,
    });
  }

  async function run() {
    for (let round = 0; round < 3; round++) {
      again = false;
      const username = deps.user();
      if (!username) { knownUser = null; started = true; setStatus({ signedIn: false, state: 'idle', error: '', inAccount: [], browserOnly: [], problems: {}, keptBoth: [], ...NOTHING_SHARED }); return; }
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
    dismissShared: () => setStatus({ updates: [], ended: [] }),
    // Opens a project someone shared in this browser, linked to the owner's copy. Resolves to
    // whether it arrived.
    join: async (owner: string, id: string): Promise<boolean> => {
      const username = deps.user();
      if (!username) return false;
      await running;
      // A project already here under that id is someone's work; it is not replaced.
      if ((await store.syncRecords())?.some(entry => entry.id === id)) return false;
      const { meta } = load(username);
      meta.shared[id] = { owner, revision: 0, hash: '' };
      delete meta.left[id];
      save(username, meta);
      await sync();
      return (await store.syncRecords())?.some(entry => entry.id === id) ?? false;
    },
    // Stops working on a shared project. The copy here stays, as a project of this browser only.
    leave: async (id: string) => {
      const username = deps.user();
      if (!username) return;
      await running;
      const { meta } = load(username);
      const link = meta.shared[id];
      if (!link) return;
      meta.left[id] = link.owner;
      delete meta.shared[id];
      if (!meta.localOnly.includes(id)) meta.localOnly.push(id);
      save(username, meta);
      await sync();
    },
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
      // Deleting a project someone else shared only removes it here and leaves; it is theirs.
      const link = meta.shared[id];
      if (link) { meta.left[id] = link.owner; delete meta.shared[id]; }
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
// With a project shared, the other person's save should not take two minutes to show up.
const CHECK_SHARED_EVERY_MS = 20_000;

export const projectSync = createProjectSync({
  store: localService,
  api: projectsApi,
  sharing: sharingApi,
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
  const check = () => {
    const { shared, sharedByMe } = projectSync.status();
    const together = Object.keys(shared).length + Object.keys(sharedByMe).length > 0;
    setTimeout(() => { if (!document.hidden) now(); check(); }, together ? CHECK_SHARED_EVERY_MS : CHECK_EVERY_MS);
  };
  check();
  void projectSync.sync();
}
