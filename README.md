# Discord Synth Bot

A Discord bot with a web-based UI for creating music using synthesis, sequencing, and drums. Control a 16-step sequencer, synthesizer, and drum machine from a web interface or Discord slash commands. Audio plays through the Discord voice channel in real time.

## Features

- **16-step Sequencer**: Step grid with note assignment via piano keyboard, monophonic mode
- **Synthesizer**: 4 waveforms (sine, square, sawtooth, triangle), detune, resonant lowpass filter, ADSR envelope, delay effect, master gain
- **Drum Machine**: 8 instruments (kick, snare, open/closed hi-hat, ride, crash, snare 2, clap), 16-step toggle grid with per-instrument volume/tone/extra controls, master volume
- **Browser Audio**: Web Audio API feedback for synth and drums that respects parameters, independent mute toggle
- **Discord Audio Streaming**: Pattern rendered to 48kHz PCM with soft-clipped master mix, sent over WebSocket, played through bot voice connection with loop
- **Pattern Persistence**: Save/load/delete patterns with name, stores all synth params, drum state, and master volumes in `saved-patterns.json`
- **Real-time Sync**: All connected clients stay synchronized via WebSocket
- **Tempo Control**: LED-style BPM display, click-to-edit, live updates to sequencer
- **Hybrid Control**: Web UI or Discord slash commands

## Architecture

Monorepo using npm workspaces with 4 packages:

```
discord-synth-bot/
├── bot/       # Discord bot (Discord.js, @discordjs/voice)
├── engine/    # Custom math-based audio synthesis (no Tone.js)
├── web/       # Express API + WebSocket server
└── ui/        # React web interface (Vite)
```

**Audio Flow**: Engine renders PCM → Web Server base64-encodes → WebSocket → Bot plays through Discord voice (48kHz stereo 16-bit raw PCM)

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
   - Permissions: `Connect`, `Speak`
6. Open the generated URL and invite the bot to your server

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
```

### 4. Run

```bash
npm run dev
```

Starts:
- Web API on http://localhost:3001
- WebSocket on ws://localhost:8080
- Web UI on http://localhost:3000
- Discord bot (connects to Discord)

### 5. Use It

1. Open http://localhost:3000
2. Join a voice channel in Discord
3. In Discord: `/join`
4. In the UI: click a step button (amber = selected), click a piano key to assign a note, click Play
5. The bot plays the pattern through your voice channel

## Discord Commands

| Command | Description |
|---------|-------------|
| `/join` | Join your current voice channel |
| `/leave` | Leave voice channel |
| `/play` | Start sequencer playback |
| `/stop` | Stop playback |
| `/note <note>` | Play a single note (e.g., C4, A#3) |
| `/tempo <bpm>` | Set tempo |

## Web UI

- **Sequencer grid**: 16 steps, click to select (amber), piano key assigns note (blue)
- **Piano keyboard**: 3 octaves (C3–F5), responsive width (keys scale to container)
- **Synth controls**: Oscillator, filter, envelope, delay, master gain — all with hover info tooltips
- **Drum machine**: 8×16 toggle grid with instrument selection, per-instrument volume/tone/extra knobs, master volume knob
- **Save/Load/Manage**: Save patterns with name confirmation, load from dropdown (5 recent + show all), delete from modal
- **Tempo**: Red LED display, click to edit
- **Browser mute**: Toggle browser audio without affecting Discord
- **Reset**: Clear pattern + reset synth + reset drums

## Tech Stack

| Layer | Technology |
|-------|------------|
| Bot | Discord.js v14, @discordjs/voice |
| Engine | Custom synthesis (no Tone.js) |
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

## Status

### Working
- Step sequencer with visual indicator lights
- Piano keyboard note assignment to steps, responsive scaling
- Synth controls with real-time parameter updates and master gain
- Drum machine with 8 instruments, 16-step toggle grid, per-instrument controls, master volume
- Drum browser preview on cell click
- Drum playback during sequencer playback in both browser and Discord
- Pattern save/load/delete (JSON persistence) — stores all synth params, drum state, and master volumes
- Discord voice playback (full pattern rendered, soft-clipped master mix, looped)
- Stop in UI stops bot playback
- Tempo control with live BPM updates
- Browser audio with synth and drum parameter respect
- Multi-client WebSocket sync
- Reset button

### Needs Work
- Step-by-step real-time streaming (currently renders full pattern)
- `SamplePlayer` is a stub, not functional
- Audio export / WAV download
- No authentication or rate limiting
