import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService, MAX_VERSIONS } from '../src/services/localService.ts';
import { createMemoryLibrary, type ProjectLibrary } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35, pan: 0 },
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

// One browser profile; `load` is a page load.
function browser(library: ProjectLibrary = createMemoryLibrary()) {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const load = async () => {
    const service = new LocalProjectService();
    service.initialize(defaults());
    await service.openLibrary(library);
    return service;
  };
  return { load, library };
}
const tempo = async (service: LocalProjectService, bpm: number) => {
  await service.request('/tempo', { method: 'POST', body: JSON.stringify({ tempo: bpm }) });
  service.flush();
  // Keeping a version is asynchronous; let it finish.
  await new Promise(resolve => setTimeout(resolve, 5));
};
const reasons = async (service: LocalProjectService) => (await service.listVersions()).map(version => version.reason);

test('a version is kept when a project is opened, then at intervals while it is edited, and never twice the same', async () => {
  const { load } = browser();
  let service = await load();
  assert.deepEqual(await reasons(service), ['opened'], 'the project as first found');
  await tempo(service, 100);
  await tempo(service, 101);
  assert.deepEqual(await reasons(service), ['opened'], 'edits inside the interval do not each make a version');

  service.versionIntervalMs = 0;
  await tempo(service, 102);
  await tempo(service, 103);
  assert.deepEqual(await reasons(service), ['auto', 'auto', 'opened']);
  service.flush();
  await service.openProject(service.snapshot().projectId);
  await tempo(service, 103);
  assert.equal((await service.listVersions()).length, 3, 'saving without changing anything keeps nothing');

  // A reload: the project as opened is the same as the last version, so nothing new.
  service = await load();
  assert.equal((await service.listVersions()).length, 3);
  assert.equal(service.snapshot().tempo, 103);
});

test('an earlier version can be restored, and restoring can be taken back', async () => {
  const { load } = browser();
  const service = await load();
  service.versionIntervalMs = 0;
  await service.renameProject(service.snapshot().projectId, 'Night Drive');
  await tempo(service, 90);
  await service.request('/drum/step', { method: 'POST', body: JSON.stringify({ instrument: 'kick', step: 0, active: true }) });
  service.flush();
  await new Promise(resolve => setTimeout(resolve, 5));
  await tempo(service, 150);
  await service.request('/drum/step', { method: 'POST', body: JSON.stringify({ instrument: 'kick', step: 0, active: false }) });
  service.flush();
  await new Promise(resolve => setTimeout(resolve, 5));

  const versions = await service.listVersions();
  const id = service.snapshot().projectId;
  // Find the version with the kick on step 1 at 90 BPM.
  let wanted = '';
  for (const version of versions) {
    const stored = (await (service as any).library.getVersion(version.id)).project;
    if (stored.tempo === 90 && stored.drumState.kick.steps[0]) wanted = version.id;
  }
  assert.ok(wanted, 'the earlier state was kept');

  await service.renameProject(id, 'Renamed since');
  assert.deepEqual(await service.restoreVersion(wanted), { ok: true, repaired: false });
  const restored = service.snapshot();
  assert.deepEqual([restored.tempo, restored.drumState.kick.steps[0], restored.projectId], [90, true, id]);
  assert.equal(restored.name, 'Renamed since', 'restoring brings back the music, not an old name');
  const after = await service.listVersions();
  // The project as it was just before is the newest version. (It had already been kept while
  // editing, so it is not kept a second time under another label.)
  assert.equal(((await (service as any).library.getVersion(after[0].id)).project as any).tempo, 150);

  assert.deepEqual(await service.restoreVersion(after[0].id), { ok: true, repaired: false });
  assert.deepEqual([service.snapshot().tempo, service.snapshot().drumState.kick.steps[0]], [150, false], 'the restore itself is undone');
  assert.deepEqual(await service.restoreVersion('no-such-version'), { ok: false, error: 'That version is no longer available.' });
});

test('a version can be saved as a project of its own', async () => {
  const { load } = browser();
  const service = await load();
  service.versionIntervalMs = 0;
  await service.renameProject(service.snapshot().projectId, 'Song');
  await tempo(service, 77);
  await tempo(service, 140);
  const versions = await service.listVersions();
  let earlier = '';
  for (const version of versions) if ((await (service as any).library.getVersion(version.id)).project.tempo === 77) earlier = version.id;
  assert.deepEqual(await service.copyVersion(earlier), { ok: true });
  assert.equal(service.snapshot().tempo, 140, 'the open project is untouched');
  const copy = (await service.listProjects()).find(project => project.name === 'Song (earlier version)')!;
  await service.openProject(copy.id);
  assert.equal(service.snapshot().tempo, 77);
  assert.notEqual(copy.id, versions[0].projectId);
});

test('only the newest versions are kept, each project has its own, and deleting a project removes them', async () => {
  const { load, library } = browser();
  const service = await load();
  service.versionIntervalMs = 0;
  const first = service.snapshot().projectId;
  for (let bpm = 60; bpm < 60 + MAX_VERSIONS + 6; bpm++) await tempo(service, bpm);
  const kept = await service.listVersions();
  assert.equal(kept.length, MAX_VERSIONS);
  assert.equal((await library.getVersion(kept[0].id))!.project && ((await library.getVersion(kept[0].id))!.project as any).tempo, 60 + MAX_VERSIONS + 5, 'the newest is kept');

  await service.newProject('Second');
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = service.snapshot().projectId;
  await tempo(service, 99);
  assert.ok((await service.listVersions()).every(version => version.projectId === second));
  assert.equal((await service.listVersions(first)).length, MAX_VERSIONS, 'the first project\'s versions are still its own');

  await service.deleteProject(first);
  assert.deepEqual(await service.listVersions(first), []);
  assert.ok((await service.listVersions(second)).length > 0);
});
