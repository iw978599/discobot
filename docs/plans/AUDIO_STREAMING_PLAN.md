# Audio Streaming Implementation Plan

Based on the analysis of your discobot codebase, here's a plan for implementing the missing audio streaming feature from Tone.js to Discord voice channels:

## Problem Analysis
The current implementation in bot/src/index.ts sets up voice connections with:
1. `joinVoiceChannel` function (lines 163-170) 
2. But lacks audio streaming from the web server's Tone.js audio engine

## Solution Architecture

### 1. Audio Bridge Setup (in Web Server)
We need to modify the web server (web/src/index.ts) to:
- Capture audio output from Tone.js for streaming
- Convert to PCM format that Discord can consume
- Provide an API endpoint that bot can access

### 2. Voice Streaming in Bot (modify bot/src/index.ts)
We need to:
- Add audio streaming capability in the bot (this file)
- Create an audio streamer that connects Tone.js output to Discord voice
- Handle playback timing and synchronization

## Implementation Steps

### Step 1: Create Audio Streamer in Web Server
We'll need to modify web/src/index.ts to provide a PCM streaming endpoint that can be called by the bot.

### Step 2: Modify Bot Voice Streaming
Update bot/src/index.ts with proper audio streaming logic using @discordjs/voice capabilities.

## Key Technical Details
- Audio from Tone.js needs conversion from Web Audio to PCM format  
- Discord voice uses Opus codec (will need proper PCM bridging)
- The streaming must synchronize with the sequencer timing
- Handle memory management and cleanup properly

## Files to Modify:
1. web/src/index.ts - Add audio streaming endpoint
2. bot/src/index.ts - Implement voice streaming functionality

The main challenge is creating a bridge from Tone.js audio graph output to Discord's audio streaming format.

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
