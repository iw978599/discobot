import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAILURE_WINDOW_MS, MAX_FAILURES, SESSION_DAYS, handle, type Env } from '../src/index.ts';
import { createLocalDatabase } from '../src/localDatabase.ts';
import { checkPassword, checkUsername } from '../src/rules.ts';
import { hashPassword, newInviteCode, newRecoveryCode, verifyPassword } from '../src/secrets.ts';

const ORIGIN = 'https://iw978599.github.io';
const OWNER_INVITE = 'owner-bootstrap-secret';
const PASSWORD = 'correct horse battery';

function api(now = { value: 1_700_000_000_000 }) {
  const env: Env = { DB: createLocalDatabase(), ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:3000`, OWNER_INVITE };
  const call = async (method: string, path: string, body?: unknown, token?: string, origin: string | null = ORIGIN) => {
    const headers: Record<string, string> = {};
    if (origin) headers.Origin = origin;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await handle(new Request(`https://api.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, now.value);
    const data = response.status === 204 ? {} : await response.json() as Record<string, any>;
    return { status: response.status, data, headers: response.headers };
  };
  const owner = async () => (await call('POST', '/signup', { username: 'Ian', password: PASSWORD, invite: OWNER_INVITE })).data;
  const invite = async (token: string) => (await call('POST', '/invites', {}, token)).data.code as string;
  return { env, call, owner, invite, now };
}

test('password hashes are salted, slow and verifiable', async () => {
  const first = await hashPassword(PASSWORD), second = await hashPassword(PASSWORD);
  assert.match(first, /^pbkdf2\$100000\$[\w-]{22}\$[\w-]{43}$/);
  assert.notEqual(first, second, 'the same password hashes differently each time');
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword(`${PASSWORD}!`, first), false);
  assert.equal(await verifyPassword(PASSWORD, 'not-a-hash'), false);
  assert.equal(await verifyPassword(PASSWORD, 'pbkdf2$999999999$AAAA$AAAA'), false, 'a stored hash cannot ask for unbounded work');
});

test('codes are readable and do not repeat', () => {
  const codes = new Set(Array.from({ length: 200 }, newRecoveryCode));
  assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^([A-HJ-KM-NP-Z2-9]{5}-){4}[A-HJ-KM-NP-Z2-9]{5}$/);
  assert.match(newInviteCode(), /^([A-HJ-KM-NP-Z2-9]{5}-){2}[A-HJ-KM-NP-Z2-9]{5}$/);
});

test('username and password rules', () => {
  assert.equal(checkUsername('ian_w-1'), null);
  for (const bad of ['ab', 'a'.repeat(21), 'has space', '_lead', 'Admin', 'discobot', 'é'.repeat(4), 5]) assert.ok(checkUsername(bad), `${bad} is refused`);
  assert.equal(checkPassword(PASSWORD, 'ian'), null);
  for (const bad of ['short', 'password123', 'QWERTYUIOP', 'aaaaaaaaaaaa', 'ababababababab', 'my-name-is-ian-ok', 'x'.repeat(201)]) assert.ok(checkPassword(bad, 'ian'), `${bad} is refused`);
});

test('the owner signs up once with the bootstrap secret, and everyone else needs an invite', async () => {
  const { call, owner, invite, env } = api();
  assert.equal((await call('POST', '/signup', { username: 'friend', password: PASSWORD, invite: 'AAAAA-BBBBB-CCCCC' })).status, 403);
  assert.equal((await call('POST', '/signup', { username: 'friend', password: PASSWORD })).status, 400);

  const ian = await owner();
  assert.equal(ian.user.owner, true);
  assert.match(ian.recoveryCode, /^(\w{5}-){4}\w{5}$/);
  assert.equal((await call('POST', '/signup', { username: 'second', password: PASSWORD, invite: OWNER_INVITE })).status, 403, 'the bootstrap secret works once');

  const code = await invite(ian.token);
  const taken = await call('POST', '/signup', { username: 'IAN', password: PASSWORD, invite: code });
  assert.equal(taken.status, 409, 'usernames are unique whatever the capitals');
  const weak = await call('POST', '/signup', { username: 'friend', password: 'password123', invite: code });
  assert.equal(weak.status, 400);

  const friend = await call('POST', '/signup', { username: 'Friend', password: PASSWORD, invite: code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(friend.status, 201, 'a refused attempt did not use up the invite, and codes are forgiving about case and dashes');
  assert.equal(friend.data.user.owner, false);
  assert.equal((await call('POST', '/signup', { username: 'third', password: PASSWORD, invite: code })).status, 403, 'an invite works once');

  const stored = await env.DB.prepare('SELECT * FROM users WHERE username_key = ?').bind('friend').first<Record<string, unknown>>();
  assert.deepEqual(Object.keys(stored!).sort(), ['created_at', 'id', 'invite_code', 'is_owner', 'password_hash', 'recovery_hash', 'username', 'username_key'], 'nothing else is stored about a person');
  const everything = JSON.stringify([
    (await env.DB.prepare('SELECT * FROM users').all()).results,
    (await env.DB.prepare('SELECT * FROM sessions').all()).results,
  ]);
  for (const secret of [PASSWORD, friend.data.token, friend.data.recoveryCode, ian.token, ian.recoveryCode]) {
    assert.equal(everything.includes(secret), false, 'passwords, session tokens and recovery codes are stored only as hashes');
  }
});

test('signing in, signing out and expiry', async () => {
  const { call, owner, now } = api();
  const ian = await owner();
  assert.equal((await call('GET', '/me', undefined, ian.token)).data.user.username, 'Ian');
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', undefined, 'made-up-token')).status, 401);

  const wrong = await call('POST', '/signin', { username: 'ian', password: 'not the password' });
  const unknown = await call('POST', '/signin', { username: 'nobody', password: 'not the password' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.data, wrong.data, 'a wrong username and a wrong password look the same');

  const laptop = await call('POST', '/signin', { username: ' IAN ', password: PASSWORD });
  assert.equal(laptop.status, 200);
  assert.equal(laptop.data.recoveryCode, undefined, 'the recovery code is only shown when it is made');
  assert.equal((await call('POST', '/signout', {}, laptop.data.token)).status, 200);
  assert.equal((await call('GET', '/me', undefined, laptop.data.token)).status, 401);
  assert.equal((await call('GET', '/me', undefined, ian.token)).status, 200, 'signing out one browser leaves the others');

  const phone = await call('POST', '/signin', { username: 'ian', password: PASSWORD });
  assert.equal((await call('POST', '/signout-everywhere', {}, phone.data.token)).status, 200);
  assert.equal((await call('GET', '/me', undefined, ian.token)).status, 401);

  const later = await call('POST', '/signin', { username: 'ian', password: PASSWORD });
  now.value += (SESSION_DAYS + 1) * 86_400_000;
  assert.equal((await call('GET', '/me', undefined, later.data.token)).status, 401, 'sessions expire');
});

test('repeated wrong passwords lock the username for a while', async () => {
  const { call, owner, now } = api();
  await owner();
  for (let attempt = 0; attempt < MAX_FAILURES; attempt++) assert.equal((await call('POST', '/signin', { username: 'ian', password: `guess number ${attempt}` })).status, 401);
  assert.equal((await call('POST', '/signin', { username: 'ian', password: PASSWORD })).status, 429, 'even the right password waits');
  assert.equal((await call('POST', '/recover', { username: 'ian', recoveryCode: 'AAAAA', newPassword: PASSWORD })).status, 429, 'the recovery code cannot be guessed around the lock');
  now.value += FAILURE_WINDOW_MS + 1;
  assert.equal((await call('POST', '/signin', { username: 'ian', password: PASSWORD })).status, 200);
});

test('a recovery code sets a new password once and signs out every browser', async () => {
  const { call, owner } = api();
  const ian = await owner();
  const newPassword = 'a brand new passphrase';
  assert.equal((await call('POST', '/recover', { username: 'ian', recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', newPassword })).status, 401);
  assert.equal((await call('POST', '/recover', { username: 'ian', recoveryCode: ian.recoveryCode, newPassword: 'short' })).status, 400);

  const recovered = await call('POST', '/recover', { username: 'Ian', recoveryCode: ian.recoveryCode.toLowerCase(), newPassword });
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.data.recoveryCode, ian.recoveryCode);
  assert.equal((await call('GET', '/me', undefined, ian.token)).status, 401, 'whoever had the old password is signed out');
  assert.equal((await call('GET', '/me', undefined, recovered.data.token)).status, 200);
  assert.equal((await call('POST', '/signin', { username: 'ian', password: PASSWORD })).status, 401);
  assert.equal((await call('POST', '/signin', { username: 'ian', password: newPassword })).status, 200);
  assert.equal((await call('POST', '/recover', { username: 'ian', recoveryCode: ian.recoveryCode, newPassword })).status, 401, 'a used code is dead');

  const fresh = await call('POST', '/recovery-code', { password: newPassword }, recovered.data.token);
  assert.equal(fresh.status, 200);
  assert.equal((await call('POST', '/recovery-code', { password: 'wrong password!' }, recovered.data.token)).status, 403);
  assert.equal((await call('POST', '/recover', { username: 'ian', recoveryCode: recovered.data.recoveryCode, newPassword })).status, 401, 'asking for a new code retires the old one');
  assert.equal((await call('POST', '/recover', { username: 'ian', recoveryCode: fresh.data.recoveryCode, newPassword })).status, 200);
});

test('changing the password needs the current one and signs out other browsers', async () => {
  const { call, owner } = api();
  const ian = await owner();
  const other = await call('POST', '/signin', { username: 'ian', password: PASSWORD });
  assert.equal((await call('POST', '/password', { currentPassword: 'wrong password!', newPassword: 'another long password' }, ian.token)).status, 403);
  assert.equal((await call('POST', '/password', { currentPassword: PASSWORD, newPassword: 'short' }, ian.token)).status, 400);
  assert.equal((await call('POST', '/password', { currentPassword: PASSWORD, newPassword: 'another long password' }, ian.token)).status, 200);
  assert.equal((await call('GET', '/me', undefined, ian.token)).status, 200);
  assert.equal((await call('GET', '/me', undefined, other.data.token)).status, 401);
  assert.equal((await call('POST', '/signin', { username: 'ian', password: 'another long password' })).status, 200);
});

test('only the owner manages invites and members', async () => {
  const { call, owner, invite } = api();
  const ian = await owner();
  const used = await invite(ian.token), spare = await invite(ian.token);
  const friend = await call('POST', '/signup', { username: 'friend', password: PASSWORD, invite: used });

  for (const [method, path] of [['GET', '/invites'], ['POST', '/invites'], ['POST', '/invites/delete'], ['GET', '/members'], ['POST', '/members/remove']]) {
    assert.equal((await call(method, path, method === 'POST' ? {} : undefined, friend.data.token)).status, 403, `${method} ${path} is owner-only`);
    assert.equal((await call(method, path, method === 'POST' ? {} : undefined)).status, 401);
  }

  const listed = (await call('GET', '/invites', undefined, ian.token)).data.invites;
  assert.deepEqual(listed.map((entry: any) => [entry.code, entry.usedBy]).sort(), [[spare, null], [used, 'friend']].sort());
  assert.equal((await call('POST', '/invites/delete', { code: used }, ian.token)).status, 404, 'a used invite is a record, not something to delete');
  assert.equal((await call('POST', '/invites/delete', { code: spare }, ian.token)).status, 200);
  assert.equal((await call('POST', '/signup', { username: 'late', password: PASSWORD, invite: spare })).status, 403);

  assert.deepEqual((await call('GET', '/members', undefined, ian.token)).data.members.map((member: any) => member.username), ['Ian', 'friend']);
  assert.equal((await call('POST', '/members/remove', { username: 'ian' }, ian.token)).status, 400);
  assert.equal((await call('POST', '/members/remove', { username: 'Friend' }, ian.token)).status, 200);
  assert.equal((await call('GET', '/me', undefined, friend.data.token)).status, 401);
  assert.equal((await call('POST', '/signin', { username: 'friend', password: PASSWORD })).status, 401);
  assert.equal((await call('POST', '/signup', { username: 'again', password: PASSWORD, invite: used })).status, 403, 'removing a member does not hand their invite back');
});

test('deleting an account removes every trace of it', async () => {
  const { call, owner, invite, env } = api();
  const ian = await owner();
  const friend = await call('POST', '/signup', { username: 'friend', password: PASSWORD, invite: await invite(ian.token) });
  await call('POST', '/signin', { username: 'friend', password: 'a wrong guess here' });
  assert.equal((await call('POST', '/account/delete', { password: 'not the password' }, friend.data.token)).status, 403);
  assert.equal((await call('POST', '/account/delete', { password: PASSWORD }, friend.data.token)).status, 200);
  assert.equal((await call('GET', '/me', undefined, friend.data.token)).status, 401);
  const id = friend.data.user.username.toLowerCase();
  assert.equal(await env.DB.prepare('SELECT 1 FROM users WHERE username_key = ?').bind(id).first(), null);
  assert.equal((await env.DB.prepare('SELECT * FROM sessions').all()).results.length, 1, 'only the owner\'s session is left');
  assert.equal((await env.DB.prepare('SELECT * FROM invites WHERE used_by IS NOT NULL').all()).results.length, 0);
  assert.equal((await call('POST', '/signup', { username: 'friend', password: PASSWORD, invite: await invite(ian.token) })).status, 201, 'the username is free again');
});

test('only the listed sites can call the API from a browser', async () => {
  const { call, owner } = api();
  const ian = await owner();
  const allowed = await call('GET', '/me', undefined, ian.token);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
  assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'), null, 'no cookies are involved');

  const preflight = await call('OPTIONS', '/signin');
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /Authorization/);

  const elsewhere = await call('POST', '/signin', { username: 'ian', password: PASSWORD }, undefined, 'https://evil.example');
  assert.equal(elsewhere.status, 403);
  assert.equal(elsewhere.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await call('OPTIONS', '/signin', undefined, undefined, 'https://evil.example')).status, 403);

  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('POST', '/signin', { username: 'ian', password: 'x'.repeat(5000) })).status, 413);
  const garbled = await handle(new Request('https://api.example/signin', { method: 'POST', headers: { Origin: ORIGIN }, body: '{not json' }), api().env);
  assert.equal(garbled.status, 400);
});
