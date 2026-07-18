# Discobot - Project Summary

**Status**: Beta - Core features working including Discord audio playback  
**Location**: Repository root (`discobot/`)

## What Was Built

A full-stack music creation application with:

### 1. **Discord Bot** (`bot/`)
- Discord.js v14 with slash commands
- Voice channel connection + real-time PCM audio streaming via `@discordjs/voice`
- Commands: `/join`, `/leave`, `/play`, `/stop`, `/note`, `/tempo`
- WebSocket client receives rendered pattern audio from web server and plays it in a loop
- Audio loop stops on `/stop` or `sequencerStop` broadcast

### 2. **Audio Engine** (`engine/`)
- Custom math-based synthesizer (no Tone.js dependency):
  - 4 oscillator waveforms (sine, square, saw, triangle) with detune
  - Resonant lowpass filter
  - ADSR envelope
  - Delay effect
- `renderNote()` generates PCM samples (Float32Array) per note
- Full pattern rendering at 48kHz stereo for Discord streaming
- 16-step sequencer with tempo control, monophonic step activation

### 3. **Web API Server** (`web/`)
- Express REST API on port 3001
- WebSocket endpoint on `ws://localhost:3001/ws` for real-time sync
- Centralized audio engine state (Synthesizer, Sequencer, SamplePlayer)
- Pattern management with JSON file persistence (`saved-patterns.json`)
- Pattern save/load/delete endpoints
- Auto-renders pattern audio on play, tempo change, synth param change, pattern edit
- Throttles audio re-rendering to 300ms intervals
- Tracks `hasActiveSession` flag

### 4. **React Web UI** (`ui/`)
- Vite + React + TypeScript (no Tone.js dependency)
- **Sequencer**: 16-step grid, step button = select + activate, visual playback indicator lights
- **Keyboard**: 3-octave piano keyboard (C3-F5) with note assignment to selected steps
- **SynthControls**: All parameters with sliders/dropdowns and hover info‑icon tooltips
- **Save/Load/Delete**: Save patterns with name, load from dropdown (5 most recent + show all), manage/delete in modal
- **Tempo**: LED-style red display, click-to-edit, commits on Enter/blur
- **Browser audio**: Web Audio API oscillator respecting synth params, independent mute button
- **Reset button**: Clears pattern, resets synth to defaults, stops playback

## Architecture Highlights

- **Monorepo**: npm workspaces (4 packages)
- **TypeScript**: 100% TypeScript across all packages
- **Real-time**: WebSocket keeps UI, bot, and server in sync
- **Hybrid control**: Web UI OR Discord slash commands
- **Audio pipeline**: Engine renders PCM → server base64-encodes → bot receives via WebSocket → plays through Discord voice
- **PCM format**: 48kHz, 16-bit signed, stereo little-endian (`StreamType.Raw`)

## What's Working

- Full web UI with sequencer, keyboard, and synth controls
- Note assignment via piano key click on selected step
- Step selection/activation (amber = selected, blue = has note, dark = empty)
- Synth parameter controls with real-time updates
- Pattern editing, save/load/delete with JSON persistence
- Tempo control with live BPM update
- Browser audio playback with Web Audio API
- Discord bot joins voice, receives pattern audio, plays in loop
- Stop in UI stops bot's audio loop
- Audio re-renders on tempo/synth/pattern changes during playback (throttled)
- Multi-client synchronization via WebSocket
- Reset button

## File Structure

```
discobot/
├── docs/reports/PROJECT_SUMMARY.md # This file
├── README.md                     # Main docs (may be outdated)
├── package.json                  # Workspace config
├── tsconfig.json                 # Shared TS config
├── .env                          # Your secrets (gitignored)
├── .env.example                  # Template
├── .gitignore
│
├── bot/                          # Discord bot
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── index.ts              # Bot entry (~350 lines)
│
├── engine/                       # Audio engine (no Tone.js)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── types.ts              # Shared types
│       ├── Synthesizer.ts        # Oscillator, filter, ADSR, renderNote
│       ├── Sequencer.ts          # 16-step sequencer
│       ├── SamplePlayer.ts       # Stub (not implemented)
│       ├── AudioExporter.ts      # WAV export util
│       ├── Streaming.ts          # Discord audio streamer
│       ├── AudioContextPolyfill.ts
│       └── index.ts              # Re-exports
│
├── web/                          # Express + WebSocket server
│   ├── package.json
│   ├── tsconfig.json
│   ├── saved-patterns.json       # Persistent pattern storage
│   └── src/
│       └── index.ts              # All routes
│
└── ui/                           # React frontend
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── App.css
        ├── index.css
        ├── types.ts
        ├── components/
        │   ├── Sequencer.tsx      # Grid, save/load/manage, tempo
        │   ├── Sequencer.css
        │   ├── Keyboard.tsx       # Piano keyboard C3-F5
        │   ├── Keyboard.css
        │   ├── SynthControls.tsx  # Sliders + info tooltips
        │   └── SynthControls.css
        └── hooks/
            └── useWebSocket.ts
```

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Bot | Discord.js + @discordjs/voice | ^14.14.1 / ^0.16.1 |
| Audio Engine | Custom math-based (no Tone.js) | — |
| API | Express | ^4.18.2 |
| WebSocket | ws | ^8.16.0 |
| Frontend | React | ^18.2.0 |
| Build Tool | Vite | ^5.0.11 |
| Language | TypeScript | ^5.3.3 |

## Lines of Code (approximate)

- Bot: ~350 lines
- Engine: ~350 lines
- Web: ~550 lines
- UI: ~850 lines
- **Total: ~2,100 lines of TypeScript/TSX/CSS**

## What Needs Work

1. **SamplePlayer** — Stub methods only, not usable
2. **Audio export** — `/export` endpoint should render WAV and send via Discord attachment
3. **Real-time step-by-step streaming** — Currently renders full pattern; step-by-step would enable seamless loop transitions and live pattern changes without restart

## Known Issues

- First note may sustain after stop (bot player state race; refresh browser to clear)
- Sample player backend remains stubbed

<!-- AUTO_PR_CHANGELOG_START -->
### PR #54: Feat/multi synth save layout redesign

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T15:06:55.296Z

#### Changed files
- `.opencode/agent/discobot-developer.md` — MODIFIED (+3/-12)
- `.opencode/skills/discobot-dev/SKILL.md` — MODIFIED (+3/-12)
- `AGENTS.md` — MODIFIED (+3/-12)
- `README.md` — MODIFIED (+3/-12)
- `docs/guides/DEPLOYMENT.md` — MODIFIED (+3/-12)
- `docs/guides/FEATURE_TESTING_GUIDE.md` — MODIFIED (+3/-12)
- `docs/guides/HOSTING_QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/RAILWAY_DEPLOY.md` — MODIFIED (+3/-12)
- `docs/guides/README_STREAMING.md` — MODIFIED (+3/-12)
- `docs/guides/SETUP.md` — MODIFIED (+3/-12)
- `docs/plans/AUDIO_STREAMING_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/DRUM_SAMPLE_REPLACEMENT_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_INVESTIGATION.md` — MODIFIED (+3/-12)
- `docs/plans/IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/IMPROVEMENT_IDEAS.md` — MODIFIED (+3/-12)
- `docs/plans/MIDI_CONTROLLER_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/PIANO_ROLL_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_CLONE_OPTIONS_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_REFACTOR_PLAN.md` — MODIFIED (+3/-12)
- `docs/reference/AI_DEVELOPMENT_GUIDE.md` — MODIFIED (+3/-12)
- `docs/reference/AUDIO_STREAMING_CODE.md` — MODIFIED (+3/-12)
- `docs/reports/ERROR_HANDLING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/FINAL_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/HIGH_PRIORITY_WORK_COMPLETE.md` — MODIFIED (+3/-12)
- `docs/reports/PERFORMANCE_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/PROJECT_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/REFACTORING_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/SEQUENCER_TIMING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reviews/CODE_REVIEW.md` — MODIFIED (+3/-12)
- `engine/src/types.ts` — MODIFIED (+1/-0)
- `start-ui.bat` — ADDED (+4/-0)
- `start-web.bat` — ADDED (+5/-0)
- `ui/src/App.css` — MODIFIED (+5/-6)
- `ui/src/App.tsx` — MODIFIED (+22/-21)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+19/-1)
- `ui/src/components/Keyboard.css` — MODIFIED (+2/-0)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+2/-0)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+6/-1)
- `web/src/index.ts` — MODIFIED (+3/-0)
<!-- AUTO_PR_CHANGELOG_END -->
