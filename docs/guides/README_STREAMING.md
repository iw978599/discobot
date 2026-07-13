# Discord Audio Streaming

## Current Status

Discord streaming is implemented and active.

## How It Works

1. Engine renders pattern audio as PCM.
2. Web server mixes/encodes audio and broadcasts `patternAudio` over WebSocket.
3. Bot receives `patternAudio` and plays the PCM loop in Discord voice.

## Runtime Endpoints and Paths

- API base: `http://localhost:3001`
- UI WebSocket: `ws://localhost:3001/ws`
- Bot WebSocket: `ws://localhost:3001/ws/bot`

## Relevant Files

- `engine/src/Synthesizer.ts`
- `engine/src/DrumSynthesizer.ts`
- `engine/src/Streaming.ts`
- `web/src/index.ts`
- `bot/src/index.ts`

## Notes

- Streaming is pattern-loop based (not per-step live streaming).
- Sample-player streaming paths are still limited by the current sample stub implementation.