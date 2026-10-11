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
    assert.deepEqual(keys(message.synths[0]), ['muted', 'pattern', 'solo', 'synthId']);
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
    ['synth.remove', {}], ['synth.params', { patch: {} }], ['synth.model', {}], ['synth.mix', {}], ['synth.prefs', {}],
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
      assert.deepEqual({ ...scenes[1], id: 0, name: 0 }, { ...scenes[0], id: 0, name: 0 });
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
  ...([4, -1, 1.5, '2'] as const).map((synthId): Case => (
    { type: 'synth.create', title: `lane ${JSON.stringify(synthId)} is refused`, body: { synthId }, status: 400, error: 'Three synths maximum' }
  )),
  {
    type: 'synth.create', title: 'with all three lanes there, no lane named is refused', body: {},
    arrange: service => { ok(service.createLane()); ok(service.createLane()); }, status: 400, error: 'Three synths maximum',
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
      for (const scene of service.snapshot().scenes) assert.deepEqual(keys(scene), ['drums', 'id', 'lanes', 'mutes', 'name']);
    },
  }, ['guestsChanged']),

  // --- Drums: levels, effects, length
  ...([
    ['drum.masterVolume', 'drumMasterVolume', 'volume', 'drumMasterVolume', 1, .6],
    ['drum.swing', 'drumSwing', 'swing', 'drumSwing', .75, .3],
  ] as const).flatMap(([type, event, field, stateKey, max, value]): Case[] => {
    const set = (service: LocalProjectService, to: number) => ok(type === 'drum.swing' ? service.setDrumSwing(to) : service.setDrumMasterVolume(to));
    return [
      changed(`sets ${field} and emits ${event}`, {
        type, body: { [field]: value },
        check: (result, service) => { assert.deepEqual(result.events[0].data, { [field]: value }); assert.equal(service.snapshot()[stateKey], value); },
      }, [event]),
      changed(`${field} is held to 0..${max}`, {
        type, body: { [field]: 5 }, arrange: service => set(service, -5),
        check: (result, _service, _ctx, before) => { assert.equal(before[stateKey], 0); assert.deepEqual(result.events[0].data, { [field]: max }); },
      }, [event]),
      changed(`a ${field} that is not a number changes nothing but still emits and saves`, {
        type, body: { [field]: '0.5' }, arrange: service => set(service, value),
        check: (result, service, _ctx, before) => { assert.deepEqual(result.events[0].data, { [field]: value }); unchanged(result, service, null, before); },
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

test('an instrument name that is a built-in property of every object is not refused: the edit throws (looks wrong)', () => {
  const service = setup();
  const before = service.snapshot();
  for (const instrument of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => service.setDrumStep(wrong(instrument), 0, true), TypeError);
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
