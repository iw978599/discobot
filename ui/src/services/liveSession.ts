import { accountsEnabled, currentUser, openLiveSocket, subscribeAccount } from './account';
import { localService } from './localService';
import { OP_META, type Applied, type Operation, type OpNotice, type OpType, type Origin } from './projectOps';
import { WHOLE_SOUND } from './projectReducers';
import { projectSync } from './projectSync';

// A live session: the people a project is shared with, editing it at once (docs/LIVE_SESSIONS_PLAN.md).
// The room (server/src/live.ts) keeps nothing and sends every edit to everyone, the sender too, in
// one order. This browser applies its own edits at once and sends them; on someone else's edit it
// applies theirs, then applies again any of its own still on their way whose parts overlap, since
// the room ordered those after it. So every browser ends with the edits in the room's order.
//
// What is sent:
//   op       { n, edits: [{ op, scene }] }  edits made here, a run of them to one part sent as one
//   replace  { n, project }                 the whole project, after undo or redo or Reset All
//   state    { to, project }                the whole project, for someone joining
// Opening a scene is not sent: each person opens their own, and every edit says the scene it was
// made in. A guest's own settings (`state` of guest.patch) come from the guest in each browser, so
// they are not sent either.

export interface LiveMember { id: string; user: string; colour: number; since: number }

// What a session needs of the project store. `localService` is one; the tests hand it others.
export interface LiveStore {
  apply(op: Operation, origin: Origin): Applied<unknown>;
  subscribeOps(listener: (notice: OpNotice) => void): () => void;
  subscribe(listener: (message: { type: string; data: unknown }) => void): () => void;
  openSceneId(): string;
  hasScene(id: string): boolean;
  exportProject(): unknown;
  receiveLive(file: unknown): Promise<boolean>;
}

export interface LiveSocket { send(text: string): void; close(): void }

export interface LiveDeps {
  store: LiveStore;
  // Opens the connection. It calls `received` with each message and `closed` once, at the end.
  connect(events: { received(text: string): void; closed(): void }): LiveSocket;
  // Runs `run` after `ms`; the answer cancels it.
  later(run: () => void, ms: number): () => void;
  // Whether this browser is the one saving the project to the account: the person longest in the
  // session. Told when that changes while the session lasts; what happens after it is the caller's.
  saving?(on: boolean): void;
  changed?(): void;
  // The studio's transport: started at a moment someone else chose, stopped, and where it is now.
  transport?: LiveTransportHandlers;
  // Milliseconds on this computer's clock.
  wall?(): number;
}

export type LiveState = 'connecting' | 'joining' | 'live' | 'closed';
export interface LiveStatus { state: LiveState; me: LiveMember | null; others: LiveMember[]; playing: LivePlay | null }

// Where the music is: tick `tick` of the transport (counted from its start, count-in included) is
// heard at `wall` on this computer's clock. The play mode, the song entry it started from and the
// count-in's ticks come with it, so every browser plays the same thing from the same place.
export interface LiveAnchor { wall: number; tick: number; mode: string; entry: number; countIn: number }
export interface LivePlay extends LiveAnchor { by: string }
export interface LiveTransportHandlers { start(play: LivePlay): void; stop(): void; now(): LiveAnchor | null }

// A knob's drag is a few messages a second, not one for every value.
export const BATCH_MS = 40;
// How long someone joining waits for the project before going on with their own copy.
export const JOIN_WAIT_MS = 10_000;
// The room's own limit (MAX_MESSAGE in server/src/live.ts).
const MAX_MESSAGE = 600_000;
// Each person's clock is measured against the others' by this many round trips through the room.
export const CLOCK_PINGS = 3;
const CLOCK_GAP_MS = 250;
// How long a play from someone whose clock is not measured yet waits for the first measurement.
export const CLOCK_WAIT_MS = 1_000;
// How long pressing Play to listen along waits for someone to say where the music is.
export const LISTEN_WAIT_MS = 1_500;
// How far ahead music started here is placed while someone else is in the session, so the start
// reaches them in time (the room is a round trip away).
export const LIVE_LEAD_SECONDS = 0.3;

interface Edit { op: Operation; scene: string }
// Something of this browser's applied here and not yet back from the room: an edit, or a whole
// project. `n` is the message it went in; an entry without one has not been sent.
interface Own { n?: number; edit?: Edit; keys?: string[]; project?: unknown }

// Edits that change the open scene, and so are applied in the scene they were made in.
const SCENE_BOUND = new Set<OpType>([
  'drum.state', 'drum.reset', 'drum.bars', 'drum.copyBar', 'drum.step', 'drum.stepVelocity', 'drum.stepDetail', 'drum.mix',
  'synth.create', 'synth.mix', 'pattern.write', 'scene.signature', 'scene.copyPart', 'scene.create',
]);

function patchKeys(prefix: string, patch: unknown): string[] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return [prefix];
  const keys = Object.entries(patch).filter(([, value]) => value !== undefined).flatMap(([key, value]) => patchKeys(`${prefix}/${key}`, value));
  return keys.length ? keys : [prefix];
}

// The parts of the project an edit changes, as paths. Coarser than needed is safe (an edit of this
// browser's is applied again for nothing); finer than what the edit really changes is not.
export function editKeys(op: Operation, scene: string): string[] {
  const here = `scenes/${scene}`;
  switch (op.type) {
    case 'tempo.set': return ['tempo'];
    case 'drum.swing': return ['drums/swing'];
    case 'drum.masterVolume': return ['drums/master'];
    case 'drum.kit': return ['drums/kit', 'drums/settings'];
    case 'drum.state': case 'drum.reset': return ['drums', `${here}/drums`];
    case 'drum.bars': case 'drum.copyBar': return [`${here}/drums`];
    case 'drum.step': case 'drum.stepVelocity': case 'drum.stepDetail': return [`${here}/drums/${op.instrument}/${op.step}`];
    case 'drum.mix': return [`${here}/drums/${op.instrument}/mix`];
    case 'drum.settings': return [`drums/settings/${op.instrument}`];
    case 'drum.sample': return [`drums/sample/${op.instrument}`];
    case 'drum.fx': return patchKeys('drumfx', op.patch);
    case 'effects.set': return patchKeys('effects', op.patch);
    case 'synth.create': case 'synth.remove': return [`synth/${op.synthId}`, 'scenes'];
    case 'synth.params': {
      const whole = WHOLE_SOUND.every(key => key in op.patch) && !('inserts' in op.patch);
      return whole ? [`synth/${op.synthId}/sound`] : patchKeys(`synth/${op.synthId}/sound`, op.patch);
    }
    case 'synth.model': return [`synth/${op.synthId}/sound`, `synth/${op.synthId}/model`, `synth/${op.synthId}/preset`];
    case 'synth.mix': return [`${here}/synth/${op.synthId}/mix`];
    case 'synth.swing': return [`synth/${op.synthId}/swing`];
    case 'synth.name': return [`synth/${op.synthId}/name`];
    case 'synth.preset': return [`synth/${op.synthId}/preset`];
    case 'pattern.write': return patchKeys(`${here}/synth/${op.synthId}/pattern`, Object.fromEntries(Object.keys(op.patch ?? {}).map(key => [key, true])));
    case 'scene.create': case 'scene.delete': return ['scenes', 'song'];
    case 'scene.rename': return [`scenes/${op.sceneId}/name`];
    case 'scene.color': return [`scenes/${op.sceneId}/color`];
    case 'scene.signature': return [here];
    case 'scene.copyPart': return [`scenes/${op.toSceneId}`];
    case 'scene.replace': return [''];
    case 'song.set': return ['song'];
    case 'guest.add': case 'guest.remove': return [`guests/${op.guestId}`];
    case 'guest.patch': return patchKeys(`guests/${op.guestId}`, Object.fromEntries(Object.keys(op.patch ?? {}).map(key => [key, true])));
    case 'synth.prefs': case 'transport.play': case 'transport.stop': case 'scene.select': return [];
  }
}

// Two paths overlap when one is the other or contains it. The empty path is the whole project.
const covers = (a: string, b: string) => a === '' || b === '' || a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
export const overlap = (a: string[], b: string[]) => a.some(x => b.some(y => covers(x, y)));

const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((key, at) => key === b[at]);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// Edits from someone else are untrusted: an edit is only ever an operation that is shared, and the
// store checks everything in it as it checks anything else.
function readEdits(value: unknown): Edit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!isRecord(entry) || !isRecord(entry.op) || typeof entry.scene !== 'string') return [];
    const type = entry.op.type as OpType;
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(OP_META, type) || !OP_META[type].share) return [];
    return [{ op: entry.op as Operation, scene: entry.scene }];
  });
}

export function createLiveSession(deps: LiveDeps) {
  const { store } = deps;
  let state: LiveState = 'connecting';
  let me: LiveMember | null = null;
  let others: LiveMember[] = [];
  // The music as this browser last heard of it, on this computer's clock, and who started it.
  let playing: LivePlay | null = null;
  // How far each other person's clock is ahead of this one, from the quickest round trip so far.
  const clocks = new Map<string, { ahead: number; trip: number }>();
  // Plays from people whose clocks are not measured yet, until they are.
  const unclocked = new Map<string, Record<string, unknown>>();
  let listening = false;
  const wall = deps.wall ?? (() => Date.now());
  let openScene = store.openSceneId();
  let pending: Own[] = [];
  let queue: Own[] = [];
  let wholeWanted = false;
  let sent = 0;
  let saving: boolean | null = null;
  let buffered: Record<string, unknown>[] = [];
  let cancelFlush: (() => void) | null = null;
  let cancelWait: (() => void) | null = null;
  let chain = Promise.resolve();

  const changed = () => deps.changed?.();
  const setSaving = (on: boolean) => { if (saving !== on) { saving = on; deps.saving?.(on); } };
  const host = () => [...(me ? [me] : []), ...others].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id))[0];
  const hostingChanged = () => { if (me) setSaving(host()?.id === me.id); };

  // Applies an edit in the scene it was made in, and leaves this browser in the scene it was in.
  function applyIn(edit: Edit) {
    if (!SCENE_BOUND.has(edit.op.type)) { store.apply(edit.op, 'remote'); return; }
    const back = store.openSceneId();
    if (back !== edit.scene) {
      if (!store.hasScene(edit.scene)) return;
      store.apply({ type: 'scene.select', sceneId: edit.scene }, 'remote');
    }
    store.apply(edit.op, 'remote');
    if (store.openSceneId() !== back && store.hasScene(back)) store.apply({ type: 'scene.select', sceneId: back }, 'remote');
  }

  // This browser's edits still on their way were ordered after `theirs`, so where they overlap they
  // are applied again on top. A whole project of this browser's wipes out everything after it,
  // which is applied again too.
  async function reapply(theirs: string[]) {
    const own = [...pending, ...queue];
    let wiped = false;
    for (const entry of own) {
      if (entry.project !== undefined) { await store.receiveLive(entry.project); wiped = true; }
      else if (entry.edit && (wiped || overlap(entry.keys!, theirs))) applyIn(entry.edit);
    }
    // Edits made here while a whole project was being put in place were made on the one before it.
    if (wiped) for (const entry of [...pending, ...queue]) if (!own.includes(entry) && entry.edit) applyIn(entry.edit);
  }

  function send(message: unknown): boolean {
    const text = JSON.stringify(message);
    if (text.length > MAX_MESSAGE) return false;
    socket.send(text);
    return true;
  }

  function flush() {
    cancelFlush = null;
    if (state !== 'live') return;
    if (wholeWanted) {
      wholeWanted = false;
      // The project as it is now holds every edit waiting to go.
      queue = [];
      const project = store.exportProject();
      const n = ++sent;
      // Too large to send: the others would be left with a different project, so the session ends.
      if (!send({ t: 'replace', n, project })) { close(); return; }
      pending.push({ n, project });
      return;
    }
    if (!queue.length) return;
    const n = ++sent;
    if (!send({ t: 'op', n, edits: queue.map(entry => entry.edit) })) { wholeWanted = true; flush(); return; }
    for (const entry of queue) entry.n = n;
    pending.push(...queue);
    queue = [];
  }

  function schedule(now = false) {
    if (now) { cancelFlush?.(); cancelFlush = null; flush(); return; }
    if (!cancelFlush) cancelFlush = deps.later(flush, BATCH_MS);
  }

  const stopOps = store.subscribeOps(notice => {
    const madeIn = openScene;
    openScene = store.openSceneId();
    if (notice.origin !== 'local' || state === 'closed' || !OP_META[notice.op.type].share) return;
    // Reset All makes a scene of its own inside the store, so the result goes, not the edit.
    if (notice.op.type === 'scene.replace') { wholeWanted = true; schedule(); return; }
    let op = notice.op;
    if (op.type === 'guest.patch') {
      const { state: _state, ...patch } = op.patch;
      if (!Object.keys(patch).length) return;
      op = { ...op, patch };
    }
    const edit: Edit = { op: copy(op), scene: madeIn };
    const keys = editKeys(edit.op, madeIn);
    const last = queue[queue.length - 1];
    if (last?.edit && last.edit.op.type === op.type && last.edit.scene === madeIn && sameKeys(last.keys!, keys)) last.edit = edit;
    else queue.push({ edit, keys });
    schedule();
  });

  const stopEvents = store.subscribe(message => {
    if (message.type === 'init' || message.type === 'restored') openScene = store.openSceneId();
    // Undo and redo put back a whole project here, so the whole project goes to everyone.
    if (message.type === 'restored' && state !== 'closed') { wholeWanted = true; schedule(true); }
  });

  function timeClocks() {
    for (let ping = 0; ping < CLOCK_PINGS; ping++) {
      deps.later(() => { if (state !== 'closed') send({ t: 'transport', kind: 'clock', sent: wall() }); }, ping * CLOCK_GAP_MS);
    }
  }

  function readAnchor(value: Record<string, unknown>): LiveAnchor | null {
    const { wall: at, tick, mode, entry, countIn } = value;
    if (![at, tick, entry, countIn].every(number => typeof number === 'number' && Number.isFinite(number)) || typeof mode !== 'string') return null;
    return { wall: at as number, tick: Math.max(0, tick as number), mode, entry: Math.max(0, Math.floor(entry as number)), countIn: Math.max(0, Math.floor(countIn as number)) };
  }

  // A message about the transport from someone else: their clock, their music, or a question.
  function hear(message: Record<string, unknown>) {
    const from = others.find(member => member.id === message.from);
    if (!from || (typeof message.to === 'string' && message.to !== me?.id)) return;
    switch (message.kind) {
      case 'clock':
        if (typeof message.sent === 'number') send({ t: 'transport', kind: 'clock-back', to: from.id, sent: message.sent, at: wall() });
        return;
      case 'clock-back': {
        if (typeof message.sent !== 'number' || typeof message.at !== 'number') return;
        const now = wall(), trip = now - message.sent;
        const known = clocks.get(from.id);
        if (trip >= 0 && (!known || trip < known.trip)) clocks.set(from.id, { ahead: message.at - (message.sent + now) / 2, trip });
        const held = unclocked.get(from.id);
        unclocked.delete(from.id);
        if (held) hear(held);
        return;
      }
      case 'play': {
        const anchor = readAnchor(message);
        if (!anchor) return;
        if (!clocks.has(from.id)) {
          if (!unclocked.has(from.id)) deps.later(() => { const held = unclocked.get(from.id); unclocked.delete(from.id); if (held) { clocks.set(from.id, { ahead: 0, trip: Infinity }); hear(held); } }, CLOCK_WAIT_MS);
          unclocked.set(from.id, message);
          return;
        }
        const play: LivePlay = { ...anchor, wall: anchor.wall - clocks.get(from.id)!.ahead, by: from.user };
        const here = deps.transport?.now() ?? null;
        // An answer to a question this browser no longer needs: it is playing already.
        if (message.to && here && !listening) return;
        // Two people pressed Play at once: the earlier start is kept everywhere.
        if (!message.to && here && playing && (playing.wall < play.wall || (playing.wall === play.wall && playing.by <= play.by))) return;
        listening = false;
        playing = play;
        changed();
        deps.transport?.start(play);
        return;
      }
      case 'stop':
        playing = null;
        listening = false;
        changed();
        deps.transport?.stop();
        return;
      case 'where': {
        const here = deps.transport?.now();
        if (here) send({ t: 'transport', kind: 'play', to: from.id, ...here });
        return;
      }
    }
  }

  async function take(message: Record<string, unknown>) {
    if (message.t === 'transport') { hear(message); return; }
    if (me && message.from === me.id) {
      pending = pending.filter(entry => entry.n !== message.n);
      return;
    }
    if (message.t === 'replace') {
      if (!await store.receiveLive(message.project)) return;
      await reapply(['']);
      return;
    }
    const edits = readEdits(message.edits);
    for (const edit of edits) applyIn(edit);
    await reapply(edits.flatMap(edit => editKeys(edit.op, edit.scene)));
  }

  async function goLive() {
    cancelWait?.();
    cancelWait = null;
    state = 'live';
    changed();
    const waiting = buffered;
    buffered = [];
    if (others.length) timeClocks();
    for (const message of waiting) await take(message);
    schedule(true);
  }

  async function handle(text: string) {
    if (state === 'closed') return;
    let message: unknown;
    try { message = JSON.parse(text); } catch { return; }
    if (!isRecord(message)) return;
    switch (message.t) {
      case 'welcome': {
        if (!isRecord(message.you)) return;
        me = message.you as unknown as LiveMember;
        others = Array.isArray(message.members) ? message.members as LiveMember[] : [];
        hostingChanged();
        if (!others.length) { await goLive(); return; }
        // Someone is here already: their project is the session's, and is on its way.
        state = 'joining';
        changed();
        cancelWait = deps.later(() => { chain = chain.then(() => (state === 'joining' ? goLive() : undefined)); }, JOIN_WAIT_MS);
        return;
      }
      case 'join':
        if (isRecord(message.member)) others = [...others, message.member as unknown as LiveMember];
        hostingChanged();
        changed();
        if (state === 'live') timeClocks();
        return;
      case 'leave': {
        const gone = others.find(member => member.id === message.id);
        others = others.filter(member => member.id !== message.id);
        clocks.delete(String(message.id));
        unclocked.delete(String(message.id));
        // The music they started is not playing anywhere this browser knows of.
        if (gone && playing?.by === gone.user && !deps.transport?.now()) playing = null;
        hostingChanged();
        changed();
        return;
      }
      case 'send-state': {
        if (state !== 'live') return;
        send({ t: 'state', to: message.to, project: store.exportProject() });
        // Someone joining while the music plays is told where it is.
        const here = deps.transport?.now();
        if (here) send({ t: 'transport', kind: 'play', to: message.to, ...here });
        return;
      }
      case 'transport':
        // A clock is measured at once; the rest waits, while joining, for the project to arrive.
        if (state === 'joining' && message.kind !== 'clock' && message.kind !== 'clock-back') { buffered.push(message); return; }
        if (state === 'live' || state === 'joining') hear(message);
        return;
      case 'state': {
        if (state !== 'joining' || message.to !== me?.id) return;
        // The edits made here meanwhile were made on this browser's copy, and go on top of the one sent.
        if (await store.receiveLive(message.project)) await reapply(['']);
        await goLive();
        return;
      }
      case 'op': case 'replace':
        if (state === 'joining') { buffered.push(message); return; }
        if (state === 'live') await take(message);
        return;
    }
  }

  function ended() {
    if (state === 'closed') return;
    state = 'closed';
    cancelFlush?.();
    cancelWait?.();
    stopOps();
    stopEvents();
    changed();
  }

  const socket = deps.connect({
    received: text => { chain = chain.then(() => handle(text)).catch(() => {}); },
    closed: ended,
  });

  function close() {
    if (state === 'closed') return;
    ended();
    try { socket.close(); } catch { /* already gone */ }
  }

  return {
    close,
    status: (): LiveStatus => ({ state, me, others, playing }),
    // This browser started the music: everyone else starts it at the same moment.
    sendPlay(anchor: LiveAnchor) {
      if (state !== 'live' || !me) return;
      playing = { ...anchor, by: me.user };
      listening = false;
      changed();
      send({ t: 'transport', kind: 'play', ...anchor });
    },
    sendStop() {
      if (state !== 'live') return;
      playing = null;
      listening = false;
      changed();
      send({ t: 'transport', kind: 'stop' });
    },
    // Someone else is playing: asks where the music is, to start there. If nobody answers, it
    // starts from what this browser last heard. Answers whether it asked.
    listen(): boolean {
      if (state !== 'live' || !playing || !others.length) return false;
      listening = true;
      send({ t: 'transport', kind: 'where' });
      deps.later(() => {
        if (!listening || !playing) return;
        listening = false;
        deps.transport?.start(playing);
      }, LISTEN_WAIT_MS);
      return true;
    },
    // Resolves when every message received so far has been dealt with. For the tests.
    settled: () => chain,
  };
}

export type LiveSession = ReturnType<typeof createLiveSession>;

// ---------------------------------------------------------------- this page's session
// One at a time: for the open project, while it is shared and its person is signed in. Signed out,
// or with a project that is not shared, nothing connects.

const RETRY_FIRST_MS = 5_000;
const RETRY_MOST_MS = 300_000;

let running: { key: string; id: string; session: LiveSession } | null = null;
// Whether the open session's project is held from sync because someone else is saving it.
let holding = false;
let retryAfter = RETRY_FIRST_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryKey = '';
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

export const liveStatus = (): LiveStatus => running?.session.status() ?? { state: 'closed', me: null, others: [], playing: null };
export const subscribeLive = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

// Between the studio's Play button and this page's session. Only the button (and Space) tells the
// session anything: an export playing the song through, or a song ending, is this browser's own.
let studioTransport: LiveTransportHandlers | null = null;
const withOthers = () => { const status = running?.session.status(); return !!status && status.state === 'live' && status.others.length > 0; };
export const liveTransport = {
  connect(handlers: LiveTransportHandlers) {
    studioTransport = handlers;
    return () => { if (studioTransport === handlers) studioTransport = null; };
  },
  // Someone else is in the session, so music started here is placed far enough ahead for them.
  shared: withOthers,
  // Someone else's music is playing in the session.
  playingElsewhere: () => withOthers() && !!running?.session.status().playing,
  play: (anchor: LiveAnchor) => running?.session.sendPlay(anchor),
  stop: () => running?.session.sendStop(),
  listen: () => running?.session.listen() ?? false,
};

function wanted(): { owner: string; id: string } | null {
  const user = currentUser();
  if (!user) return null;
  let id: string;
  try { id = localService.openProjectId(); } catch { return null; }
  const { shared, sharedByMe } = projectSync.status();
  if (shared[id]) return { owner: shared[id].owner, id };
  if (sharedByMe[id]) return { owner: user.username, id };
  return null;
}

// Leaving on purpose (another project opened, signed out, no longer shared). Anyone still in the
// session has everything this browser had, and the account's copy will be theirs.
function stop() {
  if (!running) return;
  const { session, id } = running;
  running = null;
  const others = session.status().others.length > 0;
  session.close();
  projectSync.hold(id, false, others ? 'yield' : undefined);
  holding = false;
  changed();
}

function check() {
  const target = wanted();
  const key = target ? `${target.owner}/${target.id}` : '';
  if ((running?.key ?? '') === key) return;
  // Waiting to try this one again: the wait stands, whatever else has changed.
  if (retryTimer && retryKey === key) return;
  stop();
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (!target) { retryAfter = RETRY_FIRST_MS; return; }
  let welcomed = false;
  const session = createLiveSession({
    store: localService,
    connect: events => {
      const socket = openLiveSocket(target.owner, target.id);
      if (!socket) { queueMicrotask(events.closed); return { send: () => {}, close: () => {} }; }
      socket.onmessage = event => { if (typeof event.data === 'string') events.received(event.data); };
      socket.onclose = () => events.closed();
      return { send: text => { if (socket.readyState === 1) socket.send(text); }, close: () => socket.close() };
    },
    later: (run, ms) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer); },
    wall: () => performance.timeOrigin + performance.now(),
    transport: {
      start: play => studioTransport?.start(play),
      stop: () => studioTransport?.stop(),
      now: () => studioTransport?.now() ?? null,
    },
    saving: on => {
      if (!on) { projectSync.hold(target.id, true); holding = true; return; }
      // Taking over from someone who left: this copy holds what they saved, and goes on top of it.
      projectSync.hold(target.id, false, holding ? 'adopt' : undefined);
      holding = false;
      void projectSync.sync();
    },
    changed: () => {
      const status = session.status();
      if (status.state === 'live' && !welcomed) { welcomed = true; retryAfter = RETRY_FIRST_MS; }
      if (status.state === 'closed' && running?.session === session) {
        // Lost or refused (a server without live sessions answers 503): try again later, less
        // often each time, while the project is still shared and open.
        // This browser may have missed edits, so the usual rule applies: both copies are kept.
        running = null;
        projectSync.hold(target.id, false);
        holding = false;
        retryKey = key;
        retryTimer = setTimeout(() => { retryTimer = null; check(); }, retryAfter);
        retryAfter = Math.min(retryAfter * 2, RETRY_MOST_MS);
      }
      changed();
    },
  });
  running = { key, id: target.id, session };
  changed();
}

let watching = false;

// Starts live sessions for this page. Signed out it does nothing and contacts nobody.
export function startLiveSessions() {
  if (watching || !accountsEnabled || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  watching = true;
  projectSync.subscribe(check);
  subscribeAccount(check);
  localService.subscribe(message => { if (message.type === 'init' || message.type === 'projectsChanged') check(); });
  window.addEventListener('online', check);
  check();
}
