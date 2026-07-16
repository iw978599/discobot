---
name: discobot-dev
description: Provides guidance for developing, testing, and enhancing the Discord Synth Bot with web UI integration.
---

# Discord Synth Bot Development Skill

This skill helps with working on the Discord Synth Bot project which combines a Discord bot with web-based audio synthesis.

## Project Overview

The discobot is a monorepo with 4 npm workspaces:
- **bot/**: Discord bot using discord.js v14 and @discordjs/voice
- **engine/**: Custom math-based audio synthesis (no Tone.js)
- **web/**: Express API (port 3001) + WebSocket server (3001/ws)
- **ui/**: React web interface with Vite (port 3000)

## Architecture

### Data Flow
- **Browser**: AudioWorkletProcessor renders synth audio in real-time
- **Server**: StreamingSynth renders 20ms PCM chunks, sends via WebSocket
- **Bot**: Receives PCM chunks, broadcasts to Discord voice channel (48kHz stereo 16-bit)

### Key Technical Details
- Engine is single source of truth for types (`engine/src/types.ts`), UI re-exports via `ui/src/types.ts`
- WebSocket drives real-time UI sync between all connected clients
- Auth: Discord OAuth2 flow, session tokens with TTL, CSRF validation, HMAC-signed bot requests
- Bot signs requests with `x-bot-timestamp` + `x-bot-signature` headers
- UI uses Bearer + CSRF tokens for API calls

## Running Development Server

```bash
# Run everything (bot + web + ui concurrently)
npm run dev

# Run individual services
npm run dev:bot    # Discord bot only
npm run dev:web    # API + WebSocket server only (tsx watch)
npm run dev:ui     # Web UI only (Vite dev server)

# Build for production
npm run build
npm run build:ui   # Build UI only (tsc + vite build)
```

## Key Files

| File | Purpose |
|------|---------|
| `web/src/index.ts` | Express + WebSocket server, REST endpoints, drum/synth state, streaming, auth |
| `web/src/wsHelpers.ts` | WebSocket channel routing (ui/bot), origin validation |
| `web/src/sessionAuth.ts` | Role assignment (owner/collaborator), `canControl` |
| `ui/src/App.tsx` | Main React component, multi-synth state, header, WebSocket client, MIDI export |
| `ui/src/config.ts` | Smart base URL detection, WebSocket URL builder with session token |
| `ui/src/synthModels.ts` | 6 synth model definitions (generic, minimoog, juno-106, dx7, tb-303, prophet-5) |
| `ui/src/components/SynthUnit.tsx` | Wrapper combining Sequencer + SynthControls + Keyboard per synth |
| `ui/src/components/DrumMachine.tsx` | 8×16 grid, per-instrument knobs, kit selector (8 kits), master volume, drum FX |
| `ui/src/hooks/useSynthAudio.ts` | Browser synth: AudioWorkletNode, shared FX bus, pan/portamento |
| `engine/src/StreamingSynth.ts` | 8-voice poly chunk-based renderer with persistent oscillator/filter/envelope state |
| `engine/src/DrumSynthesizer.ts` | 8 drum instruments with 8 kit variants, humanization, sample layer blending |

## Features

### Completed
- Multi-synth support (up to 3, Synth 1 cannot be removed)
- 16/32-step sequencer with per-step velocity
- Piano roll editor with click/drag note painting
- Synthesizer: 4 waveforms, detune, filter, ADSR, dual LFOs, arpeggiator (7 modes)
- 6 synth model presets (Minimoog, Juno-106, DX7, TB-303, Prophet-5)
- Shared effects loop: drive, phaser, delay, reverb
- MIDI input/output
- Undo/redo with keyboard shortcuts
- Global tempo across all synths
- Drum machine: 8 instruments with 8 kit variants (3 generic + 5 drum machine clones)
- Browser audio preview for synth notes and drum hits
- Real-time streaming to Discord voice
- Pattern persistence (save/load/delete)
- Discord OAuth2 auth with session tokens
- Real-time user presence display
- Stereo panning and portamento per synth
- Import MIDI files with track selection

### Audio Streaming
- StreamingSynth: 8-voice poly, 20ms chunks at 48kHz
- Sample-accurate note scheduling (no setTimeout drift)
- Catch-up timing prevents audio stutter
- WebSocket keepalive (ping/pong every 15s)

## Conventions

- No comments in code unless explaining non-obvious logic
- `DrumState` always initialized with `createDefaultDrumState()` (never null)
- `renderPatternAudio()` produces base64 Int16 stereo PCM at 48kHz
- REST for data ops, WebSocket for real-time sync
- Engine types are single source of truth (`engine/src/types.ts`)
- Auth: bot signs with HMAC, UI uses Bearer + CSRF tokens

## Known Issues

- `SamplePlayer` is stubbed (not functional)
- Serial effects chain causes cumulative dry attenuation
- Firefox/Safari lack Web MIDI API support

## Testing Checklist

- [ ] UI connects to WebSocket (green indicator)
- [ ] Clicking sequencer grid toggles steps
- [ ] Play/Stop button works
- [ ] Sequencer steps highlight during playback
- [ ] Keyboard plays notes
- [ ] Synth controls update in real-time
- [ ] Drum machine kit selector shows all 8 kits
- [ ] Discord bot responds to `/join`, `/leave`
- [ ] Discord bot responds to `/play`, `/stop`
- [ ] Multiple browser tabs stay in sync

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
