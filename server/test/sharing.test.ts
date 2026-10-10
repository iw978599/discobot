import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_SHARED_WITH, handle, type Env } from '../src/index.ts';
import { createLocalDatabase } from '../src/localDatabase.ts';

const PASSWORD = 'correct horse battery';
const OWNER_INVITE = 'owner-bootstrap-secret';
const SONG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const file = (tempo: number) => ({ format: 'discobot-project', formatVersion: 1, project: { tempo } });

// The API with Ian, who owns it, and as many invited friends as are asked for.
async function api() {
  const env: Env = { DB: createLocalDatabase(), ALLOWED_ORIGINS: '', OWNER_INVITE };
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await handle(new Request(`https://api.example${path}`, {
      method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: response.status, data: await response.json() as Record<string, any> };
  };
  const ian = (await call('POST', '/signup', { username: 'Ian', password: PASSWORD, invite: OWNER_INVITE })).data.token as string;
  const join = async (username: string) => {
    const invite = (await call('POST', '/invites', {}, ian)).data.code;
    return (await call('POST', '/signup', { username, password: PASSWORD, invite })).data.token as string;
  };
  return { call, ian, join };
}

test('a shared project can be opened and saved by the people it is shared with, and by nobody else', async () => {
  const { call, ian, join } = await api();
  const dana = await join('Dana'), eve = await join('Eve');
  assert.equal((await call('PUT', `/projects/${SONG}`, { name: 'Night Drive', baseRevision: 0, project: file(120) }, ian)).status, 201);
  assert.equal((await call('PUT', `/projects/${OTHER}`, { name: 'Private', baseRevision: 0, project: file(90) }, ian)).status, 201);
  assert.deepEqual((await call('GET', '/projects', undefined, ian)).data.projects.map((project: any) => project.sharedWith), [undefined, undefined], 'nothing is shared to begin with');

  // Only the owner shares, only with an account that exists, and not with themselves.
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: 'nobody-here' }, ian)).status, 404);
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: 'ian' }, ian)).status, 400);
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: 'eve' }, dana)).status, 404, 'it is not Dana\'s to share');
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: ' DANA ' }, ian)).status, 200);
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: 'dana' }, ian)).status, 200, 'sharing twice is harmless');
  assert.deepEqual((await call('GET', `/projects/${SONG}/sharing`, undefined, ian)).data.members, ['Dana']);
  assert.equal((await call('GET', `/projects/${SONG}/sharing`, undefined, dana)).status, 404);

  // Dana sees it, with whose it is; Eve does not, and cannot read it by guessing where it is.
  const list = (await call('GET', '/shared', undefined, dana)).data.projects;
  assert.deepEqual(list.map((project: any) => [project.owner, project.id, project.name, project.revision, project.savedBy]), [['Ian', SONG, 'Night Drive', 1, 'Ian']]);
  assert.deepEqual((await call('GET', '/shared', undefined, eve)).data.projects, []);
  assert.equal((await call('GET', `/shared/ian/${SONG}`, undefined, eve)).status, 404);
  assert.equal((await call('GET', `/shared/ian/${OTHER}`, undefined, dana)).status, 404, 'sharing one project shares only that one');
  assert.equal((await call('GET', `/projects/${SONG}`, undefined, dana)).status, 404, 'it is not in Dana\'s own account');
  assert.equal((await call('GET', '/shared')).status, 401);
  assert.equal((await call('GET', `/shared/ian/${SONG}`, undefined, dana)).data.project.project.tempo, 120);

  // A save names the revision it was based on, whoever makes it.
  assert.equal((await call('PUT', `/shared/ian/${SONG}`, { name: 'Night Drive', baseRevision: 1, project: file(133) }, dana)).data.revision, 2);
  const stale = await call('PUT', `/projects/${SONG}`, { name: 'Night Drive', baseRevision: 1, project: file(99) }, ian);
  assert.equal(stale.status, 409, 'Ian was working from the version before Dana\'s');
  assert.equal(stale.data.revision, 2);
  assert.equal((await call('GET', `/projects/${SONG}`, undefined, ian)).data.project.project.tempo, 133);
  const mine = (await call('GET', '/projects', undefined, ian)).data.projects.find((project: any) => project.id === SONG);
  assert.deepEqual([mine.sharedWith, mine.savedBy], [1, 'Dana'], 'the owner can see it is shared and who saved it last');
  assert.equal((await call('PUT', `/projects/${SONG}`, { name: 'Night Drive', baseRevision: 2, project: file(140) }, ian)).data.revision, 3);
  assert.equal((await call('PUT', `/shared/ian/${SONG}`, { name: 'Night Drive', baseRevision: 2, project: file(50) }, dana)).status, 409);
  assert.equal((await call('GET', '/shared', undefined, dana)).data.projects[0].savedBy, 'Ian');
  assert.equal((await call('PUT', `/shared/ian/${SONG}`, { name: 'Night Drive', baseRevision: 3, project: { not: 'a project' } }, dana)).status, 400);
  assert.equal((await call('PUT', `/shared/ian/${SONG}`, { name: 'x', baseRevision: 3, project: file(1) }, eve)).status, 404);

  // A member cannot delete it or pass it on.
  assert.equal((await call('POST', `/projects/${SONG}/delete`, { baseRevision: 3 }, dana)).status, 200, 'deleting a project that is not yours does nothing');
  assert.equal((await call('GET', `/projects/${SONG}`, undefined, ian)).status, 200);
  assert.equal((await call('POST', `/shared/ian/${SONG}/delete`, { baseRevision: 3 }, dana)).status, 404);
});

test('sharing ends when the owner stops it, the member leaves, the project is deleted or an account goes', async () => {
  const { call, ian, join } = await api();
  const dana = await join('Dana'), eve = await join('Eve');
  for (const id of [SONG, OTHER]) await call('PUT', `/projects/${id}`, { name: id === SONG ? 'One' : 'Two', baseRevision: 0, project: file(100) }, ian);
  for (const id of [SONG, OTHER]) for (const username of ['dana', 'eve']) await call('POST', `/projects/${id}/share`, { username }, ian);
  const sharedWith = async (token: string) => (await call('GET', '/shared', undefined, token)).data.projects.map((project: any) => project.name).sort();
  assert.deepEqual(await sharedWith(dana), ['One', 'Two']);

  // The owner takes one person off one project.
  assert.equal((await call('POST', `/projects/${SONG}/unshare`, { username: 'dana' }, ian)).status, 200);
  assert.deepEqual(await sharedWith(dana), ['Two']);
  assert.equal((await call('PUT', `/shared/ian/${SONG}`, { name: 'One', baseRevision: 1, project: file(1) }, dana)).status, 404);
  assert.deepEqual(await sharedWith(eve), ['One', 'Two']);

  // A member leaves by themselves, and only themselves.
  assert.equal((await call('POST', `/shared/ian/${OTHER}/leave`, {}, dana)).status, 200);
  assert.deepEqual(await sharedWith(dana), []);
  assert.deepEqual((await call('GET', `/projects/${OTHER}/sharing`, undefined, ian)).data.members, ['Eve']);

  // Deleting the project ends it for everyone, and it does not come back shared if it is made again.
  assert.equal((await call('POST', `/projects/${OTHER}/delete`, { baseRevision: 1 }, ian)).status, 200);
  assert.deepEqual(await sharedWith(eve), ['One']);
  assert.equal((await call('GET', `/shared/ian/${OTHER}`, undefined, eve)).status, 404);
  assert.equal((await call('PUT', `/projects/${OTHER}`, { name: 'Two', baseRevision: 2, project: file(100) }, ian)).status, 200);
  assert.deepEqual(await sharedWith(eve), ['One']);

  // An account that is deleted takes its memberships with it; the owner's going takes the projects.
  assert.equal((await call('POST', '/account/delete', { password: PASSWORD }, eve)).status, 200);
  assert.deepEqual((await call('GET', `/projects/${SONG}/sharing`, undefined, ian)).data.members, []);
  await call('POST', `/projects/${SONG}/share`, { username: 'dana' }, ian);
  assert.deepEqual(await sharedWith(dana), ['One']);
  assert.equal((await call('POST', '/account/delete', { password: PASSWORD }, ian)).status, 200);
  assert.deepEqual(await sharedWith(dana), []);
});

test('a project is shared with a limited number of people', async () => {
  const { call, ian, join } = await api();
  await call('PUT', `/projects/${SONG}`, { name: 'Crowd', baseRevision: 0, project: file(100) }, ian);
  for (let index = 0; index < MAX_SHARED_WITH; index++) {
    await join(`friend${index}`);
    assert.equal((await call('POST', `/projects/${SONG}/share`, { username: `friend${index}` }, ian)).status, 200);
  }
  await join('onemore');
  const refused = await call('POST', `/projects/${SONG}/share`, { username: 'onemore' }, ian);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /up to 8 people/);
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: 'friend0' }, ian)).status, 200, 'someone already there is not counted twice');
  assert.equal((await call('POST', `/projects/${SONG}/share`, { username: 'anyone' }, ian)).status, 404);
  assert.equal((await call('POST', `/projects/${OTHER}/share`, { username: 'friend0' }, ian)).status, 404, 'a project that is not in the account cannot be shared');
});
