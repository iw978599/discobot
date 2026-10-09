import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary, type ProjectLibrary } from '../src/services/projectLibrary.ts';
import { AccountError, type ProjectsApi } from '../src/services/account.ts';
import { createProjectSync } from '../src/services/projectSync.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { MAX_PROJECTS, handle, type Env } from '../../server/src/index.ts';
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

// The real API, in memory, with one account already made.
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
  const api = (token: string): ProjectsApi => ({
    list: async () => (await raw('GET', '/projects', undefined, token)).data.projects,
    get: async id => (await raw('GET', `/projects/${id}`, undefined, token)).data.project,
    put: async (id, name, baseRevision, project) => { const { status, data } = await raw('PUT', `/projects/${id}`, { name, baseRevision, project }, token); return status === 409 ? 'changed' : data.revision; },
    remove: async (id, baseRevision) => ((await raw('POST', `/projects/${id}/delete`, { baseRevision }, token)).status === 409 ? 'changed' : 'removed'),
  });
  const owner = (await raw('POST', '/signup', { username: 'Ian', password: PASSWORD, invite: 'owner-secret' })).data;
  const signIn = async () => (await raw('POST', '/signin', { username: 'ian', password: PASSWORD })).data.token as string;
  return { env, raw, api, owner, signIn, calls };
}

// One browser: its own localStorage and project library, and a sync wired to the server.
async function browser(remote: Awaited<ReturnType<typeof server>>, library: ProjectLibrary = createMemoryLibrary()) {
  const storage = new Map<string, string>();
  const use = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  use();
  const service = new LocalProjectService();
  service.initialize(defaults());
  await service.openLibrary(library);
  let token: string | null = null;
  let api: ProjectsApi | null = null;
  const sync = createProjectSync({
    store: service,
    api: { list: () => api!.list(), get: id => api!.get(id), put: (...args) => api!.put(...args), remove: (...args) => api!.remove(...args) },
    user: () => (token ? 'Ian' : null),
    storage: { read: () => storage.get('sync') ?? null, write: text => { storage.set('sync', text); } },
  });
  const run = async () => { use(); await sync.sync(); };
  await run();
  return {
    service, sync, storage, library, use, run,
    signIn: async () => { token = await remote.signIn(); api = remote.api(token); await run(); },
    signOut: async () => { token = null; await run(); },
    edit: async (path: string, body: unknown) => { use(); await service.request(path, { method: 'POST', body: JSON.stringify(body) }); service.flush(); },
    names: async () => { use(); return (await service.listProjects()).map(project => project.name).sort(); },
    idOf: async (name: string) => (await service.listProjects()).find(project => project.name === name)!.id,
  };
}
const accountNames = async (remote: Awaited<ReturnType<typeof server>>) =>
  ((await remote.raw('GET', '/projects', undefined, remote.owner.token)).data.projects as any[]).filter(project => !project.deleted).map(project => project.name).sort();
const puts = (remote: Awaited<ReturnType<typeof server>>) => remote.calls.filter(call => call.startsWith('PUT')).length;

test('signing in uploads nothing until asked, then projects follow the account to another browser', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.service.renameProject(laptop.service.snapshot().projectId, 'Old song');
  await laptop.edit('/tempo', { tempo: 97 });

  await laptop.signIn();
  assert.deepEqual(await accountNames(remote), [], 'projects that were here before signing in stay here');
  assert.deepEqual(laptop.sync.status().browserOnly.length, 1);

  laptop.use();
  await laptop.service.newProject('Made signed in');
  await laptop.edit('/drum/step', { instrument: 'kick', step: 0, active: true });
  await laptop.run();
  assert.deepEqual(await accountNames(remote), ['Made signed in'], 'a project made while signed in is the account\'s');

  await laptop.sync.addToAccount([await laptop.idOf('Old song')]);
  assert.deepEqual(await accountNames(remote), ['Made signed in', 'Old song']);
  assert.deepEqual(laptop.sync.status().browserOnly, []);

  const phone = await browser(remote);
  await phone.signIn();
  assert.deepEqual(await phone.names(), ['Made signed in', 'Old song', 'Untitled'], 'the phone keeps its own project and gains the account\'s');
  assert.equal(phone.sync.status().browserOnly.length, 1);
  phone.use();
  await phone.service.openProject(await phone.idOf('Old song'));
  assert.equal(phone.service.snapshot().tempo, 97);
  await phone.service.openProject(await phone.idOf('Made signed in'));
  assert.equal(phone.service.snapshot().drumState.kick.steps[0], true);
});

test('an unchanged project is never uploaded again, however often it is opened or saved', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('One');
  await laptop.service.newProject('Two');
  await laptop.run();
  const phone = await browser(remote);
  await phone.signIn();
  const before = puts(remote);

  for (const device of [laptop, phone]) {
    device.use();
    await device.service.openProject(await device.idOf('One'));
    await device.run();
    await device.service.openProject(await device.idOf('Two'));
    device.service.flush();
    await device.run();
    await device.run();
  }
  assert.equal(puts(remote), before, 'opening, switching and re-saving are not edits');
});

test('an edit in one browser reaches the other, including the project it has open', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('Shared');
  await laptop.run();
  const phone = await browser(remote);
  await phone.signIn();
  phone.use();
  await phone.service.openProject(await phone.idOf('Shared'));

  await laptop.edit('/tempo', { tempo: 133 });
  await laptop.run();
  await phone.run();
  assert.equal(phone.service.snapshot().tempo, 133);
  assert.equal(phone.service.snapshot().name, 'Shared');
  // What the download replaced is still there as a version.
  phone.use();
  const kept = await phone.service.listVersions();
  const tempos = await Promise.all(kept.map(async version => ((await phone.library.getVersion(version.id))!.project as { tempo: number }).tempo));
  assert.ok(tempos.includes(120), 'the copy the phone had before the sync can be restored');

  await phone.edit('/tempo', { tempo: 88 });
  await phone.run();
  await laptop.run();
  assert.equal(laptop.service.snapshot().tempo, 88);
  assert.deepEqual(await laptop.names(), await phone.names());
  assert.deepEqual(laptop.sync.status().keptBoth, []);
});

test('a project changed in two browsers is kept twice, and nothing is overwritten', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('Clash');
  await laptop.run();
  const phone = await browser(remote);
  await phone.signIn();
  phone.use();
  await phone.service.openProject(await phone.idOf('Clash'));

  await laptop.edit('/tempo', { tempo: 100 });
  await phone.edit('/tempo', { tempo: 150 });
  await laptop.run();
  await phone.run();

  assert.equal(phone.service.snapshot().tempo, 150, 'the phone is still looking at its own edits');
  assert.equal(phone.service.snapshot().name, 'Clash (this browser\'s version)');
  assert.deepEqual(phone.sync.status().keptBoth, ['Clash']);
  phone.use();
  await phone.service.openProject(await phone.idOf('Clash'));
  assert.equal(phone.service.snapshot().tempo, 100, 'and has the laptop\'s version beside it');

  await laptop.run();
  assert.deepEqual(await laptop.names(), ['Clash', 'Clash (this browser\'s version)', 'Untitled']);
  assert.equal(laptop.service.snapshot().tempo, 100);
  laptop.use();
  await laptop.service.openProject(await laptop.idOf('Clash (this browser\'s version)'));
  assert.equal(laptop.service.snapshot().tempo, 150);
});

test('deleting a project removes it everywhere, unless it was changed elsewhere first', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('Gone');
  await laptop.service.newProject('Rescued');
  await laptop.service.newProject('Edited then deleted elsewhere');
  await laptop.run();
  const phone = await browser(remote);
  await phone.signIn();

  const remove = async (device: typeof laptop, name: string) => {
    device.use();
    const id = await device.idOf(name);
    await device.service.deleteProject(id);
    await device.sync.noteDeleted(id);
  };
  await remove(laptop, 'Gone');
  await phone.run();
  assert.equal((await phone.names()).includes('Gone'), false);
  assert.equal((await accountNames(remote)).includes('Gone'), false);

  // The phone edits a project and syncs; the laptop, not having seen that, deletes it.
  phone.use();
  await phone.service.openProject(await phone.idOf('Rescued'));
  await phone.edit('/tempo', { tempo: 77 });
  await phone.run();
  await remove(laptop, 'Rescued');
  assert.equal((await laptop.names()).includes('Rescued'), true, 'the newer version comes back instead of being deleted');
  laptop.use();
  await laptop.service.openProject(await laptop.idOf('Rescued'));
  assert.equal(laptop.service.snapshot().tempo, 77);

  // The phone has unsent edits to a project the laptop deletes.
  phone.use();
  await phone.service.openProject(await phone.idOf('Edited then deleted elsewhere'));
  await phone.edit('/tempo', { tempo: 66 });
  await remove(laptop, 'Edited then deleted elsewhere');
  await phone.run();
  assert.equal(phone.service.snapshot().tempo, 66, 'unsent edits are not thrown away');
  assert.equal(phone.sync.status().browserOnly.includes(phone.service.snapshot().projectId), true, 'it stays, as a project in this browser only');
  await phone.run();
  assert.equal((await accountNames(remote)).includes('Edited then deleted elsewhere'), false, 'and is not quietly put back in the account');
});

test('losing the browser\'s projects does not delete them from the account', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('Precious');
  await laptop.edit('/tempo', { tempo: 111 });
  await laptop.run();

  // The project library is wiped, but the browser still remembers what it had synced.
  const wiped = await browser(remote);
  wiped.storage.set('sync', laptop.storage.get('sync')!);
  await wiped.signIn();
  assert.deepEqual(await accountNames(remote), ['Precious']);
  assert.equal((await wiped.names()).includes('Precious'), true, 'it is downloaded again');
});

test('signing out leaves the projects here and stops syncing; signing back in resumes', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('Mine');
  await laptop.run();
  await laptop.signOut();
  assert.equal(laptop.sync.status().signedIn, false);
  assert.equal((await laptop.names()).includes('Mine'), true);

  const before = remote.calls.length;
  await laptop.edit('/tempo', { tempo: 140 });
  laptop.use();
  await laptop.service.newProject('Made signed out');
  await laptop.run();
  assert.equal(remote.calls.length, before, 'signed out, nothing is sent');

  await laptop.signIn();
  assert.deepEqual(await accountNames(remote), ['Mine'], 'a project made while signed out waits to be added');
  const phone = await browser(remote);
  await phone.signIn();
  phone.use();
  await phone.service.openProject(await phone.idOf('Mine'));
  assert.equal(phone.service.snapshot().tempo, 140, 'edits made while signed out are sent on signing back in');
});

test('the account only gives projects to their owner, and enforces its limits', async () => {
  const remote = await server();
  const laptop = await browser(remote);
  await laptop.signIn();
  laptop.use();
  await laptop.service.newProject('Private');
  await laptop.run();
  const id = await laptop.idOf('Private');
  const file = laptop.service.fileFor((await laptop.service.syncRecords())!.find(entry => entry.id === id)!);

  const invite = (await remote.raw('POST', '/invites', {}, remote.owner.token)).data.code;
  const friend = (await remote.raw('POST', '/signup', { username: 'friend', password: PASSWORD, invite })).data.token;
  assert.deepEqual((await remote.raw('GET', '/projects', undefined, friend)).data.projects, []);
  await assert.rejects(remote.raw('GET', `/projects/${id}`, undefined, friend), { status: 404 });
  await assert.rejects(remote.raw('GET', '/projects'), { status: 401 });
  assert.equal((await remote.raw('PUT', `/projects/${id}`, { name: 'Theirs', baseRevision: 0, project: file }, friend)).status, 201, 'the same id in another account is a different project');
  laptop.use();
  await laptop.run();
  assert.equal(laptop.service.snapshot().name, 'Private');

  assert.equal((await remote.raw('PUT', `/projects/${id}`, { name: 'Stale', baseRevision: 0, project: file }, remote.owner.token)).status, 409);
  await assert.rejects(remote.raw('PUT', `/projects/${id}`, { name: 'Bad', baseRevision: 1, project: { format: 'something-else' } }, remote.owner.token), { status: 400 });
  await assert.rejects(remote.raw('PUT', '/projects/not-an-id', { name: 'Bad', baseRevision: 0, project: file }, remote.owner.token), { status: 404 });
  await assert.rejects(remote.raw('PUT', `/projects/${id}`, { name: 'Huge', baseRevision: 1, project: { format: 'discobot-project', filler: 'x'.repeat(400_001) } }, remote.owner.token), { status: 413 });

  for (let count = 1; count < MAX_PROJECTS; count++) {
    await remote.raw('PUT', `/projects/${crypto.randomUUID()}`, { name: `Filler ${count}`, baseRevision: 0, project: { format: 'discobot-project' } }, friend);
  }
  await assert.rejects(remote.raw('PUT', `/projects/${crypto.randomUUID()}`, { name: 'One too many', baseRevision: 0, project: { format: 'discobot-project' } }, friend), { status: 507 });

  await remote.raw('POST', '/account/delete', { password: PASSWORD }, friend);
  const left = (await remote.env.DB.prepare('SELECT name FROM projects').all<{ name: string }>()).results.map(row => row.name);
  assert.deepEqual(left, ['Private'], 'deleting an account deletes its projects');
});
