import { checkPassword, checkUsername } from './rules.ts';
import { hashPassword, newInviteCode, newRecoveryCode, newToken, normalizeCode, sameText, sha256, verifyPassword } from './secrets.ts';

// The part of Cloudflare's D1 interface this API uses, so tests can stand in a local SQLite.
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export interface Env {
  DB: Database;
  // Comma-separated origins allowed to call the API from a browser.
  ALLOWED_ORIGINS: string;
  // A secret. Signing up with it as the invite code creates the owner, once.
  OWNER_INVITE?: string;
}

interface UserRow { id: string; username: string; username_key: string; password_hash: string; recovery_hash: string; is_owner: number; created_at: number }

export const SESSION_DAYS = 90;
export const MAX_FAILURES = 8;
export const FAILURE_WINDOW_MS = 15 * 60_000;
export const MAX_OPEN_INVITES = 50;
export const MAX_PROJECTS = 100;
export const MAX_PROJECT_BYTES = 400_000;
const MAX_BODY_BYTES = 4096;
const DAY_MS = 86_400_000;

class Refusal extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const json = (status: number, body: unknown, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

async function readBody(request: Request, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > limit) throw new Refusal(413, 'That request is too large.');
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new Refusal(400, 'That request could not be read.');
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const publicUser = (user: UserRow) => ({ username: user.username, owner: user.is_owner === 1, createdAt: user.created_at });

async function startSession(env: Env, userId: string, now: number) {
  const token = newToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY_MS),
  ]);
  return token;
}

async function sessionUser(env: Env, request: Request, now: number) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new Refusal(401, 'Sign in first.');
  const tokenHash = await sha256(token);
  const user = await env.DB.prepare(
    'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
  ).bind(tokenHash, now).first<UserRow>();
  if (!user) throw new Refusal(401, 'You have been signed out. Sign in again.');
  return { user, tokenHash };
}

async function requireOwner(env: Env, request: Request, now: number) {
  const session = await sessionUser(env, request, now);
  if (session.user.is_owner !== 1) throw new Refusal(403, 'Only the owner can do that.');
  return session;
}

async function tooManyFailures(env: Env, usernameKey: string, now: number) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS failures FROM sign_in_failures WHERE username_key = ? AND at > ?').bind(usernameKey, now - FAILURE_WINDOW_MS).first<{ failures: number }>();
  return (row?.failures ?? 0) >= MAX_FAILURES;
}

async function recordFailure(env: Env, usernameKey: string, now: number) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sign_in_failures WHERE at <= ?').bind(now - FAILURE_WINDOW_MS),
    env.DB.prepare('INSERT INTO sign_in_failures (username_key, at) VALUES (?, ?)').bind(usernameKey, now),
  ]);
}

const LOCKED = 'Too many wrong attempts. Wait fifteen minutes and try again.';
// Checked when the username does not exist, so a wrong username takes as long as a wrong password.
let decoyHash: Promise<string> | null = null;

async function removeUser(env: Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM projects WHERE owner_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM invites WHERE created_by = ? AND used_by IS NULL').bind(userId),
    env.DB.prepare('UPDATE invites SET used_by = NULL WHERE used_by = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

async function signUp(env: Env, body: Record<string, unknown>, now: number) {
  const username = text(body.username).trim();
  const password = text(body.password);
  const invite = text(body.invite).trim();
  const problem = checkUsername(username) || checkPassword(password, username);
  if (problem) throw new Refusal(400, problem);
  if (!invite) throw new Refusal(400, 'Enter your invite code.');
  const usernameKey = username.toLowerCase();
  if (await env.DB.prepare('SELECT 1 AS taken FROM users WHERE username_key = ?').bind(usernameKey).first()) throw new Refusal(409, 'That username is taken.');

  const id = crypto.randomUUID();
  const inviteCode = normalizeCode(invite);
  const ownerInvite = env.OWNER_INVITE ? await sameText(invite, env.OWNER_INVITE) : false;
  let owner = false;
  if (ownerInvite && !(await env.DB.prepare('SELECT 1 AS present FROM users WHERE is_owner = 1').first())) {
    owner = true;
  } else {
    // Claiming is one statement, so two people cannot use the same code.
    const claim = await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_at IS NULL').bind(id, now, inviteCode).run();
    if (claim.meta.changes !== 1) throw new Refusal(403, 'That invite code is not valid, or has already been used.');
  }

  const recoveryCode = newRecoveryCode();
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, username, username_key, password_hash, recovery_hash, is_owner, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, username, usernameKey, await hashPassword(password), await sha256(normalizeCode(recoveryCode)), owner ? 1 : 0, owner ? null : inviteCode, now).run();
  } catch {
    // Someone took the username between the check and the insert: give the invite back.
    if (!owner) await env.DB.prepare('UPDATE invites SET used_by = NULL, used_at = NULL WHERE code = ? AND used_by = ?').bind(inviteCode, id).run();
    throw new Refusal(409, 'That username is taken.');
  }
  return json(201, { token: await startSession(env, id, now), recoveryCode, user: { username, owner, createdAt: now } });
}

async function signIn(env: Env, body: Record<string, unknown>, now: number) {
  const usernameKey = text(body.username).trim().toLowerCase().slice(0, 40);
  const password = text(body.password).slice(0, 400);
  if (!usernameKey || !password) throw new Refusal(400, 'Enter your username and password.');
  if (await tooManyFailures(env, usernameKey, now)) throw new Refusal(429, LOCKED);
  const user = await env.DB.prepare('SELECT * FROM users WHERE username_key = ?').bind(usernameKey).first<UserRow>();
  decoyHash ??= hashPassword(newToken());
  const correct = await verifyPassword(password, user ? user.password_hash : await decoyHash);
  if (!user || !correct) {
    await recordFailure(env, usernameKey, now);
    throw new Refusal(401, 'That username or password is not right.');
  }
  return json(200, { token: await startSession(env, user.id, now), user: publicUser(user) });
}

async function recover(env: Env, body: Record<string, unknown>, now: number) {
  const usernameKey = text(body.username).trim().toLowerCase().slice(0, 40);
  const code = normalizeCode(text(body.recoveryCode).slice(0, 80));
  const password = text(body.newPassword);
  if (!usernameKey || !code) throw new Refusal(400, 'Enter your username and recovery code.');
  if (await tooManyFailures(env, usernameKey, now)) throw new Refusal(429, LOCKED);
  const user = await env.DB.prepare('SELECT * FROM users WHERE username_key = ?').bind(usernameKey).first<UserRow>();
  if (!user || !(await sameText(await sha256(code), user.recovery_hash))) {
    await recordFailure(env, usernameKey, now);
    throw new Refusal(401, 'That username or recovery code is not right.');
  }
  const problem = checkPassword(password, user.username);
  if (problem) throw new Refusal(400, problem);
  // A recovery code works once: using it issues a new one and signs out every browser.
  const recoveryCode = newRecoveryCode();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ?').bind(await hashPassword(password), await sha256(normalizeCode(recoveryCode)), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sign_in_failures WHERE username_key = ?').bind(usernameKey),
  ]);
  return json(200, { token: await startSession(env, user.id, now), recoveryCode, user: publicUser(user) });
}

// Asks for the password again before anything that cannot be undone, so an unattended
// signed-in browser is not enough.
async function confirmPassword(env: Env, user: UserRow, password: string, now: number) {
  if (await tooManyFailures(env, user.username_key, now)) throw new Refusal(429, LOCKED);
  if (!password || !(await verifyPassword(password, user.password_hash))) {
    await recordFailure(env, user.username_key, now);
    throw new Refusal(403, 'That password is not right.');
  }
}

interface ProjectRow { id: string; name: string; revision: number; updated_at: number; deleted: number; data: string }
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHANGED_ELSEWHERE = 'This project was changed somewhere else.';
const revisionOf = (value: unknown) => (Number.isInteger(value) ? value as number : -1);

// Projects are stored as the browser sent them. The browser sanitizes whatever it downloads,
// exactly as it does for a project file, so the server only checks size and shape.
async function projects(request: Request, env: Env, now: number, rest: string): Promise<Response> {
  const { user } = await sessionUser(env, request, now);
  const method = request.method;
  if (rest === '' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name, revision, updated_at, deleted FROM projects WHERE owner_id = ? ORDER BY updated_at DESC').bind(user.id).all<ProjectRow>();
    return json(200, { projects: results.map(row => ({ id: row.id, name: row.name, revision: row.revision, updatedAt: row.updated_at, deleted: row.deleted === 1 })) });
  }

  const [, id, action] = /^\/([^/]+)(\/delete)?$/.exec(rest) || [];
  if (!id || !PROJECT_ID.test(id)) throw new Refusal(404, 'Not found.');
  const row = await env.DB.prepare('SELECT id, name, revision, updated_at, deleted, data FROM projects WHERE owner_id = ? AND id = ?').bind(user.id, id).first<ProjectRow>();

  if (method === 'GET' && !action) {
    if (!row || row.deleted === 1) throw new Refusal(404, 'That project is not in your account.');
    return json(200, { id: row.id, name: row.name, revision: row.revision, updatedAt: row.updated_at, project: JSON.parse(row.data) });
  }

  if (method === 'POST' && action) {
    const base = revisionOf((await readBody(request)).baseRevision);
    if (!row || row.deleted === 1) return json(200, { ok: true });
    const removed = await env.DB.prepare("UPDATE projects SET deleted = 1, data = '', revision = revision + 1, updated_at = ? WHERE owner_id = ? AND id = ? AND revision = ?").bind(now, user.id, id, base).run();
    if (removed.meta.changes !== 1) return json(409, { error: CHANGED_ELSEWHERE, revision: row.revision });
    return json(200, { ok: true });
  }

  if (method === 'PUT' && !action) {
    const body = await readBody(request, MAX_PROJECT_BYTES + 2048);
    const project = body.project;
    const base = revisionOf(body.baseRevision);
    const name = text(body.name).trim().slice(0, 60);
    if (!name || !project || typeof project !== 'object' || Array.isArray(project) || (project as { format?: unknown }).format !== 'discobot-project') throw new Refusal(400, 'That is not a Discobot project.');
    const data = JSON.stringify(project);
    if (data.length > MAX_PROJECT_BYTES) throw new Refusal(413, 'This project is too large to sync.');
    if (!row) {
      if (base !== 0) return json(409, { error: CHANGED_ELSEWHERE, revision: 0 });
      const count = await env.DB.prepare('SELECT COUNT(*) AS live FROM projects WHERE owner_id = ? AND deleted = 0').bind(user.id).first<{ live: number }>();
      if ((count?.live ?? 0) >= MAX_PROJECTS) throw new Refusal(507, `An account holds up to ${MAX_PROJECTS} projects. Delete some to sync more.`);
      try {
        await env.DB.prepare('INSERT INTO projects (owner_id, id, name, revision, updated_at, deleted, data) VALUES (?, ?, ?, 1, ?, 0, ?)').bind(user.id, id, name, now, data).run();
      } catch {
        return json(409, { error: CHANGED_ELSEWHERE, revision: 1 });
      }
      return json(201, { revision: 1 });
    }
    // One statement checks the revision and writes, so two browsers cannot both win.
    const saved = await env.DB.prepare('UPDATE projects SET name = ?, data = ?, deleted = 0, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND id = ? AND revision = ?').bind(name, data, now, user.id, id, base).run();
    if (saved.meta.changes !== 1) return json(409, { error: CHANGED_ELSEWHERE, revision: row.revision });
    return json(200, { revision: row.revision + 1 });
  }

  throw new Refusal(404, 'Not found.');
}

async function route(request: Request, env: Env, now: number): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const is = (verb: string, path: string) => method === verb && pathname === path;

  if (is('GET', '/')) return json(200, { service: 'discobot-api' });
  if (is('POST', '/signup')) return signUp(env, await readBody(request), now);
  if (is('POST', '/signin')) return signIn(env, await readBody(request), now);
  if (is('POST', '/recover')) return recover(env, await readBody(request), now);

  if (pathname === '/projects' || pathname.startsWith('/projects/')) return projects(request, env, now, pathname.slice('/projects'.length));

  if (is('GET', '/me')) return json(200, { user: publicUser((await sessionUser(env, request, now)).user) });

  if (is('POST', '/signout')) {
    const { tokenHash } = await sessionUser(env, request, now);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return json(200, { ok: true });
  }

  if (is('POST', '/signout-everywhere')) {
    const { user } = await sessionUser(env, request, now);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    return json(200, { ok: true });
  }

  if (is('POST', '/password')) {
    const { user, tokenHash } = await sessionUser(env, request, now);
    const body = await readBody(request);
    await confirmPassword(env, user, text(body.currentPassword).slice(0, 400), now);
    const problem = checkPassword(body.newPassword, user.username);
    if (problem) throw new Refusal(400, problem);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(text(body.newPassword)), user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, tokenHash),
    ]);
    return json(200, { ok: true });
  }

  if (is('POST', '/recovery-code')) {
    const { user } = await sessionUser(env, request, now);
    await confirmPassword(env, user, text((await readBody(request)).password).slice(0, 400), now);
    const recoveryCode = newRecoveryCode();
    await env.DB.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').bind(await sha256(normalizeCode(recoveryCode)), user.id).run();
    return json(200, { recoveryCode });
  }

  if (is('POST', '/account/delete')) {
    const { user } = await sessionUser(env, request, now);
    await confirmPassword(env, user, text((await readBody(request)).password).slice(0, 400), now);
    await removeUser(env, user.id);
    return json(200, { ok: true });
  }

  if (is('GET', '/invites')) {
    const { user } = await requireOwner(env, request, now);
    const { results } = await env.DB.prepare(
      'SELECT invites.code, invites.created_at, invites.used_at, users.username AS used_by FROM invites LEFT JOIN users ON users.id = invites.used_by WHERE invites.created_by = ? ORDER BY invites.created_at DESC, invites.code',
    ).bind(user.id).all<{ code: string; created_at: number; used_at: number | null; used_by: string | null }>();
    return json(200, { invites: results.map(row => ({ code: row.code.replace(/(.{5})(?=.)/g, '$1-'), createdAt: row.created_at, usedAt: row.used_at, usedBy: row.used_by })) });
  }

  if (is('POST', '/invites')) {
    const { user } = await requireOwner(env, request, now);
    const open = await env.DB.prepare('SELECT COUNT(*) AS open FROM invites WHERE used_at IS NULL').first<{ open: number }>();
    if ((open?.open ?? 0) >= MAX_OPEN_INVITES) throw new Refusal(409, `There are already ${MAX_OPEN_INVITES} unused invite codes. Delete some first.`);
    const code = newInviteCode();
    await env.DB.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)').bind(normalizeCode(code), user.id, now).run();
    return json(201, { code });
  }

  if (is('POST', '/invites/delete')) {
    await requireOwner(env, request, now);
    const code = normalizeCode(text((await readBody(request)).code).slice(0, 80));
    const removed = await env.DB.prepare('DELETE FROM invites WHERE code = ? AND used_at IS NULL').bind(code).run();
    if (removed.meta.changes !== 1) throw new Refusal(404, 'That invite code was not found, or has been used.');
    return json(200, { ok: true });
  }

  if (is('GET', '/members')) {
    await requireOwner(env, request, now);
    const { results } = await env.DB.prepare('SELECT username, is_owner, created_at FROM users ORDER BY created_at, username').all<{ username: string; is_owner: number; created_at: number }>();
    return json(200, { members: results.map(row => ({ username: row.username, owner: row.is_owner === 1, createdAt: row.created_at })) });
  }

  if (is('POST', '/members/remove')) {
    await requireOwner(env, request, now);
    const usernameKey = text((await readBody(request)).username).trim().toLowerCase().slice(0, 40);
    const target = await env.DB.prepare('SELECT * FROM users WHERE username_key = ?').bind(usernameKey).first<UserRow>();
    if (!target) throw new Refusal(404, 'That account was not found.');
    if (target.is_owner === 1) throw new Refusal(400, 'The owner account is removed from its own Delete Account button.');
    await removeUser(env, target.id);
    return json(200, { ok: true });
  }

  throw new Refusal(404, 'Not found.');
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(entry => entry.trim()).filter(Boolean);
  const cors: Record<string, string> = origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
  const withCors = (response: Response) => {
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
    return response;
  };
  try {
    // A browser always sends Origin on these; a page on any other site is turned away.
    if (origin && !allowed.includes(origin)) throw new Refusal(403, 'This site is not allowed to use the Discobot API.');
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    return withCors(await route(request, env, now));
  } catch (error) {
    if (error instanceof Refusal) return withCors(json(error.status, { error: error.message }));
    console.error('Unhandled error', error instanceof Error ? error.message : 'unknown');
    return withCors(json(500, { error: 'Something went wrong on the server. Try again.' }));
  }
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
