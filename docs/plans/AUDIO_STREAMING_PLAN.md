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
