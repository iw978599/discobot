// Live sessions, stage 2: browsers editing one project through the room's real rules. Each browser
// is a real project store with a session; the room is server/src/live.ts. Messages and timers are
// delivered by hand, so a test chooses which edits cross on their way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { BATCH_MS, JOIN_WAIT_MS, createLiveSession, editKeys, overlap } from '../src/services/liveSession.ts';
import { freeColour, joined, left, received, type Peer } from '../../server/src/live.ts';
import { comparable, defaults, ok, setup, storage } from './helpers/store.ts';

function room() {
  const peers: Peer[] = [];
  const browsers: Browser[] = [];
  let now = 0, since = 0;
  const timers: Array<{ at: number; run: () => void; done: boolean }> = [];

  // A browser with a project of its own (the first one made shares the helper's storage).
  function browser(user: string, store?: LocalProjectService) {
    if (!store) {
      storage.clear();
      store = new LocalProjectService();
      store.initialize(defaults());
    }
    const inbox: string[] = [];
    const sent: any[] = [];
    const saving: boolean[] = [];
    let events!: { received(text: string): void; closed(): void };
    const peer: Peer = { id: user, user, colour: freeColour(peers), since: ++since, send: text => inbox.push(text) };
    const session = createLiveSession({
      store,
      connect: handlers => {
        events = handlers;
        return {
          send: text => { sent.push(JSON.parse(text)); received(peers, peer, text); },
          close: () => { const at = peers.indexOf(peer); if (at >= 0) { peers.splice(at, 1); left(peers, peer); } },
        };
      },
      later: (run, ms) => { const timer = { at: now + ms, run, done: false }; timers.push(timer); return () => { timer.done = true; }; },
      saving: on => saving.push(on),
    });
    peers.push(peer);
    joined(peers, peer);
    const made = { user, store, session, inbox, sent, saving, receive: (text: string) => events.received(text) };
    browsers.push(made);
    return made;
  }

  // Delivers everything waiting, and what that sends, until the room is quiet.
  async function deliver() {
    for (let round = 0; round < 50; round++) {
      let any = false;
      for (const entry of browsers) {
        while (entry.inbox.length) { any = true; entry.receive(entry.inbox.shift()!); }
        await entry.session.settled();
      }
      if (!any) return;
    }
    throw new Error('the room never went quiet');
  }

  // Moves the clock on, running the timers that come due, in order.
  function tick(ms = BATCH_MS) {
    now += ms;
    for (const timer of timers.filter(entry => !entry.done && entry.at <= now).sort((a, b) => a.at - b.at)) {
      timer.done = true;
      timer.run();
    }
  }

  return { browser, deliver, tick };
}
type Browser = ReturnType<ReturnType<typeof room>['browser']>;

// What two browsers must agree on: the project as the store would keep it (a project that has come
// through the checks has every setting filled in), but not which scene each has open.
function shape(store: LocalProjectService) {
  const project = store.normalized((store.exportProject() as any).project) as any;
  return comparable({
    tempo: project.tempo, scenes: project.scenes, song: project.song, effectsLoop: project.effectsLoop, drumFx: project.drumFx,
    synths: project.synths.map(({ synthId, synthParams, synthModelId, synthModelParams, name, preset, swing }: any) => ({ synthId, synthParams, synthModelId, synthModelParams, name, preset, swing })),
    drums: Object.fromEntries(Object.entries(project.drumState).map(([drum, lane]: [string, any]) => [drum, { settings: lane.settings, sampleId: lane.sampleId }])),
    guests: project.guests,
  });
}
const kick = (store: LocalProjectService) => (store.snapshot() as any).drumState.kick.steps.map((step: any) => step === true || step?.active === true);

async function twoInSession() {
  const live = room();
  const ann = live.browser('ann', setup());
  await live.deliver();
  const ben = live.browser('ben');
  await live.deliver();
  return { live, ann, ben };
}

test('the parts of the project an edit changes overlap where one contains the other', () => {
  const cell = editKeys({ type: 'drum.step', instrument: 'kick', step: 3, active: true }, 's1');
  const grid = editKeys({ type: 'drum.state', state: {} }, 's1');
  const otherScene = editKeys({ type: 'drum.step', instrument: 'kick', step: 3, active: true }, 's2');
  const settings = editKeys({ type: 'drum.settings', instrument: 'kick', settings: { volume: .4 } }, 's1');
  assert.ok(overlap(cell, grid), 'a whole drum state and one of its cells');
  assert.ok(!overlap(cell, otherScene), 'the same cell in another scene');
  assert.ok(overlap(settings, grid), 'a whole drum state holds every drum\'s settings');
  const cutoff = editKeys({ type: 'synth.params', synthId: 1, patch: { filter: { cutoff: 900 } } as any }, 's1');
  const resonance = editKeys({ type: 'synth.params', synthId: 1, patch: { filter: { resonance: .5 } } as any }, 's1');
  const model = editKeys({ type: 'synth.model', synthId: 1, modelId: 'minimoog' as any }, 's1');
  assert.ok(!overlap(cutoff, resonance), 'two knobs of one lane');
  assert.ok(overlap(cutoff, model), 'a model sets the whole sound');
  assert.ok(overlap(editKeys({ type: 'scene.replace' }, 's1'), cutoff), 'the whole project overlaps everything');
  assert.deepEqual(editKeys({ type: 'scene.select', sceneId: 's2' }, 's1'), []);
});

test('someone joining takes the project of the person already there, who alone saves it', async () => {
  const { ann, ben } = await twoInSession();
  assert.equal(ann.session.status().state, 'live');
  assert.equal(ben.session.status().state, 'live');
  assert.deepEqual(shape(ben.store), shape(ann.store));
  assert.deepEqual(ann.saving, [true]);
  assert.deepEqual(ben.saving, [false]);
  assert.deepEqual(ben.session.status().others.map(member => member.user), ['ann']);
});

test('an edit reaches the other person, outside their undo, and opening a scene is not sent', async () => {
  const { live, ann, ben } = await twoInSession();
  ok(ann.store.setTempo(141));
  ok(ann.store.setDrumStep('kick', 2, true));
  live.tick();
  await live.deliver();
  assert.equal(ben.store.getTempo().tempo, 141);
  assert.equal(kick(ben.store)[2], true);
  assert.equal(ben.store.undoSteps().undo, 0, 'another person\'s edit is theirs to undo');
  assert.ok(ann.store.undoSteps().undo > 0);

  const first = ann.store.openSceneId();
  const second = ok(ann.store.createScene({ empty: true })).currentSceneId;
  live.tick();
  await live.deliver();
  assert.equal(ben.store.openSceneId(), first, 'a scene made by someone else is made here, and not opened');
  assert.ok(ben.store.hasScene(second));
  ann.sent.length = 0;
  ok(ann.store.selectScene(first));
  live.tick();
  await live.deliver();
  assert.deepEqual(ann.sent, []);
});

test('a knob turned through many values is one message', async () => {
  const { live, ann, ben } = await twoInSession();
  ann.sent.length = 0;
  for (let tempo = 100; tempo < 130; tempo++) ok(ann.store.setTempo(tempo));
  live.tick();
  await live.deliver();
  assert.equal(ann.sent.length, 1);
  assert.equal(ann.sent[0].edits.length, 1);
  assert.equal(ben.store.getTempo().tempo, 129);
});

test('two edits to one part that cross on their way end the same in both browsers, the later one on top', async () => {
  const { live, ann, ben } = await twoInSession();
  // Ann writes the whole drum grid with step 5 on; at the same moment Ben turns step 5 off and 9 on.
  // Ann's reaches the room first, so Ben's cells land on top of her grid everywhere.
  const state = structuredClone((ann.store.snapshot() as any).drumState);
  state.kick.steps = state.kick.steps.map((_: unknown, at: number) => at === 5);
  ok(ann.store.setDrumState(state));
  ok(ben.store.setDrumStep('kick', 5, false));
  ok(ben.store.setDrumStep('kick', 9, true));
  live.tick();
  await live.deliver();
  assert.equal(kick(ann.store)[5], false);
  assert.equal(kick(ann.store)[9], true);
  assert.deepEqual(kick(ann.store), kick(ben.store));
  assert.deepEqual(shape(ann.store), shape(ben.store));
});

test('the room\'s order decides between crossing edits, whoever made them', async () => {
  const { live, ann, ben } = await twoInSession();
  const state = structuredClone((ann.store.snapshot() as any).drumState);
  state.kick.steps = state.kick.steps.map((_: unknown, at: number) => at === 5);
  // Ben's goes first: Ann's whole grid is ordered after it and wins everywhere.
  ok(ben.store.setDrumStep('kick', 9, true));
  live.tick();
  ok(ann.store.setDrumState(state));
  live.tick();
  await live.deliver();
  assert.equal(kick(ben.store)[9], false);
  assert.equal(kick(ann.store)[5], true);
  assert.deepEqual(kick(ann.store), kick(ben.store));
});

test('an edit made in another scene lands in that scene, and each person stays where they are', async () => {
  const { live, ann, ben } = await twoInSession();
  const first = ann.store.openSceneId();
  const second = ok(ann.store.createScene({ empty: true })).currentSceneId;
  live.tick();
  await live.deliver();
  ok(ann.store.setDrumStep('kick', 3, true));
  ok(ben.store.setDrumStep('kick', 1, true));
  live.tick();
  await live.deliver();
  assert.equal(ann.store.openSceneId(), second);
  assert.equal(ben.store.openSceneId(), first);
  assert.equal(kick(ann.store)[1], false);
  assert.equal(kick(ann.store)[3], true);
  assert.equal(kick(ben.store)[1], true);
  assert.equal(kick(ben.store)[3], false);
  assert.deepEqual(shape(ann.store), shape(ben.store));
});

test('undo sends the whole project, and everyone takes it', async () => {
  const { live, ann, ben } = await twoInSession();
  const before = ann.store.getTempo().tempo;
  ok(ann.store.setTempo(150));
  live.tick();
  await live.deliver();
  assert.equal(ben.store.getTempo().tempo, 150);
  assert.ok(ann.store.undo());
  await live.deliver();
  assert.equal(ben.store.getTempo().tempo, before);
  assert.equal(ann.sent.at(-1).t, 'replace');
  assert.deepEqual(shape(ann.store), shape(ben.store));
});

test('Reset All, which makes a scene inside the store, sends the whole project', async () => {
  const { live, ann, ben } = await twoInSession();
  ok(ann.store.setDrumStep('kick', 4, true));
  ok(ann.store.createScene({ empty: true }));
  live.tick();
  await live.deliver();
  ok(ann.store.replaceScenes());
  live.tick();
  await live.deliver();
  assert.equal(ann.sent.at(-1).t, 'replace');
  assert.deepEqual(shape(ann.store), shape(ben.store));
  assert.equal(ann.store.openSceneId(), ben.store.openSceneId());
});

test('edits made while the project is on its way are kept, on top of it', async () => {
  const live = room();
  const ann = live.browser('ann', setup());
  await live.deliver();
  // Ben has an older copy of the same project, as anyone it is shared with does.
  ok(ann.store.setDrumStep('kick', 0, true));
  ann.store.flush();
  const older = new LocalProjectService();
  older.initialize(defaults());
  assert.equal(older.openProjectId(), ann.store.openProjectId());
  ok(ann.store.setTempo(133));
  live.tick();
  await live.deliver();
  const ben = live.browser('ben', older);
  // Ben's welcome arrives, and his edit is made before Ann's project does.
  ben.receive(ben.inbox.shift()!);
  await ben.session.settled();
  assert.equal(ben.session.status().state, 'joining');
  ok(ben.store.setDrumStep('kick', 7, true));
  live.tick();
  await live.deliver();
  live.tick();
  await live.deliver();
  assert.equal(ben.store.getTempo().tempo, 133);
  assert.equal(kick(ben.store)[7], true);
  assert.equal(kick(ann.store)[7], true);
  assert.deepEqual(shape(ann.store), shape(ben.store));
});

test('someone joining whose project never comes goes on with their own copy', async () => {
  const live = room();
  live.browser('ann', setup());
  await live.deliver();
  const ben = live.browser('ben');
  ben.receive(ben.inbox.shift()!);
  await ben.session.settled();
  ben.inbox.length = 0;
  live.tick(JOIN_WAIT_MS);
  await ben.session.settled();
  assert.equal(ben.session.status().state, 'live');
});

test('a third person joining is sent the project once, by the person longest in the session', async () => {
  const { live, ann, ben } = await twoInSession();
  ok(ben.store.setTempo(118));
  live.tick();
  await live.deliver();
  ann.sent.length = 0;
  ben.sent.length = 0;
  const cy = live.browser('cy');
  await live.deliver();
  assert.equal(ann.sent.filter(message => message.t === 'state').length, 1);
  assert.equal(ben.sent.filter(message => message.t === 'state').length, 0);
  assert.equal(cy.store.getTempo().tempo, 118);
  assert.deepEqual(cy.saving, [false]);
});

test('when the person saving leaves, the next longest in the session saves', async () => {
  const { live, ann, ben } = await twoInSession();
  ann.session.close();
  assert.equal(ann.session.status().state, 'closed');
  ben.receive(ben.inbox.shift()!);
  await ben.session.settled();
  assert.deepEqual(ben.saving, [false, true]);
  // Nothing more is sent from a session that has ended.
  ann.sent.length = 0;
  ok(ann.store.setTempo(90));
  live.tick();
  assert.deepEqual(ann.sent, []);
});
