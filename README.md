# Discobot

A browser-only music workstation: up to three synths, 16/32-step sequencing,
piano-roll editing, an eight-instrument drum machine, MIDI and shared effects.
No Discord account, backend, API keys or login is required.

## Architecture

```
discobot/
├── engine/    # Browser-compatible TypeScript DSP and shared types
└── ui/        # React + Vite, Web Audio, local project/sample services
```

Two npm workspaces build to a static site in `ui/dist/`. Project operations and
events run in-process; there is no REST server or WebSocket connection. Sound is
generated locally and played through the browser's Web Audio API.

## Run locally

Use **Node.js 22+** and npm from the repository root:
```bash
npm ci
npm run dev
```

Open **http://localhost:3000/discobot/**. To preview the production build:

```bash
npm run build
npm start
```

Open **http://localhost:4173/discobot/**. `npm start` is Vite's static preview,
not an application backend. The build's asset base is `/discobot/`.

## Make music

1. Click a keyboard key or Play to unlock browser audio; start with low output volume.
2. Select a synth step and assign a note, or paint notes in the piano roll.
   Adjust velocity, oscillator, filter, ADSR, LFOs and arpeggiator controls.
3. Add drum steps, select a kit, and adjust track settings, swing, mute/solo and mix.
4. Use Play All / Stop All, shared tempo and the mixer. Effects sends feed
   drive, phaser, delay and reverb; a send and its return must be audible.
5. Save a named pattern; load or delete it through the pattern manager.

### Local data

Project state and named patterns are stored in **localStorage**. Imported sample
bytes and metadata are stored in **IndexedDB**, then decoded locally for playback.
Nothing is uploaded. Storage is specific to the browser profile and origin:
localhost ports and the deployed site do not share projects. Clearing site data,
private browsing or storage quotas can remove/prevent persistence. Storage errors
are reported in the UI; local storage is not a backup.

### MIDI and audio files

- **MIDI input:** select a device, channel, target synth and live/record/step mode.
  Hardware input requires Web MIDI support, a secure context (HTTPS or localhost)
  and permission. Unsupported browsers show an explanation instead of unusable
  device controls; use the on-screen keyboard or import a file instead.
- **Import MIDI:** choose a `.mid` file and a track; imported notes and detected
  tempo are mapped to the sequencer. MIDI file import/export does not require
  Web MIDI or a connected controller.
- **Export MIDI:** download a Standard MIDI File containing synth lanes, tempo
  and drums on channel 10. MIDI stores note events, not synthesized audio.
- **Export WAV:** render the current arrangement locally to a stereo audio file.
  Offline rendering is a separate DSP path, not a recording of the live output.

## Validation

Existing checks: `npm run typecheck`, `npm test`, and `npm run test:browser`.
See [the control audit](docs/CONTROL_AUDIT.md) for coverage and remaining limits.
Automated browser/DSP checks do not verify subjective sound quality, real MIDI
hardware or every browser/device; those require listening and hands-on testing.

## GitHub Pages publication

**Publication is not confirmed.** Repository metadata reported `has_pages: false`,
the expected site's DNS lookup failed, and browser-only PR #58 was still unmerged
when checked. No Pages-settings write API is available in this task.

Remaining maintainer steps:
1. Merge the approved browser-only PR into `main`.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Run **Publish GitHub Pages** on `main` and confirm its deployment succeeds.

Expected URL: **https://iw978599.github.io/discobot/** — this is not a claim that
the site is already published.

## Changelog

### PR #47 — Auto-update documentation on PR create
CI workflow added to automatically stage and commit updated markdown docs when PRs are opened. Ensures documentation stays in sync with code changes.

### PR #46 — Fix 32-step change issue
Improved browser play fallback handling. Fixed a bug where switching between 16 and 32 step counts caused playback issues.

### PR #45 — Investigate sound problems
Restored loop-active gating for step preview audio. Fixed an issue where browser preview audio played incorrectly during sequencer playback.

### PR #44 — Fix synth/drum sequence issue
Fixed hard clipping in rendered pattern loop. The master mix was clipping when synth and drum signals combined at high levels.

### PR #43 — Fix playback sound issue
Fixed browser audio playback to prefer rendered loop audio over step preview during playback. Previously both would play simultaneously, causing phasing and volume issues.

### PR #42 — Implement synth clone plan
Added synth model state and UI scaffolding for 6 vintage synth models (Minimoog, Juno-106, DX7, TB-303, Prophet-5, plus generic). Implemented browser rendered-pattern audio loop playback.

### PR #41 — Expand help section UI
Expanded help modal content with quick start, header controls, keyboard shortcuts, synth/drum workflow, and FX return notes. Added planning doc for sample-based drum migration. Updated drum return controls.

### PR #40 — Fix phaser and velocity issues
Implemented synth timing, velocity, and preset/effects updates. Fixed save overwrite typing. Finalized synth model parameter updates and velocity sensitivity.

### PR #39 — Undo/redo, MIDI export, arpeggiator, presets
Added per-pattern undo/redo stack with keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z). Implemented Standard MIDI File export (multi-synth lanes, drums on channel 10). Added arpeggiator (7 modes: up, down, updown, random, chord, upchord, downchord) with BPM-synced rate and gate control. Added synth preset system with save/load/delete and built-in presets (Pad, Bass, Lead, Pluck).

### PR #38 — Piano roll and MIDI panel
Added piano roll editor component with 3-octave × 16-step grid, click/drag note painting. Added MIDI input panel with device selector, mode toggle (live/record/step), channel routing, and synth target selection. Added saved pattern name display in header.

### PR #37 — Keyboard layout, LFO filter, effects loop, scrolling
Moved keyboard to column 2 below sequencer. Changed default filter cutoff to 5000Hz (was 20000, LFO modulation was inaudible). Enabled effects loop by default. Fixed `processEffectsLoopBus` returning raw send signal when disabled. Added shared effects bus to browser synth preview (delay, reverb via ConvolverNode, drive via WaveShaperNode). Added overflow scrolling to main layout panels.

### PR #36 — Fix/keyboard layout, LFO filter, effects loop, scrolling (initial)
Fixed keyboard layout alignment with synth controls panel. Moved Add Synth button inside synth-units-container. Fixed default `EffectsLoopState.enabled` to `true` in both server and UI.

### PR #35 — Review deploy and HTTP logs
Fixed WebSocket auth fallback for stale tokens. Prevented compatibility fallback on invalid bearer auth headers.

### PR #34 — Railway WebSocket handling
Fixed Railway WebSocket upgrade handling. Hardened URL configuration for production deployment behind Railway's reverse proxy.

### PR #33 — Fix synth 1 display issue
Ensured Synth 1 is always initialized in guild runtime. Previously Synth 1 could be missing from state if the bot hadn't received a command yet.

### PR #32 — Add help button and cleanup
Added help modal with usage instructions. Fixed right-side panel scrolling behavior. Refreshed README and key documentation.

### PR #31 — Fix drum kit sound issues
Fixed drum kit apply behavior — kit changes now correctly update all instrument parameters. Fixed effects knob editing and timing issues.

### PR #30 — Fix interaction crash
Fixed bot crash on expired Discord interactions (error code 10062). Wrapped error handler reply in try-catch. Fixed `handleLogin` to check `interaction.deferred` before calling `editReply`.

### PR #29 — Drum machine FX loop
Implemented shared FX loop for drum machine: reverb, delay, drive, phaser sends per instrument, global loop return level. Added drum FX panel in UI. Implemented responsive UI overhaul. Added drum kit types, server plumbing, UI wiring, and note release lifecycle fixes.

### PR #28 — Add synth controls and effects loop
Added step toggle hold mode for sequencer. Added editable knob value inputs (click to type exact values). Implemented shared effects loop migration: moved per-synth delay/reverb to send/return bus architecture. Added `EffectsLoopState` with drive, phaser, delay, reverb sections and per-effect on/off toggles.

### PR #27 — Redo drum machine instruments
Fixed knob direction (vertical drag), improved LFO depth scaling, retuned drum voices across all 3 kit variants. Updated drum instrument parameters for better sonic character.

### PR#26 — Standardize knob values and edit patterns
Implemented live-edit sequencing sync (pattern changes push to server immediately). Updated knob direction and value display. Fixed App load control and synth effect processing updates.

### PR #25 — Fix application not responding error
Deferred `/login` Discord interaction to prevent timeout. Added deferred interaction response handling with 15-minute token expiry.

### PR #24 — Synth redesign vertical controls
Implemented synth column layout (controls left, sequencer/keyboard right). Added guild-scoped auth/session foundation with HMAC-signed bot requests. Fixed bot WebSocket auth timestamp and signature validation. Implemented security hardening updates.

### PR #23 — Redesign synth controls and drum sounds
Implemented synth layout with dual LFOs (pitch/filter targets), 3rd synth support (max 3). Added synth model selector with 6 vintage models (Minimoog, Juno-106, DX7, TB-303, Prophet-5). Finalized synth LFO rendering updates.

### PR #22 — Redo drum sounds and fix pause
Improved drum synthesis for all 8 instruments. Fixed selected step note clearing behavior. Smoothed Discord audio loop transitions.

### PR #21 — Make UI updates
Added global transport controls (Play All / Stop All). Added synth and drum mute/solo controls in header.

### PR #20 — Modify synth sequencer and controls
Fixed browser playback and note-off interference. Refined synth unit layout and relocated octave controls below sequencer.

### PR #19 — Update synth controls layout
Fixed type narrowing in audio readiness checks. Added explicit browser audio context unlock on first user interaction. Fixed synth keyboard container fill behavior.

### PR #18 — Fix synth playback error
Fixed synth envelope timing (attack/decay/sustain/release math). Fixed synth unit keyboard layout alignment.

### PR #17 — Synth refactor
Multi-synth refactor: SynthUnit wrapper component, backend Map-based synth storage, add/remove synth endpoints. Added Keyboard octave shift with range display. Backend synthId routing for all REST + WebSocket messages. Discord bot synthId option on /play, /stop, /note, /tempo. Global tempo: single BPM shared across all synths. Header UI: "Discobot" title, TempoDisplay LED, SavePattern inline save.

### PR #15 — WebSocket play button issue
Added `/api` route compatibility for production deployments behind reverse proxies. Made save confirmation reliable.

### PR #14 — WebSocket issue fix
Fixed WebSocket upgrade handling on `/ws` and `/ws/` paths explicitly. Resolved connection issues with trailing slashes.

### PR #12–13 — WebSocket connection issues
Unified WebSocket endpoint on web server. Repositioned drum controls above instruments. Resolved multiple WebSocket connection failures.

### PR #10–11 — Traffic capture and WebSocket fixes
Redesigned ride cymbal and single-hit clap synthesis. Initial WebSocket traffic capture for debugging connection issues.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #56: Add LFO tempo sync, stereo spread, drum velocity per step, envelope v…

Source branch: `feat/effects-mixer-improvements`
Last sync: 2026-07-18T19:08:07.568Z

#### Changed files
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+9/-2)
- `engine/src/StreamingSynth.ts` — MODIFIED (+47/-11)
- `engine/src/Synthesizer.ts` — MODIFIED (+52/-4)
- `engine/src/types.ts` — MODIFIED (+5/-0)
- `ui/public/synth-processor.js` — MODIFIED (+17/-7)
- `ui/src/App.css` — MODIFIED (+40/-0)
- `ui/src/App.tsx` — MODIFIED (+146/-6)
- `ui/src/components/DrumMachine.css` — MODIFIED (+41/-0)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+91/-8)
- `ui/src/components/EffectsPanel.tsx` — MODIFIED (+0/-8)
- `ui/src/components/MixerPanel.css` — ADDED (+248/-0)
- `ui/src/components/MixerPanel.tsx` — ADDED (+196/-0)
- `ui/src/components/Sequencer.css` — MODIFIED (+12/-0)
- `ui/src/components/Sequencer.tsx` — MODIFIED (+6/-0)
- `ui/src/components/SynthControls.css` — MODIFIED (+48/-0)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+92/-24)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+4/-2)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+16/-6)
- `web/src/index.ts` — MODIFIED (+174/-11)
<!-- AUTO_PR_CHANGELOG_END -->
