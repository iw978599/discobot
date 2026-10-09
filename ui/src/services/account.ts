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

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signedIn = true): Promise<T> {
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
