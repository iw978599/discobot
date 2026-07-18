# Audio Streaming Implementation

## Problem Statement  
The discobot project has a complete Tone.js-based audio engine in the web server (engine package), but it lacks integration with Discord voice channels. Users can control audio through web UI and make patterns, but audio is not streamed to Discord voice channels.

## Root Cause Analysis
Looking at bot/src/index.ts, we can see:
1. Voice connection setup (lines 163-170) works properly
2. But no audio streaming implementation from Tone.js to Discord
3. The web server has the Tone.js engine but no way to stream its output

## Solution Approach

### Step 1: Web Server Audio Streaming Endpoint

We need to add a streaming endpoint in web/src/index.ts that allows the Discord bot to receive audio data from Tone.js.

### Step 2: Update Bot for Audio Streaming 

We need to modify bot/src/index.ts to:
- Implement proper audio streaming when a user joins a voice channel
- Connect to the web server's audio streaming endpoint 
- Stream PCM data to Discord voice

### Step 3: Integration Points

1. **WebSocket Connection** between bot and web server for real-time audio
2. **Audio Buffer Management** in web server  
3. **Discord Voice Streaming** from bot using @discordjs/voice

## Implementation Plan

### 1. Add Audio Streaming Service to Web Server

We'll add functionality to the web server that:
- Captures audio output from Tone.js 
- Converts to PCM format
- Makes available via API endpoint for bot streaming  

### 2. Update Bot Code to Stream Audio

Add new classes and functions in bot/src/index.ts for:
- AudioStream class to handle Discord voice streaming
- Integration with join/leave commands  
- `/stream` command to toggle audio streaming

## Key Files to Modify:

### web/src/index.ts
- Add audio streaming API endpoints  
- Implement buffer management
- Provide WebSocket access to audio stream

### bot/src/index.ts  
- Add AudioStreamingService class
- Enhance voice connection handling
- Add new slash commands for stream control

This approach uses best practices from the existing codebase while adding the missing audio streaming functionality.

<!-- AUTO_PR_CHANGELOG_START -->
### PR #54: Feat/multi synth save layout redesign

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T15:06:55.296Z

#### Changed files
- `.opencode/agent/discobot-developer.md` — MODIFIED (+3/-12)
- `.opencode/skills/discobot-dev/SKILL.md` — MODIFIED (+3/-12)
- `AGENTS.md` — MODIFIED (+3/-12)
- `README.md` — MODIFIED (+3/-12)
- `docs/guides/DEPLOYMENT.md` — MODIFIED (+3/-12)
- `docs/guides/FEATURE_TESTING_GUIDE.md` — MODIFIED (+3/-12)
- `docs/guides/HOSTING_QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/QUICK_START.md` — MODIFIED (+3/-12)
- `docs/guides/RAILWAY_DEPLOY.md` — MODIFIED (+3/-12)
- `docs/guides/README_STREAMING.md` — MODIFIED (+3/-12)
- `docs/guides/SETUP.md` — MODIFIED (+3/-12)
- `docs/plans/AUDIO_STREAMING_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/DRUM_SAMPLE_REPLACEMENT_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/EFFECTS_LOOP_INVESTIGATION.md` — MODIFIED (+3/-12)
- `docs/plans/IMPLEMENTATION_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/IMPROVEMENT_IDEAS.md` — MODIFIED (+3/-12)
- `docs/plans/MIDI_CONTROLLER_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/PIANO_ROLL_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_CLONE_OPTIONS_PLAN.md` — MODIFIED (+3/-12)
- `docs/plans/SYNTH_REFACTOR_PLAN.md` — MODIFIED (+3/-12)
- `docs/reference/AI_DEVELOPMENT_GUIDE.md` — MODIFIED (+3/-12)
- `docs/reference/AUDIO_STREAMING_CODE.md` — MODIFIED (+3/-12)
- `docs/reports/ERROR_HANDLING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/FINAL_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/HIGH_PRIORITY_WORK_COMPLETE.md` — MODIFIED (+3/-12)
- `docs/reports/PERFORMANCE_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reports/PROJECT_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/REFACTORING_SUMMARY.md` — MODIFIED (+3/-12)
- `docs/reports/SEQUENCER_TIMING_IMPROVEMENTS.md` — MODIFIED (+3/-12)
- `docs/reviews/CODE_REVIEW.md` — MODIFIED (+3/-12)
- `engine/src/types.ts` — MODIFIED (+1/-0)
- `start-ui.bat` — ADDED (+4/-0)
- `start-web.bat` — ADDED (+5/-0)
- `ui/src/App.css` — MODIFIED (+5/-6)
- `ui/src/App.tsx` — MODIFIED (+22/-21)
- `ui/src/components/DrumMachine.tsx` — MODIFIED (+19/-1)
- `ui/src/components/Keyboard.css` — MODIFIED (+2/-0)
- `ui/src/components/KeyboardPanel.css` — MODIFIED (+2/-0)
- `ui/src/hooks/useDrumAudio.ts` — MODIFIED (+6/-1)
- `web/src/index.ts` — MODIFIED (+3/-0)
<!-- AUTO_PR_CHANGELOG_END -->
