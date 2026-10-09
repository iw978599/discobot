import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary, type ProjectLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { MAX_SHARE_LENGTH, decodeShare, encodeShare, sharePayload, shareUrl } from '../src/services/shareLink.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const KEY = 'discobot_browser_project_v1';
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

// One "browser profile": a localStorage and a project library that outlive each service.
function browser() {
  const storage = new Map<string, string>();
  const library = createMemoryLibrary();
  const use = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const load = async (lib: ProjectLibrary = library) => {
    use();
    const service = new LocalProjectService();
    service.initialize(defaults());
    await service.openLibrary(lib);
    return service;
  };
  return { storage, library, load, use };
}
const post = (service: LocalProjectService, path: string, body: unknown, method = 'POST') =>
  service.request(path, { method, body: JSON.stringify(body) });
const names = async (service: LocalProjectService) => (await service.listProjects()).map(project => project.name);

test('a first visit starts one project, and it is in the library', async () => {
  const { load } = browser();
  const service = await load();
  const state = service.snapshot();
  assert.equal(state.name, 'Untitled');
  assert.ok(state.projectId);
  assert.deepEqual((await service.listProjects()).map(project => project.id), [state.projectId]);
});

test('projects can be created, opened, copied, renamed and deleted, each keeping its own contents', async () => {
  const { load, library } = browser();
  const service = await load();
  const first = service.snapshot().projectId;
  await post(service, '/tempo', { tempo: 97 });
  await post(service, '/drum/step', { instrument: 'kick', step: 0, active: true });
  assert.equal((await service.renameProject(first, '  Night drive  ')).ok, true);
  assert.equal((await service.renameProject(first, '   ')).ok, false, 'a project needs a name');

  const messages: string[] = [];
  service.subscribe(message => messages.push(message.type));
  messages.length = 0;
  assert.equal((await service.newProject('Second')).ok, true);
  assert.deepEqual(messages, ['init', 'projectsChanged'], 'the app is told to show the new project');
  const second = service.snapshot();
  assert.notEqual(second.projectId, first);
  assert.deepEqual([second.name, second.tempo, second.drumState.kick.steps[0], second.synths.length], ['Second', 120, false, 3]);
  assert.equal((await library.get(first))!.name, 'Night drive', 'the project that was open was put away first');
  await post(service, '/tempo', { tempo: 140 });

  assert.equal((await service.openProject(first)).ok, true);
  assert.deepEqual([service.snapshot().name, service.snapshot().tempo, service.snapshot().drumState.kick.steps[0]], ['Night drive', 97, true]);
  assert.equal((await library.get(second.projectId) as { project: { tempo: number } }).project.tempo, 140, 'edits made just before switching were kept');
  assert.equal((await service.openProject('missing')).ok, false);
  assert.equal(service.snapshot().projectId, first, 'a failed open changes nothing');

  // A copy is a version to go back to: the open project stays open.
  await post(service, '/tempo', { tempo: 101 });
  assert.equal((await service.copyProject(first)).ok, true);
  assert.equal(service.snapshot().projectId, first);
  await post(service, '/tempo', { tempo: 60 });
  const copy = (await service.listProjects()).find(project => project.name === 'Night drive copy')!;
  assert.equal((await library.get(copy.id) as { project: { tempo: number } }).project.tempo, 101, 'the copy has the project as it was, with edits not yet written');
  assert.deepEqual((await names(service)).sort(), ['Night drive', 'Night drive copy', 'Second']);

  assert.equal((await service.deleteProject(second.projectId)).ok, true);
  assert.equal(service.snapshot().projectId, first, 'deleting another project leaves the open one alone');
  assert.equal((await service.deleteProject(first)).ok, true);
  assert.equal(service.snapshot().projectId, copy.id, 'deleting the open project opens the most recent one left');
  assert.equal(service.snapshot().tempo, 101);
  assert.equal((await service.deleteProject(copy.id)).ok, true);
  assert.deepEqual(await names(service), ['Untitled'], 'deleting the last project starts a fresh one');
});

test('the open project and the library both survive a reload', async () => {
  const { load } = browser();
  const service = await load();
  await post(service, '/tempo', { tempo: 88 });
  await service.newProject('B');
  await post(service, '/tempo', { tempo: 133 });
  service.flush();
  const reloaded = await load();
  assert.deepEqual([reloaded.snapshot().name, reloaded.snapshot().tempo], ['B', 133]);
  assert.deepEqual((await names(reloaded)).sort(), ['B', 'Untitled']);
  assert.ok(reloaded.snapshot().revision > 0, 'each save moves the revision on');
});

test('if only the working copy is lost, the latest project in the library is reopened', async () => {
  const { load, storage } = browser();
  const service = await load();
  await post(service, '/tempo', { tempo: 77 });
  await service.renameProject(service.snapshot().projectId, 'Keeper');
  storage.clear();
  const reloaded = await load();
  assert.deepEqual([reloaded.snapshot().name, reloaded.snapshot().tempo], ['Keeper', 77]);
  assert.deepEqual(await names(reloaded), ['Keeper'], 'no stray empty project is left behind');
});

test('arrangements saved by older versions become projects, and only leave the working copy once stored', async () => {
  const { load, storage, use } = browser();
  use();
  const seed = new LocalProjectService();
  seed.initialize(defaults());
  await post(seed, '/tempo', { tempo: 111 });
  seed.flush();
  const stored = JSON.parse(storage.get(KEY)!);
  const lane = stored.synths[0];
  const steps = lane.pattern.steps.map((step: object, i: number) => (i === 0 ? { active: true, note: 'C3', velocity: 0.8 } : step));
  const kit = drums(); kit.snare.steps[4] = true;
  stored.savedPatterns = [
    { id: 'old-1', name: 'Verse idea', createdAt: 1, updatedAt: 2000, tempo: 96, steps, synthParams: lane.synthParams, drumState: kit, drumKitId: 'tr-808', drumSwing: 0.25,
      synths: [{ id: 1, steps, synthParams: lane.synthParams }, { id: 3, steps: lane.pattern.steps, synthParams: lane.synthParams, muted: true }] },
    { id: 'old-2', name: 'Just one lane', createdAt: 1, updatedAt: 1000, tempo: 140, steps, synthParams: { ...lane.synthParams, gain: 0.5 }, drumState: drums() },
  ];
  delete stored.projectId; delete stored.name;
  storage.set(KEY, JSON.stringify(stored));

  // First the library is unavailable: nothing may be thrown away.
  const broken: ProjectLibrary = { list: async () => [], get: async () => undefined, put: async () => { throw new Error('no'); }, remove: async () => {} };
  const stuck = await load(broken);
  const messages: string[] = [];
  stuck.subscribe(message => messages.push(message.type));
  assert.ok(messages.includes('storageError'), 'the problem is reported');
  assert.equal(JSON.parse(storage.get(KEY)!).savedPatterns.length, 2, 'saved arrangements stay put until they are safely stored');

  const service = await load();
  assert.equal(service.snapshot().tempo, 111, 'the open project is untouched');
  assert.deepEqual(await names(service), ['Untitled', 'Verse idea', 'Just one lane']);
  assert.equal(JSON.parse(storage.get(KEY)!).savedPatterns.length, 0);

  assert.equal((await service.openProject('old-1')).ok, true);
  const verse = service.snapshot();
  assert.deepEqual([verse.name, verse.tempo, verse.selectedDrumKitId, verse.drumSwing], ['Verse idea', 96, 'tr-808', 0.25]);
  assert.deepEqual(verse.synths.map(synth => [synth.synthId, synth.muted]), [[1, false], [3, true]]);
  assert.equal(verse.synths[0].pattern.steps[0].note, 'C3');
  assert.equal(verse.drumState.snare.steps[4], true);
  assert.equal(verse.scenes.length, 1, 'it gets a scene like any other project');
  assert.equal(verse.scenes[0].lanes[1][0].note, 'C3');

  await service.openProject('old-2');
  assert.deepEqual([service.snapshot().synths.length, service.snapshot().synths[0].synthParams.gain, service.snapshot().tempo], [1, 0.5, 140]);
  const again = await load();
  assert.equal((await names(again)).length, 3, 'migrating twice does not duplicate anything');
});

test('a project file is added as a new project; the open one is kept', async () => {
  const source = await browser().load();
  await post(source, '/synth/create', { synthId: 2 });
  await post(source, '/synth/2/parameters', { filter: { frequency: 777 } });
  await post(source, '/tempo', { tempo: 97 });
  await post(source, '/drum/step-detail', { instrument: 'kick', step: 2, ratchet: 2 });
  await source.renameProject(source.snapshot().projectId, 'From my laptop');
  await post(source, '/scenes/create', { name: 'Chorus' });
  await post(source, '/sequencer/play', { synthId: 1 });
  const file = JSON.parse(JSON.stringify(source.exportProject()));
  assert.equal(file.format, 'discobot-project');
  assert.equal(file.project.synths[0].isPlaying, false, 'a file never carries a running transport');
  assert.equal(source.snapshot().synths[0].isPlaying, true, 'exporting does not disturb the live project');

  const target = await browser().load();
  await post(target, '/tempo', { tempo: 150 });
  const mine = target.snapshot().projectId;
  assert.deepEqual(await target.importProject(file), { ok: true, repaired: false });
  const state = target.snapshot();
  assert.deepEqual([state.name, state.tempo, state.synths.length, state.synths[1].synthParams.filter.frequency], ['From my laptop', 97, 2, 777]);
  assert.equal(state.drumState.kick.stepRatchets![2], 2);
  assert.deepEqual(state.scenes.map(scene => scene.name), ['Scene 1', 'Chorus']);
  assert.notEqual(state.projectId, file.project.projectId, 'an imported project gets its own identity');
  assert.deepEqual((await names(target)).sort(), ['From my laptop', 'Untitled']);
  await target.importProject(file);
  assert.equal((await names(target)).length, 3, 'importing the same file twice makes two projects, never an overwrite');
  await target.openProject(mine);
  assert.equal(target.snapshot().tempo, 150, 'the project that was open before the import is intact');
});

test('a bad project file is refused and changes nothing; hostile values are repaired', async () => {
  const { load, use } = browser();
  const service = await load();
  await post(service, '/tempo', { tempo: 88 });
  const good = JSON.parse(JSON.stringify(service.exportProject()));
  const id = service.snapshot().projectId;
  for (const bad of [null, [], 'text', {}, { format: 'other', formatVersion: 1, project: good.project },
    { ...good, formatVersion: 2 }, { ...good, project: { version: 1 } }, { ...good, project: null }]) {
    assert.equal((await service.importProject(bad)).ok, false);
    assert.equal(service.readProjectFile(bad).ok, false);
    assert.deepEqual([service.snapshot().projectId, service.snapshot().tempo, (await names(service)).length], [id, 88, 1]);
  }
  const hostile = structuredClone(good);
  hostile.project.tempo = 1e9;
  hostile.project.name = 'x'.repeat(500);
  hostile.project.synths[0].synthParams.gain = 'loud';
  hostile.project.synths.push({ synthId: 9 });
  const preview = service.readProjectFile(hostile);
  assert.ok(preview.ok && preview.project.tempo === 400 && preview.project.name.length === 60);
  assert.equal(service.snapshot().projectId, id, 'looking at a file does not open it');
  assert.deepEqual(await service.importProject(hostile), { ok: true, repaired: true });
  assert.deepEqual([service.snapshot().tempo, service.snapshot().synths.length], [400, 1]);

  // Storage is full: the import is refused and the project that was open comes back.
  const before = service.snapshot().projectId;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } } });
  assert.equal((await service.importProject(good)).ok, false);
  assert.equal(service.snapshot().projectId, before);
  use();
});

test('a share link carries a whole song and survives being pasted around', async () => {
  const service = await browser().load();
  await post(service, '/tempo', { tempo: 128 });
  await service.renameProject(service.snapshot().projectId, 'Friday');
  const pattern = service.snapshot().synths[0].pattern;
  pattern.steps[0] = { active: true, note: 'A3', velocity: 0.9 };
  await post(service, `/synth/1/patterns/${pattern.id}`, pattern, 'PUT');
  await post(service, '/scenes/create', { name: 'Drop' });

  const payload = await encodeShare(service.exportProject());
  assert.match(payload, /^[A-Za-z0-9_-]+$/, 'only characters that are safe in an address');
  const url = shareUrl(payload, 'https://example.test/discobot/?x=1#old');
  assert.equal(url, `https://example.test/discobot/?x=1#song=${payload}`);
  assert.ok(url.length < 6000, `a small song makes a short link (${url.length})`);
  assert.ok(url.length < MAX_SHARE_LENGTH);
  assert.equal(sharePayload(new URL(url).hash), payload);
  assert.equal(sharePayload('#something-else'), null);

  const opened = service.readProjectFile(await decodeShare(payload));
  assert.ok(opened.ok);
  if (opened.ok) {
    assert.deepEqual([opened.project.name, opened.project.tempo, opened.project.scenes.map(scene => scene.name)], ['Friday', 128, ['Scene 1', 'Drop']]);
    assert.equal(opened.project.scenes[0].lanes[1][0].note, 'A3');
    assert.equal(opened.project.synths[0].patterns.length, 1, 'the pattern list left out of the link is rebuilt');
  }
  const friend = await browser().load();
  assert.equal((await friend.importProject(await decodeShare(payload))).ok, true);
  assert.deepEqual([friend.snapshot().name, friend.snapshot().tempo], ['Friday', 128]);

  await assert.rejects(decodeShare('not*valid*base64'));
  await assert.rejects(decodeShare(payload.slice(0, 40)), 'a link cut short is reported, not half-loaded');
  await assert.rejects(decodeShare('A'.repeat(MAX_SHARE_LENGTH * 2 + 1)));
});
