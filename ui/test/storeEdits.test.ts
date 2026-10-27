// What every operation of the project store does today: its status, what it answers, the events
// it emits, whether it schedules a save, and the state it leaves. This is the file that notices
// an operation being dropped or its events or saving drifting. It pins behaviour as it is,
// including behaviour that looks wrong; those cases say so in their titles. Each case is an
// operation applied through `apply`; `storeOps.test.ts` is where the typed helpers are held to
// the same answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { OP_META, type Operation } from '../src/services/projectOps.ts';
import { DRUM_INSTRUMENTS, DRUM_KITS } from '../src/services/drumKits.ts';
import { MAX_GUESTS } from '../src/services/guests.ts';
import { MAX_SCENES } from '../src/services/projectSanitization.ts';
import { applied, defaults, ok, setup, storage, type Message, type Result } from './helpers/store.ts';

const STORAGE_KEY = 'discobot_browser_project_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GUEST_URL = 'https://guest.example/synth';
const NO_GUEST = '00000000-0000-4000-8000-000000000000';
const SAMPLE = '11111111-2222-4333-8444-555555555555';
const NO_LANE = 'Unknown local operation';

// A value of the wrong type, as an untyped caller or a replayed operation could send.
const wrong = (value: unknown) => value as never;
const fresh = () => crypto.randomUUID();
// The project without the two fields every write changes.
const content = (snapshot: any) => { const { revision: _revision, updatedAt: _updatedAt, ...rest } = snapshot; return rest; };
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const keys = (value: object) => Object.keys(value).sort();
const blank = (count = 16) => Array.from({ length: count }, () => ({ active: false, velocity: .7 }));
const note = (name: string) => ({ active: true, note: name, velocity: .8 });

// A second scene, empty and open; the first holds a kick on step 3.
function twoScenes(service: LocalProjectService) {
  ok(service.setDrumStep('kick', 3, true));
  const first = service.snapshot().currentSceneId as string;
  const second = ok(service.createScene({ empty: true })).currentSceneId as string;
  return { first, second };
}
// The defaults these tests start from leave out a drum's tune, humanize and pan. The first drum
// edit that runs the checks fills them in, so a case about "nothing else changed" starts after one.
const checkedDrums = (service: LocalProjectService) => ok(service.setDrumMix('kick', {}));
const addGuest = (service: LocalProjectService, url = GUEST_URL) => ok(service.addGuest(url)).guests.at(-1).id as string;
const fillGuests = (service: LocalProjectService) => { for (let count = 0; count < MAX_GUESTS; count++) addGuest(service, `https://guest${count}.example/`); };

interface Case {
  type: Operation['type'];
  title: string;
  arrange?: (service: LocalProjectService) => any;
  // The operation's fields; a function is handed what `arrange` returned.
  body?: object | ((ctx: any) => object);
  status?: 400 | 404 | 409;
  // The answer is this error, and nothing was emitted, saved or changed.
  error?: string;
  events?: string[];
  saved?: boolean;
  // Most operations answer with exactly what they emit. False where the two differ.
  echo?: boolean;
  check?: (result: Result, service: LocalProjectService, ctx: any, before: any) => void;
}

const SCENE_MESSAGE = ['currentSceneId', 'drumState', 'guests', 'scenes', 'song', 'synths'];
const changed = (title: string, rest: Omit<Case, 'title' | 'events' | 'saved'>, events: string[]): Case =>
  ({ title, events, saved: true, ...rest });
const sceneChange = (title: string, rest: Omit<Case, 'title' | 'events' | 'saved'>): Case => changed(title, {
  ...rest,
  check: (result, service, ctx, before) => {
    const message = result.events[0].data;
    assert.deepEqual(keys(message), SCENE_MESSAGE);
    assert.deepEqual(keys(message.synths[0]).filter(key => key !== 'preset' && key !== 'shared'), ['muted', 'pattern', 'solo', 'synthId', 'synthModelId', 'synthModelParams', 'synthParams']);
    const now = service.snapshot();
    assert.deepEqual(message.scenes, now.scenes);
    assert.deepEqual(message.song, now.song);
    assert.equal(message.currentSceneId, now.currentSceneId);
    assert.deepEqual(message.drumState, now.drumState);
    rest.check?.(result, service, ctx, before);
  },
}, ['sceneChanged']);
const drumChange = (title: string, rest: Omit<Case, 'title' | 'events' | 'saved'>): Case => changed(title, {
  ...rest,
  check: (result, service, ctx, before) => {
    assert.deepEqual(keys(result.events[0].data), ['drumState']);
    assert.deepEqual(keys(result.events[0].data.drumState), [...DRUM_INSTRUMENTS].sort(), 'the whole drum state, not the lane that changed');
    assert.deepEqual(result.events[0].data.drumState, service.snapshot().drumState);
    rest.check?.(result, service, ctx, before);
  },
}, ['drumFullState']);
const unchanged = (result: Result, service: LocalProjectService, _ctx: any, before: any) => {
  assert.deepEqual(content(service.snapshot()), content(before));
};

const cases: Case[] = [
  // --- An instrument the drums do not have
  ...(['drum.step', 'drum.stepVelocity', 'drum.stepDetail', 'drum.settings', 'drum.sample', 'drum.mix'] as const).flatMap((type): Case[] => [
    { type, title: 'an instrument that does not exist is an unknown operation, whatever else is sent', body: { instrument: 'cowbell', step: -1, muted: true }, status: 404, error: NO_LANE },
    { type, title: 'no instrument is an unknown operation', body: { step: 0 }, status: 404, error: NO_LANE },
  ]),
  // --- A lane that does not exist
  ...([
    ['synth.remove', {}], ['synth.params', { patch: {} }], ['synth.model', {}], ['synth.mix', {}], ['synth.swing', { swing: true }], ['synth.name', { name: 'Lead' }], ['synth.preset', { preset: 'Pad' }], ['synth.prefs', {}],
    ['pattern.write', { patternId: fresh(), patch: {} }], ['pattern.write', { patternId: 'x', patch: {} }],
  ] as const).map(([type, rest]): Case => (
    { type, title: `a lane that does not exist: ${type}`, body: { synthId: 2, ...rest }, status: 404, error: 'Synth not found' }
  )),

  // --- Scenes
  { type: 'scene.select', title: 'a scene that does not exist', body: { sceneId: 'nope' }, status: 404, error: 'Scene not found' },
  { type: 'scene.select', title: 'no scene named', body: {}, status: 404, error: 'Scene not found' },
  sceneChange('selecting the open scene changes nothing but still emits and saves', {
    type: 'scene.select', arrange: service => service.snapshot().currentSceneId,
    body: (sceneId: string) => ({ sceneId }), check: unchanged,
  }),
  sceneChange('selecting another scene keeps the edits to the one left and opens the other, with its mutes', {
    type: 'scene.select',
    arrange: service => {
      const ids = twoScenes(service);
      ok(service.setDrumStep('snare', 5, true));
      ok(service.setSynthMix(1, { muted: true }));
      ok(service.setDrumMix('clap', { solo: true }));
      return ids;
    },
    body: (ids: any) => ({ sceneId: ids.first }),
    check: (result, service, ids) => {
      const message = result.events[0].data;
      assert.equal(message.currentSceneId, ids.first);
      assert.equal(message.drumState.kick.steps[3], true);
      assert.equal(message.drumState.snare.steps[5], false);
      assert.equal(message.drumState.clap.solo, false);
      assert.equal(message.synths[0].muted, false);
      const left = message.scenes.find((scene: any) => scene.id === ids.second);
      assert.equal(left.drums.snare.steps[5], true);
      assert.deepEqual(left.mutes.lanes[1], { muted: true, solo: false });
      assert.deepEqual(left.mutes.drums.clap, { muted: false, solo: true });
      assert.equal(service.snapshot().synths[0].muted, false);
    },
  }),
  sceneChange('a new scene is a copy of the open one, placed after it and opened', {
    type: 'scene.create', body: () => ({ sceneId: fresh() }),
    arrange: service => {
      ok(service.setDrumStep('kick', 3, true));
      ok(service.setDrumStepVelocity('kick', 3, .4));
      const pattern = service.snapshot().synths[0].pattern;
      ok(service.writePattern(1, pattern.id, { steps: [note('C4')] as any }));
    },
    check: (result, _service, _ctx, before) => {
      const { scenes, currentSceneId, drumState } = result.events[0].data;
      assert.equal(scenes.length, 2);
      assert.equal(scenes[0].id, before.currentSceneId);
      assert.equal(scenes[1].name, 'Scene 2');
      assert.match(scenes[1].id, UUID);
      assert.equal(currentSceneId, scenes[1].id);
      assert.deepEqual({ ...scenes[1], id: 0, name: 0, color: 0 }, { ...scenes[0], id: 0, name: 0, color: 0 });
      assert.equal(scenes[1].color, 'red');
      assert.equal(scenes[1].drums.kick.stepVelocities[3], .4);
      assert.equal(scenes[1].lanes[1][0].note, 'C4');
      assert.equal(drumState.kick.steps[3], true);
    },
  }),
  sceneChange('an empty new scene has no notes or hits, keeps the lengths, and takes its name trimmed', {
    type: 'scene.create', body: () => ({ sceneId: fresh(), empty: true, name: '  Break  ' }),
    arrange: service => {
      ok(service.setDrumBars(2));
      ok(service.setDrumStep('kick', 20, true));
      ok(service.setDrumStepVelocity('kick', 20, .4));
      const pattern = service.snapshot().synths[0].pattern;
      ok(service.writePattern(1, pattern.id, { steps: [...blank(31), note('C4')] as any }));
    },
    check: (result, service) => {
      const { scenes, drumState, synths } = result.events[0].data;
      assert.equal(scenes[1].name, 'Break');
      assert.deepEqual(scenes[1].lanes[1], blank(32));
      assert.deepEqual(scenes[1].drums.kick, { steps: Array(32).fill(false) });
      assert.equal(scenes[0].drums.kick.steps[20], true);
      assert.equal(scenes[0].lanes[1][31].note, 'C4');
      assert.deepEqual(drumState.kick.steps, Array(32).fill(false));
      assert.equal(drumState.kick.stepVelocities, undefined);
      assert.deepEqual(synths[0].pattern.steps, blank(32));
      assert.deepEqual(service.snapshot().synths[0].pattern.steps, blank(32));
    },
  }),
  sceneChange('a scene name is cut to 40 characters', {
    type: 'scene.create', body: () => ({ sceneId: fresh(), name: 'n'.repeat(50) }),
    check: result => assert.equal(result.events[0].data.scenes[1].name, 'n'.repeat(40)),
  }),
  sceneChange('a blank or missing name is numbered from how many scenes there are', {
    type: 'scene.create', body: () => ({ sceneId: fresh(), name: '   ' }), arrange: twoScenes,
    check: result => assert.deepEqual(result.events[0].data.scenes.map((scene: any) => scene.name), ['Scene 1', 'Scene 2', 'Scene 3']),
  }),
  sceneChange('a new scene goes straight after the open one, not at the end', {
    type: 'scene.create', body: () => ({ sceneId: fresh(), name: 'Middle' }),
    arrange: service => { const ids = twoScenes(service); ok(service.selectScene(ids.first)); return ids; },
    check: (result, _service, ids) => {
      const { scenes, currentSceneId } = result.events[0].data;
      assert.deepEqual([scenes[0].id, scenes[1].name, scenes[2].id], [ids.first, 'Middle', ids.second]);
      assert.equal(currentSceneId, scenes[1].id);
    },
  }),
  {
    type: 'scene.create', title: `a project holds at most ${MAX_SCENES} scenes`, body: () => ({ sceneId: fresh() }),
    arrange: service => { for (let count = 1; count < MAX_SCENES; count++) ok(service.createScene()); },
    status: 400, error: `A project can hold ${MAX_SCENES} scenes`,
  },
  sceneChange('renaming trims the name and cuts it to 40 characters', {
    type: 'scene.rename', arrange: twoScenes,
    body: (ids: any) => ({ sceneId: ids.first, name: `  ${'v'.repeat(50)}  ` }),
    check: (result, _service, ids, before) => {
      assert.deepEqual(result.events[0].data.scenes.map((scene: any) => scene.name), ['v'.repeat(40), 'Scene 2']);
      assert.equal(result.events[0].data.currentSceneId, ids.second, 'renaming does not open the scene');
      assert.deepEqual(result.events[0].data.drumState, before.drumState);
    },
  }),
  sceneChange('a scene is given a colour, and one that is not in the list takes it away', {
    type: 'scene.color', arrange: twoScenes,
    body: (ids: any) => ({ sceneId: ids.first, color: 'teal' }),
    check: (result, service, ids) => {
      assert.deepEqual(result.events[0].data.scenes.map((scene: any) => scene.color), ['teal', 'red']);
      assert.equal(result.events[0].data.currentSceneId, ids.second, 'colouring does not open the scene');
      ok(service.setSceneColor(ids.first, 'url(javascript:1)'));
      assert.equal('color' in service.snapshot().scenes[0], false);
    },
  }),
  sceneChange('a scene is given a tempo of its own, and anything that is not a tempo takes it away', {
    type: 'scene.tempo', arrange: twoScenes,
    body: (ids: any) => ({ sceneId: ids.first, tempo: 92 }),
    check: (result, service, ids) => {
      assert.deepEqual(result.events[0].data.scenes.map((scene: any) => scene.tempo), [92, undefined]);
      assert.equal(result.events[0].data.currentSceneId, ids.second, 'it does not open the scene');
      ok(service.setSceneTempo(ids.first, Number.NaN));
      assert.equal('tempo' in service.snapshot().scenes[0], false);
    },
  }),
  sceneChange('the open scene is given a sound of its own for a lane, which the other scenes do not hear, and gives it back', {
    type: 'scene.sound', arrange: twoScenes,
    body: { synthId: 1, own: true },
    check: (result, service, ids) => {
      const lane = result.events[0].data.synths[0];
      assert.deepEqual(lane.shared.synthParams, lane.synthParams, 'nothing is heard to change');
      ok(service.setSynthParams(1, { filter: { frequency: 300 } } as never));
      ok(service.selectScene(ids.first));
      assert.notEqual(service.snapshot().synths[0].synthParams.filter.frequency, 300, 'the other scene plays the shared sound');
      ok(service.selectScene(ids.second));
      assert.equal(service.snapshot().synths[0].synthParams.filter.frequency, 300, 'and this one its own');
      ok(service.setSceneSound(1, false));
      const now = service.snapshot();
      assert.notEqual(now.synths[0].synthParams.filter.frequency, 300);
      assert.equal('shared' in now.synths[0] || now.scenes.some((scene: any) => scene.sounds), false, 'nothing is kept of it');
    },
  }),
  sceneChange('the open scene is given a time signature, and every lane and the drums become bars of it', {
    type: 'scene.signature',
    arrange: (service) => {
      const ids = twoScenes(service);
      ok(service.setDrumBars(2));
      ok(service.setDrumStep('kick', 11, true));
      ok(service.setDrumStep('kick', 15, true));
      ok(service.setDrumStepVelocity('kick', 16, .4));
      const pattern = service.snapshot().synths[0].pattern;
      ok(service.writePattern(1, pattern.id, { steps: [...blank(11), note('C4'), ...blank(3), note('D4'), note('E4'), ...blank(15)] as any, bars: 2 }));
      return ids;
    },
    body: { signature: '3/4' },
    check: (result, service, ids) => {
      const { scenes, drumState, synths, currentSceneId } = result.events[0].data;
      assert.equal(currentSceneId, ids.second);
      assert.deepEqual(scenes.map((scene: any) => scene.signature), [undefined, '3/4'], 'only the open scene');
      assert.equal(scenes[0].drums.kick.steps.length, 16, 'the other scene is left as it was');
      assert.equal(synths[0].pattern.steps.length, 24);
      assert.equal(synths[0].pattern.bars, 2, 'the bars are kept');
      assert.deepEqual([synths[0].pattern.steps[11].note, synths[0].pattern.steps[12].note, synths[0].pattern.steps.filter((step: any) => step.active).length], ['C4', 'E4', 2], 'the step past the end of the first bar is cut off');
      assert.equal(drumState.kick.steps.length, 24);
      assert.deepEqual([drumState.kick.steps[11], drumState.kick.steps.filter(Boolean).length, drumState.kick.stepVelocities[12]], [true, 1, .4]);
      assert.deepEqual(scenes[1].lanes[1], synths[0].pattern.steps, 'the open scene\'s slot holds what the lanes hold');
      ok(service.setDrumStep('snare', 2, true));
      assert.equal(service.snapshot().scenes[1].signature, '3/4', 'and keeps its signature when the next edit rebuilds it');
    },
  }),
  sceneChange('4/4 is stored as nothing, and a longer bar gains empty steps', {
    type: 'scene.signature',
    arrange: (service) => { ok(service.setSceneSignature('7/8')); ok(service.setDrumStep('kick', 13, true)); },
    body: { signature: '4/4' },
    check: (result) => {
      const { scenes, drumState, synths } = result.events[0].data;
      assert.equal('signature' in scenes[0], false);
      assert.deepEqual(synths[0].pattern.steps, blank(16));
      assert.deepEqual(drumState.kick.steps.flatMap((hit: boolean, index: number) => (hit ? [index] : [])), [13]);
      assert.equal(drumState.kick.steps.length, 16);
    },
  }),
  { type: 'scene.signature', title: 'a signature that is not one of the six is refused', body: { signature: '9/8' }, status: 400, error: 'A scene is in 4/4, 3/4, 6/8, 5/4, 7/8, 12/8' },
  { type: 'scene.signature', title: 'nor is anything that is not text', body: { signature: wrong({ toString: () => '3/4' }) }, status: 400, error: 'A scene is in 4/4, 3/4, 6/8, 5/4, 7/8, 12/8' },
  {
    type: 'scene.color', title: 'a scene that does not exist cannot be coloured',
    body: { sceneId: 'nope', color: 'teal' }, status: 400, error: 'That scene is not in the project.',
  },
  sceneChange('a scene moves to another place in the strip, and the song and the open scene are as they were', {
    type: 'scene.move', arrange: twoScenes,
    body: (ids: any) => ({ sceneId: ids.second, to: 0 }),
    check: (result, _service, ids, before) => {
      assert.deepEqual(result.events[0].data.scenes.map((scene: any) => scene.id), [ids.second, ids.first]);
      assert.equal(result.events[0].data.currentSceneId, ids.second);
      assert.deepEqual(result.events[0].data.song, before.song);
    },
  }),
  {
    type: 'scene.move', title: 'a scene that does not exist cannot be moved',
    body: { sceneId: 'nope', to: 0 }, status: 400, error: 'That scene is not in the project.',
  },
  {
    type: 'scene.sound', title: 'a lane that does not exist cannot have a sound of its own',
    body: { synthId: 4, own: true }, status: 404, error: 'Synth not found',
  },
  {
    type: 'scene.sound', title: 'a scene has a sound of its own or not, and nothing else',
    body: { synthId: 1, own: 'yes' }, status: 400, error: 'Invalid local operation data',
  },
  {
    type: 'scene.tempo', title: 'a scene that does not exist cannot be given a tempo',
    body: { sceneId: 'nope', tempo: 90 }, status: 400, error: 'That scene is not in the project.',
  },
  sceneChange('one drum row of the open scene is put into another scene, and the rest of that scene is left', {
    type: 'scene.copyPart',
    arrange: (service) => { const ids = twoScenes(service); ok(service.setDrumStep('snare', 5, true)); return ids; },
    body: (ids: any) => ({ toSceneId: ids.first, drum: 'snare' }),
    check: (result, _service, ids) => {
      const [first, second] = result.events[0].data.scenes;
      assert.equal(first.drums.snare.steps[5], true, 'the row is there');
      assert.equal(first.drums.kick.steps[3], true, 'and the kick it had is still there');
      assert.deepEqual(second.drums.snare.steps, first.drums.snare.steps, 'the open scene keeps its own');
      assert.equal(result.events[0].data.currentSceneId, ids.second, 'copying does not open the other scene');
    },
  }),
  sceneChange('a lane\'s notes are put into another scene with their length', {
    type: 'scene.copyPart',
    arrange: (service) => {
      const ids = twoScenes(service);
      const lane = service.snapshot().synths[0];
      ok(service.writePattern(lane.synthId, lane.pattern.id, { steps: lane.pattern.steps.map((step: any, index: number) => (index === 2 ? { ...step, active: true, note: 'C3' } : step)) }));
      return ids;
    },
    body: (ids: any) => ({ toSceneId: ids.first, synthId: 1 }),
    check: (result) => {
      const [first, second] = result.events[0].data.scenes;
      assert.equal(first.lanes[1][2].note, 'C3');
      assert.deepEqual(first.lanes[1], second.lanes[1]);
      assert.notEqual(first.lanes[1], second.lanes[1], 'a copy, not the same steps shared');
    },
  }),
  {
    type: 'scene.copyPart', title: 'a part is not copied into the scene it is in, a scene that is not there, or without saying which part',
    arrange: twoScenes, body: (ids: any) => ({ toSceneId: ids.second, drum: 'kick' }), status: 400, error: 'Choose another scene to copy to.',
  },
  { type: 'scene.copyPart', title: 'a scene that is not there', body: { toSceneId: 'nope', synthId: 1 }, status: 400, error: 'Choose another scene to copy to.' },
  { type: 'scene.copyPart', title: 'no part named', arrange: twoScenes, body: (ids: any) => ({ toSceneId: ids.first }), status: 400, error: 'Choose a lane or a drum to copy.' },
  { type: 'scene.copyPart', title: 'a drum that is not one', arrange: twoScenes, body: (ids: any) => ({ toSceneId: ids.first, drum: 'cowbell' }), status: 400, error: 'Choose a lane or a drum to copy.' },
  { type: 'scene.copyPart', title: 'a lane that is not there', arrange: twoScenes, body: (ids: any) => ({ toSceneId: ids.first, synthId: 9 }), status: 404, error: 'Synth not found' },
  {
    type: 'scene.rename', title: 'a scene that does not exist is a 400 about the name, not a 404 (looks wrong)',
    body: { sceneId: 'nope', name: 'Verse' }, status: 400, error: 'A scene needs a name',
  },
  {
    type: 'scene.rename', title: 'a blank name', arrange: service => service.snapshot().currentSceneId,
    body: (sceneId: string) => ({ sceneId, name: '   ' }), status: 400, error: 'A scene needs a name',
  },
  {
    type: 'scene.rename', title: 'a name that is not text', arrange: service => service.snapshot().currentSceneId,
    body: (sceneId: string) => ({ sceneId, name: 7 }), status: 400, error: 'A scene needs a name',
  },
  { type: 'scene.delete', title: 'a scene that does not exist, even when only one is left', body: { sceneId: 'nope' }, status: 404, error: 'Scene not found' },
  {
    type: 'scene.delete', title: 'the last scene cannot be deleted', arrange: service => service.snapshot().currentSceneId,
    body: (sceneId: string) => ({ sceneId }), status: 400, error: 'A project needs at least one scene',
  },
  sceneChange('deleting the open scene opens the one before it and takes it out of the song', {
    type: 'scene.delete',
    arrange: service => {
      const ids = twoScenes(service);
      ok(service.setSong({ entries: [{ sceneId: ids.first, repeats: 2 }, { sceneId: ids.second, repeats: 3 }], loop: true }));
      return ids;
    },
    body: (ids: any) => ({ sceneId: ids.second }),
    check: (result, _service, ids) => {
      const message = result.events[0].data;
      assert.deepEqual(message.scenes.map((scene: any) => scene.id), [ids.first]);
      assert.equal(message.currentSceneId, ids.first);
      assert.equal(message.drumState.kick.steps[3], true);
      assert.deepEqual(message.song, { entries: [{ sceneId: ids.first, repeats: 2 }], loop: true });
    },
  }),
  sceneChange('deleting the open first scene opens the one that takes its place', {
    type: 'scene.delete',
    arrange: service => { const ids = twoScenes(service); ok(service.selectScene(ids.first)); return ids; },
    body: (ids: any) => ({ sceneId: ids.first }),
    check: (result, _service, ids) => {
      assert.equal(result.events[0].data.currentSceneId, ids.second);
      assert.equal(result.events[0].data.drumState.kick.steps[3], false);
    },
  }),
  sceneChange('deleting another scene leaves the open one open; a song left empty plays the first scene once', {
    type: 'scene.delete',
    arrange: service => {
      const ids = twoScenes(service);
      ok(service.setSong({ entries: [{ sceneId: ids.first, repeats: 4 }] }));
      ok(service.setDrumStep('snare', 5, true));
      return ids;
    },
    body: (ids: any) => ({ sceneId: ids.first }),
    check: (result, _service, ids) => {
      const message = result.events[0].data;
      assert.deepEqual(message.scenes.map((scene: any) => scene.id), [ids.second]);
      assert.equal(message.currentSceneId, ids.second);
      assert.equal(message.drumState.snare.steps[5], true);
      assert.deepEqual(message.song, { entries: [{ sceneId: ids.second, repeats: 1 }], loop: false });
    },
  }),
  sceneChange('replacing with nothing leaves one new scene made from the live pattern', {
    type: 'scene.replace', body: {},
    arrange: service => { const ids = twoScenes(service); ok(service.setDrumStep('snare', 5, true)); return ids; },
    check: (result, _service, ids) => {
      const message = result.events[0].data;
      assert.equal(message.scenes.length, 1);
      assert.equal(message.scenes[0].name, 'Scene 1');
      assert.match(message.scenes[0].id, UUID);
      assert.ok(message.scenes[0].id !== ids.first && message.scenes[0].id !== ids.second);
      assert.equal(message.currentSceneId, message.scenes[0].id);
      assert.equal(message.scenes[0].drums.snare.steps[5], true);
      assert.deepEqual(message.song, { entries: [{ sceneId: message.scenes[0].id, repeats: 1 }], loop: false });
    },
  }),
  sceneChange('replacing takes the scenes and song given, except the open scene, which stays the live pattern', {
    type: 'scene.replace',
    arrange: service => {
      twoScenes(service);
      const [a, b] = service.getScenes().scenes as any[];
      a.drums.kick.steps[7] = true;
      b.drums.kick.steps[9] = true;
      return {
        scenes: [{ ...a, id: 'a', name: 'A' }, { ...b, id: 'b', name: 'B' }, { ...b, id: 'a', name: 'Twice' }, { name: 'No id' }],
        currentSceneId: 'b', song: { entries: [{ sceneId: 'b', repeats: 3 }, { sceneId: 'gone', repeats: 1 }], loop: true },
      };
    },
    body: (given: any) => given,
    check: (result, _service, _ctx, before) => {
      const message = result.events[0].data;
      assert.deepEqual(message.scenes.map((scene: any) => [scene.id, scene.name]), [['a', 'A'], ['b', 'B']]);
      assert.equal(message.currentSceneId, 'b');
      assert.deepEqual(message.song, { entries: [{ sceneId: 'b', repeats: 3 }], loop: true });
      assert.equal(message.scenes[0].drums.kick.steps[7], true);
      assert.equal(message.scenes[1].drums.kick.steps[9], false, 'the open scene is not read from what it was given');
      assert.deepEqual(message.drumState, before.drumState, 'and the live pattern is not replaced by it');
    },
  }),
  sceneChange('replacing with an open scene that is not among them opens the first', {
    type: 'scene.replace',
    arrange: service => {
      const [scene] = service.getScenes().scenes;
      return { scenes: [{ ...scene, id: 'a' }, { ...scene, id: 'b' }], currentSceneId: 'zzz' };
    },
    body: (given: any) => given,
    check: result => {
      assert.equal(result.events[0].data.currentSceneId, 'a');
      assert.deepEqual(result.events[0].data.song, { entries: [{ sceneId: 'a', repeats: 1 }], loop: false });
    },
  }),
  sceneChange('the song takes entries for scenes that exist, with whole repeats from 1 to 64', {
    type: 'song.set', arrange: twoScenes,
    body: (ids: any) => ({ entries: [{ sceneId: ids.second, repeats: 2.6 }, { sceneId: 'gone', repeats: 2 }, { sceneId: ids.first, repeats: 999 }, { sceneId: ids.first }], loop: true }),
    check: (result, _service, ids, before) => {
      assert.deepEqual(result.events[0].data.song, {
        entries: [{ sceneId: ids.second, repeats: 3 }, { sceneId: ids.first, repeats: 64 }, { sceneId: ids.first, repeats: 1 }], loop: true,
      });
      assert.equal(result.events[0].data.currentSceneId, before.currentSceneId);
    },
  }),
  sceneChange('the song keeps whichever of entries and loop is not sent', {
    type: 'song.set',
    arrange: service => {
      const ids = twoScenes(service);
      ok(service.setSong({ entries: [{ sceneId: ids.second, repeats: 2 }], loop: true }));
      ok(service.setSong({ entries: [{ sceneId: ids.first, repeats: 5 }] }));
      return ids;
    },
    body: { loop: false },
    check: (result, _service, ids) => assert.deepEqual(result.events[0].data.song, { entries: [{ sceneId: ids.first, repeats: 5 }], loop: false }),
  }),
  sceneChange('an empty song is the first scene once; a loop that is not exactly true is off', {
    type: 'song.set', arrange: twoScenes, body: { entries: [], loop: 'yes' },
    check: (result, _service, ids) => assert.deepEqual(result.events[0].data.song, { entries: [{ sceneId: ids.first, repeats: 1 }], loop: false }),
  }),
  sceneChange('a song request with nothing in it changes nothing but still emits and saves', { type: 'song.set', body: {}, check: unchanged }),

  // --- Synth lanes
  changed('a new lane, with everything the caller builds its lane from', {
    type: 'synth.create', body: { synthId: 3 },
    check: (result, service) => {
      const synth = result.data;
      assert.deepEqual(keys(synth), ['isPlaying', 'muted', 'pattern', 'patterns', 'solo', 'synthId', 'synthModelId', 'synthModelParams', 'synthParams']);
      assert.equal(synth.synthId, 3);
      assert.match(synth.pattern.id, UUID);
      assert.deepEqual({ ...synth.pattern, id: 0 }, { id: 0, name: 'Synth 3', tempo: 120, steps: blank() });
      assert.deepEqual(synth.patterns, [synth.pattern]);
      assert.deepEqual(synth.synthParams, json(defaults().synthParams));
      assert.equal(synth.synthModelId, 'generic');
      assert.deepEqual(synth.synthModelParams, { macro1: .5, macro2: .5, macro3: .5, macro4: .5 });
      assert.deepEqual([synth.muted, synth.solo, synth.isPlaying], [false, false, false]);
      assert.deepEqual(service.snapshot().synths.map((lane: any) => lane.synthId), [1, 3]);
    },
  }, ['synthCreated']),
  changed('with no lane named, the lowest free one', {
    type: 'synth.create', body: {}, check: result => assert.equal(result.data.synthId, 2),
  }, ['synthCreated']),
  changed('a lane of 0 counts as no lane named (looks wrong)', {
    type: 'synth.create', body: { synthId: 0 }, check: result => assert.equal(result.data.synthId, 2),
  }, ['synthCreated']),
  changed('lanes are kept in the order they were made, not by number', {
    type: 'synth.create', body: { synthId: 2 }, arrange: service => ok(service.createLane(3)),
    check: (_result, service) => assert.deepEqual(service.snapshot().synths.map((lane: any) => lane.synthId), [1, 3, 2]),
  }, ['synthCreated']),
  changed('creating a lane that exists answers with it as it is, and still emits and saves', {
    type: 'synth.create', body: { synthId: 1 },
    arrange: service => ok(service.setSynthParams(1, { filter: { frequency: 1234 } })),
    check: (result, service, _ctx, before) => {
      assert.equal(result.data.synthParams.filter.frequency, 1234);
      assert.deepEqual(result.data, before.synths[0]);
      unchanged(result, service, null, before);
    },
  }, ['synthCreated']),
  ...([6, -1, 1.5, '2'] as const).map((synthId): Case => (
    { type: 'synth.create', title: `lane ${JSON.stringify(synthId)} is refused`, body: { synthId }, status: 400, error: '5 synths maximum' }
  )),
  {
    type: 'synth.create', title: 'with all five lanes there, no lane named is refused', body: {},
    arrange: service => { for (let n = 0; n < 4; n++) ok(service.createLane()); }, status: 400, error: '5 synths maximum',
  },
  { type: 'synth.remove', title: 'lane 1 cannot be removed', body: { synthId: 1 }, status: 400, error: 'Synth 1 cannot be removed' },
  changed('removing a lane', {
    type: 'synth.remove', body: { synthId: 2 },
    arrange: service => { ok(service.createLane(2)); ok(service.createLane(3)); },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 2 });
      assert.deepEqual(service.snapshot().synths.map((lane: any) => lane.synthId), [1, 3]);
    },
  }, ['synthRemoved']),
  changed('a sound change is merged into what is there, then checked; the answer is the sound, the event names the lane', {
    type: 'synth.params', echo: false,
    arrange: service => ok(service.createLane(2)),
    body: { synthId: 1, patch: { filter: { frequency: 1234, q: 999 }, gain: 5, oscillator: { type: 'noise' }, lfo1: { sync: true }, bogus: 1 } },
    check: (result, service, _ctx, before) => {
      assert.deepEqual(keys(result.events[0].data), ['parameters', 'synthId']);
      assert.equal(result.events[0].data.synthId, 1);
      assert.deepEqual(result.data, result.events[0].data.parameters);
      const was = before.synths[0].synthParams, now = result.data;
      assert.equal(now.filter.frequency, 1234);
      assert.equal(now.filter.q, 30);
      assert.equal(now.filter.type, was.filter.type);
      assert.equal(now.gain, 2);
      assert.equal(now.oscillator.type, was.oscillator.type);
      assert.equal(now.oscillator.detune, was.oscillator.detune);
      assert.equal(now.lfo1.sync, true);
      assert.equal('bogus' in now, false);
      assert.deepEqual(now.envelope, was.envelope);
      const after = service.snapshot();
      assert.deepEqual(after.synths[0].synthParams, now);
      assert.deepEqual(after.synths[1], before.synths[1], 'the other lane is untouched');
    },
  }, ['synthUpdate']),
  changed('a model change sets the model and merges its macros, each held to 0..1', {
    type: 'synth.model', body: { synthId: 1, modelId: 'tb-303', modelParams: { macro1: .9, macro2: 7, macro3: 'x', extra: 1 } },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, modelId: 'tb-303', modelParams: { macro1: .9, macro2: 1, macro3: .5, macro4: .5 } });
      assert.equal(service.snapshot().synths[0].synthModelId, 'tb-303');
    },
  }, ['synthModelUpdate']),
  changed('macros alone keep the model', {
    type: 'synth.model', body: { synthId: 1, modelParams: { macro4: .1 } },
    arrange: service => ok(service.setSynthModel(1, { modelId: 'juno-106', modelParams: { macro1: .9 } })),
    check: result => assert.deepEqual(result.events[0].data, { synthId: 1, modelId: 'juno-106', modelParams: { macro1: .9, macro2: .5, macro3: .5, macro4: .1 } }),
  }, ['synthModelUpdate']),
  changed('a model that does not exist puts the lane back on the generic one, not the one it had', {
    type: 'synth.model', body: { synthId: 1, modelId: 'nope' },
    arrange: service => ok(service.setSynthModel(1, { modelId: 'juno-106' })),
    check: result => assert.equal(result.events[0].data.modelId, 'generic'),
  }, ['synthModelUpdate']),
  changed('a lane\'s name is stored tidied and cut to its length; an empty one takes it away', {
    type: 'synth.name', body: { synthId: 1, name: '  Bass   line  ' },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, name: 'Bass line' });
      assert.equal(service.snapshot().synths[0].name, 'Bass line');
    },
  }, ['synthName']),
  changed('the lanes are shown in another order, and only where they are shown changes', {
    type: 'lanes.order', body: { order: [2, 1, 3, 4, 5] },
    check: (result, service, _ctx, before) => {
      assert.deepEqual(result.events[0].data, { order: [2, 1, 3, 4, 5] });
      assert.deepEqual(service.snapshot().laneOrder, [2, 1, 3, 4, 5]);
      assert.deepEqual(service.snapshot().synths, before.synths, 'each lane is as it was, number and all');
    },
  }, ['laneOrder']),
  { type: 'lanes.order', title: 'an order that is not every lane once is refused', body: { order: [5, 4, 3] }, status: 400, error: 'A lane order names every lane once' },
  changed('a name of nothing but spaces gives the lane back its number', {
    type: 'synth.name', body: { synthId: 1, name: '   ' }, arrange: service => ok(service.setSynthName(1, 'x'.repeat(40))),
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, name: '' });
      assert.equal('name' in service.snapshot().synths[0], false);
    },
  }, ['synthName']),
  changed('the preset loaded on a lane is kept by its name, and an empty one takes it away', {
    type: 'synth.preset', body: { synthId: 1, preset: '  Steinway  Grand Piano ' },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, preset: 'Steinway Grand Piano' });
      assert.equal(service.snapshot().synths[0].preset, 'Steinway Grand Piano');
    },
  }, ['synthPreset']),
  changed('another model forgets the preset that was loaded; a turned macro does not', {
    type: 'synth.model', body: { synthId: 1, modelId: 'juno-106' },
    arrange: service => { ok(service.setSynthPreset(1, 'Felt Piano')); },
    check: (result, service) => {
      assert.equal('preset' in service.snapshot().synths[0], false);
      ok(service.setSynthPreset(1, 'Juno Keys'));
      ok(service.setSynthModel(1, { modelParams: { macro1: 0.2 } }));
      assert.equal(service.snapshot().synths[0].preset, 'Juno Keys');
    },
  }, ['synthModelUpdate']),
  changed('swing is stored on the lane only while it is on', {
    type: 'synth.swing', body: { synthId: 1, swing: true },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, swing: true });
      assert.equal(service.snapshot().synths[0].swing, true);
    },
  }, ['synthSwing']),
  changed('swing turned off takes the key away, and anything but true is off', {
    type: 'synth.swing', body: { synthId: 1, swing: 'yes' }, arrange: service => ok(service.setSynthSwing(1, true)),
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, swing: false });
      assert.equal('swing' in service.snapshot().synths[0], false);
    },
  }, ['synthSwing']),
  changed('mute and solo are set when they are true or false, and left otherwise', {
    type: 'synth.mix', body: { synthId: 1, muted: true, solo: 'yes' },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, muted: true, solo: false });
      assert.equal(service.snapshot().synths[0].muted, true);
    },
  }, ['synthMix']),
  changed('a mix request with nothing in it changes nothing but still emits and saves', {
    type: 'synth.mix', body: { synthId: 1 }, arrange: service => ok(service.setSynthMix(1, { solo: true })),
    check: (result, service, _ctx, before) => { assert.deepEqual(result.events[0].data, { synthId: 1, muted: false, solo: true }); unchanged(result, service, null, before); },
  }, ['synthMix']),
  {
    type: 'synth.prefs', title: 'octave and keyboard are saved without an event; the answer is the whole lane',
    body: { synthId: 1, octaveShift: 1.6, keyboardMode: 'piano-roll' }, saved: true,
    check: (result, service) => {
      assert.deepEqual(keys(result.data), ['isPlaying', 'keyboardMode', 'muted', 'octaveShift', 'pattern', 'patterns', 'solo', 'synthId', 'synthModelId', 'synthModelParams', 'synthParams']);
      assert.deepEqual([result.data.octaveShift, result.data.keyboardMode], [2, 'piano-roll']);
      assert.deepEqual(result.data, service.snapshot().synths[0]);
    },
  },
  {
    type: 'synth.prefs', title: 'the octave is held to -2..2, and values that are not understood keep what was there',
    arrange: service => { ok(service.setSynthPrefs(1, { octaveShift: -9, keyboardMode: 'keyboard' })); },
    body: { synthId: 1, octaveShift: 'up', keyboardMode: 'harp' }, saved: true,
    check: result => assert.deepEqual([result.data.octaveShift, result.data.keyboardMode], [-2, 'keyboard']),
  },
  {
    type: 'synth.prefs', title: 'on a lane that has none yet, an empty request sets the octave to 0 and no keyboard', body: { synthId: 1 }, saved: true,
    check: result => { assert.equal(result.data.octaveShift, 0); assert.equal('keyboardMode' in result.data, false); },
  },
  changed('a pattern with a new id is new, becomes the lane\'s pattern, and takes the project\'s tempo, not its own', {
    type: 'pattern.write', echo: false, body: () => ({ synthId: 1, patternId: fresh(), patch: { name: 'Bass', tempo: 90, steps: [note('C4'), { active: true, note: 'H9' }] } }),
    check: (result, service, _ctx, before) => {
      assert.deepEqual(keys(result.events[0].data), ['pattern', 'synthId']);
      assert.equal(result.events[0].data.synthId, 1);
      assert.deepEqual(result.data, result.events[0].data.pattern);
      assert.match(result.data.id, UUID);
      assert.deepEqual({ ...result.data, id: 0 }, { id: 0, name: 'Bass', tempo: 120, steps: [note('C4'), ...blank(15)] });
      const lane = service.snapshot().synths[0];
      assert.deepEqual(lane.pattern, result.data);
      assert.deepEqual(lane.patterns, [before.synths[0].pattern, result.data]);
    },
  }, ['patternCreated']),
  changed('a pattern can be given its own id; with no steps it copies the open pattern\'s, and with no name it is "Recovered pattern"', {
    type: 'pattern.write', echo: false, body: { synthId: 1, patternId: 'mine', patch: {} },
    arrange: service => { ok(service.writePattern(1, service.snapshot().synths[0].pattern.id, { steps: [note('E3')] as any })); },
    check: result => assert.deepEqual(result.data, { id: 'mine', name: 'Recovered pattern', tempo: 120, steps: [note('E3'), ...blank(15)] }),
  }, ['patternCreated']),
  { type: 'pattern.write', title: 'steps that are not a list', body: () => ({ synthId: 1, patternId: fresh(), patch: { steps: 'x' } }), status: 400, error: 'Invalid sequence pattern' },
  changed('writing a pattern that exists updates it, keeping what is not sent', {
    type: 'pattern.write', echo: false, arrange: service => service.snapshot().synths[0].pattern,
    body: (pattern: any) => ({ synthId: 1, patternId: pattern.id, patch: { steps: [...blank(3), { ...note('G2'), slide: true, length: 2 }] } }),
    check: (result, service, pattern) => {
      assert.deepEqual(result.events[0].data, { synthId: 1, pattern: result.data });
      assert.deepEqual(result.data, { id: pattern.id, name: 'Synth 1', tempo: 120, steps: [...blank(3), { ...note('G2'), slide: true, length: 2 }, ...blank(12)] });
      assert.deepEqual(service.snapshot().synths[0].patterns, [result.data]);
    },
  }, ['patternUpdated']),
  changed('an id not seen before is a new pattern', {
    type: 'pattern.write', echo: false, body: { synthId: 1, patternId: 'midi-import', patch: { name: 'Imported', steps: [note('C4')] } },
    check: (result, service) => {
      assert.equal(result.data.id, 'midi-import');
      assert.deepEqual(service.snapshot().synths[0].patterns.map((pattern: any) => pattern.id).slice(1), ['midi-import']);
      assert.equal(service.snapshot().synths[0].pattern.id, 'midi-import');
    },
  }, ['patternCreated']),
  changed('an updated pattern moves to the end of the lane\'s list and becomes the lane\'s pattern', {
    type: 'pattern.write', echo: false,
    arrange: service => { const first = service.snapshot().synths[0].pattern.id; ok(service.writePattern(1, 'b', { name: 'B' })); return first; },
    body: (first: string) => ({ synthId: 1, patternId: first, patch: { name: 'Again' } }),
    check: (result, service, first) => {
      const lane = service.snapshot().synths[0];
      assert.deepEqual(lane.patterns.map((pattern: any) => pattern.id), ['b', first]);
      assert.equal(lane.pattern.id, first);
      assert.equal(result.data.name, 'Again');
    },
  }, ['patternUpdated']),
  changed('two bars of steps are two bars when the pattern says so', {
    type: 'pattern.write', echo: false, body: { synthId: 1, patternId: 'long', patch: { name: 'Long', steps: blank(32), bars: 2 } },
    check: result => { assert.equal(result.data.bars, 2); assert.equal(result.data.steps.length, 32); },
  }, ['patternCreated']),
  changed('a pattern\'s automation is kept as checked: known parameters, inside their ranges, as long as the steps', {
    type: 'pattern.write', echo: false, arrange: service => service.snapshot().synths[0].pattern,
    body: (pattern: any) => ({ synthId: 1, patternId: pattern.id, patch: { automation: { cutoff: [300, 1e9, null, 'x'], macro1: [1], duck: [1] } } }),
    check: (result, service, pattern) => {
      const kept = { cutoff: [300, 20000, ...Array(14).fill(null)] };
      assert.deepEqual(result.data, { ...pattern, automation: kept });
      assert.deepEqual(result.events[0].data, { synthId: 1, pattern: result.data });
      const project = service.snapshot();
      assert.deepEqual(project.scenes[0].laneAutomation, { 1: kept }, 'and it is in the open scene with the steps');
    },
  }, ['patternUpdated']),
  changed('automation is kept by a write that does not send any, and taken away by one that sends none', {
    type: 'pattern.write', echo: false,
    arrange: service => { const { id } = service.snapshot().synths[0].pattern; ok(service.writePattern(1, id, { automation: { level: [0.5] } })); ok(service.writePattern(1, id, { steps: [note('C4')] as any })); return id; },
    body: (id: string) => ({ synthId: 1, patternId: id, patch: { automation: {} } }),
    check: (result, service, _id, before) => {
      assert.deepEqual(before.synths[0].pattern.automation, { level: [0.5, ...Array(15).fill(null)] }, 'the write of steps kept it');
      assert.equal('automation' in result.data, false);
      assert.equal('laneAutomation' in service.snapshot().scenes[0], false);
    },
  }, ['patternUpdated']),
  {
    type: 'pattern.write', title: 'steps that are not a list, for a pattern that exists', arrange: service => service.snapshot().synths[0].pattern.id,
    body: (id: string) => ({ synthId: 1, patternId: id, patch: { steps: { 0: note('C4') } } }), status: 400, error: 'Invalid sequence pattern',
  },

  // --- Tempo and transport
  changed('the tempo is set on the project and on every pattern of every lane', {
    type: 'tempo.set', body: { tempo: 137.5 },
    arrange: service => { ok(service.createLane(2)); ok(service.writePattern(1, 'b', {})); ok(service.writePattern(2, 'c', {})); },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data, { tempo: 137.5 });
      const now = service.snapshot();
      assert.equal(now.tempo, 137.5);
      assert.deepEqual(now.synths.map((lane: any) => [lane.pattern.tempo, ...lane.patterns.map((pattern: any) => pattern.tempo)]), [[137.5, 137.5, 137.5], [137.5, 137.5, 137.5]]);
    },
  }, ['tempoChange']),
  ...([20, 400] as const).map((tempo): Case => changed(`a tempo of ${tempo} is allowed`, { type: 'tempo.set', body: { tempo }, check: result => assert.deepEqual(result.data, { tempo }) }, ['tempoChange'])),
  ...([19.9, 400.1, '120', null] as const).map((tempo): Case => ({ type: 'tempo.set', title: `a tempo of ${JSON.stringify(tempo)} is refused`, body: { tempo }, status: 400, error: 'Invalid tempo' })),
  { type: 'tempo.set', title: 'no tempo is refused', body: {}, status: 400, error: 'Invalid tempo' },
  ...(['play', 'stop'] as const).flatMap((verb): Case[] => {
    const type = `transport.${verb}` as const, event = verb === 'play' ? 'sequencerPlay' : 'sequencerStop', playing = verb === 'play';
    return [
      {
        type, title: 'marks the lane and emits, but does not save', echo: false, events: [event], body: { synthId: 2 },
        arrange: service => { ok(service.createLane(2)); ok(service.playLane(verb === 'play' ? 1 : 2)); },
        check: (result, service) => {
          assert.deepEqual(result.data, { success: true });
          assert.deepEqual(result.events[0].data, { synthId: 2 });
          assert.deepEqual(service.snapshot().synths.map((lane: any) => lane.isPlaying), [playing, playing]);
        },
      },
      {
        type, title: 'a pattern named becomes the lane\'s pattern; one the lane does not have is ignored', echo: false, events: [event],
        arrange: service => { const first = service.snapshot().synths[0].pattern.id; ok(service.writePattern(1, 'b', {})); return first; },
        body: (first: string) => ({ synthId: 1, patternId: first }),
        check: (_result, service, first) => { assert.equal(service.snapshot().synths[0].pattern.id, first); },
      },
      {
        type, title: 'an unknown pattern leaves the lane\'s pattern alone', echo: false, events: [event], body: { synthId: 1, patternId: 'nope' },
        check: (result, service, _ctx, before) => { assert.deepEqual(result.data, { success: true }); assert.equal(service.snapshot().synths[0].pattern.id, before.synths[0].pattern.id); },
      },
      {
        type, title: 'a lane that does not exist is a 200 that says it failed, with no event', body: { synthId: 2 },
        check: (result, service, _ctx, before) => { assert.deepEqual(result.data, { success: false }); unchanged(result, service, null, before); },
      },
    ];
  }),

  // --- Drums: kit and whole state
  { type: 'drum.kit', title: 'a kit that does not exist', body: { kitId: 'nope' }, status: 400, error: 'Unknown kit' },
  { type: 'drum.kit', title: 'no kit named', body: {}, status: 400, error: 'Unknown kit' },
  changed('choosing a kit lays its settings over every drum and keeps the steps', {
    type: 'drum.kit', body: { kitId: 'tr-808' },
    arrange: service => { ok(service.setDrumStep('kick', 3, true)); ok(service.setDrumSettings('kick', { pan: -.5 })); },
    check: (result, service, _ctx, before) => {
      assert.deepEqual(keys(result.data), ['drumState', 'selectedDrumKitId']);
      assert.equal(result.data.selectedDrumKitId, 'tr-808');
      const kit = DRUM_KITS.find(entry => entry.id === 'tr-808')!;
      for (const instrument of DRUM_INSTRUMENTS) {
        assert.deepEqual(result.data.drumState[instrument], { ...before.drumState[instrument], settings: { ...before.drumState[instrument].settings, ...kit.instrumentDefaults[instrument] } });
      }
      assert.equal(result.data.drumState.kick.settings.volume, .75);
      assert.equal(result.data.drumState.kick.settings.pan, 0, 'the kit\'s own pan replaces the lane\'s');
      assert.equal(result.data.drumState.kick.steps[3], true);
      assert.equal(service.snapshot().selectedDrumKitId, 'tr-808');
      assert.deepEqual(service.snapshot().drumState, result.data.drumState);
    },
  }, ['drumKitChanged']),
  changed('with applyDefaults false only the kit\'s name changes', {
    type: 'drum.kit', body: { kitId: 'tr-909', applyDefaults: false },
    check: (result, service, _ctx, before) => {
      assert.equal(result.data.selectedDrumKitId, 'tr-909');
      assert.deepEqual(result.data.drumState, before.drumState);
      assert.equal(service.snapshot().selectedDrumKitId, 'tr-909');
    },
  }, ['drumKitChanged']),
  drumChange('a whole drum state replaces the one there, checked and filled in', {
    type: 'drum.state',
    arrange: service => ok(service.setDrumStep('snare', 5, true)),
    body: { state: { kick: { steps: [true, 'yes'], settings: { volume: 9, pan: -3 }, muted: 'yes', solo: true, sampleId: 'not-an-id', stepVelocities: [.25, 7] }, cowbell: { steps: [true] } } },
    check: result => {
      const { drumState } = result.events[0].data;
      assert.deepEqual(drumState.kick, {
        steps: [true, ...Array(15).fill(false)], muted: false, solo: true,
        settings: { volume: 1, tone: .5, extra: .5, tune: 0, humanize: .35, pan: -1 }, stepVelocities: [.25, ...Array(15).fill(1)],
      });
      assert.deepEqual(drumState.snare, { steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: .5, tone: .5, extra: .5, tune: 0, humanize: .35, pan: 0 } });
    },
  }),
  drumChange('an empty drum state clears every drum', {
    type: 'drum.state', body: { state: {} },
    arrange: service => { ok(service.setDrumStep('kick', 3, true)); ok(service.setDrumMix('kick', { muted: true })); },
    check: result => { assert.deepEqual(result.events[0].data.drumState.kick.steps, Array(16).fill(false)); assert.equal(result.events[0].data.drumState.kick.muted, false); },
  }),
  drumChange('a longer kick makes every drum that long', {
    type: 'drum.state', body: { state: { kick: { steps: Array(32).fill(true) }, snare: { steps: [true] } } },
    check: result => { assert.equal(result.events[0].data.drumState.kick.steps.length, 32); assert.deepEqual(result.events[0].data.drumState.snare.steps, [true, ...Array(31).fill(false)]); },
  }),
  drumChange('reset puts back the defaults the service was started with, exactly as given, and leaves the kit\'s name', {
    type: 'drum.reset', body: {},
    arrange: service => { ok(service.setDrumKit('tr-808')); ok(service.setDrumBars(2)); ok(service.setDrumStep('kick', 20, true)); },
    check: (result, service) => {
      assert.deepEqual(result.events[0].data.drumState, defaults().drumState);
      assert.equal('pan' in result.events[0].data.drumState.kick.settings, false, 'unlike every other drum edit, the state is not passed through the checks');
      assert.equal(service.snapshot().selectedDrumKitId, 'tr-808');
    },
  }),

  // --- Guests
  ...(['http://guest.example/', 'ftp://guest.example/', 'https://user:pass@guest.example/', 'not an address', `https://guest.example/${'a'.repeat(300)}`, 7] as const).map((url): Case => ({
    type: 'guest.add', title: `the address ${JSON.stringify(url).slice(0, 40)} is refused`, body: () => ({ guestId: fresh(), url }), status: 400,
    error: 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.',
  })),
  changed('a guest is added with its address tidied, and its site as its name', {
    type: 'guest.add', body: () => ({ guestId: fresh(), url: `  ${GUEST_URL}?a=1#part  ` }),
    check: (result, service) => {
      assert.deepEqual(keys(result.data), ['guests']);
      assert.equal(result.data.guests.length, 1);
      assert.match(result.data.guests[0].id, UUID);
      assert.deepEqual({ ...result.data.guests[0], id: 0 }, { id: 0, url: `${GUEST_URL}?a=1`, name: 'guest.example', volume: .8, muted: false });
      assert.deepEqual(service.snapshot().guests, result.data.guests);
    },
  }, ['guestsChanged']),
  changed('a guest can be given a name, cut to 60 characters; a local address may be http', {
    type: 'guest.add', body: () => ({ guestId: fresh(), url: 'http://localhost:8787/__guest', name: `  ${'g'.repeat(70)}  ` }),
    arrange: service => addGuest(service),
    check: result => {
      assert.equal(result.data.guests.length, 2);
      assert.deepEqual({ ...result.data.guests[1], id: 0 }, { id: 0, url: 'http://localhost:8787/__guest', name: 'g'.repeat(60), volume: .8, muted: false });
    },
  }, ['guestsChanged']),
  {
    type: 'guest.add', title: `a project holds at most ${MAX_GUESTS} guests, and says so with a 409`, body: () => ({ guestId: fresh(), url: GUEST_URL }),
    arrange: fillGuests, status: 409, error: `A project can hold ${MAX_GUESTS} guest instruments.`,
  },
  {
    type: 'guest.add', title: 'a bad address is a 400 even when the project is full', body: () => ({ guestId: fresh(), url: 'nope' }),
    arrange: fillGuests,
    status: 400, error: 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.',
  },
  ...(['guest.patch', 'guest.remove'] as const).map((type): Case => ({
    type, title: 'a guest that does not exist', body: type === 'guest.patch' ? { guestId: NO_GUEST, patch: {} } : { guestId: NO_GUEST },
    arrange: service => addGuest(service), status: 404, error: 'Guest not found',
  })),
  changed('a guest\'s name, level, mute, sends and settings are each changed only when sent, and checked', {
    type: 'guest.patch', arrange: service => { addGuest(service, 'https://other.example/'); return addGuest(service); },
    body: (id: string) => ({ guestId: id, patch: { name: '  Choir  ', volume: 3, muted: true, sends: { reverb: .5, delay: 9, bogus: 1 }, state: { voices: [1, 2] }, url: 'https://evil.example/', id: 'x' } }),
    check: (result, service, id, before) => {
      assert.deepEqual(keys(result.data), ['guests']);
      assert.deepEqual(result.data.guests[0], before.guests[0], 'the other guest is untouched');
      assert.deepEqual(result.data.guests[1], {
        id, url: GUEST_URL, name: 'Choir', volume: 1, muted: true,
        sends: { reverb: .5, delay: 1, drive: 0, phaser: 0, chorus: 0 }, state: { voices: [1, 2] },
      });
      assert.deepEqual(service.snapshot().guests, result.data.guests);
    },
  }, ['guestsChanged']),
  changed('sends of nothing and settings of null are taken off the guest; a blank name keeps the old one', {
    type: 'guest.patch',
    arrange: service => { const id = addGuest(service); ok(service.changeGuest(id, { name: 'Choir', sends: { reverb: .5 }, state: { a: 1 }, muted: true } as never)); return id; },
    body: (id: string) => ({ guestId: id, patch: { name: '  ', sends: { reverb: 0 }, state: null, muted: 'yes' } }),
    check: (result, _service, id) => assert.deepEqual(result.data.guests, [{ id, url: GUEST_URL, name: 'Choir', volume: .8, muted: false }]),
  }, ['guestsChanged']),
  changed('an empty change to a guest still emits and saves (looks wrong)', {
    type: 'guest.patch', arrange: service => addGuest(service), body: (id: string) => ({ guestId: id, patch: {} }), check: unchanged,
  }, ['guestsChanged']),
  changed('removing a guest also takes its settings and level out of every scene', {
    type: 'guest.remove',
    arrange: service => {
      const keep = addGuest(service, 'https://other.example/'), id = addGuest(service);
      ok(service.changeGuest(id, { state: { a: 1 } }));
      ok(service.changeGuest(keep, { state: { b: 2 } }));
      ok(service.createScene());
      const stored = service.getScenes().scenes;
      assert.deepEqual(stored.map((scene: any) => [keys(scene.guests), keys(scene.guestMix)]), Array(2).fill([[id, keep].sort(), [id, keep].sort()]));
      return { id, keep };
    },
    body: (ctx: any) => ({ guestId: ctx.id }),
    check: (result, service, ctx) => {
      assert.deepEqual(result.data.guests.map((guest: any) => guest.id), [ctx.keep]);
      for (const scene of service.snapshot().scenes) {
        assert.deepEqual(scene.guests, { [ctx.keep]: { b: 2 } });
        assert.deepEqual(scene.guestMix, { [ctx.keep]: { volume: .8, muted: false } });
      }
    },
  }, ['guestsChanged']),
  changed('removing the only guest leaves the scenes with no guest settings at all', {
    type: 'guest.remove',
    arrange: service => { const id = addGuest(service); ok(service.changeGuest(id, { state: { a: 1 } })); ok(service.createScene()); return id; },
    body: (id: string) => ({ guestId: id }),
    check: (result, service) => {
      assert.deepEqual(result.data, { guests: [] });
      for (const scene of service.snapshot().scenes) assert.deepEqual(keys(scene).filter((key: string) => key !== 'color'), ['drums', 'id', 'lanes', 'mutes', 'name']);
    },
  }, ['guestsChanged']),

  // --- Audio tracks and clips
  changed('a track is added with its name tidied, and the project holds tracks from then on', {
    type: 'track.add', body: () => ({ trackId: fresh(), name: '  Lead   vocal  ' }),
    check: (result, service) => {
      assert.deepEqual(keys(result.data), ['audioTracks']);
      assert.deepEqual({ ...result.data.audioTracks[0], id: 0 }, { id: 0, name: 'Lead vocal', volume: .8, clips: [] });
      assert.deepEqual(service.snapshot().audioTracks, result.data.audioTracks);
    },
  }, ['audioTracksChanged']),
  changed('a track without a name is called by its place', {
    type: 'track.add', body: () => ({ trackId: fresh() }), arrange: service => ok(service.addTrack()),
    check: result => assert.deepEqual(result.data.audioTracks.map((track: any) => track.name), ['Audio 1', 'Audio 2']),
  }, ['audioTracksChanged']),
  { type: 'track.add', title: 'a track id that is not one is refused', body: { trackId: 'abc' }, status: 400, error: 'That is not an id a track can have.' },
  { type: 'track.add', title: 'a ninth track is refused', body: () => ({ trackId: fresh() }), arrange: service => { for (let count = 0; count < 8; count++) ok(service.addTrack()); }, status: 409, error: 'A project can hold 8 audio tracks.' },
  { type: 'track.add', title: 'a track id that is taken is refused', arrange: service => ok(service.addTrack()).audioTracks[0].id, body: (id: string) => ({ trackId: id }), status: 409, error: 'That track is already in the project.' },
  changed('a track\'s level, pan, mute and sends are held to their ranges, and an empty name gives its place back', {
    type: 'track.patch', arrange: service => ok(service.addTrack('Keys')).audioTracks[0].id,
    body: (id: string) => ({ trackId: id, patch: { name: ' ', volume: 5, pan: -.5, muted: true, solo: 'yes', sends: { reverb: .3, delay: 0, bogus: 1 } } }),
    check: result => assert.deepEqual({ ...result.data.audioTracks[0], id: 0 }, { id: 0, name: 'Audio 1', volume: 1, pan: -.5, muted: true, sends: { reverb: .3 }, clips: [] }),
  }, ['audioTracksChanged']),
  { type: 'track.patch', title: 'a track that does not exist cannot be changed', body: { trackId: NO_GUEST, patch: { volume: .5 } }, status: 404, error: 'Track not found' },
  changed('removing the last track leaves the project holding none', {
    type: 'track.remove', arrange: service => ok(service.addTrack()).audioTracks[0].id, body: (id: string) => ({ trackId: id }),
    check: (result, service) => { assert.deepEqual(result.data, { audioTracks: [] }); assert.equal('audioTracks' in service.snapshot(), false); },
  }, ['audioTracksChanged']),
  { type: 'track.remove', title: 'a track that does not exist cannot be removed', body: { trackId: NO_GUEST }, status: 404, error: 'Track not found' },
  changed('a clip is placed on a whole tick, its fades fit inside it, and what is as it would be anyway is not stored', {
    type: 'clip.add', arrange: service => ok(service.addTrack()).audioTracks[0].id,
    body: (id: string) => ({ trackId: id, clip: { id: NO_GUEST, sampleId: SAMPLE, at: 96.4, length: 2.5, offset: -1, gain: 1, fadeIn: 9, fadeOut: 1, name: '  take  ' } }),
    check: result => assert.deepEqual(result.data.audioTracks[0].clips, [{ id: NO_GUEST, sampleId: SAMPLE, at: 96, length: 2.5, fadeIn: 2.5, name: 'take' }]),
  }, ['audioTracksChanged']),
  ...([[{ sampleId: SAMPLE, at: 0, length: 0 }, 'nothing to play'], [{ sampleId: 'beep', at: 0, length: 1 }, 'no recording'], [{ sampleId: SAMPLE, length: 1 }, 'no id']] as const).map(([clip, why]): Case => ({
    type: 'clip.add', title: `a clip with ${why} is refused`, arrange: service => ok(service.addTrack()).audioTracks[0].id,
    body: (id: string) => ({ trackId: id, clip: why === 'no id' ? clip : { id: fresh(), ...clip } }), status: 400, error: 'That is not a clip a track can hold.',
  })),
  { type: 'clip.add', title: 'a clip cannot go on a track that does not exist', body: () => ({ trackId: NO_GUEST, clip: { id: fresh(), sampleId: SAMPLE, at: 0, length: 1 } }), status: 404, error: 'Track not found' },
  {
    type: 'clip.add', title: 'a clip id that is taken is refused',
    arrange: service => { const track = ok(service.addTrack()).audioTracks[0].id; ok(service.addClip(track, { id: NO_GUEST, sampleId: SAMPLE, at: 0, length: 1 })); return track; },
    body: (id: string) => ({ trackId: id, clip: { id: NO_GUEST, sampleId: SAMPLE, at: 8, length: 1 } }), status: 409, error: 'That clip is already in the project.',
  },
  changed('a clip is moved along and to another track, and kept in order there', {
    type: 'clip.patch',
    arrange: service => {
      const first = ok(service.addTrack()).audioTracks[0].id, second = ok(service.addTrack()).audioTracks[1].id;
      ok(service.addClip(first, { id: NO_GUEST, sampleId: SAMPLE, at: 0, length: 1 }));
      ok(service.addClip(second, { sampleId: SAMPLE, at: 64, length: 1 }));
      return second;
    },
    body: (second: string) => ({ clipId: NO_GUEST, patch: { trackId: second, at: 128, length: 99999, sampleId: 'swapped' } }),
    check: result => {
      assert.deepEqual(result.data.audioTracks[0].clips, []);
      assert.deepEqual(result.data.audioTracks[1].clips.map((clip: any) => clip.at), [64, 128]);
      assert.deepEqual(result.data.audioTracks[1].clips[1], { id: NO_GUEST, sampleId: SAMPLE, at: 128, length: 3600 }, 'its recording is not changed by a patch');
    },
  }, ['audioTracksChanged']),
  { type: 'clip.patch', title: 'a clip that does not exist cannot be changed', body: { clipId: NO_GUEST, patch: { at: 4 } }, status: 404, error: 'Clip not found' },
  {
    type: 'clip.patch', title: 'a clip cannot move to a track that does not exist',
    arrange: service => { const track = ok(service.addTrack()).audioTracks[0].id; ok(service.addClip(track, { id: NO_GUEST, sampleId: SAMPLE, at: 0, length: 1 })); },
    body: { clipId: NO_GUEST, patch: { trackId: fresh() } }, status: 404, error: 'Track not found',
  },
  changed('a clip is removed and its track stays', {
    type: 'clip.remove',
    arrange: service => { const track = ok(service.addTrack()).audioTracks[0].id; ok(service.addClip(track, { id: NO_GUEST, sampleId: SAMPLE, at: 0, length: 1 })); },
    body: { clipId: NO_GUEST },
    check: result => assert.deepEqual(result.data.audioTracks[0].clips, []),
  }, ['audioTracksChanged']),
  { type: 'clip.remove', title: 'a clip that does not exist cannot be removed', body: { clipId: NO_GUEST }, status: 404, error: 'Clip not found' },

  // --- Drums: levels, effects, length
  ...([
    ['drum.masterVolume', 'drumMasterVolume', 'volume', 'drumMasterVolume', 1, .6],
    ['drum.swing', 'drumSwing', 'swing', 'drumSwing', .75, .3],
  ] as const).flatMap(([type, event, field, stateKey, max, value]): Case[] => {
    const set = (service: LocalProjectService, to: number) => ok(type === 'drum.swing' ? service.setDrumSwing(to) : service.setDrumMasterVolume(to));
    // The swing's event also says which steps it moves.
    const data = (to: number) => (type === 'drum.swing' ? { [field]: to, grid: 16 } : { [field]: to });
    return [
      changed(`sets ${field} and emits ${event}`, {
        type, body: { [field]: value },
        check: (result, service) => { assert.deepEqual(result.events[0].data, data(value)); assert.equal(service.snapshot()[stateKey], value); },
      }, [event]),
      changed(`${field} is held to 0..${max}`, {
        type, body: { [field]: 5 }, arrange: service => set(service, -5),
        check: (result, _service, _ctx, before) => { assert.equal(before[stateKey], 0); assert.deepEqual(result.events[0].data, data(max)); },
      }, [event]),
      changed(`a ${field} that is not a number changes nothing but still emits and saves`, {
        type, body: { [field]: '0.5' }, arrange: service => set(service, value),
        check: (result, service, _ctx, before) => { assert.deepEqual(result.events[0].data, data(value)); unchanged(result, service, null, before); },
      }, [event]),
    ];
  }),
  changed('drum sends are merged into what is there and held to 0..1', {
    type: 'drum.fx', body: { patch: { sends: { reverb: .9, delay: 7, chorus: .5 }, bogus: 1 } },
    check: (result, service) => {
      assert.deepEqual(result.data, { drumFx: { sends: { reverb: .9, delay: 1, drive: .1, phaser: 0 }, returnLevel: .7 } });
      assert.deepEqual(service.snapshot().drumFx, result.data.drumFx);
    },
  }, ['drumFxUpdate']),
  changed('the drum return level is held to 0..1 and keeps the sends', {
    type: 'drum.fx', body: { patch: { returnLevel: 4 } },
    check: result => assert.deepEqual(result.data, { drumFx: { sends: defaults().drumFx.sends, returnLevel: 1 } }),
  }, ['drumFxUpdate']),
  changed('an effects change is merged into what is there, then checked', {
    type: 'effects.set', body: { patch: { delay: { feedback: 7, sync: '1/8' }, phaser: { enabled: true }, enabled: 'no', bogus: 1 } },
    check: (result, service, _ctx, before) => {
      assert.deepEqual(keys(result.data), ['effectsLoop']);
      const now = result.data.effectsLoop, was = before.effectsLoop;
      assert.deepEqual(now.delay, { ...was.delay, feedback: .85, sync: '1/8' });
      assert.deepEqual(now.phaser, { ...was.phaser, enabled: true });
      assert.equal(now.enabled, true, 'a value of the wrong type goes back to the default');
      assert.equal('bogus' in now, false);
      assert.deepEqual(now.reverb, was.reverb);
      assert.deepEqual(now.drive, was.drive);
      assert.deepEqual(service.snapshot().effectsLoop, now);
    },
  }, ['effectsLoopUpdate']),
  ...([3, 16, '2', null] as const).map((bars): Case => ({ type: 'drum.bars', title: `${JSON.stringify(bars)} bars is refused`, body: { bars }, status: 400, error: 'A drum pattern is 1, 2, 4 or 8 bars long' })),
  drumChange('a longer drum pattern repeats what is there, with each step\'s details', {
    type: 'drum.bars', body: { bars: 2 },
    arrange: service => {
      ok(service.setDrumStep('kick', 3, true));
      ok(service.setDrumStepVelocity('kick', 3, .4));
      ok(service.setDrumStepDetail('kick', 3, { probability: .5, ratchet: 3 }));
    },
    check: result => {
      const { kick, snare } = result.events[0].data.drumState;
      const twice = (fill: unknown, at: unknown) => Array.from({ length: 32 }, (_, index) => (index % 16 === 3 ? at : fill));
      assert.deepEqual(kick.steps, twice(false, true));
      assert.deepEqual(kick.stepVelocities, twice(1, .4));
      assert.deepEqual(kick.stepProbabilities, twice(1, .5));
      assert.deepEqual(kick.stepRatchets, twice(1, 3));
      assert.deepEqual(snare.steps, Array(32).fill(false));
      assert.equal('stepVelocities' in snare, false);
    },
  }),
  ...([{ from: 2, to: [0] }, { from: 0, to: [2] }, { from: 0, to: [0] }, { from: 0, to: [] }, { from: 0, to: 1 }, { from: '0', to: [1] }, { from: 0.5, to: [1] }, { to: [1] }] as const).map((body): Case => ({
    type: 'drum.copyBar', title: `copying ${JSON.stringify(body)} in two bars is refused`, arrange: service => { ok(service.setDrumBars(2)); }, body, status: 400, error: 'There is no such bar to copy',
  })),
  drumChange('one bar of the drums is laid over another, with each step\'s details, and replaces what was there', {
    type: 'drum.copyBar', body: { from: 0, to: [1] },
    arrange: service => {
      ok(service.setDrumBars(2));
      ok(service.setDrumStep('kick', 3, true));
      ok(service.setDrumStepVelocity('kick', 3, .4));
      ok(service.setDrumStepDetail('kick', 3, { probability: .5, ratchet: 3 }));
      ok(service.setDrumStep('snare', 20, true));
    },
    check: result => {
      const { kick, snare } = result.events[0].data.drumState;
      const twice = (fill: unknown, at: unknown) => Array.from({ length: 32 }, (_, index) => (index % 16 === 3 ? at : fill));
      assert.deepEqual(kick.steps, twice(false, true));
      assert.deepEqual(kick.stepVelocities, twice(1, .4));
      assert.deepEqual(kick.stepProbabilities, twice(1, .5));
      assert.deepEqual(kick.stepRatchets, twice(1, 3));
      assert.deepEqual(snare.steps, Array(32).fill(false));
    },
  }),
  drumChange('a bar laid over every other bar leaves itself alone', {
    type: 'drum.copyBar', body: { from: 1, to: [0, 2, 3] },
    arrange: service => { ok(service.setDrumBars(4)); ok(service.setDrumStep('kick', 2, true)); ok(service.setDrumStep('kick', 21, true)); },
    check: result => assert.deepEqual(result.events[0].data.drumState.kick.steps, Array.from({ length: 64 }, (_, index) => index % 16 === 5)),
  }),
  drumChange('a shorter drum pattern keeps the first bars', {
    type: 'drum.bars', body: { bars: 1 },
    arrange: service => { ok(service.setDrumBars(4)); ok(service.setDrumStep('kick', 2, true)); ok(service.setDrumStep('kick', 40, true)); },
    check: result => assert.deepEqual(result.events[0].data.drumState.kick.steps, [false, false, true, ...Array(13).fill(false)]),
  }),

  // --- Drums: one instrument
  ...(['drum.step', 'drum.stepVelocity', 'drum.stepDetail'] as const).flatMap((type): Case[] => [-1, 16, 1.5, '3', undefined].map((step): Case => ({
    type, title: `step ${JSON.stringify(step) ?? 'missing'} of 16 is refused`, body: { instrument: 'kick', step, active: true, velocity: .5, probability: .5 }, status: 400, error: 'Invalid drum step',
  }))),
  drumChange('a step is on for anything truthy', {
    type: 'drum.step', body: { instrument: 'snare', step: 15, active: 'yes' }, arrange: checkedDrums,
    check: (result, _service, _ctx, before) => {
      const { drumState } = result.events[0].data;
      assert.deepEqual(drumState.snare.steps, [...Array(15).fill(false), true]);
      assert.deepEqual({ ...drumState, snare: 0 }, { ...before.drumState, snare: 0 }, 'no other drum changes');
    },
  }),
  drumChange('a step with no "active" is switched off', {
    type: 'drum.step', body: { instrument: 'kick', step: 3 }, arrange: service => ok(service.setDrumStep('kick', 3, true)),
    check: result => assert.equal(result.events[0].data.drumState.kick.steps[3], false),
  }),
  drumChange('the last step of a longer pattern can be set', {
    type: 'drum.step', body: { instrument: 'kick', step: 31, active: true }, arrange: service => ok(service.setDrumBars(2)),
    check: result => assert.equal(result.events[0].data.drumState.kick.steps[31], true),
  }),
  drumChange('a step\'s velocity is held to 0..1; the lane\'s other steps start at 1', {
    type: 'drum.stepVelocity', body: { instrument: 'kick', step: 3, velocity: .33 },
    arrange: service => ok(service.setDrumStepVelocity('kick', 0, -4)),
    check: result => {
      assert.deepEqual(result.events[0].data.drumState.kick.stepVelocities, [0, 1, 1, .33, ...Array(12).fill(1)]);
      assert.equal('stepVelocities' in result.events[0].data.drumState.snare, false);
      assert.equal(result.events[0].data.drumState.kick.steps[3], false, 'setting a velocity does not switch the step on');
    },
  }),
  drumChange('a velocity that is not a number is 1', {
    type: 'drum.stepVelocity', body: { instrument: 'kick', step: 3, velocity: 'loud' },
    arrange: service => ok(service.setDrumStepVelocity('kick', 3, .2)),
    check: result => assert.equal(result.events[0].data.drumState.kick.stepVelocities[3], 1),
  }),
  drumChange('chance is held to 0..1 and repeats to a whole number from 1 to 4', {
    type: 'drum.stepDetail', body: { instrument: 'kick', step: 3, probability: .25, ratchet: 2.6 },
    check: result => {
      const { kick } = result.events[0].data.drumState;
      assert.deepEqual(kick.stepProbabilities, [1, 1, 1, .25, ...Array(12).fill(1)]);
      assert.deepEqual(kick.stepRatchets, [1, 1, 1, 3, ...Array(12).fill(1)]);
    },
  }),
  drumChange('only the detail that is sent gets a list', {
    type: 'drum.stepDetail', body: { instrument: 'kick', step: 3, ratchet: 9 },
    check: result => {
      assert.equal(result.events[0].data.drumState.kick.stepRatchets[3], 4);
      assert.equal('stepProbabilities' in result.events[0].data.drumState.kick, false);
    },
  }),
  drumChange('a step detail request with neither changes nothing but still emits and saves', {
    type: 'drum.stepDetail', body: { instrument: 'kick', step: 3 }, arrange: checkedDrums, check: unchanged,
  }),
  drumChange('a drum\'s settings are merged into what is there, then checked', {
    type: 'drum.settings', body: { instrument: 'ride', settings: { pan: -3, tune: .4, cymbalType: 'crash', bogus: 1 } },
    arrange: service => ok(service.setDrumSettings('ride', { volume: .9 })),
    check: (result, _service, _ctx, before) => {
      const { drumState } = result.events[0].data;
      assert.deepEqual(drumState.ride.settings, { volume: .9, tone: .5, extra: .5, tune: .4, humanize: .35, pan: -1, cymbalType: 'crash' });
      assert.deepEqual(drumState.kick, before.drumState.kick);
    },
  }),
  drumChange('a drum\'s own sends are kept below the whole, held to their range, and stored as nothing at the whole', {
    type: 'drum.settings', body: { instrument: 'kick', settings: { delaySend: 1, reverbSend: .4 } },
    arrange: service => { ok(service.setDrumSettings('kick', { delaySend: .2 })); ok(service.setDrumSettings('snare', { delaySend: -3, reverbSend: 8 })); },
    check: (result, _service, _ctx, before) => {
      const { drumState } = result.events[0].data;
      assert.equal(before.drumState.kick.settings.delaySend, .2);
      assert.deepEqual(drumState.kick.settings, { volume: .5, tone: .5, extra: .5, tune: 0, humanize: .35, pan: 0, reverbSend: .4 });
      assert.deepEqual(drumState.snare.settings, { ...before.drumState.clap.settings, delaySend: 0 });
      assert.equal('reverbSend' in drumState.snare.settings, false);
    },
  }),
  drumChange('a settings request with no settings changes nothing but still emits and saves', {
    type: 'drum.settings', body: { instrument: 'kick', settings: 'loud' },
    arrange: service => ok(service.setDrumSettings('kick', { pan: .5 })), check: unchanged,
  }),
  drumChange('a sample is put on a drum by its id', {
    type: 'drum.sample', body: { instrument: 'kick', sampleId: SAMPLE },
    check: result => { assert.equal(result.events[0].data.drumState.kick.sampleId, SAMPLE); assert.equal('sampleId' in result.events[0].data.drumState.snare, false); },
  }),
  ...([['no id', undefined], ['null', null], ['an id of the wrong form', 'kick.wav']] as const).map(([what, sampleId]): Case => drumChange(`${what} takes the sample off`, {
    type: 'drum.sample', body: { instrument: 'kick', sampleId }, arrange: service => ok(service.setDrumSample('kick', SAMPLE)),
    check: (result, _service, _ctx, before) => { assert.equal(before.drumState.kick.sampleId, SAMPLE); assert.equal('sampleId' in result.events[0].data.drumState.kick, false); },
  })),
  drumChange('a drum\'s mute and solo are set when they are true or false, and left otherwise', {
    type: 'drum.mix', body: { instrument: 'clap', muted: true, solo: 1 },
    check: result => {
      assert.deepEqual([result.events[0].data.drumState.clap.muted, result.events[0].data.drumState.clap.solo], [true, false]);
      assert.equal(result.events[0].data.drumState.kick.muted, false);
    },
  }),
  drumChange('a drum mix request with neither changes nothing but still emits and saves', {
    type: 'drum.mix', body: { instrument: 'clap' }, arrange: service => ok(service.setDrumMix('clap', { solo: true })), check: unchanged,
  }),
  // Rows after the eight drums (docs/DRUM_ROWS_PLAN.md).
  sceneChange('a row is added after the eight drums, empty, in every scene, and silent until it has a sound', {
    type: 'drum.addRow', arrange: service => { const ids = twoScenes(service); ok(service.setDrumBars(2)); return ids; }, body: { row: 'extra1' },
    check: (result, service) => {
      const { drumState, scenes } = result.events[0].data;
      assert.equal(drumState.extra1.steps.length, 32, 'as long as the drums');
      assert.equal(drumState.extra1.steps.some(Boolean), false);
      assert.equal('sampleId' in drumState.extra1 || 'percType' in drumState.extra1.settings, false, 'nothing to play yet');
      assert.deepEqual(scenes.map((scene: any) => scene.drums.extra1.steps.length), [16, 32], 'every scene has it, at its own length');
      ok(service.setDrumStep('extra1', 3, true));
      ok(service.setDrumSettings('extra1', { percType: 'cowbell' }));
      assert.equal(service.snapshot().drumState.extra1.steps[3], true, 'and it is edited as any row is');
      assert.equal(service.snapshot().drumState.extra1.settings.percType, 'cowbell', 'and plays any of the percussion');
    },
  }),
  { type: 'drum.addRow', title: 'a row that cannot be added is refused', body: { row: 'extra9' }, status: 400, error: 'A kit has eight rows to add at most' },
  { type: 'drum.addRow', title: 'nor one that is there already', arrange: service => ok(service.addDrumRow('extra2')), body: { row: 'extra2' }, status: 409, error: 'That row is there already' },
  sceneChange('an added row is taken out of the drums and every scene', {
    type: 'drum.removeRow', arrange: service => { twoScenes(service); ok(service.addDrumRow('extra3')); ok(service.setDrumMix('extra3', { muted: true })); }, body: { row: 'extra3' },
    check: result => {
      const { drumState, scenes } = result.events[0].data;
      assert.equal('extra3' in drumState, false);
      assert.equal(scenes.some((scene: any) => 'extra3' in scene.drums || 'extra3' in (scene.mutes?.drums ?? {})), false);
    },
  }),
  { type: 'drum.removeRow', title: 'a row that is not there is refused', body: { row: 'extra4' }, status: 404, error: 'There is no such row' },
  { type: 'drum.removeRow', title: 'and none of the eight can be removed', body: { row: 'kick' }, status: 404, error: 'There is no such row' },
];

for (const entry of cases) {
  test(`${entry.type} | ${entry.title}`, () => {
    const service = setup();
    const ctx = entry.arrange?.(service);
    service.flush();
    const before = service.snapshot();
    const fields = typeof entry.body === 'function' ? entry.body(ctx) : entry.body ?? {};
    const result = applied(service, store => store.apply({ type: entry.type, ...fields } as Operation));
    assert.equal(result.status, entry.status ?? 200, JSON.stringify(result.data));
    assert.deepEqual(result.events.map(event => event.type), entry.error ? [] : entry.events ?? []);
    assert.equal(result.saved, entry.error ? false : entry.saved ?? false, 'whether a save was scheduled');
    if (entry.error) {
      assert.deepEqual(result.data, { error: entry.error });
      assert.deepEqual(service.snapshot(), before, 'a refused operation changes nothing');
    } else if (result.events.length === 1 && entry.echo !== false) {
      assert.deepEqual(result.data, result.events[0].data, 'the answer is what was emitted');
    }
    if (result.saved) {
      const stored = JSON.parse(storage.get(STORAGE_KEY)!);
      assert.equal(stored.revision, before.revision + 1, 'one write, one revision');
      const { drumKits: _kits, restored: _restored, ...now } = service.snapshot();
      assert.deepEqual(json({ ...stored, synths: 0 }), json({ ...now, synths: 0 }), 'what was written is the state the operation left');
    } else {
      assert.equal(service.snapshot().revision, before.revision);
    }
    entry.check?.(result, service, ctx, before);
  });
}

// A read answers with a copy, emits nothing and schedules no save.
const reading = (title: string, arrange: ((service: LocalProjectService) => void) | undefined, read: (service: LocalProjectService) => any, check: (data: any, service: LocalProjectService, before: any) => void) =>
  test(title, () => {
    const service = setup();
    arrange?.(service);
    service.flush();
    const before = service.snapshot();
    const events: Message[] = [];
    let writes = 0;
    let listening = false;
    service.subscribe(message => { if (listening) events.push(message); });
    service.subscribeWrites(() => { writes++; });
    listening = true;
    const data = read(service);
    service.flush();
    assert.deepEqual(events, []);
    assert.equal(writes, 0);
    check(data, service, before);
    assert.deepEqual(content(service.snapshot()), content(before));
    assert.equal(service.snapshot().revision, before.revision);
  });

reading('getScenes answers with the scenes, the song and the open scene, read from the live pattern', service => { ok(service.setDrumStep('kick', 3, true)); }, service => service.getScenes(), data => {
  assert.deepEqual(keys(data), ['currentSceneId', 'scenes', 'song']);
  assert.equal(data.scenes.length, 1);
  assert.equal(data.scenes[0].name, 'Scene 1');
  assert.match(data.scenes[0].id, UUID);
  assert.equal(data.currentSceneId, data.scenes[0].id);
  assert.deepEqual(keys(data.scenes[0]), ['drums', 'id', 'lanes', 'mutes', 'name']);
  assert.equal(data.scenes[0].drums.kick.steps[3], true);
  assert.deepEqual(data.song, { entries: [{ sceneId: data.currentSceneId, repeats: 1 }], loop: false });
});
reading('getTempo reads the tempo', undefined, service => service.getTempo(), data => assert.deepEqual(data, { tempo: 120 }));
reading('getDrumKits lists the kits and names the default', undefined, service => service.getDrumKits(), data => assert.deepEqual(data, { kits: json(DRUM_KITS), defaultKitId: 'clean-analog' }));

test('events are delivered before selectScene returns, which song playback relies on when it opens a scene', () => {
  const service = setup();
  const { first } = twoScenes(service);
  const seen: Message[] = [];
  service.subscribe(message => seen.push(message));
  seen.length = 0;
  const result = service.selectScene(first);
  assert.deepEqual(seen.map(message => message.type), ['sceneChanged']);
  assert.equal(seen[0].data.currentSceneId, first);
  assert.equal(seen[0].data.drumState.kick.steps[3], true);
  assert.equal(service.snapshot().currentSceneId, first, 'and the store has already changed');
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  service.flush();
});

test('an event carries a copy: changing it does not reach the store or the other listeners', () => {
  const service = setup();
  const seen: Message[] = [];
  service.subscribe(message => { if (message.type === 'drumFullState') message.data.drumState.kick.steps[0] = true; });
  service.subscribe(message => seen.push(message));
  const result = ok(service.setDrumStep('snare', 1, true));
  assert.equal(seen.at(-1)!.data.drumState.kick.steps[0], false);
  assert.equal(result.drumState.kick.steps[0], false);
  assert.equal(service.snapshot().drumState.kick.steps[0], false);
  service.flush();
});

test('a save is scheduled, not made: the write follows about 300 ms after the last edit, once', async () => {
  const service = setup();
  let writes = 0;
  service.subscribeWrites(() => { writes++; });
  service.setDrumSwing(.2);
  service.setDrumSwing(.3);
  assert.equal(writes, 0);
  assert.equal(storage.has(STORAGE_KEY), false);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)!).drumSwing, .3);
  assert.equal(service.flush(), true);
  assert.equal(writes, 1, 'nothing is left to write');
});

test('an operation that does not save leaves earlier edits waiting, and a read does not write them', () => {
  const service = setup();
  let writes = 0;
  service.subscribeWrites(() => { writes++; });
  service.playLane(1);
  service.getTempo();
  service.getScenes();
  service.flush();
  assert.equal(writes, 0);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('an instrument name that is a built-in property of every object is an unknown instrument, not a throw', () => {
  const service = setup();
  const before = service.snapshot();
  for (const instrument of ['constructor', 'toString', '__proto__']) {
    const result = applied(service, store => store.setDrumStep(wrong(instrument), 0, true));
    assert.deepEqual([result.status, result.data, result.events, result.saved], [404, { error: NO_LANE }, [], false]);
  }
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.flush(), true);
  assert.equal(storage.has(STORAGE_KEY), false, 'nothing was scheduled');
});

test('an operation before the service is initialized is rejected, not answered', () => {
  assert.throws(() => new LocalProjectService().apply({ type: 'tempo.set', tempo: 100 }), /Local project has not been initialized/);
});

test('every operation has a case above that succeeds', () => {
  const succeeds = new Set(cases.filter(entry => !entry.error).map(entry => entry.type));
  assert.deepEqual(Object.keys(OP_META).filter(type => !succeeds.has(type as Operation['type'])), []);
});
