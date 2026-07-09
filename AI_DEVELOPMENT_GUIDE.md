# Discord Synth Bot - AI Development Guide

This document is for AI assistants who will be working on this project in the future.

## Project Overview

A Discord bot with a web-based UI for creating music using synthesis and sequencing. Users can:
- Program 16-step sequences in a web interface
- Play notes on a 3-octave virtual keyboard
- Adjust synthesizer parameters (oscillators, filters, reverb, delay)
- Control the bot via Discord slash commands
- Stream audio to Discord voice channels (partially implemented)
- Export patterns to WAV files (planned)

## Architecture

### Monorepo Structure (npm workspaces)

```
discord-synth-bot/
├── bot/          # Discord bot (TypeScript)
│   └── src/
│       └── index.ts          # Main bot file, Discord.js, slash commands
├── engine/       # Audio synthesis & sequencer engine (TypeScript)
│   └── src/
│       ├── Synthesizer.ts    # Tone.js-based synth with oscillators, filter, effects
│       ├── Sequencer.ts      # 16-step sequencer with Tone.Transport
│       ├── SamplePlayer.ts   # Sample loading and playback
│       ├── AudioExporter.ts  # WAV export using offline rendering
│       └── types.ts          # Shared types
├── web/          # Express API server + WebSocket (TypeScript)
│   └── src/
│       └── index.ts          # REST API + WebSocket for real-time sync
└── ui/           # React frontend with Vite (TypeScript)
    └── src/
        ├── App.tsx           # Main app component
        ├── components/
        │   ├── Sequencer.tsx # 16-step grid
        │   ├── Keyboard.tsx  # 3-octave piano keyboard
        │   └── SynthControls.tsx # Parameter knobs/sliders
        └── hooks/
            └── useWebSocket.ts

```

### Data Flow

1. **User interacts with Web UI** → HTTP/WebSocket to Web Server
2. **Web Server** updates audio engine state, broadcasts to all clients via WebSocket
3. **Discord Bot** receives commands → HTTP requests to Web Server
4. **Audio Engine** (Tone.js) generates audio in Web Server process
5. **Real-time updates** flow from Web Server → WebSocket → all connected clients

### Key Technologies

- **Discord.js v14**: Discord bot framework
- **Tone.js**: Web Audio API wrapper for synthesis
- **Express**: REST API server
- **WebSocket (ws)**: Real-time bidirectional communication
- **React**: Frontend UI
- **Vite**: Frontend build tool
- **TypeScript**: Type safety across entire stack

## Important Concepts

### Audio Engine (Tone.js)

The audio engine runs in the **web server**, not the browser or Discord bot. This is intentional:
- Tone.js uses Web Audio API, which works in Node.js
- Centralized audio state allows multiple clients to stay in sync
- Discord bot can trigger audio without running a browser

### State Management

State is stored in the web server (`web/src/index.ts`):
- `patterns` Map: All sequencer patterns
- `synth`: Current Synthesizer instance
- `sequencer`: Current Sequencer instance
- `samplePlayer`: Sample management

Changes propagate via WebSocket to all connected clients (UI, bots).

### WebSocket Messages

Format: `{ type: string, data: any }`

Message types:
- `init`: Initial state on connection
- `synthUpdate`: Synth parameters changed
- `patternCreated/Updated/Deleted`: Pattern CRUD
- `sequencerPlay/Stop`: Playback control
- `sequencerStep`: Current step update (for visualization)
- `tempoChange`: BPM update
- `sampleLoaded/Removed`: Sample management

## Development Commands

```bash
# Install dependencies (from root)
npm install

# Run everything in dev mode (recommended)
npm run dev

# Run individual services
npm run dev:bot   # Discord bot only
npm run dev:web   # API + WebSocket server only
npm run dev:ui    # Web UI only (Vite dev server)

# Build for production
npm run build

# Start production build
npm start
```

## Environment Variables

Required in `.env` file (root directory):

```bash
DISCORD_TOKEN=your_bot_token          # From Discord Developer Portal
DISCORD_CLIENT_ID=your_app_id         # From Discord Developer Portal
WEB_PORT=3001                         # API server port
UI_PORT=3000                          # Vite dev server port
WS_PORT=8080                          # WebSocket server port
WEB_API_URL=http://localhost:3001    # For bot to connect to API
WS_URL=ws://localhost:8080            # For bot to connect to WebSocket
```

## Discord Bot Setup

1. Create application at https://discord.com/developers/applications
2. Add bot, copy token to `.env`
3. Enable intents: Server Members, Message Content
4. Generate invite URL with scopes: `bot`, `applications.commands`
5. Add permissions: Connect, Speak, Use Voice Activity
6. Invite bot to your server

## Known Issues & TODOs

### Audio Streaming to Discord

**Current Status**: Partially implemented but not working yet.

**The Problem**: 
- Tone.js generates audio in Web Audio API format
- Discord voice requires PCM audio stream
- Need to bridge: Tone.js → PCM buffer → Discord voice

**Implementation Path**:
1. Create audio recorder in web server that captures Tone.js output
2. Use `@discordjs/voice` to create audio resource from PCM stream
3. Pipe audio to voice connection
4. Handle timing/buffering issues

**Relevant Files**:
- `bot/src/index.ts` (lines ~175-220): Voice connection setup
- Need to add: Audio capture from Tone.js, PCM streaming

### Audio Export

**Current Status**: `/export` command exists but doesn't work.

**The Problem**:
- `AudioExporter.ts` uses Tone.Offline for rendering
- Need REST endpoint to trigger export
- Need file storage/download mechanism

**Implementation Path**:
1. Add `POST /export/:patternId` endpoint to web server
2. Use `AudioExporter.exportPattern()` to render pattern
3. Save WAV to disk or return as response
4. Discord bot downloads and sends as attachment

**Relevant Files**:
- `engine/src/AudioExporter.ts`: Export logic exists
- `web/src/index.ts`: Add `/export` endpoint
- `bot/src/index.ts` (line ~280): Handle export command

### Sample Management

**Current Status**: Backend exists, no UI yet.

**Implementation Path**:
1. Create `SampleManager.tsx` component
2. Add file upload or URL input
3. Display loaded samples
4. Add play/delete buttons
5. Wire up to existing API endpoints

**Relevant Files**:
- `engine/src/SamplePlayer.ts`: Backend ready
- `web/src/index.ts` (lines ~135-170): API endpoints exist
- Need: `ui/src/components/SampleManager.tsx`

### Pattern Persistence

**Current Status**: Patterns stored in memory only (lost on restart).

**Implementation Path**:
1. Choose database (SQLite, PostgreSQL, MongoDB)
2. Add persistence layer to web server
3. Load patterns on startup
4. Save on create/update/delete
5. Add pattern import/export

### Multiple Tracks

**Current Status**: Single pattern/track only.

**Future Enhancement**:
- Multiple sequencer tracks playing simultaneously
- Per-track synth/sample assignment
- Track mute/solo
- Mixer with volume/pan per track

## Code Patterns

### Adding a New Synth Parameter

1. **Add type** to `engine/src/types.ts` and `ui/src/types.ts`:
   ```typescript
   interface SynthParameters {
     // ... existing
     newParam: {
       value: number;
     };
   }
   ```

2. **Update Synthesizer** (`engine/src/Synthesizer.ts`):
   ```typescript
   // In constructor: create Tone.js node
   this.newNode = new Tone.SomeEffect();
   
   // In updateParameters: handle updates
   if (params.newParam) {
     this.newNode.value = params.newParam.value;
   }
   ```

3. **Add API endpoint** (optional, or use existing `/synth/parameters`)

4. **Add UI control** (`ui/src/components/SynthControls.tsx`):
   ```tsx
   <div className="control">
     <label>New Param: {parameters.newParam.value}</label>
     <input
       type="range"
       value={parameters.newParam.value}
       onChange={(e) => onParameterChange({
         newParam: { value: Number(e.target.value) }
       })}
     />
   </div>
   ```

### Adding a Discord Command

1. **Define command** (`bot/src/index.ts`, `commands` array):
   ```typescript
   new SlashCommandBuilder()
     .setName('mycommand')
     .setDescription('Does something')
     .addStringOption(/* ... */),
   ```

2. **Create handler** (`bot/src/index.ts`):
   ```typescript
   async function handleMyCommand(interaction: ChatInputCommandInteraction) {
     // Make API call to web server
     const response = await fetch(`${WEB_API_URL}/some-endpoint`, {
       method: 'POST',
       body: JSON.stringify({ /* ... */ }),
     });
     await interaction.reply('Done!');
   }
   ```

3. **Register in switch** (`bot/src/index.ts`, `interactionCreate` handler):
   ```typescript
   case 'mycommand':
     await handleMyCommand(interaction);
     break;
   ```

4. **Restart bot** to register new commands with Discord

## Testing

### Manual Testing Checklist

- [ ] UI connects to WebSocket (green indicator)
- [ ] Clicking sequencer grid toggles steps
- [ ] Play/Stop button works
- [ ] Sequencer steps highlight during playback
- [ ] Keyboard plays notes
- [ ] Synth controls update in real-time
- [ ] Discord bot responds to `/join`, `/leave`
- [ ] Discord bot responds to `/play`, `/stop`
- [ ] Multiple browser tabs stay in sync

### Debug Tips

1. **No audio in UI**: Check browser console, Tone.js needs user interaction to start
2. **WebSocket won't connect**: Check all three processes are running
3. **Discord commands don't work**: Check bot token, client ID, intents
4. **Synth parameters don't update**: Check WebSocket messages in browser devtools
5. **npm install fails**: Try `npm install --legacy-peer-deps`

## Dependencies Reference

### Bot
- `discord.js`: Discord API client
- `@discordjs/voice`: Voice channel support
- `@discordjs/opus`: Audio codec
- `ws`: WebSocket client

### Engine
- `tone`: Web Audio API synthesis
- `audiobuffer-to-wav`: Audio export

### Web
- `express`: HTTP server
- `cors`: Cross-origin requests
- `ws`: WebSocket server

### UI
- `react`: UI framework
- `vite`: Build tool
- `tone`: Client-side audio (for previews)

## Performance Notes

- Tone.js audio graph is **CPU intensive** with many effects
- Keep polyphony reasonable (default: 8 voices)
- WebSocket broadcasts can be throttled for high-frequency updates (e.g., sequencer steps)
- Consider Web Workers for audio processing if needed

## Security Considerations

- **Never commit `.env`** with real tokens (added to `.gitignore`)
- Validate Discord user permissions before destructive actions
- Sanitize file uploads if implementing sample upload
- Rate-limit API endpoints to prevent abuse
- Use HTTPS in production

## Deployment Notes

For production deployment:

1. Build all workspaces: `npm run build`
2. Set production environment variables
3. Use process manager (PM2, systemd) for Node processes
4. Reverse proxy (nginx) for web server
5. Use separate domain for UI (or serve UI from Express)
6. Consider containerization (Docker)

## Getting Help

- Discord.js docs: https://discord.js.org
- Tone.js docs: https://tonejs.github.io
- React docs: https://react.dev
- Vite docs: https://vitejs.dev

## License

ISC (see package.json)

---

**For Future AI Assistants**: This codebase is well-structured and extensible. The main areas needing work are audio streaming to Discord, pattern persistence, and sample management UI. Start with those if asked to improve the project.
