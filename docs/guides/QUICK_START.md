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
