# Discobot — AI Context / Restore Prompt

## Project Overview
Browser synth/sequencer/drum workstation with three npm workspaces. All project
operations, synthesis and playback run locally in the browser, signed in or not.
Accounts are optional and live in a small separate API (`server/`); the app never
depends on it.

## Architecture
```
discobot/
├── engine/    # Browser-compatible TypeScript DSP and shared types
├── ui/        # React/Vite UI, Web Audio and local project/sample services
└── server/    # Accounts API: a Cloudflare Worker with a D1 database
```

### Audio Flow
Browser audio-clock transport → local synth/drum generation → Web Audio effects
and output. Project edits/named patterns use localStorage; sample bytes and
metadata use IndexedDB. These stores are origin scoped and are not cloud backups.

### Current Services
- `ui/src/services/localService.ts`: in-process project operations/events and persistence.
- `ui/src/services/browserTransport.ts`: audio-clock look-ahead scheduling.
- `ui/src/services/sampleStore.ts`: IndexedDB sample persistence.
- `ui/src/services/wavExport.ts`: local offline rendering and WAV download.

Use Node.js 22+, `npm ci`, `npm run dev` and
`http://localhost:3000/discobot/`. Build with `npm run build`; `npm start`
previews the static output at `http://localhost:4173/discobot/`.

Resume Web Audio through a user gesture. Web MIDI hardware support is optional;
unsupported/permission-denied input must not block the keyboard or MIDI files.
Automated checks do not establish subjective audio quality or real MIDI hardware
compatibility. See `README.md` and `docs/CONTROL_AUDIT.md`.

## Key Files
| File | Purpose |
|------|---------|
| `ui/src/App.tsx` | Picks the page from the URL hash before `useStudio` runs: kids mode (`#kids`), one person's published songs (`#u=name`), or the workstation, which shows a shared song's page for `#song=` and `#s=` and otherwise `<Rack>` |
| `ui/src/studio/useStudio.tsx` | All app state and behaviour: synth lanes, transport scheduling, undo/redo, save/load, MIDI import/export wiring. Returns one `Studio` object; it renders nothing |
| `ui/src/rack/` | The whole UI. `Rack` stacks `TransportUnit`, three `SynthModule`s, `DrumModule` and the effects unit; `rack.css` holds the look and the shared column layout; `Dialog` and `Menu` are the only modal and dropdown; `UnitBar` is the bar a narrow screen moves between units with |
| `ui/src/services/localService.ts` | In-process project store. `apply(op)` is the one way an edit changes the project: it runs the reducer, schedules the save and emits the event. There is no other way in: the old REST-shaped `request` is gone, and so is its router |
| `ui/src/services/projectOps.ts` | The edits a project accepts, as types: `Operation`, what each answers (`OpResult`), a refusal (`Rejected`), and `OP_META`, which says whether each is saved, undone and shared |
| `ui/src/services/projectReducers.ts` | What each operation does to the project: one reducer for each, the body of the route it replaced |
| `ui/src/services/projectSanitization.ts` | Validation and clamping for everything read from storage or saved arrangements |
| `ui/src/services/browserTransport.ts` | Look-ahead clock. One tick is a 32nd note; 16-step lanes and drums use every second tick |
| `ui/src/services/playhead.ts` / `ui/src/hooks/usePlayhead.ts` | Where each lane's playhead is, kept outside React, and the two hooks that show it: `usePlayheadMark` lights the playing step, `usePlayhead` reads a part of the position such as the bar |
| `ui/src/services/sampleStore.ts` | IndexedDB sample storage |
| `ui/src/services/presetStore.ts` | The user's own synth presets, in IndexedDB, and the one-time move of any still in `localStorage` |
| `ui/src/services/drumSamples.ts` | Decodes a stored sample for a drum lane, once, mixed to one channel |
| `ui/src/services/kitImport.ts` / `ui/src/rack/KitImportDialog.tsx` | Import Kit: `matchKit` guesses a drum lane for each sample file from its name, and the dialog shows the guesses to be changed before anything is stored |
| `ui/src/services/projectLibrary.ts` | The project library: one IndexedDB record per project and a store of earlier versions, with an in-memory stand-in for tests and browsers without IndexedDB |
| `server/src/index.ts` | The whole accounts API: sign up with an invite, sign in, recovery codes, owner tools. `handle(request, env)` is a plain function, so tests call it directly |
| `server/src/secrets.ts` / `rules.ts` | Password hashing, tokens and codes; username and password rules |
| `server/src/localDatabase.ts` / `server/dev.ts` | An in-memory SQLite with D1's interface, and a local runner for it. Used by tests and `npm run dev:api`; never deployed |
| `server/migrations/` | The database schema. Add a new numbered file; never edit one that has been applied |
| `ui/src/services/account.ts` | Browser side of accounts: the session and every API call. `accountsEnabled` is false when the build has no `VITE_API_URL` |
| `ui/src/services/guests.ts` | Guest instruments: address and data checks, per-site consent, the shared-clock helpers and `guestLink`, which tells guests about the transport |
| `ui/src/rack/GuestModule.tsx` / `ui/src/hooks/guestAudio.ts` | The guest's rack unit and frame, and the player that brings its audio into the mixer |
| `ui/src/services/projectSync.ts` | Project sync: `createProjectSync` (the rules, tested against the real API handler) and `startProjectSync` (when it runs). Also keeps a project shared by someone else in step with the owner's copy |
| `ui/src/rack/AccountDialog.tsx` | Sign in, create account, recovery code, and the owner's invite codes and member list |
| `ui/src/rack/Walkthrough.tsx` / `ui/src/services/walkthrough.ts` | The tour of the rack shown after a new account's recovery code, and whether this browser has had it |
| `ui/src/services/shareLink.ts` | Share links: a project deflated into the URL after `#song=`, short links (`#s=code`) to a song published on the server, and the link to one person's page of published songs (`#u=name`) |
| `ui/src/rack/SharedSongPage.tsx` | The page a share link opens: renders the song to audio, plays it, offers a copy |
| `ui/src/rack/UserSongsPage.tsx` | The page a person's link (`#u=name`) opens: the songs they have published, each a link to its own page |
| `ui/src/kids/KidsPage.tsx` / `ui/src/services/kids.ts` | Kids mode (`#kids`): twelve big pads and a beat grid of pictures on two screens, sounds chosen by picture and one play button, on a page that never opens the projects |
| `ui/src/services/wavExport.ts` | Offline arrangement render and WAV encoding: full mix, seamless loop, and per-lane stems zipped by `utils/zip.ts` |
| `ui/src/services/delayTime.ts` | `delaySeconds`: the shared delay's time, free or tempo-synced |
| `ui/src/services/effectSettings.ts` | Defaults and limits for the chorus, master EQ and reverb shape |
| `ui/src/services/drumScheduling.ts` | `expandDrumStep`: the hits one drum step plays (chance, repeats); used live and by WAV and MIDI export |
| `ui/src/hooks/useComputerKeyboard.ts` | Computer-keyboard piano for the selected lane |
| `ui/pwa/service-worker.js` | Service worker template. `vite.config.ts` fills in the build's file list and emits it as `sw.js`; `main.tsx` registers it in production only |
| `ui/src/services/drumKits.ts` | Drum instrument list and kit metadata |
| `ui/src/hooks/browserAudio.ts` | Shared AudioContext, master limiter, parallel FX buses, sample playback |
| `ui/src/hooks/useSynthAudio.ts` | Per-lane AudioWorklet nodes, note start/stop, parameter flattening |
| `ui/src/hooks/useDrumAudio.ts` | Posts drum hits to the `drum-processor` worklet node |
| `ui/src/hooks/useMidiInput.ts` | Web MIDI input, per-device held-note tracking, and the list of outputs |
| `ui/src/services/midiOutput.ts` | `midiOut`: the sequencer's notes and MIDI clock to a hardware output |
| `ui/src/audio/worklet.ts` | Worklet entry: thin `synth-processor` and `drum-processor` wrappers around the engine cores. `vite.config.ts` bundles it to `public/audio-worklet.js` (generated, gitignored) |
| `ui/src/services/songPlayback.ts` | Pure song helpers: `sceneAtBar` (which scene plays in a bar, and where in it), `songBars`, `sceneDrumState` |
| `ui/src/services/presetImport.ts` | Synth preset files: Discobot's own (`discobot-preset`), and translators for other synths' presets |
| `ui/src/services/patternLength.ts` | Bars: how long a lane, the drum grid and a scene are, cutting one bar out of a pattern, and growing or shrinking one |
| `ui/src/rack/SongModule.tsx` | Scene strip, song order and the Scene/Song play mode switch |
| `ui/src/services/noteScheduling.ts` | `expandStepNotes`: everything one step plays (its chord, its length, arpeggio pulses, slide); used live and by export. `stepNotes` and `withStepNotes` read and write a step's chord |
| `ui/src/utils/midiExport.ts` / `midiImport.ts` | Standard MIDI File export (PPQ 480, drums on channel 10) and import |
| `ui/src/synthModels.ts` | Synth model definitions and macro mapping |
| `ui/src/components/` | Controls used inside rack modules: `SynthControls` (the tabbed sound editor), `KeyboardPanel`, `Keyboard`, `PianoRoll`, `EffectsPanel`, `MidiPanel`, `SamplePanel`, `Knob`, `DrumKnob` |
| `engine/src/types.ts` | Type definitions (single source of truth; `ui/src/types.ts` re-exports them) |
| `engine/src/synth/SynthCore.ts` | The synth voice implementation: 8 voices, 2 oscillators + sub + noise, SVF filter, amp and filter envelopes, LFOs, FM, mono/legato |
| `engine/src/synth/voiceParams.ts` | Default `SynthParameters`, and `toVoiceParams` which flattens them for the core |
| `engine/src/drums/DrumCore.ts` | The drum voice implementation and per-kit character table |
| `engine/src/dsp.ts` | Shared oscillators, state-variable filter, exponential ADSR, seeded noise |

## Behaviour Worth Knowing
- There are many projects. `localService` holds the open one, with a working copy in `localStorage` (written synchronously, so it survives a closing tab) and a record in the library that is updated after every write. Switching projects goes through `stash()` then `activate()`, which emits `init`. Project operations are async methods on `localService` (`newProject`, `openProject`, `copyProject`, `renameProject`, `deleteProject`, `importProject`), not operations.
- Each project keeps up to 20 earlier versions in the library (`keepVersion` in `localService.ts`): one when it is opened, one every five minutes of editing, and one before anything replaces it (a sync download, a restore). A version identical to the last one kept is skipped, compared in `normalized()` form. Anything new that overwrites a project must call `keepVersion` first.
- Versions are in this browser only: not in project files, links or sync. Deleting a project deletes them.
- Importing a file or opening a share link always creates a new project; nothing overwrites an existing one. Project names are unique.
- `savedPatterns` only exists to migrate arrangements saved by older versions into projects (`openLibrary`). Do not add to it.
- Share links and project files are untrusted. Both go through `restore()`; `readProjectFile` does that without opening the project.
- A project has scenes (every lane's pattern plus the drum grid, each one or more bars) and a song (scenes in order, with repeats). The lanes' patterns and `drumState` steps in the store are always the open scene; its slot in `scenes` is only brought up to date by `commitScene()`, which runs before anything reads `scenes`. Never read a scene's stored copy for the open scene: use the live pattern.
- Sounds, kit settings, tempo and effects are project-wide. A scene holds steps, and which lanes and drums are muted or soloed (`scene.mutes`): `captureScene` records them and `applyScene` puts them back on the lanes and the drum state, so everything else still reads `muted` and `solo` where it always did. A scene saved before this holds none and leaves the lanes as they are.
- A song export applies each scene's mutes bar by bar (`applySceneMutes` empties the silent lanes, `sceneDrumState` carries the drum flags) and then hands the lanes to the exporter unmuted. Never filter a song export by the open scene's mutes.
- In song mode the scheduler picks the scene from the transport's bar number (`sceneAtBar`), plays any scene other than the open one from its stored copy, and asks the store to open the playing scene with `localService.selectScene`, a plain call. It emits synchronously, and the `sceneChanged` handler updates the refs the scheduler reads straight away; keep both true or a bar would play the wrong scene.
- Every edit inside a project is a typed operation (`docs/TYPED_STORE_PLAN.md`, done). An edit is an `Operation` handed to `localService.apply`, usually through a one-line typed helper such as `setDrumSwing`. `apply` is synchronous and must never be `async`: the event has been delivered before it returns. It answers `{ ok, value }` or `{ ok: false, status, error }` and does not throw for a refusal; it throws only before the project is initialized. `reducers` has one reducer for every operation, and the compiler fails if one is missing. Reads are `getScenes`, `getTempo`, `getDrumKits` and `snapshot()`. Several edits that must land together go in one `applyAll`.
- Reducers (`projectReducers.ts`) only change the state they are handed and say what to save and send. They never emit, save or read the clock; `apply` does the first two and `write()` stamps the time. `useStudio` does not set its own state before calling a typed helper: the event is the one place a value is applied, and it carries the value as the store kept it (a drum master volume is held to 0 to 1). `storeEdits.test.ts` pins what each operation answers, emits and saves, and `storeOps.test.ts` holds each typed helper to it.
- What is in an operation is the caller's own objects, not the fresh parse of JSON a route's body was. A reducer never keeps one in the project as it is, and reads an object in an operation (a patch, a whole state) only through `sent` in `projectReducers.ts`, which is that trip through JSON: without it a key that is `undefined` counts as sent, and `{ state: undefined }` deleted a guest's settings. A reducer also refuses an id it is handed that is malformed or taken.
- A lane's sound reaches the audio in one place: the `synthUpdate` case of `useStudio`'s message switch, which calls `synthAudio.updateParameters`. A knob, a macro, a preset, undo and Reset all get there by calling `localService.setSynthParams`; apart from a project being opened and the last step of Reset, nothing else sets `synthParams` on a lane, and nothing new should. A lane's octave and keyboard (`setSynthPrefs`) are saved without an event, so they alone are still set on the lane by the handler that changes them.
- The drums on screen are set in one place, the `drumFullState` and `drumKitChanged` cases of `useStudio`'s message switch, which also write `drumStateRef` so the scheduler and a handler making a second edit before React has rendered see the first. A drum handler never calls `setDrumState` itself. Undo does not read that ref: `getSnapshot` reads `drumsForUndoRef`, the drums as last rendered (or as a scene change left them), because a pattern tool makes many edits in one click, each pushes an undo entry, and all of them must hold the drums from before the first or one undo would take back one step. Do not write `drumsForUndoRef` from the drum events.
- A lane's pattern is written only through `localService.writePattern` and set on screen only by the `patternCreated` and `patternUpdated` cases of `useStudio`'s message switch, which also move `synthsRef` (`commitPattern`), so a handler making a second edit before React has rendered, such as the next painted cell, builds on the first. A handler still sets what the event cannot carry (`selectedStep`, `stepRecordPointer`, the playhead). Undo's `getSnapshot` does not simply read that ref: for a lane a pattern event has moved on it reads `lanesBeforeEditRef`, the lane from before the first such edit since the last render, so a MIDI import that writes one lane twice is one undo. The two painting writers (`handlePianoRollNoteAssign`, `upsertStepNote`) forget it after each write, so each painted cell is its own undo entry. Keep every `pushHistorySnapshot` before its write.
- Up to 3 synth lanes; Synth 1 cannot be removed. A bar is 16 steps, or 32 on a synth lane set to finer steps; the drum grid is always 16 per bar.
- A lane's pattern and the drum grid can each be 1, 2, 4 or 8 bars (`Pattern.bars`, `Scene.laneBars`; the drum grid's length is its step count over 16). Lanes of different lengths loop against each other. `patternLength.ts` holds the arithmetic. A 32-step pattern is one fine bar unless `bars` says two: never infer bars from the step count alone, use `laneBars`.
- A scene lasts as long as its longest part (`sceneBars`). In a song, one repeat of an entry is one pass through its scene, however many bars that is. The song helpers take a `lengthOf` function because the open scene's length has to be read live (`sceneLength` in `useStudio`).
- Everything that renders works one bar at a time. `sceneAsBars` cuts a scene into one-bar scenes, each lane looping at its own length, and WAV, MIDI and the shared-song page all go through it. Do not teach an exporter about multi-bar patterns; slice first.
- The editors show one bar of a longer pattern (`firstStep`, `visibleSteps`); step numbers in labels and in state are always counted from the start of the pattern.
- The step controls under a lane are always laid out, hidden when no step is selected, so selecting a step never changes the row's height. A height change there moves the piano roll under a pointer that has just pressed a cell.
- Undo/redo is one chronological stack for the whole project (`historyRef` in `useStudio.tsx`). Each entry stores one lane plus the shared drum, tempo and effects state. Loading a saved arrangement clears it. `applySnapshot` puts an entry back with one synchronous `applyAll` and nothing awaited in it; `stepHistory` still waits one turn after it opens another scene, which nobody has yet shown to be needed.
- A tempo-synced LFO rate `N` means one cycle per 1/N note (`syncedLfoHz`). Live playback and WAV export both use it.
- Live playback and WAV export run the same `SynthCore` and `DrumCore`. Never add DSP to the worklet wrapper or to `wavExport.ts`; put it in the engine core so both paths get it.
- Drum voices are summed linearly and the master limiter only acts near full scale. Do not add saturation to the drum bus or lower the limiter threshold: that is what made simultaneous drums duck each other.
- New `SynthParameters` fields must be optional in the type, present in `createDefaultSynthParameters()` with a neutral value, and clamped in `sanitizeSynthParams`, so older saved projects load unchanged. Bump `SCHEMA` in `localService.ts` when adding one.
- The lanes labelled Low Tom and High Tom are the `snare2` and `ride` instrument ids, kept for saved-project compatibility.
- A step can hold a chord and last several steps. `note` is the lowest note and `notes` the rest (up to six in all); `length` is in steps and absent means one. Never read `step.note` to find what a step plays: use `stepNotes(step)`, and change a chord with `withStepNotes` so the order and the limit hold. With the arpeggiator on, a chord is arpeggiated through its own notes.
- A step also has optional `probability` (chance), `ratchet` (repeats across the step's length) and `offset` (how late it starts, as a fraction of a step, which is how a note sits between steps). `withStepNotes` drops all of them when a step is emptied. `expandStepNotes` takes a `random` argument: pass `seededRandom` in exports.
- A note's length is dragged by the handle on its last piano-roll cell. The handle moves as the note grows, so the drag is followed by listeners on `window`, not on the handle.
- The shared delay can follow the tempo (`delay.sync`, a note value). `delaySeconds` in `delayTime.ts` is the one place that turns it into seconds, for live playback (`setEffectsTempo`) and export. `sync` is optional and absent when off, so older projects still match the expected shape.
- The chorus, the master EQ and the reverb's pre-delay and damping came after the first four effects. They are optional in `EffectsLoopState` and must stay out of the defaults passed to `localService`: `restore()` reports a project as damaged when its effects do not match the defaults' shape. `sanitizeEffects` adds them back by hand, and `effectSettings.ts` holds what the controls show until they are set. Only a new project (`blankState`) starts with a shaped reverb.
- With no pre-delay and no damping `reverbImpulse` is the original impulse, sample for sample, and a flat EQ is left out of an export altogether, so older projects render as they did.
- `createChorus` and `createMasterEq` in `browserAudio.ts` build those effects for live playback and for export. The EQ is on the whole mix and works with the effects loop off.
- The `vibrato` LFO target is the `pitch` target scaled to one semitone at full depth. `pitch` is still an octave, so stored sounds are unchanged.
- Two exports of the same project can differ in a few samples by one step of a 16-bit file: the browser's offline renderer rounds a kick through the reverb differently from run to run. Browser tests that compare exports allow for it (`same` in `effects.spec.ts`).
- MIDI output is sent from the scheduler (`triggerStep`, the drum loop and the top of `scheduleTick`) with time stamps from `midiTime`, which turns an audio-clock time into Web MIDI's clock. Synth lane N is channel N, drums are channel 10 with the notes MIDI export uses, and clock is three pulses per transport tick with start and stop. The chosen output and what it is sent are session settings, not saved with the project. Notes played by hand are not sent, only the sequencer.
- A MIDI file is imported at the smallest of 1, 2, 4 or 8 bars that holds it (`barsFor`), the same length for every track; anything past eight bars is left out and the dialog says so.
- The piano roll paints while a pressed pointer moves. It ignores cells that arrive under a pointer that has not moved (selecting a step can shift the layout), or one click would add a second note.
- A step's `slide` flag holds its note into the next step; a mono lane then glides instead of retriggering. Accent is step velocity routed to the filter (`velocity.filter`).
- There is no common format for synth presets, so `presetImport.ts` has one translator per source format, each written from that synth's real parameter definitions, and returns a list of what did not carry over. Add a format by adding a translator and a detection rule; never guess at an unknown file. Every result goes through `sanitizeSynthParams`.
- `.rack-page` is the page's scrolling area (the window itself does not scroll), which is what lets the transport unit be `position: sticky`. Keep the page's top padding at zero, or scrolled content shows above the bar.
- At 720px wide and under, one block at the end of `rack.css` rearranges the rack for a phone: units stack their parts, the step grids go eight to a row (`.step-row` sets its columns inline, so that rule needs its `!important`), menus rise from the bottom, dialogs fill the screen, and safe-area insets are respected. It is the same components and the same markup; add narrow-screen rules there and nowhere else. `phone-layout.spec.ts` checks it, and that a wide screen is untouched.
- A phone on its side is wider than 720px and very short, and gets the same arrangement: the block's condition, and `useNarrow`, also match a screen up to 960px wide and 500px tall that is wider than it is tall. Keep the two the same. A second, smaller block after it gives height back on that screen (a lower bar of units, sixteen steps in a row, the piano roll's heading on one line). `Walkthrough` still places its card by width alone.
- On a narrow screen the top bar wraps over several lines, and only the last, with the tempo and Play, stays stuck: `TransportUnit` measures the lines above it into `--transport-tuck` and the bar's `top` goes negative by that much. Anything that needs another part of the bar on screen must scroll the page to the top first, as the walkthrough does.
- `useWakeLock` keeps the screen on while anything is playing, where the browser allows it.
- A narrow screen shows one unit of the rack at a time, chosen from the bar along its bottom (`UnitBar`, rendered only when `useNarrow` says the screen is narrow). Which unit is view state in `Rack`, remembered per browser by `services/rackView.ts` and never in `useStudio`. `Rack` puts it on `.rack` as `data-shown`, every unit carries a fixed `data-unit`, and the phone block of `rack.css` hides the units that do not match. The units are not told which is on show, so none renders for a switch.
- A unit that is off screen is hidden with CSS and never unmounted. Its audio, its scheduler lane and its MIDI go on; its step lights go on being switched, so they are right when it is shown; and a guest's frame is the same frame, still sending sound. Do not turn this into conditional rendering: a guest would reload and lose what it was doing. All the guests are one unit (`guests`), and the bar offers it only when the project has one.
- The guests unit is the one unit not hidden with `display: none`. A page in a frame that is not rendered has its animation frames stopped and may have its timers slowed, and measures itself as nothing. So a guest that is not on show keeps its size, fixed to the top of the screen and clipped to nothing, with `pointer-events: none`; `Rack` sets `inert` and `aria-hidden` on it from a layout effect, since the unit itself is not told. `docs/GUEST_PROTOCOL.md` says what a guest may assume. Do not "simplify" this to `display: none` or `visibility: hidden`.
- The lane on show and the open lane (`studio.selectedSynthId`) are kept the same by one effect in `Rack`: if the open lane changed, the view turns to it; otherwise the view's lane is opened. A lane on show that was not open would have no editor, keyboard or piano roll. The walkthrough puts back the unit and the open lane it started from when it ends.
- "All" on the bar is the whole rack on one page, the first phone arrangement. The browser tests at phone width start with it remembered (`storageState` in `playwright.config.ts`), because they were written for a rack with everything on the page; only `phone-layout.spec.ts` forgets it and checks the paging. A new spec that depends on the paged layout must forget it the same way (`paged` in that spec).
- A switch on the bar moves keyboard focus into the unit it shows (the unit is given `tabindex="-1"` at that moment, not in its markup) and scrolls the page back so the unit starts under the stuck line of the transport. The bar's switches are named "Show …" so they are never mistaken for a lane's own name plate, which is a button called "Synth 1".
- A knob (`Knob`, `DrumKnob`) that is tapped with a finger or a pen opens `KnobSheet`: a `Dialog` docked to the bottom edge (`sheet`) with the value in large figures, a native range slider and a step button either side. It is the knob's own value, limits, step and handler; do not give it a second copy of any of them. A mouse never opens it, so a desktop is as it was. The sheet is put on `.rack-page` with a portal, so it lies over the rack from inside any unit and still has the rack's colours.
- `useKnobInteraction` decides what a touch is. A finger that moves less than `TAP_SLOP` is a tap and turns nothing; further, it is the same drag a mouse makes. The tap is acted on at its `click`, not when the finger lifts: opened any earlier, the sheet would be under the finger in time to receive that click. A tap does not always end in a click (the browser check saw a touch on a drum knob that ended with `pointerup` and nothing after), so it is also acted on `TAP_WAIT_MS` after the finger lifts if no click has come. Keep both.
- The scroll wheel turns a knob (`knobWheel.ts`, wired in by `useKnobInteraction`'s `ref`, so `Knob`, `DrumKnob` and the effects panel's knobs all have it). The listener is native because React's is passive and could not stop the page scrolling. A wheel event is the page's unless the pointer (a mouse) has rested on the knob `WHEEL_REST_MS` (the knob then has `data-wheel="ready"`) and the page was not being wheel-scrolled in the `WHEEL_GAP_MS` before; once a knob is turning, it keeps the wheel while events come within that gap. A notch is 2% of the range, at least one step; Shift is one step; one event never counts for more than one notch, and small trackpad events add up. A run of notches is one undo entry only because the handlers throttle history by the gap between changes (250 to 300 ms). The rest rule is a choice the roadmap left to the builder and the owner has not confirmed it. `knob-wheel.spec.ts` checks it; a test must wait for `data-wheel="ready"` before wheeling.
- A knob's hint (`tooltip`, `title`) is shown in its sheet, since a phone has no hover. Do not put anything a person needs only in a `title`.
- The on-screen keyboard tracks each finger on its own (`pointers` in `Keyboard.tsx`: pointer id to the note under it). A note stops when the last finger on its key leaves, so releasing goes through `leave`, never straight to `handleNoteUp`. A finger or pen that moves plays the key under it, looked up with `elementFromPoint` because its events keep arriving at the key it first pressed; a mouse holds the key it pressed, and with Hold on nothing slides. A key's `blur` lets go only if no finger is on it: a second finger takes the focus from the first one's key.
- A key held by a finger is also let go when the strip of keys changes width (a `ResizeObserver` in `Keyboard`). That is the only thing that says the lane's unit was switched away on the bar, since a hidden unit is not unmounted and no pointer event is sent, and it covers the phone being turned. Notes latched with Hold are left sounding, as they are when the page is scrolled away from them.
- On a narrow screen the keyboard is a strip of three octaves that shows one (two on a phone on its side), moved an octave at a time by the Lower keys and Higher keys buttons, which `Keyboard` renders only when the strip is wider than its box. The strip has `overflow: hidden`: it is moved by those buttons and by focus, never by a finger, because a finger that moves is playing.
- The piano roll on a narrow screen has every step of the bar in the page, as it does on a wide one, in a grid that shows some of them: `PianoRoll` counts how many fit at 44px or more (`ACROSS`), hands the count to the stylesheet as `--roll-fit`, and the Earlier steps and Later steps buttons move the grid's `scrollLeft` a beat at a time. Nothing is taken out of the page or hidden with `display`, so the playhead light, the arrow keys and every browser test that clicks a cell work as before. Which steps are on show is read back from the grid's scroll position, not kept as a second truth; keep it in the component.
- The roll's grid is never moved while a pointer is down on it (`pressing`): a step selected from the row of steps is brought on show, one selected by pressing a cell or a handle is not. Do not answer the grid's own `scroll` event by moving it either: a browser test's click scrolls a cell into view first, and a grid that then snapped would put a different cell under the click.
- Only the note names slide the roll, and only up and down: the cells have `touch-action: none`, so a finger on a cell is always editing and the page cannot scroll under it. It starts at its lowest octave, the one the octave setting names, whenever it is shown or the octave changes.
- What a finger does on the roll: on an empty cell it adds the note as it lands, as a mouse does, and paints if it moves. On a note that is already there it waits: lifted within `TAP_HOLD_MS` the note is taken out, moved further than `TAP_SLOP` it rubs out along its way, and held still it keeps the note and only selects its step. So a held finger changes nothing, the rule the knobs have, and the two constants are the knobs' own (`useKnobInteraction`). A mouse still acts at once on any cell; `controls.spec.ts` pins that a touch on an empty cell does too.
- A note's length handle is 20px wide on a narrow screen, under half of the narrowest cell, so the middle of a note is the note. A finger's drag on it is captured by the grid: the handle is unmounted as the note grows, and a finger's events would otherwise still be addressed to it. A finger that lands on the handle of a note one step long and lifts within `TAP_HOLD_MS` without moving `TAP_SLOP` was tapping the note, and takes it out (`tap` in `resizing`). Do not give the handle an `onClick`: React then marks it as something to click, and a browser steers a touch that lands near such a thing onto it, so a finger on the middle of a note was handed to the handle. The same goes for any small thing laid over a control a finger uses.
- A row of steps, the drum grid and the piano roll are each one stop for the Tab key (a roving `tabIndex`): the selected step, or the cell the keyboard was last on. `gridKeyTarget` in `rack/gridKeys.ts` says where an arrow key, Home or End goes in the step row and the drum grid, reading how many cells are on a line from where they are, so it is right at eight to a row. In a lane's row the arrow keys move the keyboard only while no step is selected; once one is, left and right walk the selection as before (the `window` listener in `SynthModule`, which the row stands aside for through `arrowsWalk`). The grid's handler calls `preventDefault`, which is what stops that listener walking a lane's selection for an arrow pressed in the drum grid.
- On a screen showing one unit, the walkthrough turns to the unit each stop is in (`onUnit`), found from the stop's selector by its nearest `data-unit`. A stop's part must stay inside the unit it belongs to.
- The UI is one rack read top to bottom. Synth step rows and the drum grid share the column widths `--plate`, `--side` and `--knobs` in `rack.css` so steps line up vertically; change them together.
- The walkthrough (`Walkthrough.tsx`) is the one overlay that is not a `Dialog`: it lights one part of the rack and puts a card beside it, or along the bottom of a narrow screen. Its card is `aria-modal`, which is what makes the piano keys and the step arrow keys stand down while it is up. It finds each stop by a selector in `STOPS`; renaming one of those classes or labels means changing the stop and `walkthrough.spec.ts` with it. A stop whose part is not on the page shows its card alone.
- The walkthrough starts by itself only after the recovery code of a new account, and only in a browser that has not had it (`walkthroughSeen`); Show the Walkthrough, in the account dialog and in Help, starts it at any time, signed in or not. Browser tests that sign up set `discobot_walkthrough_v1` first unless the walkthrough is what they test.
- A `Dialog` hands focus back to the button that opened it when it closes, after the layout effects of whatever replaces it, and focusing scrolls that button into view. Anything that opens as a dialog closes must place itself and take focus in a mount effect, with `preventScroll` (see `Walkthrough`).
- The playhead is not React state. The scheduler writes each lane's step to `playhead` many times a second; putting it in state rendered the whole rack on every step, which was most of the main thread's work while playing. Never set state from `scheduleTick` for something that changes every step.
- The step lights are classes that `usePlayheadMark` switches on the elements themselves: `on` for a step light, `active` for a drum step number, `current` for a drum step, `playing` in the piano roll. Each such element carries `data-step`, and those classes must not appear in its `className`, or React and the hook would fight over them. The hook puts the light back after every render of its component, with no dependency list on purpose: a render can replace the lit element. `playhead.spec.ts` fails if that is changed.
- A component that needs the position for something other than a light (which bar is playing, for Follow) uses `usePlayhead(lane, select)`, and renders only when what `select` returns changes.
- The browser tests run one at a time on purpose: specs reset the same accounts API, and the guest and MIDI clock tests time real audio. To go faster, run more than one Playwright at once on different ports (`PLAYWRIGHT_PORT` gives each its own app and API): `scripts/browser-tests.mjs` does it locally, and `ci.yml` gives each width a machine of its own. Do not raise `workers`.
- Builds must not overlap in one checkout. Every build rewrites `ui/public/audio-worklet.js` and then copies it, so two at once can ship half a file. The script starts its runs one after another for that reason, and tests them together.
- Test speed here depends on the machine more than on the tests. On a laptop on battery the same suite has taken from 9 to 15 minutes, and tests that time real audio fail when the processor is shared. Before reading a local failure as a bug, run that test again on its own.
- A message to an audio worklet is one of the types in `engine/src/workletMessages.ts`, sent through the typed `send` in its hook and read by the same type in `worklet.ts`. Add a message by adding it to the type first; do not call `port.postMessage` with a bare object.
- Every built-in preset has a `kind` (`presetKinds.ts`: bass, lead, pad, keys, pluck, effects), required by the type of `createBuiltInPresets`, and `createNamedSynthPresets` takes it from the name; a new built-in preset must be given one. The preset menu is built by `groupPresets`: a `<optgroup>` per kind that has presets, in that order, then "My presets" for anything a person saved or imported (they have no kind). Option names are unchanged, so a lane's menu is still found by the preset's name. `preset-kinds.spec.ts` holds the expected groups and what is in each; add to it with any new preset.
- The user's synth presets are read from `presetStore` after the page is up, not during the first render. Nothing is written back until they have been read (`presetsLoadedRef`), or the empty first list would replace what is stored. Anything else loaded this way needs the same guard.
- Publishing is `pages.yml`, and it does not run the tests. It starts when `ci.yml` ("Static app CI") finishes for a push to `main`, goes on only if every job passed, and builds the commit that was checked. Renaming the CI workflow means changing its name in `pages.yml` too, or nothing is published.
- `SynthModule`, `DrumModule` and `GuestModule` are wrapped in `tracked` (`ui/src/studio/tracked.tsx`), which hands them a view of the studio that notes what they read and renders them only when one of those values changes. So an edit to one lane does not render the others or the drums. Three things follow. A unit must not call a studio function while rendering, only from handlers and effects: a function's answer can change without anything the unit read changing. Pass a tracked unit props that stay the same when nothing changed (a lane is handed its own `synth`, because `studio.synths` is a new list after any lane's edit). And the view is not the studio: it cannot be spread or listed, only read by name. `rack-renders.spec.ts` counts renders and fails if a lane starts rendering for another's edit.
- Components take the `Studio` object and call its handlers. They hold only view state (open tab, selected drum, dialog open); anything that must be saved or undone belongs in `useStudio`.
- Fonts are bundled from `@fontsource`. The app must not load anything from another origin: it works offline and a browser test fails on any outside request.
- Each lane shows four knobs plus Level. For a synth model with macros those four are the macros; otherwise Cutoff, Reso, Env and Decay.
- Project edits are written to localStorage about 300 ms after the last one (`persist()` in `localService.ts`), and at once on `pagehide` or when the tab is hidden. Anything that must know the write succeeded (saving or deleting an arrangement, importing a project) calls `write()` directly. Tests that read storage call `flush()` or dispatch `pagehide` first.
- When another tab writes the project, this tab stops saving (`paused`) and shows a banner; the user picks which version to keep. Do not write to storage while paused.
- Kick ducking is Web Audio gain automation, not core DSP: `scheduleDuck` in `browserAudio.ts` is called by the live scheduler and by `wavExport.ts`, so both pump identically. Export gets its kick times from `drumHits`, the same list the drum render uses.
- Unison copies and the 24 dB second filter stage live in `SynthCore`. One unison voice and a 12 dB slope must stay bit-identical to the sound before they existed; a test checks it.
- The audio hooks return a stable object. Keep it that way: effects in `useStudio.tsx` depend on them.
- Octave shift range is -2 to +2 per lane and affects the on-screen keyboard, the piano roll range and the computer-keyboard piano.
- The computer keyboard plays notes with unmodified letter keys (matched by physical position, `event.code`). Any new single-key shortcut must use a modifier; tap tempo is Shift+T for that reason.
- Drum steps carry optional `stepProbabilities` and `stepRatchets` arrays next to `stepVelocities`. Anything that moves or copies drum steps must move all three.
- Exports must be repeatable: use `seededRandom` for anything random in WAV or MIDI export, never `Math.random`. That includes the reverb's noise (`reverbImpulse` takes a random source).
- A drum lane can play an imported sample instead of its synthesized voice (`DrumTrack.sampleId`). The sample is played by `DrumCore` (`setSample`), so playback and export match; it is one channel, at most ten seconds, and skips the kit's colouring. `drumSamples.ts` decodes and caches by id; `useStudio` keeps the decoded samples for the worklet and for export.
- Samples live in this browser's sample store and travel only inside a saved project file. A lane whose sample is not on the device plays its synthesized voice and says so; never treat a missing sample as an error.
- A saved project file carries the audio of every sample its drum lanes use, as base64 in a top-level `samples` list beside `project` (`projectSamples.ts`). `handleExportProject` adds it with `embedSamples` and `handleImportProjectFile` takes it out with `adoptSamples` before the file reaches `importProject`; nothing else may do either. `sampleId` exists only on `drumState` lanes, which are project-wide, so a lane silent in the open scene still counts. Give `usedSampleIds` and the renaming in `adoptSamples` any new place a sample id is stored.
- A sample from a file is the same sample when its bytes are the same; the id is only what the lanes call it, and a file can say anything. Audio already in the store is not stored again (the lanes are pointed at the copy that is there), and an id already taken by different audio is never overwritten (the incoming sample gets a new id and the lanes follow).
- Embedded audio is untrusted and bounded: 4 MB a sample, 12 MB and 32 samples a file, an audio type or file name, valid base64. Anything else is dropped, the project still opens and the user is told how many were left out. The file is kept under the 20 MB an import accepts, which is also the limit in versions before this, and an older version reads only `project`, so it opens a new file with its samples missing. Do not raise the caps past that limit or move `samples` inside `project`.
- Import Kit puts several sample files on the drum lanes at once. `matchKit` reads only the file names, so every guess is shown in the dialog and can be changed; nothing is stored or changed until it is confirmed, and only files given a lane are stored. Add a naming convention by adding to `guess` in `kitImport.ts` and a name to its test.
- No drum machine's recordings are bundled with the app. The owner decided this on 2026-10-09: no LinnDrum, DMX or TR-707 recordings were found that the project is clearly allowed to redistribute. The kits with those names in the kit menu are synthesized. Do not add recordings without the owner's say-so and a checked licence.
- `localService.exportProject()` / `importProject()` are the project file format (`format: 'discobot-project'`). Import goes through the same `restore()` sanitizing as a reload; never trust a file's contents. `exportProject()` is also what share links, published songs, sync and sharing are made from, so it must never hold audio: only the saved file gains its `samples`, in `useStudio`.
- The service worker serves hashed files under `assets/` cache-first and everything else network-first. Keep unhashed files (the page, `audio-worklet.js`) network-first, or an update would pair a new app with a stale worklet.

## Colours and States
The rack's colours are named in `rack.css` (on `.rack-page`) by the job they do. A new control
picks from these names and never writes a colour out; if no name fits, add one there and to this
table. The names from before (`--amber`, `--ink`, `--legend`, `--dim`, `--well`, `--rail`,
`--unit-top`, `--unit-bottom`) still work and point at these; do not use them in anything new.

| Job | Name |
|-----|------|
| Behind the rack; the rack's frame | `--surface-page`; `--surface-rail` |
| A unit or a dialog | `--surface-panel` (a gradient of `--surface-panel-top` and `-bottom`) |
| A box inside a unit (the sound editor, an effect, a row of a list) | `--surface-inset` |
| A button's face, a menu | `--surface-control`, and `--surface-hover` under a pointer where there is no edge to lighten |
| An empty step, a slider's track | `--surface-well` |
| Somewhere to type or choose | `--surface-field` |
| Behind lit figures (the tempo) | `--surface-display` |
| A line round a unit; a stronger one; a fainter one; a control's; an empty step on a beat | `--edge`; `--edge-strong`; `--edge-faint`; `--edge-control`; `--edge-beat` |
| A name, a heading, what was typed | `--text` |
| A sentence, a word on a button | `--text-plain` |
| A label beside a control | `--text-label` |
| A caption, a hint, a disabled word (4.5 to 1 on a panel, no fainter) | `--text-faint` |
| A word on anything lit | `--text-on` |
| On, open, or holding something: a step with a note, a pressed-in toggle, mute, the open scene, the open lane's edge, a lamp | `--on`, with `--on-bright` (its lighter edge, and its face under a pointer), `--on-glow` and `--lamp-off` |
| A figure being read out: the tempo, a knob's value and pointer, a count | `--value`, `--value-glow` |
| The one main button of a bar or a dialog (`.rack-btn.go`) | `--action` |
| Keyboard focus | `--focus`, held off the control by `--gap` |
| The selected step | `--select`, with a line of `--gap` under it |
| A pointer over a control | `--hover` (its edge) |
| Something that deletes or has failed | `--danger` |
| A drum lane | `--drum-kick`, `--drum-snare`, `--drum-clap`, `--drum-closed-hat`, `--drum-open-hat`, `--drum-low-tom`, `--drum-high-tom`, `--drum-cymbal`; a row carries `data-drum` and reads its own as `--drum-color` |

- Amber means two things only: this is on or holds something (`--on`), and this is a figure (`--value`). It is not for emphasis, headings, hover or focus. The two have the same colour today and are separate names so that either can change.
- Four states look different, and `state-looks.spec.ts` holds them apart. **Focus** is a 2px white ring 2px outside the control with a dark gap between (`.rack-page :is(...):focus-visible`), the same on everything; a new kind of focusable thing must be added to that rule's list. Where a ring outside would be cut off or lie under a neighbour (menu rows, song blocks, piano keys, the piano roll, the bar of units) the ring and gap are drawn inside the edge; add to that second list for anything in a clipped strip. **Hover** is a lighter edge (`--hover`), an underline where there is no edge, and a lighter face on something lit, the last only under `@media (hover: hover)` because a touch screen keeps a hover after a tap. **Selected** (a step the controls below act on) is a frame inside the step's own edge. **On** is an amber face with a dark word, for every toggle and every "this one is open"; the bar of units on a phone shows it as a lit lamp instead.
- The focus ring's gap and the selected frame are both `box-shadow`, so a rule that gives a focusable thing a shadow of its own must say what it looks like focused as well (see `.step-cell.selected:focus-visible`), or focusing it would drop one of them.
- The older components' own stylesheets (`PianoRoll.css`, `Keyboard.css`, `KeyboardPanel.css`, `SynthControls.css`, `EffectsPanel.css`, `MidiPanel.css`, `Knob.css`, `DrumKnob.css`) are not on these names yet; that, and sizes and corners, are parts 2 and 3 of redesign C in `docs/DESIGN_REVIEW.md`. Kids mode has its own look and none of this applies to it.

## Drum Instrument Details
| Instrument | Tone range | Extra knob | Engine function |
|------------|-----------|------------|-----------------|
| Kick | Start freq 60-240Hz | Decay 80-500ms | `renderKick` |
| Snare | Body freq 150-300Hz | Snappy 0-1 | `renderSnare` |
| Open HH | Brightness 0.3-1.0 | Decay 50-500ms | `renderOpenHH` |
| Closed HH | Brightness 0.4-1.0 | Tight 0-1 (durations 100-15ms) | `renderClosedHH` |
| Ride | Fund freq 800-4000Hz | Bright 0-1 | `renderRide` |
| Crash | Brightness 0.2-1.0 | Decay 0.2-1.2s | `renderCrash` |
| Snare 2 | Body freq 200-400Hz | Snappy 0-1 | `renderSnare2` |
| Clap | (not used) | Room 10-90ms | `renderClap` |

## Commands
```bash
npm ci               # Install locked dependencies
npm run dev          # Browser UI only
npm run build        # Build engine and UI
npm start            # Static production-build preview
npm run typecheck    # No build needed: the UI resolves the engine from source
npm test             # Node unit tests (engine + UI services)
npm run test:browser # Playwright against the production preview and a local API
npm run test:browser:fast # The same tests as two runs side by side, desktop and phone width
npm run dev:api      # The accounts API on http://127.0.0.1:8787, in memory
npm run deploy --workspace=server   # Publish the API (needs `npx wrangler login`)
npm run migrate --workspace=server  # Apply new database migrations to the live database
```

## Conventions
- No comments in code unless explaining non-obvious logic
- `DrumState` always initialized with `createDefaultDrumState()` (never null)
- Engine types are single source of truth (`engine/src/types.ts`), UI re-exports via `ui/src/types.ts`
- All project mutations go through `localService`: a typed helper over `apply` (`docs/TYPED_STORE_PLAN.md`). Add an operation, its reducer, its `OP_META` row and a case in `storeEdits.test.ts` and `storeOps.test.ts`. Components do not write localStorage directly
- Sanitize anything read from storage in `projectSanitization.ts` before it reaches audio code
- The app must work fully with no account and with the API unreachable. Signed out, it makes no request to the API at all, with one exception the visitor asks for: opening a short link (`#s=code`) fetches that published song. A browser test checks both
- The API stores a username, password hash, recovery-code hash, join date and invite code, and nothing else: no email, no names, no IP addresses. Do not add personal data, analytics or logging of request contents
- Passwords, session tokens and recovery codes are stored only as hashes and never logged. PBKDF2 is capped at 100,000 iterations by Cloudflare
- The API is called with a bearer token, not cookies, and only answers origins in `ALLOWED_ORIGINS` (`server/wrangler.toml`)
- `server/` has no runtime dependencies and `wrangler` is run with `npx`, not installed, to keep the lockfile small
- Do not reintroduce Discord integration or a WebSocket transport

## Project Sync
- The browser copy is the working copy. The account holds a copy of each synced project with a revision number; a save names the revision it was based on and is refused (409) if the account has moved on.
- Nothing is merged and nothing is overwritten. A project changed in two browsers is kept twice: this browser's edits move to a new project (`syncFork`) and the account's version is downloaded under the original id.
- "Changed" is decided by `contentHash` of the project in `normalized()` form, never by the local revision number, which goes up on every write. Keep volatile fields out of the hash, or opening a project would upload it.
- Sync never infers a deletion from a project being absent, because lost browser storage must not empty the account. A delete reaches the account only through `projectSync.noteDeleted`.
- Signing in uploads nothing that was already in the browser; those projects are listed as "this browser only" until the user adds them. Projects made while signed in are the account's.
- Sync state is in `localStorage` under `discobot_sync_v1`, per username. Signed out, `startProjectSync` sends nothing.
- The server stores projects as sent and checks only size and shape. Whatever the browser downloads goes through `restore()` like a project file.
- Imported samples are not synced. `fileFor`, `contentHash`, the working copy, the library and kept versions hold a sample's id and never its audio; a test in `projectSamples.test.ts` checks each. Syncing samples needs file storage on the server.

## Working Together
- Two people work on one project in turns. There is no live connection and no merging: the owner shares a synced project by username, and the people it is shared with read and save the owner's copy under the same revision rule as everything else. This was chosen over live editing because a held-open connection is ruled out below; changing that is the owner's decision.
- A shared project stays in the owner's account. It is never copied into a member's account, and it only enters a member's browser when they open it from "Shared with you" (`projectSync.join`). Do not download someone else's project unasked.
- `createProjectSync` settles a project against a `Place`: this account (`/projects`) or the owner's copy (`/shared/<owner>/<id>`). `settle` is the one implementation of the rule for both; do not write a second.
- When both people changed a shared project at once, the one who syncs second keeps their edits as a project of their own (`syncFork`) and receives the other's version. Nothing is overwritten.
- When sharing ends (unshared, the project deleted, an account removed) the member's copy stays, as a project of this browser only. Deleting a shared project as a member only removes it here and leaves; only the owner's delete reaches the account.
- A server that has never heard of `/shared` answers 404. Sync reads that as "nothing is shared" and leaves every link alone; it must not read it as everything having been unshared. The accounts API is deployed by hand, so the site can be ahead of it.
- Sharing stores which account shared which project with which, and which account saved a project last (`project_shares`, `projects.updated_by`). No names, messages or activity beyond that.
- With anything shared, sync looks for changes every 20 seconds instead of every two minutes (`CHECK_SHARED_EVERY_MS`).

## Guest Instruments
- A guest is another creator's web page in a frame (`GuestModule`), listed in the project as `guests`. The protocol is `docs/GUEST_PROTOCOL.md`; `docs/guest-example.html` is a complete guest, and the browser tests run against it (served by `server/dev.ts` at `/__guest`). Change the three together.
- A guest's address must be https on another site (`guestUrl`). Discobot's own origin is refused: the frame is only kept apart from the app because it is a different site. Do not loosen this or the frame's `sandbox`.
- A guest is never loaded without the user's say-so for that site on this browser (`isTrustedOrigin`). Typing the address in counts; a guest that arrives in a shared or synced project asks first. This is the one place the app loads anything from another site.
- Messages are accepted only from the guest's own frame at its own origin, and everything in them is untrusted. The guest's `state` is opaque JSON, size-capped, never interpreted.
- Timing uses the computer's clock, which the frame and the app share. The guest plays early by a latency and `createGuestPlayer` holds its audio back by the same amount. The latency starts at `GUEST_LATENCY_MS` and is per guest: how long audio takes to cross from the frame differs between browsers, so a block that arrives after its time is still played at once (late, not silent), and after a run of them the latency is raised by what was missing and the guest is sent `hello` again with the new value.
- With guests connected the transport places its first beat further ahead (`guestLink.startLead`): the largest latency plus reaction time, or longer for a guest that has not been started since it loaded.
- A guest's settings belong to the scene, like a lane's steps. `guest.state` is the open scene's; `captureScene` copies it into `scene.guests` and `applyScene` copies it back, and `GuestModule` sends `setState` whenever the state changes from outside the guest (a scene opened, a song moving on, sync, a restore). A scene made before a guest was added holds nothing for it, and the guest carries on as it is.
- A guest is only asked for its settings every few seconds, so anything that leaves the open scene on the user's say-so must first `await guestLink.captureAll()` (see `sceneRequest`). Without it, a change made just before switching is recorded late, in the scene switched to. A scene change also always re-sends the scene's settings to the guest and starts a new epoch, even when the settings are unchanged.
- A guest's level and mute are per scene too (`scene.guestMix`). Its effect sends (`guest.sends`, absent when all are zero) are project-wide, like a lane's.
- A song export gives each guest its scenes' levels bar by bar (`guestBarGains`, passed to the renderer as a take's `gains`) and records every guest that any scene of the song plays. Never decide which guests to record, or how loud, from the open scene.
- Questions to a guest carry an epoch that goes up whenever it is sent settings. An answer from an earlier epoch describes settings the guest no longer has and is ignored; without that, a late answer would be saved into the wrong scene.
- `GuestModule` handles a message for every block of audio, many times a second. Nothing on that path may set React state; what the unit shows is refreshed on a timer.
- Do not use `window.confirm` for guest actions: a browser can be told to stop showing a page's dialogs, after which it silently answers no.
- A guest cannot be rendered offline, so every audio export (`handleExportWav`) first plays the arrangement through and records each guest (`guestCapture`, fed from `GuestModule`), then mixes the recordings into the normal render as `guestTakes`, through the guest's sends. Recordings are placed by the guests' time stamps against the transport's first beat. For Loop WAV the pattern is played twice and the second pass kept, and the renderer lays that pass end to end. Stems give each guest a file of its own. MIDI leaves guests out.
- `handleExportWav` is the wrapper that sets `exportStatus` (working, then done) and refuses a second export while `exportingRef` is set; the work itself is `exportWav`. The Export menu disables its four WAV items while one is working (`MenuItem.disabled`), and `Rack` shows the message. The renderer cannot report how far it has got, so the message says only that it is being made (Stems also name the file it is on). The first Export item is Scene WAV and the MIDI one Scene MIDI, to pair with Song WAV and Song MIDI; `export-progress.spec.ts` holds the render open (it wraps `startRendering`) to look at the message and the disabled items.
- Two recordings of a guest do not land on the same sample: a take can sit a millisecond or two early, and more on a slow machine. A test that compares two guest exports must not measure a fixed window that ends where a sound begins; measure something that does not move with the take (`quietest` in `guests.spec.ts`). The check run on GitHub failed for exactly this while passing on a faster machine.
- `FEATURED_GUESTS` lists instruments offered by name in the Add Guest dialog. Only add one with its creator's permission. Tape Loop Deck is on hold and off the list by the owner's decision (2026-10-10); it can still be added by its address. Do not put it back without asking.

## Kids Mode
- Kids mode is a page of its own at `#kids`, for a child too young to read. `App` chooses it before `useStudio` runs, so the project store is never opened and nothing there can change, delete, share or publish a project. Keep it that way: do not import `localService`, `account` or anything that reaches them into `ui/src/kids/`. Going in (Project menu) and coming out both reload the page. The three-second hold is the only way out, so kids mode lasts for the whole visit to a tab (`keepKidsMode`, a flag in `sessionStorage`): going in replaces the address and adds no page to go back to, and an address changed while in kids mode is put back. Only `leaveKidsMode` clears it. The page cannot stop Back from leaving the site altogether.
- There are two activities, each a screen, and one is shown at a time: the pads, and the beat grid. The way between them is two drawings at the top left (`SCREENS` in `KidsPage.tsx`), not words. Play, the speed and the level are shared, and both keep playing whichever screen is open.
- What a child makes is kept under its own key (`discobot_kids_v1`) and read back through `sanitizeKids`: `notes`, two bars of eighth notes for each pad; `beat`, one bar of eighth notes for each row of the grid; and the sound, the speed and the screen last open. It is not a project and cannot be opened as one; whether it should be is the owner's to decide.
- The key is still `_v1` because what the first version stored still loads: `sanitizeKids` fills anything missing with its empty value. A stored tune names a pad and a sound by its place in `KIDS_PADS` and `KIDS_SOUNDS`, so add to the end of those lists and never reorder them. Where a pad sits on the screen is `KIDS_PAD_ORDER`. A test holds the first nine pads and four sounds in place.
- Nothing on the page needs reading: no text fields, menus, dialogs, sliders or links, and a browser test checks there are none. The one line of text, "Hold to leave", is for the adult, and that button only works held for `KIDS_LEAVE_HOLD_MS`. New pictures are emoji or SVG drawn in the component; nothing is bundled for them.
- A pad acts on `pointerdown`, not on click, so it sounds as it is touched. While the loop plays, a tap is also kept on the nearest step (`stepNearest`), and the loop skips that step once because the tap has already played it.
- The note pads are eight notes of one five-note scale, so no two clash, and there are four drum pads. The level is fixed at `KIDS_VOLUME` and there is no volume control. The six sounds were set by reasoning, not by ear.
- Each row of the beat grid is the drum of one pad (`KIDS_BEAT_ROWS`), with that pad's picture and colour. `padSounds` is the one place that says whether a pad plays on a step, from the taps and the grid together, and both the scheduler and the lights use it; that is why a drum in both is one hit, not two. A hole sounds as it is filled, not as it is emptied. The sponge wipes only the screen it is pressed on.
- The grid's markup is one instrument after another, a picture then eight holes. CSS alone turns it: instruments are rows on a wide screen and columns on a tall one (`orientation: portrait`), where eight holes across would be too small to touch. The pads are three across on a tall screen and four across otherwise.
- The lights follow the playhead rule. The scheduler writes the step to `playhead` under the lane `'kids'`, and one layout effect in `KidsPage` switches `now` on the dots and the grid's holes and `lit` on the pads, found by `data-step`, `data-beat` and `data-pad`. Those two classes must not appear in a `className`, and the effect has no dependency list on purpose.
- A first visit starts with a drum and a clap in the beat grid and no tune (`starterKids`).
- Kids mode makes no request to the accounts API or to any other site, signed in or not. A browser test checks it.

## Published Songs
- Publishing stores a slimmed copy of a project on the server behind a ten-character code. It is always an explicit button press, never a side effect of sharing or syncing.
- Reading a song needs no account and returns the title, the publisher's username and the project. Never add anything else about the publisher to that response.
- Publishing the same project again replaces the copy and keeps the code. Unpublishing deletes the row; the site owner can unpublish any song.
- A published song is untrusted like any project file: `SharedSongPage` reads it through `readProjectFile`.
- Each person has a page of the songs they have published, at `#u=name` (`UserSongsPage`). The owner decided on 2026-10-10 that this is all there is: no page of everyone's songs, no browsing, no search and no list of people. Do not add one without asking. The page is reached by its link, from the publisher's name on a song's page, or from Share Link, where a signed-in user copies the link to their own.
- `GET /users/<name>/songs` needs no account and answers `{ author, songs: [{ code, title, updatedAt }] }`, newest first. Never add anything else to it: no project ids, join date, counts or anything about projects that are not published.
- A username nobody has, one with nothing published and text that could not be a username all get the same `{ songs: [] }` with status 200, from one query, and `author` is only there when there are songs. Keep it so: the route must not tell anyone which usernames exist.
- Opening `#u=name` is the second request a signed-out visitor can cause, after opening a short link, and like it is one the visitor asked for. It is sent without the session token even when signed in. A link that could not name a username sends nothing. `user-songs.spec.ts` checks both.
- The list is other people's text: `readUserSongs` keeps only codes, titles and times of the right shape, caps the titles and the count, and shows the name that was asked for unless the server returns the same name in other capitals. Titles are rendered as text.
- `App` chooses the page before `useStudio` runs, as it does for kids mode, and moving between it and any other page reloads. The songs on it are plain links to `#s=code`.
- A server from before the page existed answers 404 for the route, and the page then says such pages are not available yet. The accounts API is deployed by hand, so the site can be ahead of it; a server that cannot be reached gets a different message and a Try Again button.

- Names: a drum has one name (`LABELS` in `DrumModule.tsx`: Kick, Snare, Clap, Closed Hat, Open Hat, Low Tom, High Tom, Cymbal), shown whole on the grid, in its hint, to a screen reader and in Import Kit. The grid's name column is 64px wide (`--side` is that plus mute and solo, so it is 120px) and wraps on a phone. A knob's visible label may be shortened only where it cannot fit, as the lane's "Reso", and then carries the whole word as its hint; its accessible name is always the whole word. A lane says its model's name (`Generic`) under its own name. `matching-names.spec.ts` checks that none of these is cut off.

## Known Issues
- The typed store is finished (`docs/TYPED_STORE_PLAN.md`). What it left open: an edit that changes nothing still saves and emits; one step of the drums still sends the whole drum state; `synth.create` and `scene.replace` make an id inside the reducer; undo and the song scheduler do not collect the guests' settings before leaving a scene. The plan's account of pull request 8 lists them
- `useStudio.tsx` is about 2,300 lines and owns most state; the UI is separate from it, but the state itself is not yet split by concern
- Firefox/Safari lack Web MIDI API support

## Potential Next Steps
- Split `useStudio.tsx` into hooks per concern (the typed store makes it possible), then undo in the store
- See `docs/ROADMAP.md` and `docs/STORAGE_AND_ACCOUNTS_PLAN.md`
- Use imported samples as a synth source, and sync samples (project files already carry them)

## Working Rules for Agents
- Skills for this repository are in `.claude/skills/`: `add-project-field` (anything stored), `ship-change` (checks, commits, pull requests) and `scripted-edits` (editing on Windows). Read the one that fits before starting.
- `docs/HANDOFF.md`, when it exists, says where unfinished work stopped. Read it first and delete it when that work is merged. Questions it leaves for the owner go to the end of `docs/ROADMAP.md` first.
- Reproduce a reported bug before fixing it, and see it fixed the same way afterwards. If it cannot be reproduced, say so; do not report a guess as a fix.
- Find another program's real definitions before translating its files or talking to it (its source, its parameter table). Do not infer units from field names.
- Anything bundled with the app must be something the project may redistribute. Do not add samples, fonts or data whose licence has not been checked.
- Changing which outside service a workflow or the app sends data to, or adding a secret, is the owner's decision. Ask first.
- Sound cannot be verified by tests. Say "not verified by ear" when that is the case.
- Pictures of the app, for a design review or to see what a change looks like, are taken on GitHub and never on this machine. `ui/test/browser/design-shots.spec.ts` walks the app at both widths and saves a screenshot of each screen into `test-results/`; it checks nothing and is skipped unless `DESIGN_SHOTS` is set, which `ci.yml` does only for a pull request whose branch name contains `design-review`. The pictures are then in that run's `test-results-chromium` and `test-results-mobile-chromium` artifacts (`gh run download`), each put together by the `results` job from the four machines that ran that width (the `browser` job is split with `--shard`; while it runs, a machine's own results are `test-results-<width>-<1 to 4>`), kept for a week, with a `skipped.txt` beside them listing any screen that could not be reached. Do not commit the pictures. Add a screen to that spec when the app gains one; `docs/DESIGN_REVIEW.md` lists what each picture is.
