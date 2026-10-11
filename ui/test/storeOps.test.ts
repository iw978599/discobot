// The typed way into the project store: `apply(op)`, the typed helpers over it, the read methods
// and `subscribeOps`. While `request` still exists, each moved route is run both ways on two
// fresh stores, and the two must agree on everything: the answer, the events, whether a save
// was scheduled, and the project left behind. storeRoutes.test.ts pins what the routes do; this
// file pins that the typed way does the same. Each pull request of docs/TYPED_STORE_PLAN.md
// adds its group to `cases`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalProjectService } from '../src/services/localService.ts';
import { OP_META, type Applied, type OpNotice, type Operation } from '../src/services/projectOps.ts';
import { reducers } from '../src/services/projectReducers.ts';
import { merge } from '../src/services/projectSanitization.ts';
import { applied, call, comparable, setup, storage, type Message } from './helpers/store.ts';

const STORAGE_KEY = 'discobot_browser_project_v1';
// A value of the wrong type, as an untyped caller or a replayed operation could send.
const wrong = (value: unknown) => value as never;

interface Case {
  op: Operation['type'];
  title: string;
  arrange?: (service: LocalProjectService) => void;
  path: string;
  body: unknown;
  run: (service: LocalProjectService) => Applied<unknown>;
  // What both ways answer and emit, and the event's name.
  answer: unknown;
  event: string;
  check?: (project: any) => void;
}

const swing = (title: string, sent: unknown, answer: number, arrange?: Case['arrange']): Case[] => [
  { op: 'drum.swing', title, arrange, path: '/drum/swing', body: sent === undefined ? {} : { swing: sent }, run: service => service.setDrumSwing(wrong(sent)), answer: { swing: answer }, event: 'drumSwing', check: project => assert.equal(project.drumSwing, answer) },
];
const volume = (title: string, sent: unknown, answer: number, arrange?: Case['arrange']): Case[] => [
  { op: 'drum.masterVolume', title, arrange, path: '/drum/master-volume', body: sent === undefined ? {} : { volume: sent }, run: service => service.setDrumMasterVolume(wrong(sent)), answer: { volume: answer }, event: 'drumMasterVolume', check: project => assert.equal(project.drumMasterVolume, answer) },
];
const swingSet = (service: LocalProjectService) => { service.setDrumSwing(.4); };
const volumeSet = (service: LocalProjectService) => { service.setDrumMasterVolume(.6); };

const cases: Case[] = [
  ...swing('a swing in range is kept as sent', .3, .3),
  ...swing('a swing past the top is held at .75', 5, .75),
  ...swing('a swing below zero is held at 0', -1, 0, swingSet),
  ...swing('no swing leaves it as it was, and still emits and saves', undefined, .4, swingSet),
  ...swing('a swing that is not a number leaves it as it was', 'lots', .4, swingSet),
  ...swing('a swing that is not finite leaves it as it was', Number.NaN, .4, swingSet),
  ...swing('null leaves the swing as it was', null, .4, swingSet),
  ...volume('a volume in range is kept as sent', .25, .25),
  ...volume('a volume past the top is held at 1', 3, 1, volumeSet),
  ...volume('a volume below zero is held at 0', -.5, 0),
  ...volume('no volume leaves it as it was, and still emits and saves', undefined, .6, volumeSet),
  ...volume('a volume that is not a number leaves it as it was', '11', .6, volumeSet),
  ...volume('a volume that is not finite leaves it as it was', Number.POSITIVE_INFINITY, .6, volumeSet),
];

for (const entry of cases) {
  test(`${entry.op} | ${entry.title}: the route and the typed helper do the same`, async () => {
    const one = setup();
    entry.arrange?.(one);
    one.flush();
    const routed = await call(one, 'POST', entry.path, entry.body);
    const routedProject = one.snapshot(), routedStored = JSON.parse(storage.get(STORAGE_KEY)!);

    const two = setup();
    entry.arrange?.(two);
    two.flush();
    const typed = applied(two, entry.run);
    const typedProject = two.snapshot(), typedStored = JSON.parse(storage.get(STORAGE_KEY)!);

    assert.equal(typed.status, 200);
    assert.deepEqual(typed.data, entry.answer);
    assert.deepEqual(typed.events, [{ type: entry.event, data: entry.answer }]);
    assert.equal(typed.saved, OP_META[entry.op].save, 'an accepted operation saves when OP_META says so');
    entry.check?.(typedProject);

    assert.equal(typed.status, routed.status);
    assert.deepEqual(typed.data, routed.data);
    assert.deepEqual(typed.events, routed.events);
    assert.equal(typed.saved, routed.saved);
    assert.equal(typedProject.revision, routedProject.revision);
    assert.deepEqual(comparable(typedProject), comparable(routedProject));
    assert.deepEqual(comparable(typedStored), comparable(routedStored), 'and the same project was written');
  });
}

test('every case above is for an operation that has a reducer, and every reducer has a case', () => {
  assert.deepEqual([...new Set(cases.map(entry => entry.op))].sort(), Object.keys(reducers).sort());
  for (const type of Object.keys(reducers)) assert.ok(type in OP_META, type);
});

test('apply is synchronous: the event has arrived and the store has changed before it returns', () => {
  const service = setup();
  const seen: Message[] = [];
  service.subscribe(message => seen.push(message));
  seen.length = 0;
  const result = service.apply({ type: 'drum.swing', swing: .3 });
  assert.deepEqual(seen, [{ type: 'drumSwing', data: { swing: .3 } }]);
  assert.deepEqual(result, { ok: true, value: { swing: .3 } });
  assert.equal(service.snapshot().drumSwing, .3);
  for (const method of ['apply', 'applyAll', 'setDrumSwing', 'setDrumMasterVolume', 'getScenes', 'getTempo', 'getDrumKits'] as const) {
    assert.equal(LocalProjectService.prototype[method].constructor.name, 'Function', `${method} is not async`);
  }
  service.flush();
});

test('an operation listener hears each accepted operation after its event, with where it came from and whether it saved', () => {
  const service = setup();
  const order: string[] = [], notices: OpNotice[] = [];
  service.subscribe(message => order.push(`event ${message.type}`));
  const stop = service.subscribeOps(notice => { order.push(`op ${notice.op.type}`); notices.push(notice); });
  order.length = 0;
  const first: Operation = { type: 'drum.swing', swing: 9 }, second: Operation = { type: 'drum.masterVolume', volume: .5 };
  service.apply(first);
  service.apply(second, 'history');
  assert.deepEqual(order, ['event drumSwing', 'op drum.swing', 'event drumMasterVolume', 'op drum.masterVolume']);
  assert.deepEqual(notices, [{ op: first, origin: 'local', saved: true }, { op: second, origin: 'history', saved: true }]);
  assert.equal(notices[0].op, first, 'the operation as it was sent, not as it was clamped');
  stop();
  service.setDrumSwing(.1);
  assert.equal(notices.length, 2, 'and nothing once it has stopped listening');
  service.flush();
});

// No operation moved so far can be refused, and none goes unsaved, so these two stand a reducer
// in for one that has not moved yet. They are about `apply`, not about the operation named.
function standIn<T>(type: 'tempo.set' | 'transport.play', reducer: (...args: any[]) => unknown, run: (service: LocalProjectService) => T): T {
  assert.equal(type in reducers, false, `${type} has a reducer of its own now: stand in for another`);
  (reducers as Record<string, unknown>)[type] = reducer;
  try { return run(setup()); } finally { delete (reducers as Record<string, unknown>)[type]; }
}

test('a refused operation is answered, not thrown: no event, no notice, no save', () => {
  standIn('tempo.set', () => ({ ok: false, status: 400, error: 'Invalid tempo', save: true, event: { type: 'tempoChange', data: {} } }), service => {
    const before = service.snapshot();
    let notices = 0;
    service.subscribeOps(() => { notices++; });
    const result = applied(service, target => target.apply({ type: 'tempo.set', tempo: 5 }));
    assert.deepEqual(result, { status: 400, data: { error: 'Invalid tempo' }, events: [], saved: false });
    assert.deepEqual(service.apply({ type: 'tempo.set', tempo: 5 }), { ok: false, status: 400, error: 'Invalid tempo' });
    assert.equal(notices, 0);
    assert.deepEqual(service.snapshot(), before);
  });
});

test('an operation that does not save is still announced, with saved false, and its answer is a copy', () => {
  standIn('transport.play', ({ state }: any) => ({ ok: true, value: state.song, event: { type: 'sequencerPlay', data: { synthId: 1 } } }), service => {
    const notices: OpNotice[] = [];
    service.subscribeOps(notice => notices.push(notice));
    let answer: any;
    const result = applied(service, target => (answer = target.apply({ type: 'transport.play', synthId: 1 })));
    assert.deepEqual(result.events, [{ type: 'sequencerPlay', data: { synthId: 1 } }]);
    assert.equal(result.saved, false);
    assert.deepEqual(notices.map(notice => notice.saved), [false]);
    answer.value.loop = true;
    assert.equal(service.getScenes().song.loop, false, 'changing the answer does not reach the store');
  });
});

test('before the service is initialized the typed way throws, with the message request() rejects with', () => {
  const message = /Local project has not been initialized/;
  assert.throws(() => new LocalProjectService().apply({ type: 'drum.swing', swing: .1 }), message);
  assert.throws(() => new LocalProjectService().applyAll([{ type: 'drum.swing', swing: .1 }]), message);
  assert.throws(() => new LocalProjectService().setDrumSwing(.1), message);
  assert.throws(() => new LocalProjectService().setDrumMasterVolume(.1), message);
  assert.throws(() => new LocalProjectService().getTempo(), message);
  assert.throws(() => new LocalProjectService().getScenes(), message);
});

// Until the last pull request of the plan every operation is in the type but only some have a
// reducer. When scene.rename gains one, name another here; when all have one, delete this.
test('an operation whose route has not moved yet throws, and changes nothing', () => {
  const service = setup();
  const before = service.snapshot();
  assert.throws(() => service.apply({ type: 'scene.rename', sceneId: service.getScenes().currentSceneId, name: 'Verse' }), /No reducer for scene\.rename yet/);
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.flush(), true);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('applyAll applies in order, each delivered before the next, and saves once', () => {
  const service = setup();
  const order: string[] = [];
  service.subscribe(message => order.push(`event ${message.type} ${JSON.stringify(message.data)}`));
  service.subscribeOps(notice => order.push(`op ${notice.op.type} ${notice.origin}`));
  order.length = 0;
  let writes = 0;
  service.subscribeWrites(() => { writes++; });
  const results = service.applyAll([{ type: 'drum.swing', swing: .2 }, { type: 'drum.masterVolume', volume: 2 }, { type: 'drum.swing', swing: .5 }], 'history');
  assert.deepEqual(results, [{ ok: true, value: { swing: .2 } }, { ok: true, value: { volume: 1 } }, { ok: true, value: { swing: .5 } }]);
  assert.deepEqual(order, [
    'event drumSwing {"swing":0.2}', 'op drum.swing history',
    'event drumMasterVolume {"volume":1}', 'op drum.masterVolume history',
    'event drumSwing {"swing":0.5}', 'op drum.swing history',
  ]);
  assert.equal(writes, 0);
  service.flush();
  assert.equal(writes, 1);
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)!).drumSwing, .5);
  assert.deepEqual(service.applyAll([]), []);
});

test('the read methods answer what their routes answer, as copies, without saving', async () => {
  const service = setup();
  await service.request('/drum/step', { method: 'POST', body: JSON.stringify({ instrument: 'kick', step: 3, active: true }) });
  service.flush();
  let writes = 0;
  service.subscribeWrites(() => { writes++; });
  const route = async (path: string) => (await service.request(path)).json();

  assert.deepEqual(service.getTempo(), await route('/tempo'));
  assert.deepEqual(service.getTempo(), { tempo: 120 });
  assert.deepEqual(service.getDrumKits(), await route('/drum/kits'));
  assert.equal(service.getDrumKits().defaultKitId, 'clean-analog');
  const scenes = service.getScenes();
  assert.deepEqual(scenes, await route('/scenes'));
  assert.deepEqual(Object.keys(scenes).sort(), ['currentSceneId', 'scenes', 'song']);
  assert.equal(scenes.scenes[0].drums.kick.steps[3], true, 'the open scene is read from the live pattern');

  scenes.scenes[0].name = 'changed';
  scenes.song.loop = true;
  service.getDrumKits().kits[0].name = 'changed';
  assert.equal(service.getScenes().scenes[0].name, 'Scene 1');
  assert.equal(service.getScenes().song.loop, false);
  assert.notEqual(service.getDrumKits().kits[0].name, 'changed');
  service.flush();
  assert.equal(writes, 0);
});

test('merge copies its base, goes into objects, replaces lists and skips the keys that reach a prototype', () => {
  const base = { a: { b: 1, c: [1, 2] }, d: 'kept' };
  const merged = merge(base, JSON.parse('{"a":{"c":[3],"e":2},"__proto__":{"x":1},"constructor":{"x":1},"prototype":{"x":1}}'));
  assert.deepEqual(merged, { a: { b: 1, c: [3], e: 2 }, d: 'kept' });
  assert.deepEqual(base, { a: { b: 1, c: [1, 2] }, d: 'kept' });
  assert.equal((merged as any).x, undefined);
  assert.equal(Object.keys(merged).includes('constructor'), false);
});
