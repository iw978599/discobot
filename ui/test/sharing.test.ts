import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { AccountError, type ProjectsApi, type SharingApi } from '../src/services/account.ts';
import { createProjectSync } from '../src/services/projectSync.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { handle, type Env } from '../../server/src/index.ts';
import { createLocalDatabase } from '../../server/src/localDatabase.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const PASSWORD = 'correct horse battery';
const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5 },
}])) as DrumState;
const effectsLoop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};
const defaults = () => ({
  synthParams: createDefaultSynthParameters(), drumState: drums(),
  drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop,
});

// The real API, in memory, with two accounts: Ian, and Dana whom he invited.
async function server() {
  const env: Env = { DB: createLocalDatabase(), ALLOWED_ORIGINS: '', OWNER_INVITE: 'owner-secret' };
  const calls: string[] = [];
  const raw = async (method: string, path: string, body?: unknown, token?: string) => {
    calls.push(`${method} ${path.replace(/[0-9a-f-]{36}/, ':id')}`);
    const response = await handle(new Request(`https://api.example${path}`, {
      method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const data = await response.json() as Record<string, any>;
    if (!response.ok && response.status !== 409) throw new AccountError(data.error, response.status);
    return { status: response.status, data };
  };
  const tokens: Record<string, string> = {};
  tokens.Ian = (await raw('POST', '/signup', { username: 'Ian', password: PASSWORD, invite: 'owner-secret' })).data.token;
  const invite = (await raw('POST', '/invites', {}, tokens.Ian)).data.code;
  tokens.Dana = (await raw('POST', '/signup', { username: 'Dana', password: PASSWORD, invite })).data.token;
  const projects = (token: string): ProjectsApi => ({
    list: async () => (await raw('GET', '/projects', undefined, token)).data.projects,
    get: async id => (await raw('GET', `/projects/${id}`, undefined, token)).data.project,
    put: async (id, name, baseRevision, project) => { const { status, data } = await raw('PUT', `/projects/${id}`, { name, baseRevision, project }, token); return status === 409 ? 'changed' : data.revision; },
    remove: async (id, baseRevision) => ((await raw('POST', `/projects/${id}/delete`, { baseRevision }, token)).status === 409 ? 'changed' : 'removed'),
  });
  const sharing = (token: string): Pick<SharingApi, 'list' | 'get' | 'put' | 'leave'> => ({
    list: async () => (await raw('GET', '/shared', undefined, token)).data.projects,
    get: async (owner, id) => (await raw('GET', `/shared/${owner}/${id}`, undefined, token)).data.project,
    put: async (owner, id, name, baseRevision, project) => { const { status, data } = await raw('PUT', `/shared/${owner}/${id}`, { name, baseRevision, project }, token); return status === 409 ? 'changed' : data.revision; },
    leave: async (owner, id) => { await raw('POST', `/shared/${owner}/${id}/leave`, {}, token); },
  });
  const names = async (username: string) => ((await raw('GET', '/projects', undefined, tokens[username])).data.projects as any[]).filter(project => !project.deleted).map(project => project.name).sort();
  const members = async (id: string) => (await raw('GET', `/projects/${id}/sharing`, undefined, tokens.Ian)).data.members as string[];
  const share = (id: string, action: 'share' | 'unshare' = 'share') => raw('POST', `/projects/${id}/${action}`, { username: 'dana' }, tokens.Ian);
  return { raw, calls, tokens, projects, sharing, names, members, share };
}
type Remote = Awaited<ReturnType<typeof server>>;

// One person's browser, signed in: its own localStorage and project library.
async function browser(remote: Remote, username: 'Ian' | 'Dana', sharing: Pick<SharingApi, 'list' | 'get' | 'put' | 'leave'> | undefined = remote.sharing(remote.tokens[username])) {
  const storage = new Map<string, string>();
  const use = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  use();
  const service = new LocalProjectService();
  service.initialize(defaults());
  await service.openLibrary(createMemoryLibrary());
  const sync = createProjectSync({
    store: service, api: remote.projects(remote.tokens[username]), sharing, user: () => username,
    storage: { read: () => storage.get('sync') ?? null, write: text => { storage.set('sync', text); } },
  });
  const run = async () => { use(); await sync.sync(); };
  await run();
  const idOf = async (name: string) => (await service.listProjects()).find(project => project.name === name)!.id;
  return {
    service, sync, use, run, idOf,
    names: async () => { use(); return (await service.listProjects()).map(project => project.name).sort(); },
    tempo: async (name: string, bpm?: number) => {
      use();
      await service.openProject(await idOf(name));
      if (bpm !== undefined) { await service.request('/tempo', { method: 'POST', body: JSON.stringify({ tempo: bpm }) }); service.flush(); }
      return service.snapshot().tempo;
    },
    make: async (name: string, bpm: number) => {
      use();
      await service.newProject(name);
      await service.request('/tempo', { method: 'POST', body: JSON.stringify({ tempo: bpm }) });
      service.flush();
      await sync.sync();
      return service.snapshot().projectId;
    },
  };
}
const puts = (remote: Remote) => remote.calls.filter(call => call.startsWith('PUT')).length;

test('a shared project opens in the other person\'s browser when they ask, and each one\'s saves reach the other', async () => {
  const remote = await server();
  const ian = await browser(remote, 'Ian'), dana = await browser(remote, 'Dana');
  const song = await ian.make('Night Drive', 97);
  await remote.share(song);

  // It is offered to Dana. Nothing of Ian's is in her browser until she asks.
  await dana.run();
  assert.deepEqual(dana.sync.status().offered.map(project => [project.owner, project.name]), [['Ian', 'Night Drive']]);
  assert.deepEqual(await dana.names(), ['Untitled']);

  assert.equal(await dana.sync.join('Ian', song), true);
  assert.deepEqual(await dana.names(), ['Night Drive', 'Untitled']);
  assert.equal(await dana.tempo('Night Drive'), 97);
  const status = dana.sync.status();
  assert.deepEqual(status.shared, { [song]: { owner: 'Ian', savedBy: 'Ian' } });
  assert.deepEqual(status.offered, []);
  assert.ok(!status.inAccount.includes(song) && !status.browserOnly.includes(song), 'it is neither in Dana\'s account nor a project of this browser only');
  assert.deepEqual(await remote.names('Dana'), [], 'it stays in Ian\'s account, and is not copied into Dana\'s');

  // Dana takes a turn; it reaches Ian, who is told whose save it was.
  await dana.tempo('Night Drive', 120);
  await dana.run();
  await ian.run();
  assert.equal(await ian.tempo('Night Drive'), 120);
  assert.deepEqual(ian.sync.status().updates, [{ name: 'Night Drive', by: 'Dana' }]);
  assert.deepEqual(ian.sync.status().sharedByMe, { [song]: { people: 1, savedBy: 'Dana' } });
  ian.sync.dismissShared();

  // Ian takes his; it reaches Dana.
  await ian.tempo('Night Drive', 80);
  await ian.run();
  await dana.run();
  assert.equal(await dana.tempo('Night Drive'), 80);
  assert.deepEqual(dana.sync.status().updates, [{ name: 'Night Drive', by: 'Ian' }]);
  assert.deepEqual(ian.sync.status().updates, [], 'a person is not told about their own save');

  // With nothing changed, looking again uploads nothing from either side.
  const before = puts(remote);
  for (const person of [ian, dana, ian, dana]) await person.run();
  assert.equal(puts(remote), before);
  assert.deepEqual(await remote.names('Dana'), []);
});

test('when both change a shared project at once, both versions are kept', async () => {
  const remote = await server();
  const ian = await browser(remote, 'Ian'), dana = await browser(remote, 'Dana');
  const song = await ian.make('Night Drive', 97);
  await remote.share(song);
  await dana.sync.join('Ian', song);

  await ian.tempo('Night Drive', 100);
  await dana.tempo('Night Drive', 150);
  await ian.run();
  await dana.run();

  assert.deepEqual(dana.sync.status().keptBoth, ['Night Drive']);
  assert.deepEqual(await dana.names(), ['Night Drive', 'Night Drive (this browser\'s version)', 'Untitled']);
  assert.equal(await dana.tempo('Night Drive'), 100, 'the shared project is as Ian saved it');
  assert.equal(await dana.tempo('Night Drive (this browser\'s version)'), 150, 'and what Dana was doing is kept beside it');
  await dana.run();
  assert.deepEqual(await remote.names('Dana'), ['Night Drive (this browser\'s version)'], 'the copy she kept is her own project');
  assert.deepEqual(Object.keys(dana.sync.status().shared), [song], 'and the shared one is still shared');
  await ian.run();
  assert.equal(await ian.tempo('Night Drive'), 100, 'nothing of Ian\'s was overwritten');
});

test('a shared project that stops being shared stays where it is, as an ordinary project', async () => {
  const remote = await server();
  const ian = await browser(remote, 'Ian'), dana = await browser(remote, 'Dana');
  const [one, two, three] = [await ian.make('One', 90), await ian.make('Two', 91), await ian.make('Three', 92)];
  for (const id of [one, two, three]) { await remote.share(id); assert.equal(await dana.sync.join('Ian', id), true); }

  // Ian stops sharing One. Dana keeps her copy; it is hers alone now and goes nowhere.
  await remote.share(one, 'unshare');
  await dana.tempo('One', 140);
  await dana.run();
  assert.deepEqual(dana.sync.status().ended, ['One']);
  assert.deepEqual(Object.keys(dana.sync.status().shared).sort(), [two, three].sort());
  assert.ok(dana.sync.status().browserOnly.includes(one));
  assert.equal(await dana.tempo('One'), 140);
  await ian.run();
  assert.equal(await ian.tempo('One'), 90, 'her later edits do not reach him');
  assert.deepEqual(await remote.names('Dana'), []);
  // Shared again, it is not put on top of the copy she kept.
  await remote.share(one);
  await dana.run();
  assert.equal(await dana.sync.join('Ian', one), false);
  assert.equal(await dana.tempo('One'), 140);

  // Dana leaves Two herself, keeping her copy.
  await dana.sync.leave(two);
  assert.deepEqual(await remote.members(two), []);
  assert.ok((await dana.names()).includes('Two'));
  assert.ok(dana.sync.status().browserOnly.includes(two));

  // Dana deletes Three from her browser: she has left, and Ian's project is untouched.
  dana.use();
  await dana.service.deleteProject(three);
  await dana.sync.noteDeleted(three);
  assert.deepEqual(await remote.members(three), []);
  assert.ok(!(await dana.names()).includes('Three'));
  await dana.run();
  assert.ok(!(await dana.names()).includes('Three'), 'and it does not come back');
  assert.deepEqual(await remote.names('Ian'), ['One', 'Three', 'Two']);
  assert.equal(await ian.tempo('Three'), 92);
});

test('a project its owner deletes leaves the other person their copy', async () => {
  const remote = await server();
  const ian = await browser(remote, 'Ian'), dana = await browser(remote, 'Dana');
  const song = await ian.make('Night Drive', 97);
  await remote.share(song);
  await dana.sync.join('Ian', song);

  ian.use();
  await ian.service.deleteProject(song);
  await ian.sync.noteDeleted(song);
  assert.deepEqual(await remote.names('Ian'), [], 'it is gone from his account');
  await dana.run();
  assert.deepEqual(dana.sync.status().ended, ['Night Drive']);
  assert.equal(await dana.tempo('Night Drive'), 97);
  assert.deepEqual(dana.sync.status().shared, {});
});

test('a server that has never heard of sharing changes nothing', async () => {
  const remote = await server();
  const ian = await browser(remote, 'Ian'), dana = await browser(remote, 'Dana');
  const song = await ian.make('Night Drive', 97);
  await remote.share(song);
  await dana.sync.join('Ian', song);

  // The same browser storage, against an API from before sharing existed.
  let old = true;
  const real = remote.sharing(remote.tokens.Dana);
  const sometimes: Pick<SharingApi, 'list' | 'get' | 'put' | 'leave'> = {
    ...real, list: async () => { if (old) throw new AccountError('Not found.', 404); return real.list(); },
  };
  const later = createProjectSync({
    store: dana.service, api: remote.projects(remote.tokens.Dana), sharing: sometimes, user: () => 'Dana',
    storage: (() => { let text: string | null = null; return { read: () => text, write: (next: string) => { text = next; } }; })(),
  });
  dana.use();
  await later.sync();
  assert.equal(later.status().state, 'idle', 'it is not an error');
  assert.deepEqual(later.status().offered, []);

  // And with no sharing at all, a browser syncs its own projects exactly as before.
  const alone = await browser(remote, 'Ian', undefined);
  assert.deepEqual(await alone.names(), ['Night Drive', 'Untitled']);
  assert.deepEqual(alone.sync.status().shared, {});
  old = false;
});
