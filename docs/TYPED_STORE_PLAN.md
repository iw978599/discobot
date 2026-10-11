# Typed project store: the plan

Written 2026-10-11 from a design pass over `localService.ts`, `useStudio.tsx` and
`storeRoutes.test.ts`. This is roadmap improvement 1. It is done as a sequence of
pull requests, each leaving `main` working and `storeRoutes.test.ts` green.

Status: pull request 1 of 8 is built (the foundation, drum swing and drum master
volume). The rest is open.

## What was built, and where it differs from this plan

The plan was written from reading the code. Building the first pull request ran
it, and these are the places the two disagreed. The sections below have been
corrected to match; this list is so a later builder knows what changed and why.

- **`apply` answers with a copy.** The sketch handed back the reducer's value as
  it was. Most routes answer with live state (`{ guests: state.guests }`, the
  lane itself), and a route's answer was always a copy because it was
  serialized. `apply` therefore copies the value, as `emit` copies an event for
  each listener. A caller no longer goes through the route's serializing, so the
  cost per edit is about what it was.
- **`apply` throws for an operation with no reducer yet**, with a message that
  says so, instead of failing on a missing function. That branch goes when the
  reducer map is total.
- **`scene.select` and `scene.delete` are two members of the union.** As one
  member with two types, neither could be picked out by its type, which is how
  a reducer's argument is typed.
- **`scene.replace` takes optional fields.** `useStudio` sends it an empty body
  to go back to one scene.
- **`synth.params` takes a deep partial**, since the route merges deeply.
- **There is no `DrumFxState` in the engine's types.** It is declared in
  `projectOps.ts`.
- **`clone` moved with `merge`** to `projectSanitization.ts`, because `merge`
  uses it. `localService.ts` imports both.
- **`fromApplied` is declared inside `request`**, beside `respond`, which it
  needs. It goes when `request` does.
- **Where the new methods sit matters.** `storeRoutes.test.ts` reads the source
  from the `async request(` line to the end of the class, so anything added
  after `request` is read as part of the router. `apply` and the rest are
  placed before it.
- **Reducers end with `update(type, data)`**, a small function in
  `projectReducers.ts` that is what `update` was in the router: save, send the
  event, answer with the same data. A moved body keeps its last line. A reducer
  whose answer differs from its event, or that does not save, writes the
  outcome out in full.
- **Undo already sent swing and master volume**, so `applySnapshot` now calls
  the two typed helpers, and no longer sets those two values itself.
- **The numbers in the first section were off.** `useStudio.tsx` made 68 calls
  to `localRequest`, not about 80 (62 after pull request 1), and thirteen test
  files besides `storeRoutes.test.ts` call `request`, not eleven.
- **No pinned count in `storeRoutes.test.ts` changed.** The five routes that
  moved kept their `path === '...'` lines and `/tempo` kept its method check.
- **A refusal cannot be tested through a real operation yet**: neither moved
  operation can be refused. `storeOps.test.ts` stands a reducer in for one that
  has not moved, to test what `apply` does with a refusal and with an operation
  that does not save. Pull request 2 (guests) brings real refusals; keep the
  stand-in tests, pointed at an operation that still has no reducer, until the
  last pull request.
- **The kit menu's "loading" and "unable to load" states can no longer
  happen**, now that the kit list is read directly. `drumKitsLoading` and
  `drumKitsError` are left in `useStudio` and `DrumModule` for the drums pull
  request to remove.

## What is being replaced

Edits inside a project go through `localService.request(path, options)`, a leftover
from a server version: one synchronous chain of `if`s routes 35 paths (43 with
their methods) by string, parses a JSON body, changes state, usually calls
`update()` (a debounced save, then an event), and answers with a `Response`.
`useStudio.tsx` made 68 such calls, most after changing its own React state
first, then heard the event and applied the change a second time.

## Decisions

**An edit is an operation.** A discriminated union on a dotted `type`, one for each
write route, 33 in all. Reads are read methods and are not operations. The types
live in `ui/src/services/projectOps.ts`, not the engine: the reducers need
`projectSanitization.ts`, `guests.ts` and `drumKits.ts`. `pattern.write` stays a
whole pattern for now; a finer `pattern.step` can be added later.

Applying the same operation to the same state must give the same result on two
machines, because undo, automation and live editing will record, replay and send
operations:

1. An operation carries every id it creates (`scene.create` takes `sceneId`,
   `guest.add` takes `guestId`, `pattern.write` always takes a `patternId`). The
   typed helper makes the id; so does the old route, so its behaviour is unchanged.
2. `merge` is in `projectSanitization.ts` (skips `__proto__`, `constructor`,
   `prototype`; replaces arrays; recurses into objects). A patch is a deep
   partial; the reducer merges, then sanitizes. Nothing is sanitized by the
   sender.
3. Reducers are pure and never read the clock. `write()` stamps `revision` and
   `updatedAt`, outside them.
4. Whatever later wraps an operation to send it carries `SCHEMA`, and a receiver
   refuses a mismatch. Operations themselves carry no author or id.
5. `guest.add` checks the address against this machine's origin. Note it when live
   editing is built.

**One way in.** `apply(op)` is the only thing that changes the project. Typed
helpers are one-line wrappers over it, and during the migration `request` is
another. `apply` is synchronous and must never be `async`: the scheduler relies on
a scene being selected before its next line. It returns a result and does not throw
for what are 400, 404 and 409 today:

```ts
export type Rejected = { ok: false; status: 400 | 404 | 409; error: string };
export type Applied<V> = { ok: true; value: V } | Rejected;
```

`value` is exactly what the route answered, and a copy as that was, so the route
is `fromApplied(this.apply(...))`. Callers that read `.ok` and `.json().error`
read `result.ok` and `result.error`. It still throws "Local project has not been
initialized" before init, and still throws a TypeError for an instrument named
after a built-in property (`constructor`, `toString`, `__proto__`): both are pinned,
and the second is fixed on purpose at the end. Until the last pull request it also
throws for an operation whose route has not moved yet.

**The 18 named events stay** as the vocabulary of change for React, which wants
sanitized slices. `subscribeOps(listener)` is added for consumers that want the
operation itself (undo, automation, live editing). No event types are added. Inside
`apply` the order is: change state, `persist()`, emit the event, then tell the
operation listeners; this is what `update()` does today. Emitting stays
synchronous, and `apply` returns only after delivery. The deep clone of the payload
for each listener stays: the store changes its state in place and React would
otherwise hold the same objects. An operation listener is handed the operation
as the caller sent it (not clamped, and not a copy), where it came from, and
whether it saved. Nothing is told of a refused operation.

**Applying once.** `useStudio` drops its own early `setState` and relies on the
event, which arrives before `apply` returns and carries the sanitized value. React
batches the `setState` calls made in the handler into the render the early one
would have caused. `synthsRef` and `drumStateRef` are assigned at render, so they
are stale until then whichever way it is done: a handler that needs the ref on the
next line writes it itself, as the `sceneChanged`, `synthRemoved` and
`sequencerStop` handlers do. Use one helper,
`commitLanes(next) { synthsRef.current = next; setSynths(next); }`, in the
`patternUpdated` and `patternCreated` handlers, which makes the hand-written ref
lines in the piano-roll painting code redundant. Check every moved group for a ref
read after `apply`.

**Quirks.** Kept for good: synchronous emit; events delivered before return; a
save that is scheduled, not immediate; `commitScene()` before a scene is read;
`preferences` saving without an event; play and stop sending an event without
saving. Kept until the last pull request and then changed on purpose, each in a
pull request of its own: saving when nothing changed (it moves `revision` and
version-keeping, so the owner should know); a GET with a body writing; the
built-in-property throw; the rollback in the effects handlers that can never run;
a one-step drum edit echoing the whole drum state. Dead code removed in the first
pull request: the `drumStep`, `drumStepVelocity`, `drumSettings`, `drumMix` and
`drumReset` cases in `useStudio`'s message switch, which nothing emits.

**What is not project state.** `isPlaying` is in the store but is not saved, shared
or undone. Octave and keyboard mode are saved but not shared or undone. An
`OP_META: Record<OpType, { save; undoable; share }>` table says so for each
operation. `save` is checked by the two-way tests. `undoable` is a first reading:
it is true for what pushes an undo entry today, so a lane's mute and a drum's
sample are false, though a drum's mute is true. `share` is true for everything
but playing and a lane's octave and keyboard, including which scene is open,
because every other edit is made to the open scene. The pull request that moves a
group confirms its rows, and roadmap improvement 2 and live editing settle the two
columns. Selection, the step-record pointer, song position, play mode and the
playhead stay in React or the playhead store.

## Types

```ts
export type Origin = 'local' | 'remote' | 'history';
export type DrumFxState = { sends: FxSendLevels; returnLevel: number };

export type Operation =
  | { type: 'tempo.set'; tempo: number }
  | { type: 'drum.swing'; swing: number }
  | { type: 'drum.masterVolume'; volume: number }
  | { type: 'drum.kit'; kitId: string; applyDefaults?: boolean }
  | { type: 'drum.state'; state: unknown }
  | { type: 'drum.reset' }
  | { type: 'drum.bars'; bars: number }
  | { type: 'drum.step'; instrument: DrumInstrument; step: number; active: boolean }
  | { type: 'drum.stepVelocity'; instrument: DrumInstrument; step: number; velocity: number }
  | { type: 'drum.stepDetail'; instrument: DrumInstrument; step: number; probability?: number; ratchet?: number }
  | { type: 'drum.settings'; instrument: DrumInstrument; settings: Partial<DrumSettings> }
  | { type: 'drum.sample'; instrument: DrumInstrument; sampleId?: string }
  | { type: 'drum.mix'; instrument: DrumInstrument; muted?: boolean; solo?: boolean }
  | { type: 'drum.fx'; patch: DeepPartial<DrumFxState> }
  | { type: 'effects.set'; patch: DeepPartial<EffectsLoopState> }
  | { type: 'synth.create'; synthId?: number }
  | { type: 'synth.remove'; synthId: number }
  | { type: 'synth.params'; synthId: number; patch: DeepPartial<SynthParameters> }
  | { type: 'synth.model'; synthId: number; modelId?: SynthModelId; modelParams?: Partial<SynthModelParams> }
  | { type: 'synth.mix'; synthId: number; muted?: boolean; solo?: boolean }
  | { type: 'synth.prefs'; synthId: number; octaveShift?: number; keyboardMode?: 'keyboard' | 'piano-roll' }
  | { type: 'pattern.write'; synthId: number; patternId: string; patch: Partial<Pattern> }
  | { type: 'transport.play'; synthId: number; patternId?: string }
  | { type: 'transport.stop'; synthId: number }
  | { type: 'scene.select'; sceneId: string }
  | { type: 'scene.delete'; sceneId: string }
  | { type: 'scene.create'; sceneId: string; name?: string; empty?: boolean }
  | { type: 'scene.rename'; sceneId: string; name: string }
  | { type: 'scene.replace'; scenes?: unknown; currentSceneId?: string; song?: unknown }
  | { type: 'song.set'; entries?: unknown; loop?: boolean }
  | { type: 'guest.add'; guestId: string; url: string; name?: string }
  | { type: 'guest.patch'; guestId: string; patch: Record<string, unknown> }
  | { type: 'guest.remove'; guestId: string };

export type OpType = Operation['type'];
export interface OpNotice { op: Operation; origin: Origin; saved: boolean }
// What a reducer hands back: the answer, whether to save, and the event to send.
export type Outcome<V> = Applied<V> & { save?: boolean; event?: { type: string; data: unknown } };
// OpResult<T> maps each operation type to what its route answered.
```

`OpResult` is written out for all 33 in `projectOps.ts`, from the routes as they
are. If a route's answer turns out to differ when its group is moved, the route
and its pinned test win: correct the type.

On the store, added and nothing removed until the end:

```ts
apply<T extends Operation>(op: T, origin?: Origin): Applied<OpResult<T['type']>>;
applyAll(ops: Operation[], origin?: Origin): Applied<unknown>[];  // synchronous; for undo replay
subscribeOps(listener: (notice: OpNotice) => void): () => void;
// typed helpers, one line each: setDrumSwing(swing) { return this.apply({ type: 'drum.swing', swing }); }
// reads, synchronous, returning copies: getDrumKits(), getTempo(), getScenes() (which runs commitScene())
```

`applyAll` does not stop at a refused operation, as the `Promise.all` of requests
it replaces did not.

Reducers are in `ui/src/services/projectReducers.ts`, a
`Partial<{ [K in OpType]: (ctx, op) => Outcome<...> }>` that the last pull request
makes total, so the compiler checks every operation has one. `ctx` is
`{ state, defaults }`; add to `ReducerContext` what a group needs (making a lane,
this machine's origin) and nothing that emits or saves. Each reducer is the old
branch's body, moved as it is. Reducers never emit; only `apply` does (`recordFor`
swaps `this.state` and is safe only because nothing emits meanwhile). Scene
reducers stay private methods of the service, because `captureScene`, `applyScene`
and `ensureScenes` use `this.state`.

```ts
apply<T extends Operation>(op: T, origin: Origin = 'local'): Applied<OpResult<T['type']>> {
  const ctx = this.ctx();   // throws 'Local project has not been initialized'
  const reduce = reducers[op.type] as ((ctx: ReducerContext, op: Operation) => Outcome<unknown>) | undefined;
  if (!reduce) throw new Error(`No reducer for ${op.type} yet: it is still a route of request()`);
  const out = reduce(ctx, op);
  if (!out.ok) return { ok: false, status: out.status, error: out.error };
  if (out.save) this.persist();
  if (out.event) this.emit(out.event.type, out.event.data);
  const notice: OpNotice = { op, origin, saved: !!out.save };
  this.opListeners.forEach(listener => listener(notice));
  return { ok: true, value: clone(out.value) as OpResult<T['type']> };
}
```

## One route, end to end: drum swing

```ts
// projectReducers.ts: the old branch, moved
'drum.swing': ({ state }, op) => {
  state.drumSwing = number(op.swing, state.drumSwing, 0, .75);
  return update('drumSwing', { swing: state.drumSwing });
},

// localService.ts, before request() in the class
setDrumSwing(swing: number) { return this.apply({ type: 'drum.swing', swing }); }
// in request(), keeping the `path === '...'` form:
if (path === '/drum/swing') return fromApplied(this.apply({ type: 'drum.swing', swing: body.swing }));
// and, once, beside `respond`:
const fromApplied = (result: Applied<unknown>) => (result.ok ? respond(result.value) : respond({ error: result.error }, result.status));

// useStudio.tsx, handleDrumSwingChange. Before:
setDrumSwing(swing);
localRequest('/drum/swing', { method: 'POST', headers: {...}, body: JSON.stringify({ swing }) });
// After: the early setDrumSwing is gone; the existing 'drumSwing' case is the one place it is applied.
localService.setDrumSwing(swing);
```

The history push before it is unchanged.

Test: `ui/test/storeOps.test.ts` runs each migrated case twice on two fresh
services, once through `request` and once through the typed helper, and asserts
the same answer, events, saved flag, written project and snapshot, and that the
saved flag is what `OP_META` says. Each case also states the answer it expects,
so the two ways cannot be wrong together. Include a clamped input (a swing of 5
gives .75), a missing one and one of the wrong type. A group adds its cases to
the `cases` list there; one test fails if a reducer has no case.

The harness is `ui/test/helpers/store.ts`: `setup` and `call` (one request and
everything it did), moved from `storeRoutes.test.ts` unchanged; `applied`, which
is `call` for an operation applied directly; and `comparable`, which puts a
project in a form two separate stores can be compared by (their random ids and
times differ). `storeRoutes.test.ts` and the thirteen other test files that call
`request` are not changed until the last pull request: they are the proof that
nothing changed.

## The pull requests

Each one: moves a group's route bodies into reducers, with the routes calling
`apply`; adds the typed helpers; switches `useStudio`'s call sites and drops their
early updates; adds the two-way tests.

1. **Foundation and the one-way setters.** Built. `projectOps.ts`,
   `projectReducers.ts`, `apply`, `applyAll`, `subscribeOps`, `fromApplied`,
   `test/helpers/store.ts`; `merge` and `clone` moved. Routes: `/drum/swing`,
   `/drum/master-volume`; read methods for `/drum/kits`, `/tempo` GET and
   `/scenes`. In `useStudio`: `handleDrumSwingChange`,
   `handleDrumMasterVolumeChange`, the two calls undo made for them, a
   `drumMasterVolume` case that sets the volume (the event was never handled
   before, so the volume now comes back clamped to 0 to 1, which is the knob's
   range), `songArrangement` reading `getScenes()`, the kit list reading
   `getDrumKits()`, and the five dead cases deleted.
2. **Guests.** `/guests`, `/guests/:id`. No refs and no early update, so this is
   where rejected results (a bad address, too many guests) get their shape. Low.
3. **Drums.** `/drum/step`, `step-velocity`, `step-detail`, `settings`, `mix`,
   `sample`, `reset`, `state`, `bars`, `kit`. Drop the early `setDrumState`:
   `drumFullState` and `drumKitChanged` carry the whole state. Write
   `drumStateRef` in the `drumFullState` handler. Keep the throttled history pushes
   and their keys exactly. Remove `drumKitsLoading` and `drumKitsError`. Medium: a
   drag clones the whole drum state per edit.
4. **Effects.** `/drum/fx`, `/effects-loop`. Delete the second apply from the
   response and the rollback that cannot run. The helpers take a patch, not a whole
   object. Low.
5. **Lanes.** `parameters`, `model`, `mix`, `preferences`, `patterns`, `/tempo`.
   The highest risk: the `synthUpdate` handler is the only thing that sends
   parameters to the audio (`synthAudio.updateParameters`) and must keep doing so;
   pattern handlers use `commitLanes`; `/tempo` rewrites every pattern's tempo.
   Split into 5a (everything but patterns) and 5b (patterns, thirteen call sites)
   if it is too large.
6. **Lanes coming and going, and the transport.** `/synth/create`, DELETE
   `/synth/:id`, `/sequencer/play`, `/sequencer/stop`. Play and stop still do not
   save. The `synthRemoved` and `sequencerStop` handlers keep their ref writes.
   `synthAudio.stopSynth` still comes before the removal. The `Promise.all` of play
   requests becomes `applyAll`. Medium.
7. **Scenes and the song.** `/scenes/select`, `create`, `rename`, `delete`,
   `replace`, `/song`. The `sceneChanged` handler and its ref writes are untouched.
   `await guestLink.captureAll()` still comes first. The scheduler's call is the
   synchronous `localService.selectScene(id)`. Add a test that opens a scene and
   reads the refs on the next line. High, but on its own.
8. **Take `request` away.** Delete `request`, `localRequest`, `fromApplied` and the
   parts of `storeRoutes.test.ts` that read the router's source. Make the reducer
   map total and delete the branch of `apply` for a missing reducer. Turn the
   thirteen test files' helpers into `apply`, and the pinned route cases into
   typed ones, keeping each pinned status, event and saved flag. `applySnapshot`
   (undo) becomes one `applyAll`, which also ends an undo pressed during another
   being dropped: say so, it is a change in behaviour.

## Hazards

- `storeRoutes.test.ts` reads the router's source: it looks for the
  `async request(path: string, options: RequestInit = {})` line, reads from
  there to the end of the class, and checks every use of `path`, `resource` and
  `method` is a form it knows, with pinned counts. Keep the `path ===` and
  `resource ===` forms, add new methods before `request`, re-pin a count only in
  the pull request that changes it, and do not make the router table-driven
  part-way.
- An operation's contents are the caller's own objects. Through `request` they
  were always a fresh parse of a string, so a route could keep what it was sent.
  A reducer that puts part of an operation into the state must copy or sanitize it
  first, or the store and the caller (React state, an undo entry, an operation
  listener) share an object the store then changes in place. For the same reason
  a value that JSON would have dropped or changed on the way (`undefined`, `NaN`,
  infinity) now reaches the reducer as it is: the two-way tests for a group must
  include them.
- Undo (`applySnapshot`) replayed twelve requests while `isRestoringRef` is
  set; ten are left. Move its calls with their groups.
- Pattern writes are read-modify-write from `synthsRef`. Fine for one person; for
  live editing two edits in a frame would clobber each other, and `pattern.step`
  is the answer.

## After the migration

- **Reading.** Give the store a version counter per slice (`lane:<id>`, `drums`,
  `fx`, `effects`, `tempo`, `scenes`, `guests`). Reducers say which slices they
  touched, `apply` bumps them, and `store.read.lane(id)` and the like copy lazily
  and cache until the next bump, so a hook can use
  `useSyncExternalStore(subscribeSlice, getSlice)`. That is what lets `useStudio`
  be split into hooks for transport, history, MIDI and persistence, and lets hooks
  read the store from handlers and the scheduler instead of mirroring it in refs.
  It fits `tracked` (`ui/src/studio/tracked.tsx`), which already renders a unit
  only when a value it read has changed identity.
- **Undo in the store** (roadmap improvement 2) listens with `subscribeOps` and
  records the operations whose `OP_META` says `undoable`.
- **Live editing** is the owner's decision to build, last of all, deliberately
  lifting the rule against a WebSocket transport. It sends the operations whose
  `OP_META` says `share`. A `controlKeys(op)` function will flatten a patch into
  keys such as `synth:2:filter.cutoff` for last-edit-wins. Not built now.
