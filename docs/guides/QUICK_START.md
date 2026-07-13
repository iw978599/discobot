# Quick Start Guide

## For First Time Setup

1. **Extract the zip** to your desired location
2. **Install dependencies**:
   ```bash
   cd discord-synth-bot
   npm install
   ```
3. **Setup Discord bot** (see SETUP.md for detailed steps):
   - Create bot at https://discord.com/developers/applications
   - Copy token and client ID
4. **Configure `.env`**:
   ```bash
   # Edit .env file and add your credentials
   DISCORD_TOKEN=your_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   ```
5. **Run it**:
   ```bash
   npm run dev
   ```
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
- `/play` - Start sequencer playback
- `/stop` - Stop playback
- `/note C4` - Play a single note
- `/leave` - Bot leaves channel

## File Structure

```
discord-synth-bot/
├── README.md              # Full documentation
├── SETUP.md              # Detailed setup instructions
├── AI_DEVELOPMENT_GUIDE.md  # For developers/AI assistants
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

## Next Steps

- Read **README.md** for full feature list
- Read **SETUP.md** for detailed setup
- Read **AI_DEVELOPMENT_GUIDE.md** if you want to extend the project

## Support

Check existing documentation files or open a GitHub issue.
