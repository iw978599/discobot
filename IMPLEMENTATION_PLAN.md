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