# Discobot — AI Context / Restore Prompt

## Project Overview
Web-controlled Discord synth/sequencer/drum bot. Monorepo with 4 npm workspaces. Audio engine runs in Node.js (no Tone.js — custom math synthesis). WebSocket drives real-time UI sync.

## Architecture
```
discobot/
├── bot/       # Discord bot (Discord.js, @discordjs/voice)
├── engine/    # Custom math-based audio synthesis (no Tone.js)
├── web/       # Express API (3001) + WebSocket server (3001/ws)
└── ui/        # React web interface (Vite, port 3000)
```

### Audio Flow
Engine renders PCM → Web server base64-encodes → WebSocket → Bot broadcasts via Discord voice (48kHz stereo 16-bit raw PCM, soft-clipped master mix)

### WebSocket Messages
`init`, `connectedUsers`, `synthCreated`, `synthRemoved`, `synthUpdate`, `synthModelUpdate`, `synthMix`, `sequencerStep`, `sequencerPlay`, `sequencerStop`, `patternAudio`, `patternUpdated`, `patternCreated`, `tempoChange`, `drumStep`, `drumSettings`, `drumMix`, `drumReset`, `drumFullState`, `drumKitChanged`, `effectsLoopUpdate`, `drumFxUpdate`, `sampleLoaded`, `sampleRemoved`

## Key Files
| File | Purpose |
|------|---------|
| `web/src/index.ts` | Express + WebSocket server, REST endpoints, drum/synth state, audio rendering, effects loop, auth |
| `web/src/wsHelpers.ts` | WebSocket channel routing (ui/bot), origin validation (`isAllowedUpgradeOrigin`) |
| `web/src/sessionAuth.ts` | Role assignment (owner/collaborator), `canControl`, `scopedRecipients` |
| `web/src/authFallback.ts` | Bearer header detection for compatibility mode |
| `ui/src/App.tsx` | Main React component, multi-synth state, header with tempo/save/undo, WebSocket client, MIDI export |
| `ui/src/config.ts` | Smart base URL detection, WebSocket URL builder with session token |
| `ui/src/authClient.ts` | `authFetch` with Bearer + CSRF headers, session exchange |
| `ui/src/synthModels.ts` | 6 synth model definitions (generic, minimoog, juno-106, dx7, tb-303, prophet-5), macro mapping |
| `ui/src/components/SynthUnit.tsx` | Wrapper combining Sequencer + SynthControls + Keyboard per synth, add/remove, mix toggle |
| `ui/src/components/KeyboardPanel.tsx` | Toggle wrapper between Keyboard and PianoRoll modes |
| `ui/src/components/PianoRoll.tsx` | Grid editor: 3 octaves × 16 steps, click/drag paint/erase |
| `ui/src/components/Sequencer.tsx` | Step grid (16/32), velocity per step, pattern manager modal |
| `ui/src/components/Keyboard.tsx` | 3-octave keyboard with octave shift (-1 to +1), hold mode |
| `ui/src/components/SynthControls.tsx` | Oscillator, filter, envelope, dual LFOs, FX sends, arpeggiator, synth model selector, presets |
| `ui/src/components/EffectsPanel.tsx` | Shared effects loop UI: drive, phaser, delay, reverb with per-effect toggles |
| `ui/src/components/MidiPanel.tsx` | MIDI device selector, mode (live/record/step), channel, synth target routing |
| `ui/src/components/DrumMachine.tsx` | 8×16 grid, per-instrument knobs, kit selector (3 kits), master volume, drum FX sends |
| `ui/src/components/Knob.tsx` | Enhanced knob: size variants, color, tooltip, editable input, SVG rotary |
| `ui/src/components/DrumKnob.tsx` | Draggable drum-specific knob (vertical drag) |
| `ui/src/hooks/useSynthAudio.ts` | Browser synth: oscillator bank, dual LFOs, filter, ADSR, arpeggiator (7 modes), shared FX bus (drive/reverb/delay/phaser) |
| `ui/src/hooks/usePatternAudio.ts` | Server-side pattern playback: base64 PCM decode, stereo AudioBuffer, looped playback, mute toggle |
| `ui/src/hooks/useMidiInput.ts` | Web MIDI API: device enumeration, channel filtering, noteOn/noteOff/CC parsing, "all devices" mode |
| `ui/src/hooks/useDrumAudio.ts` | Browser drum playback via `DrumSynthesizer.renderHit()`, PCM validation |
| `ui/src/hooks/useWebSocket.ts` | Auto-reconnecting WebSocket (3s reconnect), JSON parsing |
| `ui/src/utils/midiExport.ts` | Standard MIDI File export (Type 0, PPQ=480, multi-synth lanes, drums on channel 10) |
| `engine/src/types.ts` | All type definitions (single source of truth): `SynthParameters`, `DrumState`, `EffectsLoopState`, `FxSendLevels`, `SynthModelId`, `DrumKitId`, `Pattern`, `SavedPatternFull` |
| `engine/src/Synthesizer.ts` | Synth PCM generation: oscillator, filter, ADSR, dual LFOs, soft-clip master mix |
| `engine/src/DrumSynthesizer.ts` | 8 drum instruments with 8 kit variants (3 generic + 5 drum machine clones), humanization, sample layer blending |
| `engine/src/StreamingSynth.ts` | 8-voice poly chunk-based renderer with persistent oscillator/filter/envelope state, sample-accurate note scheduling |
| `engine/src/Sequencer.ts` | setTimeout-based pattern scheduler |
| `engine/src/SequencerV2.ts` | Improved scheduler using `audioContextManager.getContext().currentTime`, look-ahead, pause/resume |
| `engine/src/Streaming.ts` | `DiscordAudioStreamer`: renders 16s segments as 0.1s chunks for Discord voice |
| `engine/src/AudioExporter.ts` | WAV export: `exportPattern`, `exportNotes`, `encodeWAV` |
| `engine/src/AudioContextManager.ts` | Singleton AudioContext with resume-on-suspend, dispose, `createOfflineContext` |
| `engine/src/errors.ts` | Custom error classes, `Result<T,E>` type, `Ok`/`Err`/`tryCatch`/`tryCatchAsync`, validation helpers |
| `engine/src/constants.ts` | Named constants for audio params, drum params, sequencer settings |
| `engine/src/utils.ts` | `clamp`, `noteToFrequency`, `deepMerge`, `throttle`, `isValidTempo`, `isValidVelocity` |

## Features Complete
- **Multi-synth support**: Up to 3 independent synths, each with own sequencer/keyboard/controls, Synth 1 cannot be removed
- **16/32-step sequencer**: monophonic, piano key assignment, amber selection, blue fills, per-step velocity
- **Piano roll editor**: Per-synth keyboard/piano-roll toggle with click/drag note painting on shared step data
- **Synthesizer**: sine/square/sawtooth/triangle, detune, resonant lowpass, ADSR envelope, dual LFOs (pitch/filter targets), arpeggiator (7 modes), synth model selector (6 vintage models), presets (save/load/delete with local storage persistence)
- **Octave shift**: -1 to +1 range per synth, disabled at limits
- **Shared effects loop**: drive (waveshaper), phaser, delay, reverb (convolver) — per-synth send levels, master on/off, per-effect toggles
- **MIDI input**: Web MIDI API with device selector ("All devices" option), live/record/step modes, channel routing, synth target selection
- **MIDI export**: Standard MIDI File download with tempo meta event, multi-synth lanes, drums on channel 10
- **Undo/redo**: Per-pattern undo stack for note/velocity/parameter edits, keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z)
- **Global tempo**: shared BPM across all synths, editable LED in header
- **Header controls**: "Discobot" title + active pattern badge, tempo LED, Play/Stop All, Save/Load, MIDI panel, Help modal, Undo/Redo, Export MIDI, reset/mute, connection status
- **Drum machine**: 8 instruments with 3 kit variants (clean-analog, punchy-modern, lofi-dirty), 16-step toggle grid, per-instrument volume/tone/extra knobs, mute/solo per track, master volume, drum FX sends (reverb/delay/drive/phaser), drum loop return
- **Browser audio preview**: Synth notes (via OscillatorNode with shared FX bus) + drum hits (via DrumSynthesizer.renderHit()) during both cell click and sequencer playback
- **Discord playback**: Server renders full pattern PCM, sends via WebSocket, bot loops in voice channel
- **Pattern persistence**: save/load/delete with name, stores steps, synth params, drum state, drum kit, effects loop, master volumes in `saved-patterns.json`
- **Responsive layout**: SynthUnit 2-column grid (controls + sequencer/keyboard), drum grid cells fill available space
- **Soft-clipper master mix**: Replaces hard normalization for louder drums
- **Auth system**: Discord OAuth2 login flow, session tokens with TTL, CSRF validation, HMAC-signed bot requests, role-based access (owner/collaborator/bot)
- **Connected users**: Real-time user presence display in header
- **Real-time streaming**: StreamingSynth renders 20ms PCM chunks, WebSocket sends to Discord, sample-accurate note scheduling
- **WebSocket keepalive**: Ping/pong every 15s prevents idle disconnects
- **Stereo panning**: Per-synth stereo pan control
- **Portamento**: Per-synth glide between notes
- **MIDI import**: Import MIDI files with track selection and tempo detection
- **Drum machine clones**: 5 classic drum machine presets (TR-808, TR-909, LinnDrum, Oberheim DMX, TR-707)

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
- Engine types are single source of truth (`engine/src/types.ts`), UI re-exports via `ui/src/types.ts`
- Auth: bot signs requests with HMAC (`x-bot-timestamp` + `x-bot-signature`), UI uses Bearer + CSRF tokens
- Synth models defined in `ui/src/synthModels.ts`, mapped to engine params via `mapSynthModelToEngineParams`

## Known Issues
- `SamplePlayer` is stubbed (not functional)
- Serial effects chain causes cumulative dry attenuation
- Drum sends carry post-processed signal (potential double-saturation)
- Synth insert effects bypassed during pattern rendering (by design — only shared FX loop applies)
- Firefox/Safari lack Web MIDI API support

## Potential Next Steps
- SamplePlayer implementation
- WAV download / audio export (engine has `AudioExporter`, not wired to UI)
- Song mode / pattern chaining
- Voice polyphony
- Per-step drum velocity

<!-- AUTO_PR_CHANGELOG_START -->
### PR #55: Scrollable drum panel, compact MIDI bar, shorter keyboard/piano-roll

Source branch: `feat/ui-layout-refinements`
Last sync: 2026-07-18T16:42:19.654Z

#### Changed files
- `ui/src/App.css` — MODIFIED (+1/-0)
- `ui/src/components/Keyboard.css` — MODIFIED (+5/-5)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+1/-1)
- `ui/src/components/MidiPanel.css` — MODIFIED (+25/-38)
- `ui/src/components/MidiPanel.tsx` — MODIFIED (+35/-52)
- `ui/src/components/PianoRoll.css` — MODIFIED (+1/-1)
<!-- AUTO_PR_CHANGELOG_END -->
