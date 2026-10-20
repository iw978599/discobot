// Signing in is optional. Without an API address the app has no account features at all,
// and signed out it never contacts the API: the first request is the one the user asks for.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
export const API_URL = (env?.VITE_API_URL || '').replace(/\/+$/, '');
export const accountsEnabled = API_URL !== '';

const SESSION_KEY = 'discobot_session_v1';

export interface AccountUser { username: string; owner: boolean; createdAt: number }
export interface Invite { code: string; createdAt: number; usedAt: number | null; usedBy: string | null }
export interface Member { username: string; owner: boolean; createdAt: number }
interface Session { token: string; user: AccountUser }

export class AccountError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function readSession(): Session | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    const session = stored as Session | null;
    if (session && typeof session.token === 'string' && typeof session.user?.username === 'string') {
      return { token: session.token, user: { username: session.user.username, owner: session.user.owner === true, createdAt: Number(session.user.createdAt) || 0 } };
    }
  } catch { /* no usable session */ }
  return null;
}

let session: Session | null = typeof localStorage === 'undefined' || !accountsEnabled ? null : readSession();
const listeners = new Set<() => void>();

function setSession(next: Session | null) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* signed in for this page only */ }
  listeners.forEach(listener => listener());
}

export const subscribeAccount = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const currentUser = () => session?.user ?? null;

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signedIn = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (signedIn && session) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new AccountError('The account server could not be reached. Check your connection and try again.', 0);
  }
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    // The server no longer knows this browser: forget the session here too.
    if (response.status === 401 && signedIn && session) setSession(null);
    throw new AccountError(data.error || 'Something went wrong. Try again.', response.status);
  }
  return data as T;
}

// `sharedWith` and `savedBy` are only there for a project the account has shared with someone.
export interface RemoteProject { id: string; name: string; revision: number; updatedAt: number; deleted: boolean; sharedWith?: number; savedBy?: string }
// A project someone else has shared with this account. It stays in the owner's account.
export interface SharedProject { owner: string; id: string; name: string; revision: number; updatedAt: number; savedBy: string }

// A refused save or delete is an answer, not a failure: the project changed somewhere else.
const unlessChanged = async <T,>(work: Promise<T>): Promise<T | 'changed'> => {
  try { return await work; } catch (error) { if (error instanceof AccountError && error.status === 409) return 'changed'; throw error; }
};

export const projectsApi = {
  list: async () => (await call<{ projects: RemoteProject[] }>('GET', '/projects')).projects,
  get: async (id: string) => (await call<{ project: unknown }>('GET', `/projects/${id}`)).project,
  put: (id: string, name: string, baseRevision: number, project: unknown) =>
    unlessChanged(call<{ revision: number }>('PUT', `/projects/${id}`, { name, baseRevision, project }).then(result => result.revision)),
  remove: (id: string, baseRevision: number) => unlessChanged(call('POST', `/projects/${id}/delete`, { baseRevision }).then(() => 'removed' as const)),
};
export type ProjectsApi = typeof projectsApi;

// Working on a project with someone else, in turns: the owner shares it by username, and the
// people it is shared with read and save the owner's copy under the same revision rule.
export const sharingApi = {
  list: async () => (await call<{ projects: SharedProject[] }>('GET', '/shared')).projects,
  get: async (owner: string, id: string) => (await call<{ project: unknown }>('GET', `/shared/${encodeURIComponent(owner)}/${id}`)).project,
  put: (owner: string, id: string, name: string, baseRevision: number, project: unknown) =>
    unlessChanged(call<{ revision: number }>('PUT', `/shared/${encodeURIComponent(owner)}/${id}`, { name, baseRevision, project }).then(result => result.revision)),
  leave: async (owner: string, id: string) => { await call('POST', `/shared/${encodeURIComponent(owner)}/${id}/leave`, {}); },
  // The owner's side.
  members: async (id: string) => (await call<{ members: string[] }>('GET', `/projects/${id}/sharing`)).members,
  share: async (id: string, username: string) => { await call('POST', `/projects/${id}/share`, { username }); },
  unshare: async (id: string, username: string) => { await call('POST', `/projects/${id}/unshare`, { username }); },
};
export type SharingApi = typeof sharingApi;

export interface PublishedSong { code: string; projectId: string; title: string; updatedAt: number }
export interface SongPage { title: string; author: string; updatedAt: number; project: unknown }

export interface ListedSong { code: string; title: string; updatedAt: number }
export interface UserSongs { author: string; songs: ListedSong[] }

// A list of someone's songs is text from other people, by way of the server: keep only what a
// list of songs is, and cap its size. The name shown is the one asked for unless the server
// gives the same name back in the publisher's own capitals.
export function readUserSongs(answer: unknown, asked: string): UserSongs {
  const data = (answer && typeof answer === 'object' ? answer : {}) as { author?: unknown; songs?: unknown };
  const songs = (Array.isArray(data.songs) ? data.songs as unknown[] : []).slice(0, 50).flatMap((entry): ListedSong[] => {
    const song = (entry && typeof entry === 'object' ? entry : {}) as { code?: unknown; title?: unknown; updatedAt?: unknown };
    if (typeof song.code !== 'string' || !/^[a-z0-9]{10}$/.test(song.code) || typeof song.title !== 'string') return [];
    return [{ code: song.code, title: song.title.slice(0, 60), updatedAt: typeof song.updatedAt === 'number' && Number.isFinite(song.updatedAt) ? song.updatedAt : 0 }];
  });
  return { author: typeof data.author === 'string' && data.author.toLowerCase() === asked.toLowerCase() ? data.author : asked, songs };
}

export const songsApi = {
  // Needs no account either: this is what opening the link to someone's page does.
  by: async (username: string) => readUserSongs(await call<unknown>('GET', `/users/${encodeURIComponent(username)}/songs`, undefined, false), username),
  // Needs no account: this is what opening a short link does.
  get: (code: string) => call<SongPage>('GET', `/songs/${encodeURIComponent(code)}`, undefined, false),
  mine: async () => (await call<{ songs: PublishedSong[] }>('GET', '/songs')).songs,
  publish: async (projectId: string, title: string, project: unknown) => (await call<{ code: string }>('POST', '/songs', { projectId, title, project })).code,
  unpublish: async (code: string) => { await call('POST', `/songs/${encodeURIComponent(code)}/delete`, {}); },
};

type Started = { token: string; user: AccountUser; recoveryCode?: string };
const start = (result: Started) => { setSession({ token: result.token, user: result.user }); return result.recoveryCode ?? ''; };

export const account = {
  // Each of these resolves to the new recovery code, which the server shows once.
  signUp: async (username: string, password: string, invite: string) => start(await call<Started>('POST', '/signup', { username, password, invite }, false)),
  recover: async (username: string, recoveryCode: string, newPassword: string) => start(await call<Started>('POST', '/recover', { username, recoveryCode, newPassword }, false)),
  newRecoveryCode: async (password: string) => (await call<{ recoveryCode: string }>('POST', '/recovery-code', { password })).recoveryCode,

  signIn: async (username: string, password: string) => { start(await call<Started>('POST', '/signin', { username, password }, false)); },
  // Confirms the session is still good and picks up changes such as becoming the owner.
  refresh: async () => {
    if (!session) return;
    const { user } = await call<{ user: AccountUser }>('GET', '/me');
    if (session) setSession({ token: session.token, user });
  },
  signOut: async () => {
    // Signing out always works here, even when the server cannot be told.
    try { await call('POST', '/signout', {}); } catch { /* the session expires on its own */ }
    setSession(null);
  },
  signOutEverywhere: async () => { await call('POST', '/signout-everywhere', {}); setSession(null); },
  changePassword: async (currentPassword: string, newPassword: string) => { await call('POST', '/password', { currentPassword, newPassword }); },
  deleteAccount: async (password: string) => { await call('POST', '/account/delete', { password }); setSession(null); },

  invites: async () => (await call<{ invites: Invite[] }>('GET', '/invites')).invites,
  createInvite: async () => (await call<{ code: string }>('POST', '/invites', {})).code,
  deleteInvite: async (code: string) => { await call('POST', '/invites/delete', { code }); },
  members: async () => (await call<{ members: Member[] }>('GET', '/members')).members,
  removeMember: async (username: string) => { await call('POST', '/members/remove', { username }); },
};

// The connection of a live session (liveSession.ts), or null when there can be none. A browser cannot
// put a header on a WebSocket, so the session token travels as its second protocol name, never in
// the address, and it stays in this file.
export function openLiveSocket(owner: string, id: string): WebSocket | null {
  if (!session || !accountsEnabled || typeof WebSocket === 'undefined') return null;
  const url = `${API_URL.replace(/^http/, 'ws')}/live/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`;
  try { return new WebSocket(url, ['discobot', session.token]); } catch { return null; }
}
