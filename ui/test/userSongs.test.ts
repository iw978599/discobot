import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountError, readUserSongs, songsApi } from '../src/services/account.ts';
import { shortCode, userName, userUrl } from '../src/services/shareLink.ts';
import { handle, type Env } from '../../server/src/index.ts';
import { createLocalDatabase } from '../../server/src/localDatabase.ts';

const PASSWORD = 'correct horse battery';

test('a link to a person\'s page holds their username and nothing else', () => {
  const link = userUrl('Disco_Dana', 'https://example.test/discobot/#s=abcdefghij');
  assert.equal(link, 'https://example.test/discobot/#u=Disco_Dana');
  assert.equal(userName(new URL(link).hash), 'Disco_Dana');
  assert.equal(userName(''), null);
  assert.equal(userName('#s=abcdefghij'), null, 'a song link is not a person\'s page');
  assert.equal(shortCode(new URL(link).hash), null, 'and a person\'s page is not a song link');
  assert.equal(userName('#kids'), null);
  for (const hash of ['#u=', '#u=ab', `#u=${'x'.repeat(21)}`, '#u=../songs', '#u=a%20b', '#u=<b>hi</b>', '#u=-dana']) {
    assert.equal(userName(hash), '', `${hash} opens the page, with no name to ask the server about`);
  }
});

test('a list of songs from the server is treated as untrusted', () => {
  const code = 'abcdefghij';
  const read = readUserSongs({
    author: 'Disco_Dana', joined: 5, projects: 12,
    songs: [
      { code, title: 'Night Drive', updatedAt: 1_700_000_000_000, projectId: 'x', extra: true },
      { code: '../../etc', title: 'bad code' }, { code: 'ABCDEFGHIJ', title: 'bad code' }, { code, title: 7 }, null, 'text', [],
      { code: 'klmnopqrst', title: 'T'.repeat(500), updatedAt: 'yesterday' },
    ],
  }, 'disco_dana');
  assert.deepEqual(read, { author: 'Disco_Dana', songs: [{ code, title: 'Night Drive', updatedAt: 1_700_000_000_000 }, { code: 'klmnopqrst', title: 'T'.repeat(60), updatedAt: 0 }] });
  assert.equal(readUserSongs({ author: '<img src=x>', songs: [] }, 'dana').author, 'dana', 'a name other than the one asked for is not shown');
  assert.equal(readUserSongs({ songs: Array.from({ length: 500 }, () => ({ code, title: 'x', updatedAt: 1 })) }, 'dana').songs.length, 50);
  for (const junk of [null, undefined, 'text', 4, [], { songs: 'many' }, { songs: {} }]) assert.deepEqual(readUserSongs(junk, 'dana'), { author: 'dana', songs: [] });
});

test('reading a person\'s songs sends no session, and tells a missing route from a server that is down', async () => {
  const env: Env = { DB: createLocalDatabase(), ALLOWED_ORIGINS: '', OWNER_INVITE: 'owner-secret' };
  const direct = async (method: string, path: string, body?: unknown, token?: string) => (await handle(new Request(`https://api.example${path}`, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body),
  }), env)).json() as Promise<Record<string, any>>;
  const token = (await direct('POST', '/signup', { username: 'Ian', password: PASSWORD, invite: 'owner-secret' })).token as string;
  const code = (await direct('POST', '/songs', { projectId: crypto.randomUUID(), title: 'Friday Night', project: { format: 'discobot-project', project: {} } }, token)).code as string;

  const realFetch = globalThis.fetch;
  const seen: Array<{ path: string; headers: Record<string, string> }> = [];
  let server: (request: Request) => Promise<Response> = request => handle(request, env);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ path: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return server(new Request(`https://api.example${String(input)}`, init));
  }) as typeof fetch;
  try {
    const list = await songsApi.by('ian');
    assert.deepEqual([list.author, list.songs.map(song => [song.code, song.title])], ['Ian', [[code, 'Friday Night']]]);
    assert.deepEqual(seen, [{ path: '/users/ian/songs', headers: {} }], 'one request, with no token');
    assert.deepEqual(await songsApi.by('Nobody_Here'), { author: 'Nobody_Here', songs: [] });

    // The site is published before the API is deployed: the old server has no such route.
    server = async () => new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
    await assert.rejects(songsApi.by('ian'), (error: unknown) => error instanceof AccountError && error.status === 404);
    server = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(songsApi.by('ian'), (error: unknown) => error instanceof AccountError && error.status === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
