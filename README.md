# Discobot

A Discord bot with a web-based UI for creating music using synthesis, sequencing, and drums. Control up to 3 independent synthesizers, a 16-step sequencer, piano roll editor, and drum machine from a web interface or Discord slash commands. Audio plays through the Discord voice channel in real time.

## Features

- **Multi-Synth**: Up to 3 independent synthesizers, each with own sequencer, keyboard, and parameter controls
- **16/32-step Sequencer**: Step grid with note assignment via piano keyboard, monophonic mode, per-step velocity
- **Piano Roll Editor**: Per-synth keyboard/piano-roll toggle with click/drag note painting on the shared step pattern
- **Synthesizer**: 4 waveforms (sine, square, sawtooth, triangle), detune, resonant lowpass filter, ADSR envelope, dual LFOs (pitch/filter targets), arpeggiator (7 modes), synth model selector (6 vintage models), presets (save/load/delete with local storage persistence)
- **Octave Shift**: -1 to +1 octave range per synth with range display
- **Shared Effects Loop**: Drive (waveshaper), phaser, delay, reverb (convolver) — per-synth send levels, master on/off, per-effect toggles
- **Drum Machine**: 8 instruments (kick, snare, open/closed hi-hat, ride, crash, snare 2, clap), 16-step toggle grid with per-instrument volume/tone/extra controls, 3 kit variants (clean-analog, punchy-modern, lofi-dirty), master volume, per-instrument mute/solo, drum FX sends, and drum loop return
- **MIDI Input**: Web MIDI device selection with `live`, `record`, and `step` routing modes per synth
- **MIDI Export**: Standard MIDI File download with tempo meta event, multi-synth lanes, drums on channel 10
- **Undo/Redo**: Per-pattern undo stack for note/velocity/parameter edits, keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z)
- **Browser Audio**: Web Audio API feedback for synth and drums with shared effects loop, independent mute toggle
- **Discord Audio Streaming**: Pattern rendered to 48kHz PCM with soft-clipped master mix, sent over WebSocket, played through bot voice connection with loop
- **Pattern Persistence**: Save/load/delete patterns with name, stores all synth params, drum state, effects loop, and master volumes in `saved-patterns.json` under `PERSISTENCE_DIR` (fallback `DATA_DIR`, then local `data/`)
- **Real-time Sync**: All connected clients stay synchronized via WebSocket
- **Global Tempo**: Single BPM shared across all synths, editable LED display in header
- **Auth System**: Discord OAuth2 login flow, session tokens with TTL, CSRF validation, HMAC-signed bot requests, role-based access (owner/collaborator/bot)
- **Connected Users**: Real-time user presence display in header
- **Header Controls**: "Discobot" title + active pattern badge, quick transport/save/load controls, MIDI panel, help modal, undo/redo, MIDI export, mute, and connection status
- **Hybrid Control**: Web UI or Discord slash commands

## Architecture

Monorepo using npm workspaces with 4 packages:

```
discobot/
├── bot/       # Discord bot (Discord.js, @discordjs/voice)
├── engine/    # Custom math-based audio synthesis (no Tone.js)
│   ├── Synthesizer           # Oscillator, filter, ADSR, dual LFOs
│   ├── DrumSynthesizer       # 8 drum instruments, 3 kit variants
│   ├── Sequencer / SequencerV2  # Pattern playback
│   ├── Streaming             # DiscordAudioStreamer for voice
│   ├── AudioExporter         # WAV export
│   ├── AudioContextManager   # Singleton context management
│   ├── utils.ts              # Shared utilities (clamp, noteToFreq, deepMerge)
│   ├── constants.ts          # Audio parameters (no magic numbers)
│   └── errors.ts             # Result type, error classes, validation
├── web/       # Express API + WebSocket server, multi-synth backend, auth
└── ui/        # React web interface (Vite), SynthUnit, PianoRoll, MidiPanel, EffectsPanel
```

**Audio Flow**: Engine renders PCM → Web Server base64-encodes → WebSocket → Bot plays through Discord voice (48kHz stereo 16-bit raw PCM)

### Code Quality Features

- **Singleton AudioContext**: Prevents memory leaks and "Too many contexts" errors
- **Shared Utilities**: Single source of truth for audio calculations
- **Named Constants**: All magic numbers replaced with descriptive constants
- **Deep Merge**: Proper nested parameter updates
- **Type Safety**: Comprehensive TypeScript coverage across all packages, engine types as single source of truth
- **Result Type Pattern**: `Result<T,E>` with `Ok`/`Err` for expected failures
- **Structured Error Logging**: All errors logged with context, no silent failures

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- A Discord server where you can add bots

### 1. Install

```bash
cd discobot
npm install
```

### 2. Discord Bot Setup

1. Go to https://discord.com/developers/applications
2. **New Application** → name it
3. **Bot** tab → **Add Bot** → copy token
4. Enable **Server Members Intent** + **Message Content Intent**
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`
6. Open the generated URL and invite the bot to your server

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
AUTH_MODE=strict
AUTH_TOKEN_SECRET=replace_with_long_random_secret
BOT_SHARED_SECRET=replace_with_long_random_secret

# Optional: deploy-safe saved pattern storage directory
PERSISTENCE_DIR=/data
```

### 4. Run

```bash
npm run dev
```

Starts:
- Web API on http://localhost:3001
- WebSocket on ws://localhost:3001/ws
- Web UI on http://localhost:3000
- Discord bot (connects to Discord)

### 5. Use It

1. Open http://localhost:3000
2. Join a voice channel in Discord
3. In Discord: `/join`
4. In Discord: `/login` — open the generated link in your browser
5. In the UI: click a step button (amber = selected), click a piano key to assign a note, click Play
6. The bot plays the pattern through your voice channel

## Discord Commands

| Command | Description |
|---------|-------------|
| `/join` | Join your current voice channel |
| `/leave` | Leave voice channel |
| `/play [synth]` | Start sequencer playback (optional synth: 1, 2, or 3) |
| `/stop [synth]` | Stop playback (optional synth: 1, 2, or 3) |
| `/note <note> [synth]` | Play a single note (optional synth: 1, 2, or 3) |
| `/tempo <bpm>` | Set global tempo |
| `/preset` | Cycle through synth presets |
| `/status` | Show bot status |
| `/help` | Show available commands |
| `/login` | DM a link to authenticate with the web UI |

## Web UI

- **Header**: title/badge, editable BPM LED, Play/Stop All, Save/Load, MIDI panel (device/mode/channel/synth routing), Help, Undo/Redo, Export MIDI, reset/mute, connection status, connected users
- **Synth Units**: Each contains sequencer + synth controls + keyboard/piano-roll, stacked vertically in a 2-column grid
- **Sequencer grid**: 16 or 32 steps, click to select (amber), piano key assigns note (blue), per-step velocity
- **Keyboard/Piano Roll panel**: Per-synth mode toggle between 3-octave keyboard (with octave shift/range display) and piano roll editor on shared step data
- **Synth controls**: Oscillator, filter, envelope, dual LFOs, FX sends, arpeggiator (7 modes), synth model selector (6 vintage models), octave shift, presets, hold mode
- **Effects Panel**: Shared effects loop with drive, phaser, delay, reverb — per-effect on/off toggles, master bypass
- **Drum machine**: 8×16 toggle grid with instrument selection, per-instrument volume/tone/extra knobs, per-instrument mute/solo, 3 kit variants, master volume knob, drum FX sends (reverb/delay/drive/phaser), and drum loop return controls
- **Save/Load/Manage**: Save from header, load from dropdown (5 recent + show all), delete from modal
- **Browser mute**: Toggle browser audio without affecting Discord
- **Reset**: Clear pattern + reset synth + reset drums

## Tech Stack

| Layer | Technology |
|-------|------------|
| Bot | Discord.js v14, @discordjs/voice |
| Engine | Custom math synthesis (no Tone.js) |
| API | Express, WebSocket (ws) |
| UI | React, Vite, TypeScript |
| Language | TypeScript across entire stack |

## Development

```bash
npm run dev          # Run everything
npm run dev:bot      # Discord bot only
npm run dev:web      # API + WebSocket server only
npm run dev:ui       # Web UI only (Vite)
```

## Additional Documentation

- Guides: `/docs/guides` — setup, deployment, feature testing, Railway hosting
- Plans: `/docs/plans` — implementation plans for piano roll, MIDI controller, effects loop, synth models, drum sample replacement
- Reports: `/docs/reports` — performance, error handling, refactoring summaries
- Reviews: `/docs/reviews` — code review
- Reference notes: `/docs/reference` — AI development guide, audio streaming code

## Status

### Working
- Multi-synth support (up to 3 independent units, Synth 1 cannot be removed)
- 16/32-step sequencer with visual indicator lights and per-step velocity
- Piano roll editor with click/drag note painting
- Piano keyboard with octave shift, responsive scaling, hold mode
- Synth controls with real-time parameter updates: oscillator, filter, ADSR, dual LFOs, arpeggiator (7 modes), synth model selector (6 vintage models), presets
- Shared effects loop: drive, phaser, delay, reverb with per-synth send levels
- Drum machine with 8 instruments, 3 kit variants, 16-step toggle grid, per-instrument controls, mute/solo, master volume, drum FX sends
- Drum browser preview on cell click
- Drum playback during sequencer playback in both browser and Discord
- Pattern save/load/delete (JSON persistence) — stores all synth params, drum state, drum kit, effects loop, and master volumes
- Discord voice playback (full pattern rendered, soft-clipped master mix, looped)
- Discord bot synth selection (/play, /stop, /note, /tempo accept synth option)
- Stop in UI stops bot playback
- Global tempo with live BPM updates across all synths
- Browser audio with synth and drum parameter respect, shared effects bus
- Multi-client WebSocket sync with connected user display
- Undo/redo for pattern, velocity, synth param, and drum edits
- MIDI export (Standard MIDI File, multi-synth lanes, drums on channel 10)
- MIDI input (Web MIDI API, device selector, live/record/step modes)
- Reset button
- Auth sessions + CSRF validation + request rate limiting
- Discord OAuth2 login flow

### Needs Work
- Step-by-step real-time streaming (currently renders full pattern)
- `SamplePlayer` is a stub, not functional
- Audio export / WAV download (engine has `AudioExporter`, not wired to UI)
- Song mode / pattern chaining
- Voice polyphony
- Per-step drum velocity

---

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
### PR #49: feat: real-time audio architecture, drum clones, streaming fixes

Source branch: `feat/realtime-audio-architecture`
Last sync: 2026-07-16T22:55:52.308Z

#### Changed files
- `.opencode/skills/discobot-dev/SKILL.md` — MODIFIED (+89/-88)
- `AGENTS.md` — MODIFIED (+9/-3)
- `bot/src/index.ts` — MODIFIED (+57/-1)
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+124/-91)
- `engine/src/StreamingSynth.ts` — ADDED (+420/-0)
- `engine/src/Synthesizer.ts` — MODIFIED (+2/-0)
- `engine/src/index.ts` — MODIFIED (+1/-0)
- `engine/src/types.ts` — MODIFIED (+9/-1)
- `package-lock.json` — MODIFIED (+23/-0)
- `ui/package.json` — MODIFIED (+1/-0)
- `ui/public/synth-processor.js` — ADDED (+220/-0)
- `ui/src/App.tsx` — MODIFIED (+128/-3)
- `ui/src/authClient.ts` — MODIFIED (+9/-0)
- `ui/src/components/DrumKnob.tsx` — MODIFIED (+3/-1)
- `ui/src/components/DrumMachine.css` — MODIFIED (+21/-0)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+46/-16)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+32/-0)
- `ui/src/components/KeyboardPanel.tsx` — MODIFIED (+19/-0)
- `ui/src/components/Knob.css` — MODIFIED (+0/-30)
- `ui/src/components/Knob.tsx` — MODIFIED (+2/-19)
- `ui/src/components/PianoRoll.tsx` — MODIFIED (+0/-1)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+53/-24)
- `ui/src/components/SynthUnit.tsx` — MODIFIED (+2/-3)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+124/-293)
- `ui/src/types.ts` — MODIFIED (+1/-0)
- `ui/src/utils/midiImport.ts` — ADDED (+89/-0)
- `web/src/index.ts` — MODIFIED (+469/-42)
<!-- AUTO_PR_CHANGELOG_END -->
