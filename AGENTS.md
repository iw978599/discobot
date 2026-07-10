# Discobot — AI Context / Restore Prompt

## Project Overview
Web-controlled Discord synth/sequencer/drum bot. Monorepo with 4 npm workspaces. Audio engine runs in Node.js (no Tone.js — custom math synthesis). WebSocket drives real-time UI sync.

## Architecture
```
discobot/
├── bot/       # Discord bot (Discord.js, @discordjs/voice)
├── engine/    # Custom math-based audio synthesis (no Tone.js, audiobuffer-to-wav)
├── web/       # Express API (3001) + WebSocket server (8080)
└── ui/        # React web interface (Vite, port 3000)
```

### Audio Flow
Engine renders PCM → Web server base64-encodes → WebSocket → Bot broadcasts via Discord voice (48kHz stereo 16-bit raw PCM, soft-clipped master mix)

### WebSocket Messages
`init`, `synthUpdate`, `patternUpdated`, `sequencerStep`, `sequencerPlay`, `sequencerStop`, `patternAudio`, `tempoChange`, `drumStep`, `drumSettings`, `drumReset`, `drumFullState`

## Key Files
| File | Purpose |
|------|---------|
| `web/src/index.ts` | Express + WebSocket server, REST endpoints, drum/synth state, audio rendering |
| `ui/src/App.tsx` | Main React component, multi-synth state management, header with tempo/save, WebSocket client |
| `ui/src/components/SynthUnit.tsx` | Wrapper combining Sequencer + SynthControls + Keyboard per synth |
| `ui/src/components/DrumMachine.tsx` | 8×16 drum grid, per-instrument knobs, master volume |
| `ui/src/components/DrumKnob.tsx` | SVG rotary knob (click-drag vertical) |
| `ui/src/components/Sequencer.tsx` | Step grid, load/manage patterns (save moved to header) |
| `ui/src/components/Keyboard.tsx` | 3-octave keyboard with octave shift (-1 to +1) |
| `ui/src/components/SynthControls.tsx` | Synth parameters panel — oscillator, filter, envelope, effects, gain |
| `ui/src/types.ts` | Shared TypeScript types (DrumState, SynthParameters, SavedPatternFull, etc.) |
| `engine/src/DrumSynthesizer.ts` | PCM generation for 8 drum sounds, `renderPattern()` |
| `engine/src/Synthesizer.ts` | Synth PCM generation, note rendering with ADSR + filter |
| `engine/src/types.ts` | Engine-side type definitions (mirrors ui/types.ts) |

## Features Complete
- **Multi-synth support**: Up to 2 independent synths, each with own sequencer/keyboard/controls, Synth 1 cannot be removed
- **16-step sequencer**: monophonic, piano key assignment, amber selection, blue fills
- **Synthesizer**: sine/square/sawtooth/triangle, detune, resonant lowpass, ADSR envelope, delay/reverb, master gain (0-2)
- **Octave shift**: -1 to +1 range per synth, disabled at limits
- **Global tempo**: shared BPM across all synths, editable LED in header
- **Header controls**: app title "Discobot", tempo LED, save button, mute, connection status
- **Drum machine**: 8 instruments (kick, snare, openHH, closedHH, ride, crash, snare2, clap), 16-step toggle grid, colored rows, per-instrument volume/tone/extra knobs, drum master volume
- **Browser audio preview**: synth notes (via OscillatorNode) + drum hits (via BufferSource from gen* functions) during both cell click and sequencer playback
- **Discord playback**: server renders full pattern PCM, sends via WebSocket, bot loops
- **Pattern persistence**: save/load/delete with name, stores steps, synth params, drum state, master volumes in `saved-patterns.json`
- **Responsive layout**: keyboard keys scale flexibly, drum grid cells fill available space, grid height matches controls panel
- **Soft-clipper master mix**: replaces hard normalization for louder drums
- **Drum debug logging**: `web/debug.log` captures step toggles, play events, PCM stats

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
npm run dev          # Run everything (bot + web + ui concurrently)
npm run dev:web      # API + WebSocket server only (tsx watch)
npm run dev:ui       # Web UI only (Vite dev server)
npm run dev:bot      # Discord bot only
npm run build        # Build all workspaces
npm run build:ui     # Build UI only (tsc + vite build)
```

## Conventions
- No comments in code unless explaining non-obvious logic
- `DrumState` always initialized with `createDefaultDrumState()` (never null)
- Server drum state in global `drumState` variable, client in React state + ref
- `renderPatternAudio()` produces base64 Int16 stereo PCM at 48kHz
- REST for data ops, WebSocket for real-time sync
- Browser gen* functions in App.tsx match engine DrumSynthesizer methods

## Recent Changes (commits b1effea..6015513)
- Multi-synth refactor: SynthUnit wrapper, backend Map<number, SynthData>, add/remove synth endpoints
- Keyboard octave shift with range display (C2-B4 / C3-B5 / C4-B6)
- Backend synthId routing for all REST + WebSocket messages
- Discord bot synthId option on /play, /stop, /note, /tempo
- Global tempo: single BPM shared across all synths, GET/POST /tempo endpoints
- Header UI: "Discobot" title, TempoDisplay LED, SavePattern inline save
- Moved tempo and save controls out of Sequencer into app header

## Potential Next Steps
- Real-time streaming (step-by-step instead of full pattern render)
- SamplePlayer implementation (currently stubbed)
- WAV download / audio export
- Authentication / rate limiting
