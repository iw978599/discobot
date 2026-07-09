---
name: discobot-dev
description: Provides guidance for developing, testing, and enhancing the Discord Synth Bot with web UI integration.
---

# Discord Synth Bot Development Skill

This skill helps with working on the Discord Synth Bot project which combines a Discord bot with web-based audio synthesis.

## Project Overview

The discobot is a monorepo with these packages:
- **bot/**: Discord bot using discord.js v14 and @discordjs/voice
- **engine/**: Audio synthesis engine based on Tone.js 
- **web/**: Express server with WebSocket for real-time synchronization
- **ui/**: React web interface with Vite

## Key Technical Details

### Architecture
- Data Flow: Web UI ↔ WebSocket ↔ Web Server ↔ REST API ↔ Discord Bot
- Audio Engine runs in the web server, not browser or bot (centralized audio state)
- State is stored in web server and synchronized via WebSocket to all connected clients

### Main Components
- **Synthesizer.ts**: Tone.js-based synth with oscillators, filter, effects 
- **Sequencer.ts**: 16-step sequencer with Tone.Transport
- **SamplePlayer.ts**: Sample loading and playback
- **AudioExporter.ts**: WAV export functionality

### Audio Streaming Implementation
Currently implemented but not working yet:
- Audio capture from Tone.js output 
- PCM streaming to Discord voice via @discordjs/voice
- Needs PCM bridge between Tone.js audio graph and Discord voice stream

## Common Development Tasks

### Setting Up Development Environment
1. Make sure Node.js 18+ is installed (you have v24.18.0)
2. Create a Discord application at https://discord.com/developers/applications  
3. Add bot to your test server with proper permissions
4. Copy `.env.example` to `.env` and update with credentials

### Running Development Server
```bash
# Run everything (recommended for development)
npm run dev

# Run individual services 
npm run dev:bot    # Discord bot only
npm run dev:web    # API + WebSocket server only  
npm run dev:ui     # Web UI only (Vite dev server)
```

### Testing Checklist
- [ ] UI connects to WebSocket (green indicator)
- [ ] Clicking sequencer grid toggles steps
- [ ] Play/Stop button works
- [ ] Sequencer steps highlight during playback
- [ ] Keyboard plays notes
- [ ] Synth controls update in real-time
- [ ] Discord bot responds to `/join`, `/leave`
- [ ] Discord bot responds to `/play`, `/stop`
- [ ] Multiple browser tabs stay in sync

## Key Files to Modify

### Audio Streaming (Voice Connection)
- `bot/src/index.ts` (lines ~175-220): Voice connection setup  
- Need to add: Audio capture from Tone.js, PCM streaming

### Audio Export
- `engine/src/AudioExporter.ts`: Export logic exists
- `web/src/index.ts`: Add `/export` endpoint  
- `bot/src/index.ts` (line ~280): Handle export command

### Sample Management UI
- `engine/src/SamplePlayer.ts`: Backend ready
- `web/src/index.ts` (lines ~135-170): API endpoints exist  
- Need: `ui/src/components/SampleManager.tsx`

## Development Commands

### Using npm workspaces
```bash
npm install
npm run dev              # Run all services
npm run dev:bot          # Discord bot only
npm run dev:web          # Web server only
npm run dev:ui           # UI only (Vite)
npm run build            # Build for production  
npm start                # Start production
```

## Troubleshooting

### No audio in UI
- Check browser console, Tone.js needs user interaction to start
- Ensure audio context is correctly initialized

### WebSocket won't connect  
- Make sure all three processes are running
- Check ports configured in environment variables

### Discord commands don't work
- Verify bot token, client ID are correct
- Confirm required intents are enabled (Server Members, Message Content)

## Future Enhancements  

1. **Audio Streaming to Discord**: Bridge Tone.js output to PCM for Discord voice
2. **Pattern Persistence**: Store patterns in database instead of memory
3. **Sample Management UI**: File upload support and sample display 
4. **Multiple Tracks**: Support for multiple sequencer tracks playing simultaneously
5. **MIDI Input**: Add MIDI device support