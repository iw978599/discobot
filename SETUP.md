# Discord Synth Bot Setup Guide

## Prerequisites

- Node.js 18+ installed
- Discord account
- Discord server where you have admin permissions

## Step 1: Discord Bot Setup

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name (e.g., "Synth Bot")
4. Go to the "Bot" tab
5. Click "Add Bot"
6. Under "Privileged Gateway Intents", enable:
   - Server Members Intent
   - Message Content Intent
7. Click "Reset Token" and copy your bot token
8. Go to the "OAuth2" > "URL Generator" tab
9. Select scopes:
   - `bot`
   - `applications.commands`
10. Select bot permissions:
    - Connect
    - Speak
    - Use Voice Activity
    - Send Messages
11. Copy the generated URL and open it in your browser
12. Select your server and authorize the bot

## Step 2: Project Setup

1. Navigate to the project directory:
   ```bash
   cd ~/discord-synth-bot
   ```

2. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your Discord credentials:
   ```
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_application_id_here
   ```

   To find your Client ID:
   - Go back to Discord Developer Portal
   - Select your application
   - Go to "General Information"
   - Copy "Application ID"

4. Install dependencies:
   ```bash
   npm install
   ```

## Step 3: Run the Application

Start all services (bot, web API, and UI):

```bash
npm run dev
```

This will start:
- Discord Bot (connects to Discord)
- Web API Server on http://localhost:3001
- WebSocket Server on ws://localhost:8080
- Web UI on http://localhost:3000

## Step 4: Test It Out

1. Open http://localhost:3000 in your browser
2. Join a voice channel in your Discord server
3. In Discord, type `/join` to make the bot join your channel
4. In the web UI:
   - Click on the sequencer grid to activate steps
   - Press Play to hear the sequence
   - Use the keyboard to play notes
   - Adjust synth parameters in the right panel

## Discord Commands

Once the bot is running and in your server:

- `/join` - Bot joins your current voice channel
- `/leave` - Bot leaves the voice channel
- `/play [pattern]` - Play a sequencer pattern
- `/stop` - Stop playback
- `/note <note>` - Play a single note (e.g., C4, A#3)
- `/tempo <bpm>` - Set the tempo
- `/export <pattern>` - Export pattern as WAV (coming soon)

## Troubleshooting

### Bot doesn't join voice channel
- Make sure you're in a voice channel first
- Check that the bot has "Connect" and "Speak" permissions
- Verify your bot token in `.env` is correct

### Web UI won't connect
- Make sure all services are running (`npm run dev`)
- Check that ports 3000, 3001, and 8080 are not in use
- Check browser console for WebSocket connection errors

### No audio in Discord
- Voice streaming to Discord is currently a work in progress
- Audio playback works in the web UI
- Real-time Discord streaming requires additional implementation

## Development

Run individual services:

```bash
npm run dev:bot   # Discord bot only
npm run dev:web   # API server only
npm run dev:ui    # Web UI only
```

Build for production:

```bash
npm run build
```

## Next Steps

Current features to implement:
1. Real-time audio streaming to Discord voice channels
2. Pattern save/load from database
3. Export patterns to WAV files
4. Sample management UI
5. Multiple pattern tracks
6. MIDI input support
7. VST plugin support (future)

## Notes

- The synth engine uses Tone.js for Web Audio API synthesis
- Audio processing happens in the web server
- Discord bot communicates with the web server via REST API and WebSocket
- The UI is a real-time control surface that syncs with the engine
