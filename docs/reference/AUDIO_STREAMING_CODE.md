# Audio Streaming Implementation - Legacy Notes

> This document is historical reference content from an earlier design iteration.  
> Current implementation uses the custom engine render pipeline and WebSocket events in `web/src/index.ts` + `bot/src/index.ts`.

## Web Server Enhancements (web/src/index.ts)

We need to add a streaming service and related endpoints. Here's what needs to be modified:

### Add Audio Streaming Service Class

Add this before the main application initialization:

```typescript
// Audio streaming service
class AudioStreamingService {
  private stream: Readable | null = null;
  private isStreaming: boolean = false;
  private clients: Set<any> = new Set();
  
  constructor() {
    // Initialize audio capture system
    this.initAudioCapture();
  }
  
  private initAudioCapture() {
    // This would interface with Tone.js to capture audio output
    // Implementation depends on Tone.js capabilities for audio export
    console.log('Initializing audio capture from Tone.js...');
  }
  
  startStreaming() {
    this.isStreaming = true;
    // Start audio streaming to clients
    console.log('Starting audio stream');
  }
  
  stopStreaming() {
    this.isStreaming = false;
    // Stop audio streaming
    console.log('Stopping audio stream');
  }
  
  addClient(ws: any) {
    this.clients.add(ws);
  }
  
  removeClient(ws: any) {
    this.clients.delete(ws);
  }
  
  broadcastAudio(data: Buffer) {
    // Broadcast audio data to all connected clients
    this.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(data);
      }
    });
  }
}

const audioStreamingService = new AudioStreamingService();
```

### Add API Endpoints for Streaming

Add these endpoints after the existing REST APIs:

```typescript
// Audio streaming endpoints - to be added near other API routes 
app.post('/stream/start', (req, res) => {
  try {
    audioStreamingService.startStreaming();
    res.json({ success: true, message: 'Audio streaming started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start audio streaming' });
  }
});

app.post('/stream/stop', (req, res) => {
  try {
    audioStreamingService.stopStreaming();
    res.json({ success: true, message: 'Audio streaming stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop audio streaming' });
  }
});

app.get('/stream/status', (req, res) => {
  res.json({ 
    isStreaming: audioStreamingService.isStreaming,
    clientCount: audioStreamingService.clients.size 
  });
});
```

## Bot Enhancements (bot/src/index.ts)

### Add Audio Streaming Service Class

Add this before the main client initialization:

```typescript
// Audio streaming service for Discord voice channel  
class DiscordAudioStreamer {
  private connection: any = null;
  private audioPlayer: any = null;
  private audioResource: any = null;
  private isStreaming: boolean = false;
  private ws: WebSocket | null = null;

  constructor() {
    // Initialize streaming components
  }

  async startAudioStreaming(connection: any, guildId: string) {
    this.connection = connection;
    
    try {
      // Connect to web server's audio stream endpoint
      const wsUrl = `${WS_URL.replace('ws://', 'wss://').replace(':8080', ':3001')}/audio-stream`;
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        console.log('Connected to audio streaming endpoint');
        this.isStreaming = true;
        
        // Request audio stream from web server
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ 
            action: 'start-streaming', 
            guildId 
          }));
        }
      });

      this.ws.on('message', (data: any) => {
        // Handle incoming audio chunks
        this.handleAudioChunk(data);
      });
    } catch (error) {
      console.error('Error starting audio streaming:', error);
    }
  }

  handleAudioChunk(chunk: any) {
    // Convert audio chunk to format suitable for Discord
    // This is an example - actual implementation will depend on the streaming format
    if (this.connection && this.isStreaming) {
      // This will be the actual audio packet handling code 
    }
  }

  stopAudioStreaming() {
    this.isStreaming = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    console.log('Stopped audio streaming');
  }
}

const audioStreamer = new DiscordAudioStreamer();
```

### Update Voice Channel Handlers

In the `handleJoin` function, add audio streaming initialization:
```typescript
async function handleJoin(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as any;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply('You need to be in a voice channel!');
  }

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator as any,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    connections.set(interaction.guildId!, connection);

    // Start audio streaming when joining a voice channel
    audioStreamer.startAudioStreaming(connection, interaction.guildId!);

    await interaction.reply(`Joined ${voiceChannel.name}!`);
  } catch (error) {
    console.error('Error joining voice channel:', error);
    await interaction.reply('Failed to join voice channel');
  }
}
```

### Add Stream Command Handler

Add new handler for `/stream` command:
```typescript
async function handleStream(interaction: ChatInputCommandInteraction) {
  const connection = connections.get(interaction.guildId!);

  if (!connection) {
    return interaction.reply('Not in a voice channel');
  }

  try {
    // Toggle streaming state
    if (audioStreamer.isStreaming) {
      audioStreamer.stopAudioStreaming();
      await interaction.reply('Stopped audio streaming');
    } else {
      audioStreamer.startAudioStreaming(connection, interaction.guildId!);
      await interaction.reply('Started audio streaming to voice channel');
    }
  } catch (error) {
    console.error('Error toggling stream:', error);
    await interaction.reply('Failed to toggle audio streaming');
  }
}
```

### Update Command Handler Switch

Add the stream command case:
```typescript
switch (interaction.commandName) {
  // ... existing cases ...
  case 'stream':
    await handleStream(interaction);
    break;
}
```

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
