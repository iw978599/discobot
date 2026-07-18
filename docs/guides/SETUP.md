# Discobot Setup Guide

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
   AUTH_MODE=strict
   AUTH_TOKEN_SECRET=replace_with_long_random_secret
   BOT_SHARED_SECRET=replace_with_long_random_secret
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
- WebSocket Server on ws://localhost:3001/ws
- Web UI on http://localhost:3000

## Step 4: Test It Out

1. Open http://localhost:3000 in your browser
2. Join a voice channel in your Discord server
3. In Discord, type `/join` to make the bot join your channel
4. In Discord, run `/login` and open the login link in your browser
5. In the web UI:
   - Click on the sequencer grid to activate steps
   - Press Play to hear the sequence
   - Use the keyboard to play notes
   - Adjust synth parameters in the right panel

## Discord Commands

Once the bot is running and in your server:

- `/join` - Bot joins your current voice channel
- `/leave` - Bot leaves the voice channel
- `/play [synth]` - Play sequencer (optional synth id)
- `/stop [synth]` - Stop playback (optional synth id)
- `/note <note> [synth]` - Play a single note
- `/tempo <bpm>` - Set the tempo

## Troubleshooting

### Bot doesn't join voice channel
- Make sure you're in a voice channel first
- Check that the bot has "Connect" and "Speak" permissions
- Verify your bot token in `.env` is correct

### Web UI won't connect
- Make sure all services are running (`npm run dev`)
- Check that ports 3000 and 3001 are not in use
- Check browser console for WebSocket connection errors

### No audio in Discord
- Ensure bot has joined voice with `/join`
- Ensure sequencer is started from UI or `/play`
- Check bot logs for voice connection errors

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

## Notes

- The synth engine is custom math-based (no Tone.js)
- Audio processing happens in the web server
- Discord bot communicates with the web server via REST API and WebSocket
- The UI is a real-time control surface that syncs with the engine

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
