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
