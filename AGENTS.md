# Discobot — AI Context / Restore Prompt

## Project Overview
Browser-only synth/sequencer/drum workstation with two npm workspaces. All project
operations, synthesis and playback run locally in the browser. No Discord account,
backend, authentication or WebSocket transport is required.

## Architecture
```
discobot/
├── engine/    # Browser-compatible TypeScript DSP and shared types
└── ui/        # React/Vite UI, Web Audio and local project/sample services
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
| `ui/src/services/wavExport.ts` | Offline arrangement render and WAV encoding: full mix, seamless loop, and per-lane stems zipped by `utils/zip.ts` |
| `ui/src/services/drumScheduling.ts` | `expandDrumStep`: the hits one drum step plays (chance, repeats); used live and by WAV and MIDI export |
| `ui/src/hooks/useComputerKeyboard.ts` | Computer-keyboard piano for the selected lane |
| `ui/pwa/service-worker.js` | Service worker template. `vite.config.ts` fills in the build's file list and emits it as `sw.js`; `main.tsx` registers it in production only |
| `ui/src/services/drumKits.ts` | Drum instrument list and kit metadata |
| `ui/src/hooks/browserAudio.ts` | Shared AudioContext, master limiter, parallel FX buses, sample playback |
| `ui/src/hooks/useSynthAudio.ts` | Per-lane AudioWorklet nodes, note start/stop, parameter flattening |
| `ui/src/hooks/useDrumAudio.ts` | Posts drum hits to the `drum-processor` worklet node |
| `ui/src/hooks/useMidiInput.ts` | Web MIDI input, per-device held-note tracking |
| `ui/src/audio/worklet.ts` | Worklet entry: thin `synth-processor` and `drum-processor` wrappers around the engine cores. `vite.config.ts` bundles it to `public/audio-worklet.js` (generated, gitignored) |
| `ui/src/services/noteScheduling.ts` | `expandStep`: what one step plays (arpeggio pulses, slide length); used live and by export |
| `ui/src/utils/midiExport.ts` / `midiImport.ts` | Standard MIDI File export (PPQ 480, drums on channel 10) and import |
| `ui/src/synthModels.ts` | Synth model definitions and macro mapping |
| `ui/src/components/` | Controls used inside rack modules: `SynthControls` (the tabbed sound editor), `KeyboardPanel`, `Keyboard`, `PianoRoll`, `EffectsPanel`, `MidiPanel`, `SamplePanel`, `Knob`, `DrumKnob` |
| `engine/src/types.ts` | Type definitions (single source of truth; `ui/src/types.ts` re-exports them) |
| `engine/src/synth/SynthCore.ts` | The synth voice implementation: 8 voices, 2 oscillators + sub + noise, SVF filter, amp and filter envelopes, LFOs, FM, mono/legato |
| `engine/src/synth/voiceParams.ts` | Default `SynthParameters`, and `toVoiceParams` which flattens them for the core |
| `engine/src/drums/DrumCore.ts` | The drum voice implementation and per-kit character table |
| `engine/src/dsp.ts` | Shared oscillators, state-variable filter, exponential ADSR, seeded noise |

## Behaviour Worth Knowing
- Up to 3 synth lanes; Synth 1 cannot be removed. Lanes are 16 or 32 steps over one bar; the drum grid is always 16 steps.
- Undo/redo is one chronological stack for the whole project (`historyRef` in `useStudio.tsx`). Each entry stores one lane plus the shared drum, tempo and effects state. Loading a saved arrangement clears it.
- A tempo-synced LFO rate `N` means one cycle per 1/N note (`syncedLfoHz`). Live playback and WAV export both use it.
- Live playback and WAV export run the same `SynthCore` and `DrumCore`. Never add DSP to the worklet wrapper or to `wavExport.ts`; put it in the engine core so both paths get it.
- Drum voices are summed linearly and the master limiter only acts near full scale. Do not add saturation to the drum bus or lower the limiter threshold: that is what made simultaneous drums duck each other.
- New `SynthParameters` fields must be optional in the type, present in `createDefaultSynthParameters()` with a neutral value, and clamped in `sanitizeSynthParams`, so older saved projects load unchanged. Bump `SCHEMA` in `localService.ts` when adding one.
- The lanes labelled Low Tom and High Tom are the `snare2` and `ride` instrument ids, kept for saved-project compatibility.
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
- Exports must be repeatable: use `seededRandom` for anything random in WAV or MIDI export, never `Math.random`.
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
npm run test:browser # Playwright against the production preview
```

## Conventions
- No comments in code unless explaining non-obvious logic
- `DrumState` always initialized with `createDefaultDrumState()` (never null)
- Engine types are single source of truth (`engine/src/types.ts`), UI re-exports via `ui/src/types.ts`
- All project mutations go through `localRequest`; components do not write localStorage directly (synth presets in `useStudio.tsx` are the one exception)
- Sanitize anything read from storage in `projectSanitization.ts` before it reaches audio code
- Do not reintroduce a backend, Discord integration, authentication or WebSocket transport

## Known Issues
- `localService` still exposes a REST-shaped `request(path)` API with `Response` objects, a leftover from the server version
- `useStudio.tsx` is about 2,300 lines and owns most state; the UI is separate from it, but the state itself is not yet split by concern
- Firefox/Safari lack Web MIDI API support

## Potential Next Steps
- Replace the REST-shaped facade with typed service methods and split `useStudio.tsx` into hooks per concern
- See `docs/SONG_MODE_PLAN.md` and `docs/ROADMAP.md`
- Song mode / pattern chaining
- Use imported samples as drum or synth sources (and include them in project files)
