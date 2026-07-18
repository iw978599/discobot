# Discord Audio Streaming

## Current Status

Discord streaming is implemented and active.

## How It Works

1. Engine renders pattern audio as PCM using custom math synthesis (no Tone.js).
2. Web server mixes/encodes audio and broadcasts `patternAudio` over WebSocket.
3. Bot receives `patternAudio` and plays the PCM loop in Discord voice.
4. Audio is 48kHz stereo 16-bit raw PCM with soft-clipped master mix.
5. `DiscordAudioStreamer` renders 16s segments as 0.1s chunks for smooth playback.

## Runtime Endpoints and Paths

- API base: `http://localhost:3001`
- UI WebSocket: `ws://localhost:3001/ws`
- Bot WebSocket: `ws://localhost:3001/ws/bot`

## Relevant Files

- `engine/src/Synthesizer.ts` — Synth PCM generation with filter, ADSR, dual LFOs
- `engine/src/DrumSynthesizer.ts` — Drum PCM generation, 3 kit variants
- `engine/src/Streaming.ts` — `DiscordAudioStreamer` class
- `engine/src/AudioExporter.ts` — WAV export (available, not wired to UI)
- `web/src/index.ts` — `renderPatternAudio()`, effects loop processing, WebSocket broadcast
- `bot/src/index.ts` — Voice connection, PCM playback loop

## Notes

- Streaming is pattern-loop based (not per-step live streaming).
- The shared effects loop (drive, phaser, delay, reverb) is applied during server-side rendering.
- Browser preview uses Web Audio API with a parallel shared effects bus.
- Sample-player streaming paths are still limited by the current sample stub implementation.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #52: Feat/multi synth save layout redesign

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T12:38:44.155Z

#### Changed files
- `engine/src/types.ts` — MODIFIED (+9/-0)
- `ui/src/App.css` — MODIFIED (+42/-16)
- `ui/src/App.tsx` — MODIFIED (+294/-127)
- `ui/src/components/SynthUnit.css` — MODIFIED (+10/-45)
- `ui/src/components/SynthUnit.tsx` — MODIFIED (+23/-99)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+27/-13)
- `ui/src/hooks/usePatternAudio.ts` — MODIFIED (+29/-6)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+28/-1)
- `ui/src/types.ts` — MODIFIED (+1/-0)
- `web/src/index.ts` — MODIFIED (+44/-26)
<!-- AUTO_PR_CHANGELOG_END -->
