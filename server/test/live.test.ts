import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { handle, liveTarget, type Env } from '../src/index.ts';
import { createLocalDatabase } from '../src/localDatabase.ts';
import { MAX_MESSAGE, freeColour, joined, left, received, type Peer } from '../src/live.ts';
import { acceptLive, resetRooms } from '../devLive.ts';

const PASSWORD = 'correct horse battery';
const OWNER_INVITE = 'owner-bootstrap-secret';
const SONG = '11111111-1111-4111-8111-111111111111';
const file = (tempo: number) => ({ format: 'discobot-project', formatVersion: 1, project: { tempo } });

// Someone in a room, whose messages are kept to be looked at.
const person = (id: string, since: number, colour = 0): Peer & { heard: any[] } => {
  const heard: any[] = [];
  return { id, user: id, colour, since, heard, send: text => heard.push(JSON.parse(text)) };
};

test('someone joining is welcomed, the others are told, and the one longest in the room is asked for the project', () => {
  const ann = person('ann', 1), bob = person('bob', 2, 1);
  joined([ann], ann);
  assert.deepEqual(ann.heard, [{ t: 'welcome', you: { id: 'ann', user: 'ann', colour: 0, since: 1 }, members: [] }], 'alone, nobody is asked for anything');
  ann.heard.length = 0;
  joined([ann, bob], bob);
  assert.equal(bob.heard[0].t, 'welcome');
  assert.deepEqual(bob.heard[0].members.map((entry: any) => entry.id), ['ann']);
  assert.deepEqual(ann.heard, [{ t: 'join', member: { id: 'bob', user: 'bob', colour: 1, since: 2 } }, { t: 'send-state', to: 'bob' }]);
  left([ann], bob);
  assert.deepEqual(ann.heard.at(-1), { t: 'leave', id: 'bob' });
  assert.equal(freeColour([ann, bob]), 2);
  assert.equal(freeColour([bob]), 0, 'a colour comes free when its person leaves');
});

test('an edit reaches everyone in one order, the sender too; a project for someone joining reaches them alone', () => {
  const ann = person('ann', 1), bob = person('bob', 2), cy = person('cy', 3);
  const room = [ann, bob, cy];
  received(room, ann, JSON.stringify({ t: 'op', op: { type: 'tempo.set', tempo: 90 }, keys: ['tempo'] }));
  for (const who of room) assert.deepEqual(who.heard, [{ t: 'op', op: { type: 'tempo.set', tempo: 90 }, keys: ['tempo'], from: 'ann' }], who.id);
  received(room, ann, JSON.stringify({ t: 'state', to: 'cy', file: { x: 1 } }));
  assert.deepEqual([ann.heard.length, bob.heard.length, cy.heard.at(-1)], [1, 1, { t: 'state', to: 'cy', file: { x: 1 }, from: 'ann' }]);
  received(room, bob, JSON.stringify({ t: 'presence', where: 'synth-2' }));
  assert.deepEqual([ann.heard.at(-1), bob.heard.length], [{ t: 'presence', where: 'synth-2', from: 'bob' }, 1], 'where someone is goes to the others');
  received(room, ann, JSON.stringify({ t: 'op', from: 'cy' }));
  assert.equal(bob.heard.at(-1).from, 'ann', 'nobody can speak as someone else');
  const before = room.map(who => who.heard.length);
  for (const junk of ['not json', '[]', 'null', JSON.stringify({ t: 'welcome' }), JSON.stringify({ t: 'op', pad: 'x'.repeat(MAX_MESSAGE) })]) received(room, ann, junk);
  assert.deepEqual(room.map(who => who.heard.length), before, 'anything else is dropped');
});

// The API with Ian, who owns it, Dana, with whom a project is shared, and Eve, with whom it is not.
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
  const dana = await join('Dana'), eve = await join('Eve');
  await call('PUT', `/projects/${SONG}`, { name: 'Night Drive', baseRevision: 0, project: file(120) }, ian);
  await call('POST', `/projects/${SONG}/share`, { username: 'dana' }, ian);
  return { env, ian, dana, eve };
}
const ask = (path: string, token?: string, upgrade = true) => new Request(`https://api.example${path}`, {
  headers: { ...(upgrade ? { Upgrade: 'websocket' } : {}), ...(token ? { 'Sec-WebSocket-Protocol': `discobot, ${token}` } : {}) },
});
const refused = async (promise: Promise<unknown>) => { try { await promise; return 0; } catch (error) { return (error as { status: number }).status; } };

test('a project\'s live session is open to its owner and to the people it is shared with, and to nobody else', async () => {
  const { env, ian, dana, eve } = await api();
  const owner = await liveTarget(ask(`/live/ian/${SONG}`, ian), env, Date.now());
  const member = await liveTarget(ask(`/live/IAN/${SONG}`, dana), env, Date.now());
  assert.deepEqual([owner.user, member.user], ['Ian', 'Dana']);
  assert.equal(owner.room, member.room, 'the owner and the people it is shared with meet in one room');
  assert.equal(await refused(liveTarget(ask(`/live/ian/${SONG}`, eve), env, Date.now())), 404, 'not shared with Eve');
  assert.equal(await refused(liveTarget(ask(`/live/ian/${SONG}`), env, Date.now())), 401, 'no token');
  assert.equal(await refused(liveTarget(ask(`/live/ian/${SONG}`, 'not-a-session'), env, Date.now())), 401);
  assert.equal(await refused(liveTarget(ask(`/live/ian/${SONG}`, ian, false), env, Date.now())), 426, 'not a live connection');
  assert.equal(await refused(liveTarget(ask('/live/ian/not-a-project', ian), env, Date.now())), 404);
  // A Worker deployed without the rooms says so, rather than failing.
  const response = await handle(ask(`/live/ian/${SONG}`, ian), env);
  assert.equal(response.status, 503);
});

test('two browsers in one room hear each other through the local runner', async () => {
  const { env, ian, dana } = await api();
  resetRooms();
  const server: Server = createServer().on('upgrade', async (incoming, socket) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
    const { user, room } = await liveTarget(new Request(`http://127.0.0.1${incoming.url}`, { headers }), env, Date.now());
    acceptLive(incoming, socket, room, user);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const open = (token: string) => new Promise<{ socket: WebSocket; heard: any[] }>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/live/ian/${SONG}`, ['discobot', token]);
    const heard: any[] = [];
    socket.onmessage = event => heard.push(JSON.parse(String(event.data)));
    socket.onopen = () => resolve({ socket, heard });
    socket.onerror = reject;
  });
  const until = async (check: () => boolean) => { for (let n = 0; n < 100 && !check(); n++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(check()); };
  try {
    const first = await open(ian);
    await until(() => first.heard.some(message => message.t === 'welcome'));
    const second = await open(dana);
    await until(() => first.heard.some(message => message.t === 'send-state'));
    // A big message crosses whole, in the length frames a browser sends.
    const big = { t: 'state', to: second.heard.find(message => message.t === 'welcome').you.id, file: { pad: 'x'.repeat(200_000) } };
    first.socket.send(JSON.stringify(big));
    await until(() => second.heard.some(message => message.t === 'state'));
    assert.equal(second.heard.find(message => message.t === 'state').file.pad.length, 200_000);
    second.socket.send(JSON.stringify({ t: 'op', op: { type: 'tempo.set', tempo: 99 }, keys: ['tempo'] }));
    await until(() => first.heard.some(message => message.t === 'op') && second.heard.some(message => message.t === 'op'));
    assert.equal(first.heard.find(message => message.t === 'op').op.tempo, 99);
    second.socket.close();
    await until(() => first.heard.some(message => message.t === 'leave'));
    first.socket.close();
  } finally {
    server.close();
  }
});
