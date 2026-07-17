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
### PR #51: Throttle live playback update paths to prevent loop drift during synth/drum parameter edits

Source branch: `copilot/refactor-optimization-pass`
Last sync: 2026-07-17T14:19:38.233Z

#### Changed files
- `ui/src/App.tsx` — MODIFIED (+25/-10)
- `web/src/index.ts` — MODIFIED (+13/-1)
<!-- AUTO_PR_CHANGELOG_END -->
