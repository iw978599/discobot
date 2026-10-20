import test from 'node:test';
import assert from 'node:assert/strict';
import { chosenMember, familyName, projectFamilies } from '../src/services/projectFamilies.ts';
import { LocalProjectService } from '../src/services/localService.ts';
import { createMemoryLibrary, type ProjectInfo } from '../src/services/projectLibrary.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import type { DrumState, EffectsLoopState } from '../src/types.ts';

const list = (...names: string[]): ProjectInfo[] => names.map((name, index) => ({ id: `p${index}`, name, updatedAt: 1000 - index }));
const shape = (projects: ProjectInfo[]) => projectFamilies(projects).map(family => (family.members.length === 1 ? [family.title] : [family.title, ...family.members.map(member => member.label)]));

test('a project and the copies the app names after it are one family', () => {
  assert.deepEqual(shape(list('Song copy', 'Song', 'Song 2', 'Song (this browser\'s version)', 'Song (earlier version)', 'Other')), [
    ['Song', 'Original', 'copy', '2', 'this browser\'s version', 'earlier version'],
    ['Other'],
  ], 'the plain name comes first, the rest keep the order they arrived in');
  assert.deepEqual(shape(list('Song copy 2', 'Song copy copy', 'Song (this browser\'s version) 3', 'Song')), [
    ['Song', 'Original', 'copy 2', 'copy copy', 'this browser\'s version 3'],
  ], 'endings stack: a copy of a copy is still the same song');
  assert.equal(familyName('Song copy 12'), 'Song');
});

test('a project on its own is a family of one, under its whole name', () => {
  assert.deepEqual(shape(list('Song')), [['Song']]);
  assert.deepEqual(shape(list('Song copy')), [['Song copy']], 'the last one left keeps its full name');
  assert.deepEqual(shape([]), []);
});

test('a family whose original is gone still groups under the shared name', () => {
  const families = projectFamilies(list('Song copy', 'Song 2'));
  assert.deepEqual(shape(list('Song copy', 'Song 2')), [['Song', 'copy', '2']]);
  assert.equal(families[0].key, 'song');
});

test('names that only look like a generated ending are left alone', () => {
  for (const name of ['Photocopy', 'Song copy.', 'Song Copy', 'Song (copy)', 'Song 1', 'Song 02', 'Song2', 'Song v2', 'Song (this browser version)',
    'Song (earlier versions)', 'copy', '2', '12', 'Song  copy', 'Song -2', 'Song 2.5']) {
    assert.equal(familyName(name), name, name);
  }
  assert.deepEqual(shape(list('Song', 'Songs', 'Song remix', 'Song 1', 'Photocopy')), [['Song'], ['Songs'], ['Song remix'], ['Song 1'], ['Photocopy']]);
});

test('capital letters do not split a family, as they do not make a name unique', () => {
  assert.deepEqual(shape(list('song copy', 'Song')), [['Song', 'Original', 'copy']]);
});

test('a row acts on the member picked, else the open project, else the one changed last', () => {
  const [family] = projectFamilies([{ id: 'a', name: 'Song', updatedAt: 5 }, { id: 'b', name: 'Song copy', updatedAt: 9 }, { id: 'c', name: 'Song 2', updatedAt: 7 }]);
  assert.equal(chosenMember(family, undefined, 'elsewhere').id, 'b', 'the most recently changed');
  assert.equal(chosenMember(family, undefined, 'c').id, 'c', 'the open project');
  assert.equal(chosenMember(family, 'a', 'c').id, 'a', 'the one picked');
  assert.equal(chosenMember(family, 'renamed-away', 'c').id, 'c', 'a pick that has left the family is forgotten');
});

// The names below are made by the app itself, so a change to how it names a copy fails here.
const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 0.8, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35, pan: 0 },
}])) as DrumState;
const effectsLoop: EffectsLoopState = {
  enabled: true, returns: { synth: .8, drums: .7 }, drive: { enabled: true, amount: .2, tone: .6 },
  phaser: { enabled: false, rate: .5, depth: .4, feedback: .2, mix: .2 },
  delay: { enabled: true, time: .2, feedback: .3, mix: .3 }, reverb: { enabled: true, decay: 2, mix: .3 },
};

test('every name the app gives a copy lands in the family of the project it came from', async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } });
  const service = new LocalProjectService();
  service.initialize({ synthParams: createDefaultSynthParameters(), drumState: drums(), drumFx: { sends: { reverb: .2, delay: .1, drive: .1, phaser: 0 }, returnLevel: .7 }, effectsLoop });
  await service.openLibrary(createMemoryLibrary());
  const id = service.snapshot().projectId;
  await service.copyProject(id);
  await service.copyProject(id);
  const [version] = await service.listVersions();
  await service.copyVersion(version.id);
  await service.syncFork((await service.listProjects()).find(project => project.name === 'Untitled copy')!.id, 'Untitled (this browser\'s version)');
  await service.newProject();
  await service.newProject('Something else');

  const families = projectFamilies(await service.listProjects());
  // A second new project is "Untitled 2": a project of its own, not a version of the first.
  assert.deepEqual(families.map(family => family.title).sort(), ['Something else', 'Untitled', 'Untitled 2']);
  assert.deepEqual(families.find(family => family.title === 'Untitled')!.members.map(member => member.label).sort(),
    ['Original', 'copy 2', 'earlier version', 'this browser\'s version']);
});

test('new projects numbered by the app are projects of their own; their copies still join them', () => {
  assert.equal(familyName('Untitled 2'), 'Untitled 2');
  assert.equal(familyName('untitled 3'), 'untitled 3');
  assert.equal(familyName('Untitled 2 copy'), 'Untitled 2');
  assert.equal(familyName('Untitled copy 2'), 'Untitled', 'a second copy of Untitled is still a copy');
  assert.equal(familyName('Untitled (earlier version)'), 'Untitled');
  assert.equal(familyName('Song 2'), 'Song', 'any other name is numbered as a version of itself, as before');
});
