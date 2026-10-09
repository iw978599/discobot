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
| `ui/src/App.tsx` | Five lines: calls `useStudio()` and renders `<Rack>` |
| `ui/src/studio/useStudio.tsx` | All app state and behaviour: synth lanes, transport scheduling, undo/redo, save/load, MIDI import/export wiring. Returns one `Studio` object; it renders nothing |
| `ui/src/rack/` | The whole UI. `Rack` stacks `TransportUnit`, three `SynthModule`s, `DrumModule` and the effects unit; `rack.css` holds the look and the shared column layout; `Dialog` and `Menu` are the only modal and dropdown |
| `ui/src/services/localService.ts` | In-process project store. `localRequest(path, options)` mutates state, persists to localStorage and emits events |
| `ui/src/services/projectSanitization.ts` | Validation and clamping for everything read from storage or saved arrangements |
| `ui/src/services/browserTransport.ts` | Look-ahead clock. One tick is a 32nd note; 16-step lanes and drums use every second tick |
| `ui/src/services/sampleStore.ts` | IndexedDB sample storage |
| `ui/src/services/drumSamples.ts` | Decodes a stored sample for a drum lane, once, mixed to one channel |
| `ui/src/services/projectLibrary.ts` | The project library: one IndexedDB record per project and a store of earlier versions, with an in-memory stand-in for tests and browsers without IndexedDB |
| `server/src/index.ts` | The whole accounts API: sign up with an invite, sign in, recovery codes, owner tools. `handle(request, env)` is a plain function, so tests call it directly |
| `server/src/secrets.ts` / `rules.ts` | Password hashing, tokens and codes; username and password rules |
| `server/src/localDatabase.ts` / `server/dev.ts` | An in-memory SQLite with D1's interface, and a local runner for it. Used by tests and `npm run dev:api`; never deployed |
| `server/migrations/` | The database schema. Add a new numbered file; never edit one that has been applied |
| `ui/src/services/account.ts` | Browser side of accounts: the session and every API call. `accountsEnabled` is false when the build has no `VITE_API_URL` |
| `ui/src/services/guests.ts` | Guest instruments: address and data checks, per-site consent, the shared-clock helpers and `guestLink`, which tells guests about the transport |
| `ui/src/rack/GuestModule.tsx` / `ui/src/hooks/guestAudio.ts` | The guest's rack unit and frame, and the player that brings its audio into the mixer |
| `ui/src/services/projectSync.ts` | Project sync: `createProjectSync` (the rules, tested against the real API handler) and `startProjectSync` (when it runs) |
| `ui/src/rack/AccountDialog.tsx` | Sign in, create account, recovery code, and the owner's invite codes and member list |
| `ui/src/services/shareLink.ts` | Share links: a project deflated into the URL after `#song=`, and short links (`#s=code`) to a song published on the server |
| `ui/src/rack/SharedSongPage.tsx` | The page a share link opens: renders the song to audio, plays it, offers a copy |
| `ui/src/services/wavExport.ts` | Offline arrangement render and WAV encoding: full mix, seamless loop, and per-lane stems zipped by `utils/zip.ts` |
| `ui/src/services/delayTime.ts` | `delaySeconds`: the shared delay's time, free or tempo-synced |
| `ui/src/services/drumScheduling.ts` | `expandDrumStep`: the hits one drum step plays (chance, repeats); used live and by WAV and MIDI export |
| `ui/src/hooks/useComputerKeyboard.ts` | Computer-keyboard piano for the selected lane |
| `ui/pwa/service-worker.js` | Service worker template. `vite.config.ts` fills in the build's file list and emits it as `sw.js`; `main.tsx` registers it in production only |
| `ui/src/services/drumKits.ts` | Drum instrument list and kit metadata |
| `ui/src/hooks/browserAudio.ts` | Shared AudioContext, master limiter, parallel FX buses, sample playback |
| `ui/src/hooks/useSynthAudio.ts` | Per-lane AudioWorklet nodes, note start/stop, parameter flattening |
| `ui/src/hooks/useDrumAudio.ts` | Posts drum hits to the `drum-processor` worklet node |
| `ui/src/hooks/useMidiInput.ts` | Web MIDI input, per-device held-note tracking |
| `ui/src/audio/worklet.ts` | Worklet entry: thin `synth-processor` and `drum-processor` wrappers around the engine cores. `vite.config.ts` bundles it to `public/audio-worklet.js` (generated, gitignored) |
| `ui/src/services/songPlayback.ts` | Pure song helpers: `sceneAtBar` (which scene plays in a bar, and where in it), `songBars`, `sceneDrumState` |
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
- There are many projects. `localService` holds the open one, with a working copy in `localStorage` (written synchronously, so it survives a closing tab) and a record in the library that is updated after every write. Switching projects goes through `stash()` then `activate()`, which emits `init`. Project operations are async methods on `localService` (`newProject`, `openProject`, `copyProject`, `renameProject`, `deleteProject`, `importProject`), not `localRequest` routes.
- Each project keeps up to 20 earlier versions in the library (`keepVersion` in `localService.ts`): one when it is opened, one every five minutes of editing, and one before anything replaces it (a sync download, a restore). A version identical to the last one kept is skipped, compared in `normalized()` form. Anything new that overwrites a project must call `keepVersion` first.
- Versions are in this browser only: not in project files, links or sync. Deleting a project deletes them.
- Importing a file or opening a share link always creates a new project; nothing overwrites an existing one. Project names are unique.
- `savedPatterns` only exists to migrate arrangements saved by older versions into projects (`openLibrary`). Do not add to it.
- Share links and project files are untrusted. Both go through `restore()`; `readProjectFile` does that without opening the project.
- A project has scenes (every lane's pattern plus the drum grid, each one or more bars) and a song (scenes in order, with repeats). The lanes' patterns and `drumState` steps in the store are always the open scene; its slot in `scenes` is only brought up to date by `commitScene()`, which runs before anything reads `scenes`. Never read a scene's stored copy for the open scene: use the live pattern.
- Sounds, kit settings, mutes, tempo and effects are project-wide. A scene holds only steps.
- In song mode the scheduler picks the scene from the transport's bar number (`sceneAtBar`), plays any scene other than the open one from its stored copy, and asks the store to open the playing scene. `localService.request` emits synchronously, and the `sceneChanged` handler updates the refs the scheduler reads straight away; keep both true or a bar would play the wrong scene.
- Up to 3 synth lanes; Synth 1 cannot be removed. A bar is 16 steps, or 32 on a synth lane set to finer steps; the drum grid is always 16 per bar.
- A lane's pattern and the drum grid can each be 1, 2, 4 or 8 bars (`Pattern.bars`, `Scene.laneBars`; the drum grid's length is its step count over 16). Lanes of different lengths loop against each other. `patternLength.ts` holds the arithmetic. A 32-step pattern is one fine bar unless `bars` says two: never infer bars from the step count alone, use `laneBars`.
- A scene lasts as long as its longest part (`sceneBars`). In a song, one repeat of an entry is one pass through its scene, however many bars that is. The song helpers take a `lengthOf` function because the open scene's length has to be read live (`sceneLength` in `useStudio`).
- Everything that renders works one bar at a time. `sceneAsBars` cuts a scene into one-bar scenes, each lane looping at its own length, and WAV, MIDI and the shared-song page all go through it. Do not teach an exporter about multi-bar patterns; slice first.
- The editors show one bar of a longer pattern (`firstStep`, `visibleSteps`); step numbers in labels and in state are always counted from the start of the pattern.
- The step controls under a lane are always laid out, hidden when no step is selected, so selecting a step never changes the row's height. A height change there moves the piano roll under a pointer that has just pressed a cell.
- Undo/redo is one chronological stack for the whole project (`historyRef` in `useStudio.tsx`). Each entry stores one lane plus the shared drum, tempo and effects state. Loading a saved arrangement clears it.
- A tempo-synced LFO rate `N` means one cycle per 1/N note (`syncedLfoHz`). Live playback and WAV export both use it.
- Live playback and WAV export run the same `SynthCore` and `DrumCore`. Never add DSP to the worklet wrapper or to `wavExport.ts`; put it in the engine core so both paths get it.
- Drum voices are summed linearly and the master limiter only acts near full scale. Do not add saturation to the drum bus or lower the limiter threshold: that is what made simultaneous drums duck each other.
- New `SynthParameters` fields must be optional in the type, present in `createDefaultSynthParameters()` with a neutral value, and clamped in `sanitizeSynthParams`, so older saved projects load unchanged. Bump `SCHEMA` in `localService.ts` when adding one.
- The lanes labelled Low Tom and High Tom are the `snare2` and `ride` instrument ids, kept for saved-project compatibility.
- A step can hold a chord and last several steps. `note` is the lowest note and `notes` the rest (up to six in all); `length` is in steps and absent means one. Never read `step.note` to find what a step plays: use `stepNotes(step)`, and change a chord with `withStepNotes` so the order and the limit hold. With the arpeggiator on, a chord is arpeggiated through its own notes.
- A step also has optional `probability` (chance), `ratchet` (repeats across the step's length) and `offset` (how late it starts, as a fraction of a step, which is how a note sits between steps). `withStepNotes` drops all of them when a step is emptied. `expandStepNotes` takes a `random` argument: pass `seededRandom` in exports.
- A note's length is dragged by the handle on its last piano-roll cell. The handle moves as the note grows, so the drag is followed by listeners on `window`, not on the handle.
- The shared delay can follow the tempo (`delay.sync`, a note value). `delaySeconds` in `delayTime.ts` is the one place that turns it into seconds, for live playback (`setEffectsTempo`) and export. `sync` is optional and absent when off, so older projects still match the expected shape.
- The piano roll paints while a pressed pointer moves. It ignores cells that arrive under a pointer that has not moved (selecting a step can shift the layout), or one click would add a second note.
- A step's `slide` flag holds its note into the next step; a mono lane then glides instead of retriggering. Accent is step velocity routed to the filter (`velocity.filter`).
- The UI is one rack read top to bottom. Synth step rows and the drum grid share the column widths `--plate`, `--side` and `--knobs` in `rack.css` so steps line up vertically; change them together.
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
- Samples live in this browser only. A lane whose sample is not on the device plays its synthesized voice and says so; never treat a missing sample as an error.
- `localService.exportProject()` / `importProject()` are the project file format (`format: 'discobot-project'`). Import goes through the same `restore()` sanitizing as a reload; never trust a file's contents.
- The service worker serves hashed files under `assets/` cache-first and everything else network-first. Keep unhashed files (the page, `audio-worklet.js`) network-first, or an update would pair a new app with a stale worklet.

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
npm run dev:api      # The accounts API on http://127.0.0.1:8787, in memory
npm run deploy --workspace=server   # Publish the API (needs `npx wrangler login`)
npm run migrate --workspace=server  # Apply new database migrations to the live database
```

## Conventions
- No comments in code unless explaining non-obvious logic
- `DrumState` always initialized with `createDefaultDrumState()` (never null)
- Engine types are single source of truth (`engine/src/types.ts`), UI re-exports via `ui/src/types.ts`
- All project mutations go through `localRequest`; components do not write localStorage directly (synth presets in `useStudio.tsx` are the one exception)
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
- Imported samples are not synced.

## Guest Instruments
- A guest is another creator's web page in a frame (`GuestModule`), listed in the project as `guests`. The protocol is `docs/GUEST_PROTOCOL.md`; `docs/guest-example.html` is a complete guest, and the browser tests run against it (served by `server/dev.ts` at `/__guest`). Change the three together.
- A guest's address must be https on another site (`guestUrl`). Discobot's own origin is refused: the frame is only kept apart from the app because it is a different site. Do not loosen this or the frame's `sandbox`.
- A guest is never loaded without the user's say-so for that site on this browser (`isTrustedOrigin`). Typing the address in counts; a guest that arrives in a shared or synced project asks first. This is the one place the app loads anything from another site.
- Messages are accepted only from the guest's own frame at its own origin, and everything in them is untrusted. The guest's `state` is opaque JSON, size-capped, never interpreted.
- Timing uses the computer's clock, which the frame and the app share. The guest plays `GUEST_LATENCY_MS` early and `createGuestPlayer` holds its audio back by the same amount. When guests are present the transport starts with a longer lead (`GUEST_START_LEAD_SECONDS`) so a guest can catch beat 0.
- A guest cannot be rendered offline, so Download WAV and Song WAV play the arrangement through once and record each guest (`guestCapture`, fed from `GuestModule`), then mix the recordings into the normal render as `guestTakes`. Recordings are placed by the guests' time stamps against the transport's first beat. Loop WAV, stems and MIDI leave guests out.
- `FEATURED_GUESTS` lists instruments offered by name in the Add Guest dialog. Only add one with its creator's permission.

## Published Songs
- Publishing stores a slimmed copy of a project on the server behind a ten-character code. It is always an explicit button press, never a side effect of sharing or syncing.
- Reading a song needs no account and returns the title, the publisher's username and the project. Never add anything else about the publisher to that response.
- Publishing the same project again replaces the copy and keeps the code. Unpublishing deletes the row; the site owner can unpublish any song.
- A published song is untrusted like any project file: `SharedSongPage` reads it through `readProjectFile`.

## Known Issues
- `localService` still exposes a REST-shaped `request(path)` API with `Response` objects for edits inside a project, a leftover from the server version
- `useStudio.tsx` is about 2,300 lines and owns most state; the UI is separate from it, but the state itself is not yet split by concern
- Firefox/Safari lack Web MIDI API support

## Potential Next Steps
- Replace the REST-shaped facade with typed service methods and split `useStudio.tsx` into hooks per concern
- See `docs/ROADMAP.md` and `docs/STORAGE_AND_ACCOUNTS_PLAN.md`
- Use imported samples as a synth source, and include samples in project files and sync
