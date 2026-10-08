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

## Historical Reference

The remaining notes describe the former Discord/server implementation, not the
current architecture. Deleted paths and legacy network/auth conventions below
must not be reintroduced.

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
npm ci               # Install locked dependencies
npm run dev          # Browser UI only
npm run dev:ui       # Alias for UI development
npm run build        # Build engine and UI
npm run build:ui     # Build UI only (tsc + vite build)
npm start            # Static production-build preview
npm run typecheck
npm test
npm run test:browser
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
### PR #58: [WIP] Strip all Discord functionality and configure site for GitHub Pages

Source branch: `copilot/strip-discord-functionality`
Last sync: 2026-10-08T18:30:00.532Z

#### Changed files
- `.dockerignore` — REMOVED (+0/-41)
- `.env.example` — REMOVED (+0/-25)
- `.github/workflows/ci.yml` — ADDED (+25/-0)
- `.github/workflows/docker-image.yml` — REMOVED (+0/-18)
- `.github/workflows/pages.yml` — ADDED (+45/-0)
- `.gitignore` — MODIFIED (+6/-0)
- `.opencode/agent/discobot-developer.md` — REMOVED (+0/-97)
- `.opencode/skills/discobot-dev/SKILL.md` — REMOVED (+0/-145)
- `AGENTS.md` — MODIFIED (+36/-13)
- `Dockerfile` — REMOVED (+0/-60)
- `Dockerfile.railway` — REMOVED (+0/-64)
- `README.md` — MODIFIED (+83/-329)
- `bot/package.json` — REMOVED (+0/-28)
- `bot/src/index.ts` — REMOVED (+0/-585)
- `bot/tsconfig.json` — REMOVED (+0/-9)
- `deploy.sh` — REMOVED (+0/-52)
- `docker-compose.yml` — REMOVED (+0/-59)
- `docs/CONTROL_AUDIT.md` — ADDED (+80/-0)
- `docs/REFACTOR_HANDOFF.txt` — ADDED (+192/-0)
- `docs/guides/DEPLOYMENT.md` — REMOVED (+0/-562)
- `docs/guides/FEATURE_TESTING_GUIDE.md` — REMOVED (+0/-105)
- `docs/guides/HOSTING_QUICK_START.md` — REMOVED (+0/-201)
- `docs/guides/QUICK_START.md` — REMOVED (+0/-104)
- `docs/guides/RAILWAY_DEPLOY.md` — REMOVED (+0/-262)
- `docs/guides/README_STREAMING.md` — REMOVED (+0/-63)
- `docs/guides/SETUP.md` — REMOVED (+0/-167)
- `docs/plans/AUDIO_STREAMING_PLAN.md` — REMOVED (+0/-70)
- `docs/plans/DRUM_SAMPLE_REPLACEMENT_PLAN.md` — REMOVED (+0/-118)
- `docs/plans/EFFECTS_LOOP_IMPLEMENTATION_PLAN.md` — REMOVED (+0/-95)
- `docs/plans/EFFECTS_LOOP_INVESTIGATION.md` — REMOVED (+0/-107)
- `docs/plans/IMPLEMENTATION_PLAN.md` — REMOVED (+0/-87)
- `docs/plans/IMPROVEMENT_IDEAS.md` — REMOVED (+0/-165)
- `docs/plans/MIDI_CONTROLLER_PLAN.md` — REMOVED (+0/-288)
- `docs/plans/PIANO_ROLL_PLAN.md` — REMOVED (+0/-157)
- `docs/plans/SYNTH_CLONE_OPTIONS_PLAN.md` — REMOVED (+0/-148)
- `docs/plans/SYNTH_REFACTOR_PLAN.md` — REMOVED (+0/-368)
- `docs/reference/AI_DEVELOPMENT_GUIDE.md` — REMOVED (+0/-493)
- `docs/reference/AUDIO_STREAMING_CODE.md` — REMOVED (+0/-267)
- `docs/reports/ERROR_HANDLING_IMPROVEMENTS.md` — REMOVED (+0/-432)
- `docs/reports/FINAL_SUMMARY.md` — REMOVED (+0/-401)
- `docs/reports/HIGH_PRIORITY_WORK_COMPLETE.md` — REMOVED (+0/-344)
- `docs/reports/PERFORMANCE_IMPROVEMENTS.md` — REMOVED (+0/-308)
- `docs/reports/PROJECT_SUMMARY.md` — REMOVED (+0/-188)
- `docs/reports/REFACTORING_SUMMARY.md` — REMOVED (+0/-373)
- `docs/reports/SEQUENCER_TIMING_IMPROVEMENTS.md` — REMOVED (+0/-255)
- `docs/reviews/CODE_REVIEW.md` — REMOVED (+0/-582)
- `ecosystem.config.js` — REMOVED (+0/-37)
- `engine/package.json` — MODIFIED (+2/-5)
- `engine/src/AudioContextManager.ts` — MODIFIED (+1/-1)
- `engine/src/AudioContextPolyfill.ts` — REMOVED (+0/-17)
- `engine/src/AudioExporter.ts` — MODIFIED (+19/-16)
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+24/-19)
- `engine/src/Streaming.ts` — REMOVED (+0/-89)
- `engine/src/StreamingSynth.ts` — MODIFIED (+53/-82)
- `engine/src/Synthesizer.ts` — MODIFIED (+30/-78)
- `engine/src/constants.ts` — MODIFIED (+0/-8)
- `engine/src/dsp.ts` — ADDED (+44/-0)
- `engine/src/index.ts` — MODIFIED (+1/-9)
- `engine/src/types.ts` — MODIFIED (+4/-0)
- `engine/test/audio.test.ts` — ADDED (+139/-0)
- `nginx-docker.conf` — REMOVED (+0/-32)
- `nginx.conf` — REMOVED (+0/-104)
- `opencode.json` — REMOVED (+0/-34)
- `package-lock.json` — MODIFIED (+848/-2787)
- `package.json` — MODIFIED (+10/-14)
- `playwright.config.ts` — ADDED (+33/-0)
- `railway.json` — REMOVED (+0/-7)
- `setup-discord-dependencies.ps1` — REMOVED (+0/-48)
- `setup-final.ps1` — REMOVED (+0/-77)
- `start-ui.bat` — REMOVED (+0/-4)
- `start-web.bat` — REMOVED (+0/-5)
- `supervisord.conf` — REMOVED (+0/-23)
- `ui/index.html` — MODIFIED (+2/-2)
- `ui/package.json` — MODIFIED (+2/-2)
- `ui/public/synth-processor.js` — MODIFIED (+159/-196)
- `ui/src/App.css` — MODIFIED (+0/-24)
- `ui/src/App.tsx` — MODIFIED (+411/-377)
- `ui/src/authClient.ts` — REMOVED (+0/-68)
- `ui/src/components/DrumKnob.css` — MODIFIED (+4/-0)
- `ui/src/components/DrumKnob.tsx` — MODIFIED (+23/-35)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+52/-9)
- `ui/src/components/EffectsPanel.tsx` — MODIFIED (+18/-0)
- `ui/src/components/Keyboard.tsx` — MODIFIED (+84/-30)
- `ui/src/components/KeyboardPanel.tsx` — MODIFIED (+4/-0)
- `ui/src/components/Knob.css` — MODIFIED (+5/-0)
- `ui/src/components/Knob.tsx` — MODIFIED (+22/-36)
- `ui/src/components/MidiPanel.css` — MODIFIED (+5/-0)
- `ui/src/components/MidiPanel.tsx` — MODIFIED (+15/-4)
- `ui/src/components/MixerPanel.css` — MODIFIED (+0/-2)
- `ui/src/components/MixerPanel.tsx` — MODIFIED (+18/-0)
- `ui/src/components/PianoRoll.css` — MODIFIED (+5/-0)
- `ui/src/components/PianoRoll.tsx` — MODIFIED (+54/-6)
- `ui/src/components/SamplePanel.css` — ADDED (+49/-0)
- `ui/src/components/SamplePanel.tsx` — ADDED (+59/-0)
- `ui/src/components/Sequencer.css` — MODIFIED (+3/-0)
- `ui/src/components/Sequencer.tsx` — MODIFIED (+57/-19)
- `ui/src/components/SynthControls.css` — MODIFIED (+16/-2)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+90/-6)
- `ui/src/components/SynthUnit.tsx` — MODIFIED (+2/-2)
- `ui/src/components/useKnobInteraction.ts` — ADDED (+52/-0)
- `ui/src/config.ts` — REMOVED (+0/-51)
- `ui/src/hooks/browserAudio.ts` — ADDED (+241/-0)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+66/-125)
- `ui/src/hooks/useMidiInput.ts` — MODIFIED (+24/-1)
- `ui/src/hooks/usePatternAudio.ts` — REMOVED (+0/-170)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+103/-328)
- `ui/src/hooks/useWebSocket.ts` — REMOVED (+0/-63)
- `ui/src/services/browserTransport.ts` — ADDED (+68/-0)
- `ui/src/services/drumKits.ts` — ADDED (+21/-0)
- `ui/src/services/localService.ts` — ADDED (+330/-0)
- `ui/src/services/projectSanitization.ts` — ADDED (+169/-0)
- `ui/src/services/sampleStore.ts` — ADDED (+96/-0)
- `ui/src/services/wavExport.ts` — ADDED (+167/-0)
- `ui/src/synthModels.ts` — MODIFIED (+20/-19)
- `ui/src/types.ts` — MODIFIED (+3/-3)
- `ui/src/utils/midiExport.ts` — MODIFIED (+19/-10)
- `ui/src/utils/midiImport.ts` — MODIFIED (+56/-11)
- `ui/test/audio-routing.test.ts` — ADDED (+101/-0)
- `ui/test/audio-worklet.test.ts` — ADDED (+148/-0)
- `ui/test/browser/controls.spec.ts` — ADDED (+469/-0)
- `ui/test/browser/local-app.spec.ts` — ADDED (+127/-0)
- `ui/test/localService.test.ts` — ADDED (+171/-0)
- `ui/test/static.test.ts` — ADDED (+30/-0)
- `ui/vite.config.ts` — MODIFIED (+2/-1)
- `web/package.json` — REMOVED (+0/-27)
- `web/src/authFallback.ts` — REMOVED (+0/-8)
- `web/src/index.ts` — REMOVED (+0/-2675)
- `web/src/sessionAuth.ts` — REMOVED (+0/-14)
- `web/src/tests/authFallback.test.ts` — REMOVED (+0/-18)
- `web/src/tests/sessionAuth.test.ts` — REMOVED (+0/-27)
- `web/src/tests/wsHelpers.test.ts` — REMOVED (+0/-31)
- `web/src/wsHelpers.ts` — REMOVED (+0/-45)
- `web/tsconfig.json` — REMOVED (+0/-9)
<!-- AUTO_PR_CHANGELOG_END -->
