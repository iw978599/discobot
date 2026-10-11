# Typed project store: the plan

Written 2026-10-11 from a design pass over `localService.ts`, `useStudio.tsx` and
`storeRoutes.test.ts`. This is roadmap improvement 1. It is done as a sequence of
pull requests, each leaving `main` working and `storeRoutes.test.ts` green.

Status: pull requests 1 to 6 of 8 are built (the foundation, drum swing and
drum master volume; then guests; then the drums; then the effects; then the
whole of 5, a lane's sound, model, mix and view, and the tempo, and then its
pattern writes; then lanes coming and going, and the transport). 7 and 8 are
open.

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
  to `localRequest`, not about 80 (62 after pull request 1, 59 after 2), and
  thirteen test files besides `storeRoutes.test.ts` call `request`, not eleven.
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

Found by building pull request 2 (guests):

- **A patch must be read as the route's body was.** `patchGuest` changes a
  field when its key is there (`'muted' in patch`). Through `request` a key
  whose value was `undefined` never arrived, because JSON leaves it out;
  handed straight to a reducer, `{ muted: undefined }` unmuted the guest and
  `{ state: undefined }` deleted its settings. `GuestModule` sends
  `{ state: data.state }` with whatever the guest posted, so this was not only
  a matter for tests. The reducer now puts the patch through `sent` (see
  Hazards) before reading it. The two-way tests fail without it.
- **An operation can carry an id a route could never have made.** The route
  made a new guest's id itself, so it was always a fresh UUID. `guest.add`
  carries it, so it can be malformed or already taken, and `sanitizeGuests`
  then hands back nothing, which would have put `undefined` in the guest
  list. Both are refused: 400 for an id no guest can have, 409 for one already
  in the project, after the two checks the route made and in its order
  (address, then room). Every later operation that carries an id it creates
  (`scene.create`, `pattern.write`, `synth.create`) needs the same thought.
- **`guest.patch` takes a `GuestPatch`**, the five fields a guest can have
  changed, not `Record<string, unknown>`. `useStudio` already had that type
  written out.
- **The helper is `changeGuest`**, because `patchGuest` is the name of the
  function in `guests.ts` that does the work.
- **One pinned count in `storeRoutes.test.ts` changed**: the router looked at
  `method === 'DELETE'` twice for a guest (once to choose between removing and
  changing, once more to strip the scenes) and now looks once, so
  `methodChecks` went from `DELETE: 3` to `DELETE: 2`, with the comment
  above it. Nothing else in that file changed.
- **A guest id that is not 36 characters of hex and dashes** never reached the
  guest routes (the path did not match, so the answer was 404 "Unknown local
  operation"). The typed way answers 404 "Guest not found". The status is the
  same and no caller reads the text.
- **`apply` now says so when a reducer answers with nothing**, before it saves
  or emits. Without that the copy of the answer threw a `SyntaxError` after
  the event had gone out and the save was scheduled.
- **`ReducerContext` gained `origin`**, this machine's own address, for
  `guestUrl`. It is read once for each `apply`, as the route read it.

Found by building pull request 3 (drums):

- **The built-in-property throw is not what this plan said.** It said the six
  edits to one drum lane throw a TypeError for an instrument named
  `constructor`, `toString` or `__proto__`. Run, they do three different
  things: the three step edits throw a TypeError, a change of settings throws
  a SyntaxError (`merge` copies settings that are not there), and a sample or
  a mute does not throw at all: it answers 200, emits and saves, and writes
  `sampleId` or `muted` onto the built-in property itself, which for
  `__proto__` is the object every other object inherits from. No control in
  the app can send such a name. The typed way does exactly the same, and
  `storeOps.test.ts` pins both ways. The last pull request must put right all
  three, not only the throw.
- **Undo needs the drums as they were last rendered, not as the last event
  left them.** `drumStateRef` is now written by the `drumFullState` and
  `drumKitChanged` handlers. But a pattern tool (Fill, shift, reverse,
  duplicate) makes up to 48 edits in one click and each pushes an undo entry.
  While the ref was only assigned at render, every one of those entries held
  the drums from before the tool, so one undo took the whole tool back. Read
  from a ref the events write, each entry would hold the drums after the edit
  before it, and one undo would take back a single step. So `getSnapshot`
  reads `drumsForUndoRef`, which is assigned at render and by `sceneChanged`
  and by nothing else: exactly what `drumStateRef` was. **Pull request 5 has
  the same trap**: `getSnapshot` reads `synthsRef`, and `commitLanes` will
  write it from the pattern events. Before using `commitLanes`, find every
  handler that pushes history more than once in a go, or after an edit.
- **A single flag can need the trip through JSON too.** The hazard below said
  a single number, text or flag needs nothing. That holds for `number`,
  `typeof` and `=== true`, but `/drum/step` reads its flag with
  `Boolean(active)`, and infinity is true where the `null` JSON made of it is
  false. `sentValue` in `projectReducers.ts` is `sent` for one value. Look
  for `Boolean(...)`, `!!`, `||` and a bare `if (value)` on anything out of
  an operation.
- **`drum.state` does not need `sent`.** `sanitizeDrums` builds every lane
  anew and reads what it is handed only with `=== true`, `typeof`, `number`
  and `Array.isArray`, which take `undefined`, `NaN`, infinity and `null`
  alike, so nothing of the caller's is kept and nothing differs. The two-way
  cases prove it. The route's `body.state || body` stays in the route.
- **The six edits to one lane share `drumLaneEdit`**: find the lane, make the
  edit, check the whole drum state, send it. The router's
  `track && path.startsWith('/drum/')` line is gone, and an unknown `/drum/`
  path falls through to the same 404.
- **Nothing in `storeRoutes.test.ts` changed, and no pinned count moved.**
  The ten routes kept their `path === '...'` lines and `/drum/state` kept its
  method check. The form the test knows for the `startsWith` line now matches
  nothing, which the test allows; take it out with the rest in pull request 8.
- **Two edits made before a render used to lose the first.** Mute All and
  Clear Solos each build a whole drum state from `drumStateRef`. Pressed one
  after the other before React rendered, the second was built from drums that
  did not have the first in them. With the ref written by the event, it does.
- **`handleDrumKitChange` applied its result three times** and now applies it
  once, from the event. It hands back the answer's drums because its one
  caller (`selectKit` in `DrumModule`) auditions the selected drum with the
  new settings, and its own copy of the drums is from before the change. It
  still takes `applyDefaults`, which that caller passes as true; undo calls
  `setDrumKit(id, false)` itself.
- **`drum.kit` is not undoable by the rule `OP_META` states** (true for what
  pushes an undo entry today): choosing a kit never pushed one. The row said
  true and now says false. An undo entry does hold the kit, so undoing an
  earlier edit puts the kit of that time back; roadmap improvement 2 settles
  the column.
- **The kit menu's "loading" and "unable to load" states are gone** from
  `useStudio` and `DrumModule`. No test looked for them.
- **In the tests, `comparable` takes anything shaped like a UUID for one of
  the store's own ids** and replaces it, so a sample id in an expected answer
  must be 36 characters that are not in that shape.
- **The cost, not optimized.** Each drum edit checks the whole drum state,
  copies it once for every listener and once more for `apply`'s answer. A
  drag on a knob does that per movement and a pattern tool up to 48 times a
  click. The early update that was dropped cost a shallow copy, and the
  route's own serializing, which is gone, cost about one of these copies.
  Reading by slice (see "After the migration") is the answer if it shows.
- `useStudio.tsx` makes 45 calls to `localRequest` after this pull request.

Found by building pull request 4 (effects):

- **Both patches go through `sent`, and only `undefined` needed it.** `merge`
  sets a key that is `undefined`, where JSON never sent it. So a typed
  `{ delay: { sync: undefined } }` took a synced delay's sync off,
  `{ chorus: undefined }` took the chorus away, and
  `{ sends: { reverb: undefined } }` put that send back to its default.
  With `sent` taken out, exactly those cases fail (nine, with the test for a
  patch that is not an object). `NaN`, infinity and `null` come out the same
  with or without it, because the checks after `merge` (`number`,
  `sanitizeShape`, `typeof ... === 'object'`) take them alike; the cases are
  there to say so.
- **The optional parts behave as the route's.** A delay's `sync` is kept only
  when it is a note value: `'off'`, anything else and `null` take it off, and
  a patch that does not name it leaves it. A chorus or an EQ is added whole
  from one value, kept when the patch does not name it, and taken away by a
  value that is not an object (a list puts it back as new, switched off). The
  reverb's pre-delay and damping are each taken away at zero or by a value
  that is not a number. None of them is in the defaults; `sanitizeEffects`
  still adds them back by hand. A drum send the defaults do not name
  (`chorus`, in the tests' defaults) is dropped, as before.
- **A patch that is not an object is refused with 400** "Invalid local
  operation data", as a route's body was, before anything else.
- **The handlers still send the whole of what they built.** `handleDrumFxChange`
  and `handleEffectsLoopChange` lay the change over `drumFxRef` or
  `effectsLoopRef` and send all of it, with `sync: 'off'` and a pre-delay and
  damping of zero always there, which is how turning one off reaches the
  store through a merge. That is unchanged: only the early `setState`, the
  third apply from the answer and the rollback are gone.
- **`drumFxRef` and `effectsLoopRef` are still assigned only at render.** The
  events do not write them, so undo's "before" is what it was, and so is the
  old limit that two effect changes made before one render are both laid over
  the same starting point: the second is sent whole, built without the
  first, and so puts the first back. No control makes two in one go.
- **Undo and Reset send a whole object as a patch**, as they did. Because it
  is merged, an undo entry or the reset defaults that hold no chorus or EQ
  leave the ones the project has. That is how it was; roadmap improvement 2
  is where undo is put right.
- **`applySnapshot` still awaits the two calls** (`await Promise.all` of two
  values that are not promises), so the lane, tempo and pattern calls after
  it run one turn later, as they did. Pull request 8 makes all of it one
  `applyAll`.
- **Nothing in `storeRoutes.test.ts` changed, and no pinned count moved.** The
  two paths keep their shared line and its one `method === 'GET'`.
- `useStudio.tsx` makes 39 calls to `localRequest` after this pull request.

Found by building pull request 5a (a lane's sound, model, mix and view, and
the tempo):

- **Three guards, each with its own cases.** `synth.params` reads its patch
  through `sent`: `merge` sets a key that is `undefined`, and
  `sanitizeSynthParams` asks whether `spread` and an LFO's `sync` are there
  (`!== undefined`). `synth.model` reads the model's name through
  `sentValue`, because the route takes it with `||` and infinity counts as
  true where the `null` JSON made of it does not; and its macros through
  `sent`, for `merge` again. Taking each guard out fails exactly its cases
  (six, one and one). `synth.mix`, `synth.prefs` and `tempo.set` check with
  `typeof`, `number`, `===` and `Number.isFinite`, which need nothing; the
  cases say so.
- **A lane is found by its number and nothing else.** The router took the
  lane from the digits of the path, so it was always a whole number. An
  operation that names a lane with text, a fraction or nothing answers 404
  "Synth not found", after the check that a sound patch is an object (400),
  which is the order a body check and a route had.
- **`synth.params` and `synth.prefs` write their outcome out in full.** The
  first answers the sound and sends `{ synthId, parameters }`; the second
  saves and sends nothing, and answers the whole lane (which `apply` copies).
  The two-way harness gained `eventData` and `silent` for them.
- **The `synthUpdate` handler is untouched** and is still the only caller of
  `synthAudio.updateParameters`: for a knob, a macro, a preset, undo and
  Reset alike. Parameters were echo-only before and still are.
- **One turn is kept in `handleSynthModelChange`** (`await Promise.resolve()`
  between the model and its macros' parameters). As requests, the parameters
  went one turn after the model, and for a click React rendered the model in
  between. A preset load calls the model change and then the parameter
  change, whose (throttled) undo entry reads `synthsRef`: it held the new
  model with the sound from before the macros were laid over it. With both
  calls in one turn it would hold the sound after them. Kept as it was; a
  preset load still leaves two undo entries (one if a parameter was changed
  less than 250 ms before). Roadmap improvement 2 is where that is put right.
- **What is still set early, and why.** The octave and the keyboard
  (`handleOctaveShift`, `handleKeyboardModeChange`, and the octave in
  `applySnapshot`), because `synth.prefs` sends no event, as the plan keeps
  for good. The lanes' own copy of the tempo in `pattern.tempo`
  (`handleTempoChange`), because the `tempoChange` event carries only the
  tempo; the store ignores a pattern's tempo on a write (`sanitizePattern`
  is handed the project's), so that copy is only what React shows. And
  `handleReset`'s `setSynths` after its calls, which is late, not early, and
  also clears view state. `applySnapshot` no longer sets the sound, the
  model, the mute, the solo or the tempo itself; it still sets the pattern
  (5b), clears the selected step and sets the octave.
- **A tempo the store refuses no longer shows.** `handleTempoChange` used to
  set the tempo on screen before asking; a tempo outside 20 to 400 would have
  shown while the store kept the old one. Nothing can send one: the tempo
  box, tap tempo and MIDI import all hold it to 20 to 400.
- **Undo reads what it did.** `getSnapshot` reads `synthsRef` and the
  `globalTempo` it closed over, both as last rendered; nothing in 5a writes
  `synthsRef` from an event, so every undo entry holds what it held.
- **Nothing in `storeRoutes.test.ts` changed, and no pinned count moved.**
  The `resource === '...'` lines and the three `method === 'GET'` checks
  (parameters, model, `/tempo`) are where they were. A GET to `mix` or
  `preferences` with a body still writes, as pinned.
- **The stand-in tests** now stand in for `transport.stop` and
  `transport.play`; `tempo.set` has a reducer of its own.
- `useStudio.tsx` makes 23 calls to `localRequest` after this pull request,
  fourteen of them pattern writes.

Found by building pull request 5b (a lane's pattern writes):

- **One reducer, the route's body moved.** `pattern.write` carries the pattern id
  (the route takes it from the path, then the body, then makes one), and
  `writePattern(synthId, patternId, patch)` is the helper. The patch goes through
  `sent`: a name, `bars` or `steps` that is `undefined` would otherwise
  override the pattern's own where JSON never sent it, and an `offset` of
  infinity is held to the top where the `null` JSON made of it is none. Without
  `sent`, 27 cases fail (the undefined name, undefined bars, infinite offset,
  infinite steps and the patches that are not objects among them). `NaN` and
  `null` come out the same either way; the cases say so. The project's tempo is
  written to the pattern, never the one sent, as the route did.
- **The events set the open pattern.** `patternCreated` and `patternUpdated` both
  put the pattern in the lane's list and make it the lane's open pattern, which
  is what the store does. Before, `patternCreated` did not set it and the caller
  had set it early.
- **The `commitLanes` sketched here is not what was built.** The plan's
  `commitLanes(next)` sets the ref and the state from a value worked out from the
  ref; a change made to each lane (`commitLanes(change)`) is used instead, so
  nothing another handler asked of the state since the last render is lost.
  `commitPattern` is the one the two pattern events call. The hand-written ref
  lines in the piano-roll assign and the note upsert are gone.
- **Undo needed the trap handled differently from the drums.** `getSnapshot`
  reads a lane's pattern, sound, mute and octave from `synthsRef`. Moving
  `synthsRef` on from the pattern events would have changed what a gesture's undo
  entries hold: a MIDI import onto one lane from two tracks pushes an entry before
  each write, and the second would hold the lane after the first. A render-time
  copy like `drumsForUndoRef` cannot be used, because it could not be
  refreshed from `sceneChanged`, `synthRemoved` and `sequencerStop`, which step 6
  and 7 own, and because painting needs the opposite: each cell must see the one
  before. So `lanesBeforeEditRef` keeps, for each lane a pattern event has moved
  since the last render, the lane as it was before the first of them and the
  pattern the last of them left. `getSnapshot` reads that lane while the live
  lane still has that pattern (checked by identity, so a scene change, which
  replaces it, falls back to the live lane). It is emptied at each render. The
  two painting writers (`handlePianoRollNoteAssign`, `upsertStepNote`) forget it
  after each write, so each painted cell is one undo entry, as when they wrote
  `synthsRef` by hand. Every other handler's entry holds what it held.
- **Early updates.** The pattern is gone from all fourteen call sites. Kept, because the
  event cannot carry them: `selectedStep` (step change, assign, clear, upsert,
  step count, bars, MIDI import, undo), `stepRecordPointer` (upsert), and the
  `playhead` position (step count, bars). A pattern the store refuses (nothing
  in the app can send one) no longer shows on screen.
- **The note play in record mode** no longer sets anything but the write.
- **`applySnapshot`** keeps its place in the order: the write is first in its
  `Promise.all`.
- **Lane bars sends `bars` as 1** for one bar, as before; the comment now says the
  store keeps the bars it has when none are sent, which is what the merge does.
- **The `startsWith('patterns')` router line still matches `patternsX`**, pinned.
- **Nothing in `storeRoutes.test.ts` changed and no pinned count moved.** The
  `resource?.startsWith('patterns')` and `resource === 'patterns'` forms and the
  one `method === 'GET'` are where they were.
- `useStudio.tsx` makes 9 calls to `localRequest` after this pull request: scenes
  (four, one through `sceneRequest`) and lanes coming and going and the
  transport (five).
- **For the builder of step 6:** `synthRemoved`, `sceneChanged` and
  `sequencerStop` still write `synthsRef` themselves and were not touched.
  `getSnapshot` falls back to the live lane when a pattern event's lane no longer
  has the pattern, so they need no change for undo. `commitLanes` maps over
  `synthsRef.current`, which a `synthUpdate` since the last render has not reached;
  it heals at the next render and the state is right.

Found by building pull request 6 (lanes coming and going, and the transport):

- **Four operations, one reducer each**, the route's body moved: `synth.create`
  (`createLane`), `synth.remove` (`removeLane`), `transport.play` and
  `transport.stop` (`playLane`, `stopLane`). Play and stop share one function
  that is given the flag. `setPlaying` is gone from `localService`; the lane
  is made by `newLane` in `projectReducers.ts`, which the service's private
  `createSynth` now calls.
- **`transport.stop` takes a `patternId`**, which the plan's type did not
  have. The route handed the body's pattern to stop as well as to play, so a
  stop that names a pattern the lane has makes it the lane's open pattern
  (pinned in `storeRoutes.test.ts`). No caller in the app does it. The
  `stopLane` helper leaves it out; `apply` takes it.
- **`synth.create` reads its lane number through `sentValue`.** The route took
  it with `||`, so 0, `null` and `NaN` mean "the lowest free", and so does
  infinity, because JSON turned it into `null`. Handed straight to the reducer,
  infinity would have been refused. Text, a fraction and a number outside 1 to 3
  are 400 "Three synths maximum", as before. Creating a lane that exists
  answers with it as it is, and still saves and emits (pinned).
- **A new lane's pattern id is made inside the reducer**, so `synth.create` is
  not repeatable the way the plan's first rule asks: two stores applying it get
  different pattern ids. The operation does not carry one. Not changed here
  (it would need the same refuse-a-bad-id checks as `pattern.write`); live
  editing, or undo in the store, has to settle it.
- **`synth.remove` looks for the lane first**, so a lane that is not there is a
  404 even for lane 1; lane 1 that is there is 400. The router keeps its own
  404 check, which comes before the DELETE line, so the reducer's is the same
  answer reached by the typed way.
- **Play and stop of a lane that is not there** answer `{ success: false }` and
  the status is still 200, with no event and no save. The operation counts as
  accepted: `subscribeOps` listeners are told of it, with `saved` false. The
  route's `body.synthId || 1` stays in the route; the typed helpers take the
  lane as given, so `playLane(0)` is a lane that is not there, where the route
  with `synthId: 0` is lane 1.
- **In `useStudio`**: `handleRemoveSynth` no longer sets the state after the
  request (the `synthRemoved` event does); `ensureSynthExists` no longer sets
  the state either (the `synthCreated` event had already added the lane, so
  that update never did anything), and still writes the ref; Play no longer
  sets `isPlaying` (the `sequencerPlay` event does) and keeps the playhead
  reset; Play and Stop each make one `applyAll`. The `synthRemoved` and
  `sequencerStop` handlers are untouched, with their ref writes, and
  `synthAudio.stopSynth` is still before the removal.
- **Stop's own `setSynths` is kept, and is why.** The `sequencerStop` handler
  turns each lane's `forceReleaseSignal` over, and the Stop handler did again,
  so the lane ends as it began. Taking the second out would have turned it over
  once and changed what the lane's keyboard sees. This looks like a mistake (an
  odd number of turns was probably meant); it is not fixed here. Roadmap
  improvement 2 or the last pull request should decide.
- **One turn fewer.** The `await` on the stop requests, and on Reset's stop, and
  the one on the create request, are gone, so what followed them runs one
  microtask earlier. Nothing in between could render.
- **A removal the store refuses** (the lane is not there) used to take the lane
  off the screen anyway. Nothing can ask for it.
- **The stand-in tests** now stand in for `scene.select` and `scene.delete`,
  which are what has no reducer. Point them at whatever is left in pull
  request 7, and at nothing once the map is total.
- **Nothing in `storeRoutes.test.ts` changed and no pinned count moved.** The
  `/synth/create` and `/sequencer/play` lines, the DELETE check and the
  `startsWith` are where they were.
- `useStudio.tsx` makes 4 calls to `localRequest` after this pull request:
  the scenes (three direct, one through `sceneRequest`).
- **For the builder of step 7:** `synthCreated` still adds a lane to the state
  with `octaveShift` 0 and `keyboardMode` 'keyboard' whatever the store has,
  and `ensureSynthExists` writes the ref from the answer, so the two can
  differ for a lane that already exists in the store and not on screen. Scene
  changes replace every lane's pattern; `lanesBeforeEditRef` and the ref
  writes in `sceneChanged` are the things to leave alone. The scheduler's
  `/scenes/select` is the one `void localRequest` call.

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

**A refusal** is `{ ok: false, status, error }`, settled with guests, the first
group that can be refused for more than one reason:

- `status` is the status the route answered, kept because `request` still
  answers with it and the pinned tests read it. As far as the routes allow, 400
  is an operation that is wrong in itself and would be refused by any project (a
  bad address, a change that is not an object), 404 one that names something
  this project does not have (an unknown guest), and 409 one that is well formed
  but that the project as it stands cannot take (four guests already). The
  routes are not perfectly consistent about it (a full set of scenes is a 400,
  and so is renaming a scene that is not there) and each stays as it is pinned,
  so code should not decide much by the number. When `request` goes, the
  numbers can stay as they are: they are a small closed set and read well.
- `error` is a sentence fit to show the user as it is, and is the route's own
  text. `handleAddGuest` shows it in the dialog.
- A reducer refuses before it changes anything, and makes its checks in the
  order the route made them (a bad address is a 400 even when the project is
  full). `refuse(status, error)` in `projectReducers.ts` builds one.
- `apply` hands back only those three fields. Nothing is saved, no event is
  sent and no operation listener is told, so a refused operation is never
  recorded, replayed or sent to anyone.
- A check that the route made before routing belongs to the reducer now: an
  object in an operation that is not an object is 400 "Invalid local operation
  data", the answer `request` gives for such a body, and it comes before the
  reducer's other checks, as the body check came before the route.
- A caller reads `result.ok` and, when it is false, `result.error`. A helper's
  caller that does not care (removing a guest, changing one) ignores the result,
  as it ignored the response.

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
built-in-property throw; a one-step drum edit echoing the whole drum state. Dead code removed in the first
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
  | { type: 'guest.patch'; guestId: string; patch: GuestPatch }
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
`{ state, defaults, origin }`; add to `ReducerContext` what a group needs (making
a lane) and nothing that emits or saves. Each reducer is the old
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
  if (out.value === undefined) throw new Error(`The reducer for ${op.type} answered with nothing`);
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

Since pull request 2 a case can also be a refusal (`status` and `error` in place
of `answer` and `event`): both ways must then answer the same error, emit
nothing, save nothing and leave the project as it was. A case can name a
`method`, and its `arrange` can be asynchronous and hand what it made (an id) to
`path` and `run`. The ids the two stores make differ, so an expected answer is
written with each id as its place among them (`'id-1'`), which is what
`comparable` turns them into. An `arrange` uses the typed helpers where they
exist and `request` for a route that has not moved.

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
2. **Guests.** Built. `POST /guests`, `PUT` and `DELETE /guests/:id` are
   `guest.add`, `guest.patch` and `guest.remove`, with the helpers `addGuest`,
   `changeGuest` and `removeGuest`. In `useStudio`: `handleAddGuest`,
   `handleRemoveGuest` and `handleGuestChange`, which had no refs and no early
   update; the `guestsChanged` handler is as it was. This is where a refusal got
   its shape (see Decisions) and where `sent` came from (see Hazards).
3. **Drums.** Built. `/drum/step`, `step-velocity`, `step-detail`, `settings`,
   `mix`, `sample`, `reset`, `state`, `bars` and `kit` are `drum.step`,
   `drum.stepVelocity`, `drum.stepDetail`, `drum.settings`, `drum.mix`,
   `drum.sample`, `drum.reset`, `drum.state`, `drum.bars` and `drum.kit`, with
   the helpers `setDrumStep`, `setDrumStepVelocity`, `setDrumStepDetail`,
   `setDrumSettings`, `setDrumMix`, `setDrumSample`, `resetDrums`,
   `setDrumState`, `setDrumBars` and `setDrumKit`. In `useStudio` every drum
   handler, the MIDI import's drums and the two drum calls undo makes go
   through them, with no early `setDrumState`; the `drumFullState` and
   `drumKitChanged` handlers write `drumStateRef`, and undo reads
   `drumsForUndoRef` (see what was found, above). Every history push is where
   it was, with its key. `drumKitsLoading` and `drumKitsError` are removed.
4. **Effects.** Built. `/drum/fx` and `/effects-loop` are `drum.fx` and
   `effects.set`, with the helpers `setDrumFx` and `setEffectsLoop`, each
   taking a patch. In `useStudio`: `handleDrumFxChange`,
   `handleEffectsLoopChange`, the two calls undo makes and the two Reset
   makes; the `drumFxUpdate` and `effectsLoopUpdate` handlers are as they
   were and are the one place each is applied.
5. **Lanes.** In two halves.
   5a, built: `parameters`, `model`, `mix`, `preferences` and the `/tempo`
   write are `synth.params`, `synth.model`, `synth.mix`, `synth.prefs` and
   `tempo.set`, with the helpers `setSynthParams`, `setSynthModel`,
   `setSynthMix`, `setSynthPrefs` and `setTempo`. In `useStudio`:
   `handleParameterChange`, `handleSynthModelChange`, `handleSynthMixChange`,
   `handleOctaveShift`, `handleKeyboardModeChange`, `handleTempoChange`, the
   MIDI import's tempo, the three calls Reset makes for each lane and the
   five undo makes. The `synthUpdate` handler is the only thing that sends
   parameters to the audio (`synthAudio.updateParameters`) and is untouched.
   5b, built: `patterns` and `patterns/:pid` (`pattern.write`), with the helper
   `writePattern`, at fourteen call sites. See what pull request 5b found.
6. **Lanes coming and going, and the transport.** Built. `/synth/create`, DELETE
   `/synth/:id`, `/sequencer/play`, `/sequencer/stop`. Play and stop still do not
   save. The `synthRemoved` and `sequencerStop` handlers keep their ref writes.
   `synthAudio.stopSynth` still comes before the removal. The `Promise.all` of play
   requests becomes `applyAll`. Medium. Built as `synth.create`, `synth.remove`,
   `transport.play` and `transport.stop`, with the helpers `createLane`,
   `removeLane`, `playLane` and `stopLane`. See what pull request 6 found.
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
- What to do about it, from pull request 2. For a single number, text or flag,
  the checks already in use (`number`, `typeof`, `=== true`) treat `undefined`,
  `NaN` and `null` alike, so nothing is needed; say so with a case for each.
  A check by truth (`Boolean(value)`) is not one of those: use `sentValue`. For
  an object (a patch, a whole state), pass it through `sent` in
  `projectReducers.ts` before reading it: that is the trip through JSON the
  route's body made, so keys that are `undefined` are gone, `NaN` and infinity
  are `null`, the result is a copy nobody else holds, and anything that is not
  an object comes back as `null`, to be refused with "Invalid local operation
  data". It costs what the route's own `JSON.stringify` and `JSON.parse` cost,
  which the caller no longer pays. Look especially for code that asks whether a
  key is there (`'x' in patch`, `!== undefined`, `??`, a spread): that is where
  `undefined` and a missing key part ways.
- An operation carries the ids it creates, so a reducer must refuse an id that
  is malformed or already taken, which a route that made the id never met.
- Undo (`applySnapshot`) replayed twelve requests while `isRestoringRef` is
  set; eight are left. Move its calls with their groups, each in the place it
  had among the others: the store must be changed in the same order.
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
