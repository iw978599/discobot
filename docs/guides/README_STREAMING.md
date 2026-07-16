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
