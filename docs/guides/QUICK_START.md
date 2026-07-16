# Quick Start Guide

## For First Time Setup

1. **Install dependencies**:
   ```bash
   cd discobot
   npm install
   ```
2. **Setup Discord bot** (see `docs/guides/SETUP.md` for detailed steps):
   - Create bot at https://discord.com/developers/applications
   - Copy token and client ID
3. **Configure `.env`**:
   ```bash
   # Edit .env file and add your credentials
   DISCORD_TOKEN=your_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   ```
4. **Run it**:
   ```bash
   npm run dev
   ```
5. **In Discord run `/login`**, then open the generated link in your browser
6. **Access UI**: http://localhost:3000

## Essential Commands

```bash
npm run dev          # Start everything
npm run dev:bot      # Discord bot only
npm run dev:web      # API server only  
npm run dev:ui       # Web UI only
npm run build        # Build for production
```

## Discord Commands

- `/join` - Bot joins your voice channel
- `/play [synth]` - Start sequencer playback (optional synth index)
- `/stop [synth]` - Stop playback (optional synth index)
- `/note C4 [synth]` - Play a single note (optional synth index)
- `/tempo 128` - Set global tempo
- `/leave` - Bot leaves channel

## File Structure

```
discobot/
├── README.md              # Full documentation
├── docs/guides/SETUP.md   # Detailed setup instructions
├── docs/reference/AI_DEVELOPMENT_GUIDE.md  # For developers/AI assistants
├── .env                  # Your configuration (DON'T COMMIT)
├── .env.example          # Template
├── package.json          # Root workspace config
├── bot/                  # Discord bot
├── engine/               # Synth & sequencer
├── web/                  # API + WebSocket server
└── ui/                   # React web interface
```

## Troubleshooting

**Bot won't start**: Check Discord token in `.env`
**UI won't connect**: Make sure all 3 services are running (`npm run dev`)
**No audio**: Click anywhere in the web UI first (browser security requirement)
**Drums feel too wet/dry**: Open Rhythm Composer and adjust Drum FX Return + Loop Return

## Next Steps

- Read **README.md** for full feature list
- Read **docs/guides/SETUP.md** for detailed setup
- Read **docs/reference/AI_DEVELOPMENT_GUIDE.md** if you want to extend the project

## Support

Check existing documentation files or open a GitHub issue.
