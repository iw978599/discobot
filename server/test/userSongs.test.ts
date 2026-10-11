import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle, type Env } from '../src/index.ts';
import { createLocalDatabase } from '../src/localDatabase.ts';

const PASSWORD = 'correct horse battery';
const OWNER_INVITE = 'owner-bootstrap-secret';
const ORIGIN = 'https://iw978599.github.io';
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const file = (tempo: number) => ({ format: 'discobot-project', formatVersion: 1, project: { tempo } });

// The API with Ian, who owns it, and Dana whom he invited. `clock` is the time each call is made at.
async function api() {
  const env: Env = { DB: createLocalDatabase(), ALLOWED_ORIGINS: ORIGIN, OWNER_INVITE };
  const clock = { now: 1_700_000_000_000 };
  const call = async (method: string, path: string, body?: unknown, token?: string, origin = ORIGIN) => {
    const response = await handle(new Request(`https://api.example${path}`, {
      method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    }), env, clock.now);
    return { status: response.status, text: await response.clone().text(), data: await response.json() as Record<string, any>, headers: response.headers };
  };
  const ian = (await call('POST', '/signup', { username: 'Ian', password: PASSWORD, invite: OWNER_INVITE })).data.token as string;
  const invite = (await call('POST', '/invites', {}, ian)).data.code;
  const dana = (await call('POST', '/signup', { username: 'Disco_Dana', password: PASSWORD, invite })).data.token as string;
  const publish = async (token: string, projectId: string, title: string) => {
    clock.now += 60_000;
    return (await call('POST', '/songs', { projectId, title, project: file(120) }, token)).data.code as string;
  };
  return { env, call, clock, ian, dana, publish };
}

test('anyone can read the list of songs one person has published, and nothing else about them', async () => {
  const { call, clock, ian, dana, publish } = await api();
  await call('PUT', `/projects/${THIRD}`, { name: 'Private Sketch', baseRevision: 0, project: file(77) }, dana);
  const first = await publish(dana, FIRST, 'Night Drive');
  const second = await publish(dana, SECOND, 'Morning After');
  const other = await publish(ian, FIRST, 'Somebody Else');

  const page = await call('GET', '/users/Disco_Dana/songs');
  assert.equal(page.status, 200, 'no account is needed');
  assert.equal(page.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(page.data, {
    author: 'Disco_Dana',
    songs: [
      { code: second, title: 'Morning After', updatedAt: 1_700_000_000_000 + 120_000 },
      { code: first, title: 'Night Drive', updatedAt: 1_700_000_000_000 + 60_000 },
    ],
  }, 'the newest first, and each song is its code, title and time and nothing more');
  assert.doesNotMatch(page.text, /Private Sketch|projectId|createdAt|owner|invite|1700000000000[,}]/, 'no project ids, private projects, join date or anything else about the account');
  assert.deepEqual((await call('GET', '/users/disco_dana/songs')).data, page.data, 'the name is matched whatever its capitals');
  assert.deepEqual((await call('GET', '/users/Disco_Dana/songs', undefined, ian)).data, page.data, 'signed in or not, the answer is the same');
  assert.deepEqual((await call('GET', '/users/ian/songs')).data.songs.map((song: any) => song.code), [other], 'one person\'s list holds only their songs');

  // Publishing again moves a song to the top and keeps its code.
  clock.now += 60_000;
  await call('POST', '/songs', { projectId: FIRST, title: 'Night Drive II', project: file(90) }, dana);
  assert.deepEqual((await call('GET', '/users/Disco_Dana/songs')).data.songs.map((song: any) => [song.code, song.title]), [[first, 'Night Drive II'], [second, 'Morning After']]);

  // Unpublishing takes a song off the list, and the last one leaves the same answer as nobody at all.
  assert.equal((await call('POST', `/songs/${first}/delete`, {}, dana)).status, 200);
  assert.deepEqual((await call('GET', '/users/Disco_Dana/songs')).data.songs.map((song: any) => song.code), [second]);
  assert.equal((await call('POST', `/songs/${second}/delete`, {}, dana)).status, 200);
  const none = await call('GET', '/users/Disco_Dana/songs');
  const nobody = await call('GET', '/users/Nobody_Here/songs');
  assert.deepEqual([none.status, none.text], [200, '{"songs":[]}']);
  assert.deepEqual([nobody.status, nobody.text], [none.status, none.text], 'an account with nothing published cannot be told from a username nobody has');
  assert.deepEqual([...none.headers].sort(), [...nobody.headers].sort());

  await publish(dana, FIRST, 'Back Again');
  assert.equal((await call('POST', '/account/delete', { password: PASSWORD }, dana)).status, 200);
  assert.equal((await call('GET', '/users/Disco_Dana/songs')).text, '{"songs":[]}', 'a deleted account lists nothing');
});

test('the list of songs is read-only, takes only a username, and answers only the app', async () => {
  const { call, ian, publish } = await api();
  await publish(ian, FIRST, 'Night Drive');

  for (const name of ['ab', 'x'.repeat(21), '-ian', 'ian%20', '%27%20OR%201=1--', 'Ian%25', '_']) {
    const answer = await call('GET', `/users/${name}/songs`);
    assert.deepEqual([answer.status, answer.text], [200, '{"songs":[]}'], `${name} is not a username and lists nothing`);
  }
  assert.equal((await call('POST', '/users/Ian/songs', {})).status, 404);
  assert.equal((await call('PUT', '/users/Ian/songs', {}, ian)).status, 404);
  assert.equal((await call('GET', '/users/Ian')).status, 404, 'there is no page about a person');
  assert.equal((await call('GET', '/users')).status, 404, 'and no list of people');
  assert.equal((await call('GET', '/users/Ian/songs/extra')).status, 404);
  assert.equal((await call('GET', '/users/Ian/songs', undefined, undefined, 'https://evil.example')).status, 403);
});
