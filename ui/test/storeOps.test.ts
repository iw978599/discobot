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
import { MAX_GUESTS } from '../src/services/guests.ts';
import { applied, call, comparable, setup, storage, type Message } from './helpers/store.ts';

const STORAGE_KEY = 'discobot_browser_project_v1';
// A value of the wrong type, as an untyped caller or a replayed operation could send.
const wrong = (value: unknown) => value as never;

// Either way of making an edit, run on a store of its own. An accepted case names what both
// answer and emit; a refused one names the status and the error, and both must then have
// emitted nothing, saved nothing and left the project as it was. Ids the stores make differ
// between the two, so an answer is written with each id as its place among them: 'id-1'.
interface Case {
  op: Operation['type'];
  title: string;
  // Whatever it returns is handed to `path` and `run`: usually an id it made.
  arrange?: (service: LocalProjectService) => any;
  method?: string;
  path: string | ((ctx: any) => string);
  body: unknown;
  run: (service: LocalProjectService, ctx: any) => Applied<unknown>;
  // Accepted: what both ways answer and emit, and the event's name.
  answer?: unknown;
  event?: string;
  // Refused: the status and the error both ways answer with.
  status?: 400 | 404 | 409;
  error?: string;
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

const GUEST_URL = 'https://guest.example/synth';
const NO_GUEST = '00000000-0000-4000-8000-000000000000';
const BAD_ADDRESS = 'That is not an address a guest instrument can be loaded from. It must start with https:// and be on another site.';
const FULL = `A project can hold ${MAX_GUESTS} guest instruments.`;
// A guest as the store keeps a new one, with its id as its place among the ids.
const kept = (place: number, rest: object = {}) => ({ id: `id-${place}`, url: GUEST_URL, name: 'guest.example', volume: .8, muted: false, ...rest });
const addGuest = (service: LocalProjectService, url = GUEST_URL) => {
  const result = service.addGuest(url);
  assert.ok(result.ok);
  return result.value.guests.at(-1)!.id;
};
const fill = (service: LocalProjectService) => { for (let count = 0; count < MAX_GUESTS; count++) addGuest(service, `https://guest${count}.example/`); };
// A guest with everything set that a change can set.
const dressed = (service: LocalProjectService) => {
  const id = addGuest(service);
  assert.ok(service.changeGuest(id, { name: 'Choir', volume: .5, muted: true, sends: { reverb: .5, delay: 0, drive: 0, phaser: 0 }, state: { a: 1 } }).ok);
  return id;
};
const DRESSED = { name: 'Choir', volume: .5, muted: true, sends: { reverb: .5, delay: 0, drive: 0, phaser: 0, chorus: 0 }, state: { a: 1 } };
type Outcome = { answer: unknown } | { status: 400 | 404 | 409; error: string };
const outcome = (result: Outcome) => ('answer' in result ? { answer: result.answer, event: 'guestsChanged' } : result);
// In a route's body JSON has already left out what is undefined; `body` is what is sent to both.
const guestAdd = (title: string, body: { url?: unknown; name?: unknown }, result: Outcome, arrange?: Case['arrange']): Case => ({
  op: 'guest.add', title, arrange, path: '/guests', body, run: service => service.addGuest(wrong(body.url), wrong(body.name)), ...outcome(result),
});
const guestChange = (title: string, patch: unknown, result: Outcome, arrange: Case['arrange'] = dressed): Case => ({
  op: 'guest.patch', title, arrange, method: 'PUT', path: id => `/guests/${id}`, body: patch, run: (service, id) => service.changeGuest(id, wrong(patch)), ...outcome(result),
});
const guestRemove = (title: string, result: Outcome, arrange: Case['arrange'], check?: Case['check']): Case => ({
  op: 'guest.remove', title, arrange, method: 'DELETE', path: (ctx: any) => `/guests/${ctx.id ?? ctx}`, body: {}, run: (service, ctx) => service.removeGuest(ctx.id ?? ctx), ...outcome(result), check,
});

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

  guestAdd('a guest is added with a new id, its address tidied and its site as its name', { url: `  ${GUEST_URL}?a=1#part  ` }, { answer: { guests: [kept(1, { url: `${GUEST_URL}?a=1` })] } }),
  guestAdd('a guest can be given a name, cut to 60 characters, and goes after the ones already there', { url: 'http://localhost:8787/__guest', name: `  ${'g'.repeat(70)}  ` },
    { answer: { guests: [kept(1), kept(2, { url: 'http://localhost:8787/__guest', name: 'g'.repeat(60) })] } }, addGuest),
  guestAdd('a name that is undefined gives the site as the name', { url: GUEST_URL, name: undefined }, { answer: { guests: [kept(1)] } }),
  guestAdd('a name that is not text gives the site as the name', { url: GUEST_URL, name: 7 }, { answer: { guests: [kept(1)] } }),
  guestAdd('a name that is not a number at all gives the site as the name', { url: GUEST_URL, name: Number.NaN }, { answer: { guests: [kept(1)] } }),
  guestAdd('an address that is not https is refused', { url: 'http://guest.example/' }, { status: 400, error: BAD_ADDRESS }),
  guestAdd('an address that is not text is refused', { url: 7 }, { status: 400, error: BAD_ADDRESS }),
  guestAdd('no address at all is refused', { url: undefined }, { status: 400, error: BAD_ADDRESS }, addGuest),
  guestAdd('an address that is not a number at all is refused', { url: Number.NaN }, { status: 400, error: BAD_ADDRESS }),
  guestAdd(`a project holds at most ${MAX_GUESTS} guests, and says so with a 409`, { url: GUEST_URL }, { status: 409, error: FULL }, fill),
  guestAdd('a bad address is a 400 even when the project is full', { url: 'nope' }, { status: 400, error: BAD_ADDRESS }, fill),

  guestChange('a guest\'s name, level, mute, sends and settings are each checked', { name: '  Bass  ', volume: 3, muted: false, sends: { reverb: .25, delay: 9, bogus: 1 }, state: { voices: [1, 2] }, url: 'https://evil.example/', id: 'x' },
    { answer: { guests: [kept(1, { name: 'Bass', volume: 1, muted: false, sends: { reverb: .25, delay: 1, drive: 0, phaser: 0, chorus: 0 }, state: { voices: [1, 2] } })] } }),
  guestChange('a change of nothing leaves the guest as it was, and still emits and saves', {}, { answer: { guests: [kept(1, DRESSED)] } }),
  guestChange('what is undefined is not a change: JSON never sent it', { name: undefined, volume: undefined, muted: undefined, sends: undefined, state: undefined }, { answer: { guests: [kept(1, DRESSED)] } }),
  guestChange('what is not a number at all arrives as null: the level stays, the mute goes off, the settings go', { volume: Number.NaN, muted: Number.NaN, state: Number.NaN, name: Number.NaN },
    { answer: { guests: [kept(1, { name: 'Choir', volume: .5, muted: false, sends: DRESSED.sends })] } }),
  guestChange('a level that is not finite leaves it as it was, and a send that is not finite likewise', { volume: Number.POSITIVE_INFINITY, sends: { reverb: Number.NEGATIVE_INFINITY, delay: .5 } },
    { answer: { guests: [kept(1, { ...DRESSED, sends: { ...DRESSED.sends, delay: .5 } })] } }),
  guestChange('inside a guest\'s settings, what is undefined is left out and what is not finite is null', { state: { a: undefined, b: Number.NaN, c: [undefined, Number.POSITIVE_INFINITY], d: 'kept' } },
    { answer: { guests: [kept(1, { ...DRESSED, state: { b: null, c: [null, null], d: 'kept' } })] } }),
  guestChange('sends of nothing and settings of null are taken off the guest; a blank name keeps the old one', { name: '  ', sends: { reverb: 0 }, state: null, muted: 'yes' },
    { answer: { guests: [kept(1, { name: 'Choir', volume: .5 })] } }),
  guestChange('only the guest named is changed', { muted: true }, { answer: { guests: [kept(1, { url: 'https://other.example/', name: 'other.example' }), kept(2, { muted: true })] } },
    service => { addGuest(service, 'https://other.example/'); return addGuest(service); }),
  guestChange('a guest that does not exist cannot be changed', { muted: true }, { status: 404, error: 'Guest not found' }, service => { addGuest(service); return NO_GUEST; }),

  guestRemove('removing a guest also takes its settings and level out of every scene', { answer: { guests: [kept(1, { url: 'https://other.example/', name: 'other.example', state: { b: 2 } })] } },
    async service => {
      const keep = addGuest(service, 'https://other.example/'), id = addGuest(service);
      service.changeGuest(id, { state: { a: 1 } });
      service.changeGuest(keep, { state: { b: 2 } });
      await service.request('/scenes/create', { method: 'POST', body: '{}' });
      assert.deepEqual(service.getScenes().scenes.map(scene => [Object.keys(scene.guests!).sort(), Object.keys(scene.guestMix!).sort()]), Array(2).fill([[id, keep].sort(), [id, keep].sort()]));
      return { id, keep };
    },
    project => {
      assert.equal(project.scenes.length, 2);
      for (const scene of project.scenes) {
        assert.deepEqual(Object.values(scene.guests), [{ b: 2 }]);
        assert.deepEqual(Object.values(scene.guestMix), [{ volume: .8, muted: false }]);
      }
    }),
  guestRemove('removing the only guest leaves the scenes with no guest settings at all', { answer: { guests: [] } },
    async service => { const id = dressed(service); await service.request('/scenes/create', { method: 'POST', body: '{}' }); return id; },
    project => { for (const scene of project.scenes) assert.deepEqual(Object.keys(scene).sort(), ['drums', 'id', 'lanes', 'mutes', 'name']); }),
  guestRemove('a guest that does not exist cannot be removed', { status: 404, error: 'Guest not found' }, service => { addGuest(service); return NO_GUEST; }),
];

// What is in storage, or null when nothing has been written yet.
const written = () => { const text = storage.get(STORAGE_KEY); return text === undefined ? null : JSON.parse(text); };

for (const entry of cases) {
  test(`${entry.op} | ${entry.title}: the route and the typed helper do the same`, async () => {
    const one = setup();
    const routedCtx = await entry.arrange?.(one);
    one.flush();
    const routed = await call(one, entry.method ?? 'POST', typeof entry.path === 'string' ? entry.path : entry.path(routedCtx), entry.body);
    const routedProject = one.snapshot(), routedStored = written();

    const two = setup();
    const typedCtx = await entry.arrange?.(two);
    two.flush();
    const before = two.snapshot();
    const typed = applied(two, service => entry.run(service, typedCtx));
    const typedProject = two.snapshot(), typedStored = written();

    assert.notEqual(typed.data, undefined, 'an operation always answers with something');
    if (entry.error !== undefined) {
      assert.equal(typed.status, entry.status);
      assert.deepEqual(typed.data, { error: entry.error });
      assert.deepEqual(typed.events, [], 'a refused operation emits nothing');
      assert.equal(typed.saved, false, 'and saves nothing');
      assert.deepEqual(typedProject, before, 'and has changed nothing');
    } else {
      assert.equal(typed.status, 200);
      assert.deepEqual(comparable(typed.data), entry.answer);
      assert.deepEqual(comparable(typed.events), [{ type: entry.event, data: entry.answer }]);
      assert.equal(typed.saved, OP_META[entry.op].save, 'an accepted operation saves when OP_META says so');
    }
    entry.check?.(typedProject);

    assert.equal(typed.status, routed.status);
    assert.deepEqual(comparable(typed.data), comparable(routed.data));
    assert.deepEqual(comparable(typed.events), comparable(routed.events));
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
  for (const method of ['apply', 'applyAll', 'setDrumSwing', 'setDrumMasterVolume', 'addGuest', 'changeGuest', 'removeGuest', 'getScenes', 'getTempo', 'getDrumKits'] as const) {
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

// These stand a reducer in for one that has not moved yet, to try what no real reducer does:
// an outcome that is refused and yet names an event and a save, one that does not save, and one
// with no answer. They are about `apply`, not about the operation named.
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

test('a reducer that answers with nothing is a mistake apply reports, before anything is saved or sent', () => {
  standIn('transport.play', () => ({ ok: true, value: undefined, save: true, event: { type: 'sequencerPlay', data: { synthId: 1 } } }), service => {
    const seen: Message[] = [];
    let notices = 0;
    service.subscribe(message => seen.push(message));
    service.subscribeOps(() => { notices++; });
    seen.length = 0;
    assert.throws(() => service.apply({ type: 'transport.play', synthId: 1 }), /The reducer for transport\.play answered with nothing/);
    assert.deepEqual(seen, []);
    assert.equal(notices, 0);
    assert.equal(service.flush(), true);
    assert.equal(storage.has(STORAGE_KEY), false, 'nothing was scheduled');
  });
});

test('a real refusal: nothing is emitted, saved or announced, and the answer says why', () => {
  const service = setup();
  const before = service.snapshot();
  let notices = 0;
  service.subscribeOps(() => { notices++; });
  const refused = applied(service, target => target.addGuest('http://guest.example/'));
  assert.deepEqual(refused, { status: 400, data: { error: BAD_ADDRESS }, events: [], saved: false });
  assert.deepEqual(service.removeGuest(NO_GUEST), { ok: false, status: 404, error: 'Guest not found' });
  assert.deepEqual(service.changeGuest(NO_GUEST, { muted: true }), { ok: false, status: 404, error: 'Guest not found' });
  assert.equal(notices, 0);
  assert.deepEqual(service.snapshot(), before);
  assert.equal(storage.has(STORAGE_KEY), false);
});

test('applyAll goes on past a refused operation', () => {
  const service = setup();
  const results = service.applyAll([
    { type: 'guest.remove', guestId: NO_GUEST }, { type: 'drum.swing', swing: .2 }, { type: 'guest.add', guestId: NO_GUEST, url: 'nope' }, { type: 'guest.add', guestId: NO_GUEST, url: GUEST_URL },
  ]);
  assert.deepEqual(results.map(result => (result.ok ? 200 : result.status)), [404, 200, 400, 200]);
  assert.equal(service.snapshot().drumSwing, .2);
  assert.deepEqual(service.snapshot().guests.map((guest: any) => guest.id), [NO_GUEST]);
  service.flush();
});

// A route made a new guest's id itself. An operation carries it, so it can be one no guest may
// have, or one already taken; both are refused, after the checks the route made.
test('guest.add refuses an id that is not one, and one that is taken', () => {
  const service = setup();
  const taken = addGuest(service);
  service.flush();
  const before = service.snapshot();
  for (const guestId of ['abc', '', undefined, 7, null, {}]) {
    assert.deepEqual(service.apply({ type: 'guest.add', guestId: wrong(guestId), url: GUEST_URL }), { ok: false, status: 400, error: 'That is not an id a guest instrument can have.' });
  }
  assert.deepEqual(service.apply({ type: 'guest.add', guestId: taken, url: 'https://other.example/' }), { ok: false, status: 409, error: 'That guest instrument is already in the project.' });
  assert.deepEqual(service.apply({ type: 'guest.add', guestId: taken, url: 'nope' }), { ok: false, status: 400, error: BAD_ADDRESS }, 'the address is checked first, as the route checked it');
  assert.deepEqual(service.snapshot(), before);
  while (service.snapshot().guests.length < MAX_GUESTS) addGuest(service, `https://guest${service.snapshot().guests.length}.example/`);
  assert.deepEqual(service.apply({ type: 'guest.add', guestId: 'abc', url: GUEST_URL }), { ok: false, status: 409, error: FULL }, 'and then the room, as the route did');
  service.flush();
});

// A route's body was always an object: anything else was "Invalid local operation data" before
// the route was reached. The typed way answers the same for a change that is not an object.
test('a change to a guest that is not an object is refused as a route\'s body was', async () => {
  const service = setup();
  const id = dressed(service);
  service.flush();
  const before = service.snapshot();
  const loop: Record<string, unknown> = {};
  loop.loop = loop;
  for (const patch of [null, undefined, [], [{ muted: false }], 'muted', 7, Number.NaN, loop, () => ({ muted: false })]) {
    assert.deepEqual(applied(service, target => target.changeGuest(id, wrong(patch))), { status: 400, data: { error: 'Invalid local operation data' }, events: [], saved: false });
  }
  assert.deepEqual(service.changeGuest(NO_GUEST, wrong(null)), { ok: false, status: 400, error: 'Invalid local operation data' }, 'checked before the guest is looked for, as a body was');
  for (const raw of ['null', '[]', '7', '"muted"']) {
    const routed = await call(service, 'PUT', `/guests/${id}`, undefined, raw);
    assert.deepEqual([routed.status, routed.data, routed.events, routed.saved], [400, { error: 'Invalid local operation data' }, [], false]);
  }
  assert.deepEqual(service.snapshot(), before);
});

test('the store keeps nothing of an operation\'s own objects', () => {
  const service = setup();
  const id = addGuest(service);
  const state = { voices: [1, 2], deep: { level: 1 } }, sends = { reverb: .5, delay: 0, drive: 0, phaser: 0 };
  const notices: OpNotice[] = [];
  service.subscribeOps(notice => notices.push(notice));
  const patch = { state, sends };
  const result = service.changeGuest(id, patch);
  assert.ok(result.ok);
  assert.equal((notices[0].op as { patch: unknown }).patch, patch, 'a listener is handed the operation as it was sent');
  state.voices.push(3);
  state.deep.level = 9;
  sends.reverb = 1;
  (result.value.guests[0].state as any).voices.length = 0;
  const guest = service.snapshot().guests[0];
  assert.deepEqual(guest.state, { voices: [1, 2], deep: { level: 1 } });
  assert.equal(guest.sends.reverb, .5);
  service.flush();
});

test('before the service is initialized the typed way throws, with the message request() rejects with', () => {
  const message = /Local project has not been initialized/;
  assert.throws(() => new LocalProjectService().apply({ type: 'drum.swing', swing: .1 }), message);
  assert.throws(() => new LocalProjectService().applyAll([{ type: 'drum.swing', swing: .1 }]), message);
  assert.throws(() => new LocalProjectService().setDrumSwing(.1), message);
  assert.throws(() => new LocalProjectService().setDrumMasterVolume(.1), message);
  assert.throws(() => new LocalProjectService().addGuest(GUEST_URL), message);
  assert.throws(() => new LocalProjectService().changeGuest(NO_GUEST, {}), message);
  assert.throws(() => new LocalProjectService().removeGuest(NO_GUEST), message);
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
