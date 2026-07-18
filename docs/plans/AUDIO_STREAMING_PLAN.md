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
### PR #56: Add LFO tempo sync, stereo spread, drum velocity per step, envelope v…

Source branch: `feat/effects-mixer-improvements`
Last sync: 2026-07-18T19:08:07.568Z

#### Changed files
- `engine/src/DrumSynthesizer.ts` — MODIFIED (+9/-2)
- `engine/src/StreamingSynth.ts` — MODIFIED (+47/-11)
- `engine/src/Synthesizer.ts` — MODIFIED (+52/-4)
- `engine/src/types.ts` — MODIFIED (+5/-0)
- `ui/public/synth-processor.js` — MODIFIED (+17/-7)
- `ui/src/App.css` — MODIFIED (+40/-0)
- `ui/src/App.tsx` — MODIFIED (+146/-6)
- `ui/src/components/DrumMachine.css` — MODIFIED (+41/-0)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+91/-8)
- `ui/src/components/EffectsPanel.tsx` — MODIFIED (+0/-8)
- `ui/src/components/MixerPanel.css` — ADDED (+248/-0)
- `ui/src/components/MixerPanel.tsx` — ADDED (+196/-0)
- `ui/src/components/Sequencer.css` — MODIFIED (+12/-0)
- `ui/src/components/Sequencer.tsx` — MODIFIED (+6/-0)
- `ui/src/components/SynthControls.css` — MODIFIED (+48/-0)
- `ui/src/components/SynthControls.tsx` — MODIFIED (+92/-24)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+4/-2)
- `ui/src/hooks/useSynthAudio.ts` — MODIFIED (+16/-6)
- `web/src/index.ts` — MODIFIED (+174/-11)
<!-- AUTO_PR_CHANGELOG_END -->
