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
### PR #50: Rework drum engine with per-instrument tune/humanize controls and relocate FX panel below drums

Source branch: `copilot/rework-drum-sounds`
Last sync: 2026-07-16T23:07:58.545Z

#### Changed files
- Unable to fetch changed files from API (transient error).
<!-- AUTO_PR_CHANGELOG_END -->
