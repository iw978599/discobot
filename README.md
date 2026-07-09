# Discord Synth Bot 🎹🎵

A Discord bot with a web-based UI for creating music using synthesis and sequencing. Control a powerful synthesizer and 16-step sequencer from Discord commands or a beautiful web interface.

![Status: Alpha](https://img.shields.io/badge/status-alpha-orange)
![Node: 18+](https://img.shields.io/badge/node-18%2B-green)
![License: ISC](https://img.shields.io/badge/license-ISC-blue)

## ✨ Features

- **Synthesizer Engine**: Multiple waveforms (sine, square, sawtooth, triangle), resonant filter, reverb, delay
- **16-step Sequencer**: Pattern-based step sequencer with tempo control
- **3-octave Virtual Keyboard**: Play notes directly from the web UI
- **Sample Playback**: Load and play custom audio samples (backend ready)
- **Real-time Sync**: Multiple clients stay synchronized via WebSocket
- **Audio Export**: Export patterns to WAV files (planned)
- **Discord Integration**: Control everything via slash commands
- **Hybrid Architecture**: Rich web UI + Discord commands

## 📸 Screenshots

*(Coming soon - project just created)*

## 🏗️ Architecture

This is a **monorepo** using npm workspaces with 4 packages:

```
discord-synth-bot/
├── bot/       # Discord bot (Discord.js, slash commands)
├── engine/    # Audio synthesis engine (Tone.js-based)
├── web/       # Express API + WebSocket server
└── ui/        # React web interface (Vite)
```

**Data Flow**: Web UI ↔ WebSocket ↔ Web Server ↔ REST API ↔ Discord Bot

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** and npm
- A **Discord account** and server where you have admin permissions

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd discord-synth-bot
npm install
```

### 2. Discord Bot Setup

1. Go to https://discord.com/developers/applications
2. Click **"New Application"**, give it a name
3. Go to **"Bot"** tab → **"Add Bot"**
4. Copy your bot token
5. Under **"Privileged Gateway Intents"**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
6. Go to **"OAuth2" → "URL Generator"**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`
7. Copy the generated URL and open it to invite the bot to your server

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```bash
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here  # From "General Information" tab
```

### 4. Run the Application

```bash
npm run dev
```

This starts:
- 🤖 Discord Bot (connects to Discord)
- 🌐 Web API Server on http://localhost:3001
- 🔌 WebSocket Server on ws://localhost:8080
- 🎨 Web UI on http://localhost:3000

### 5. Test It Out!

1. Open http://localhost:3000 in your browser
2. Join a voice channel in your Discord server
3. Type `/join` in Discord to summon the bot
4. In the web UI:
   - Click sequencer grid squares to activate steps
   - Press **Play** to start the sequence
   - Use the keyboard to play notes
   - Adjust synth parameters in the right panel

## 🎮 Discord Commands

| Command | Description |
|---------|-------------|
| `/join` | Join your current voice channel |
| `/leave` | Leave the voice channel |
| `/play [pattern]` | Play a sequencer pattern |
| `/stop` | Stop playback |
| `/note <note> [duration]` | Play a note (e.g., C4, A#3) |
| `/tempo <bpm>` | Set the tempo |
| `/export <pattern>` | Export pattern to WAV (coming soon) |

## 🖥️ Web UI

Open http://localhost:3000 to access:

- **16-step Sequencer Grid**: Click to toggle steps, visual playback
- **3-octave Piano Keyboard**: Click and hold to play notes
- **Synth Controls Panel**:
  - Oscillator type & detune
  - Resonant filter (frequency, Q)
  - ADSR envelope
  - Reverb (wet, decay)
  - Delay (wet, time, feedback)
- **Pattern Management**: Load and edit patterns
- **Real-time Updates**: All connected clients stay in sync

## 📚 Documentation

- **[SETUP.md](./SETUP.md)**: Detailed setup instructions
- **[AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md)**: For AI assistants or developers continuing this project

## 🛠️ Development

```bash
# Run everything
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

## 🧰 Tech Stack

| Layer | Technology |
|-------|------------|
| Bot | Discord.js v14, @discordjs/voice |
| Engine | Tone.js (Web Audio API) |
| API | Express, WebSocket (ws) |
| UI | React, Vite, TypeScript |
| Language | TypeScript across entire stack |

## 🚧 Current Status & Known Issues

### ✅ Working
- Web UI sequencer and keyboard
- Synth parameter controls
- Pattern editing and playback
- Discord bot commands
- Real-time sync between clients

### ⚠️ In Progress
- **Audio streaming to Discord**: Backend exists but needs PCM bridge
- **Audio export**: `/export` command exists but needs implementation
- **Sample management**: Backend ready, UI needed

### 📋 TODO
- [ ] Complete Discord voice streaming
- [ ] Implement WAV export endpoint
- [ ] Build sample manager UI
- [ ] Add pattern persistence (database)
- [ ] Multiple tracks
- [ ] MIDI input support

See [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) for detailed implementation notes.

## 🤝 Contributing

This is a personal project, but contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

ISC License - see [package.json](./package.json)

## 🙏 Acknowledgments

- Built with [Discord.js](https://discord.js.org)
- Audio powered by [Tone.js](https://tonejs.github.io)
- UI built with [React](https://react.dev) and [Vite](https://vitejs.dev)

## 📞 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing documentation in `SETUP.md` and `AI_DEVELOPMENT_GUIDE.md`

---

**Made with ❤️ and AI assistance**
