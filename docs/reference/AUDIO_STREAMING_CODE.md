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
### PR #53: Move sequencer+keyboard above synth control panels

Source branch: `feat/multi-synth-save-layout-redesign`
Last sync: 2026-07-18T13:43:27.722Z

#### Changed files
- `ui/src/App.tsx` — MODIFIED (+30/-30)
<!-- AUTO_PR_CHANGELOG_END -->
