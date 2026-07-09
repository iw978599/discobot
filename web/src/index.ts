import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import * as http from 'http';
import dotenv from 'dotenv';
import { Synthesizer, Sequencer, SamplePlayer, Pattern, SynthParameters, DiscordAudioStreamer } from '@discord-synth/engine';

dotenv.config();

const app = express();
const PORT = process.env.WEB_PORT || 3001;
const WS_PORT = process.env.WS_PORT || 8080;

app.use(cors());
app.use(express.json());

// Shared audio engine state
let synth: Synthesizer | null = null;
let sequencer: Sequencer | null = null;
let samplePlayer: SamplePlayer | null = null;
let discordStreamer: DiscordAudioStreamer | null = null;
const patterns = new Map<string, Pattern>();
const streamingState = {
  isStreamingToDiscord: false,
  currentStream: null as AudioBuffer | null,
  streamQueue: [] as AudioBuffer[],
  streamPosition: 0,
  lastUpdate: 0
};

// Initialize audio engine
function initAudioEngine() {
  if (!synth) {
    synth = new Synthesizer();
    sequencer = new Sequencer(synth);
    samplePlayer = new SamplePlayer();
    discordStreamer = new DiscordAudioStreamer();

    // Create default pattern
    const defaultPattern = sequencer.createEmptyPattern('Default');
    patterns.set(defaultPattern.id, defaultPattern);
  }
}

// Discord streaming endpoints
app.post('/discord/stream/start', async (req, res) => {
  try {
    initAudioEngine();
    
    const patternId = req.body.patternId;
    const pattern = patterns.get(patternId);
    
    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    // Prepare audio for Discord streaming
    const audioBuffers: AudioBuffer[] = await discordStreamer?.prepareForDiscordStreaming() || [];
    
    if (audioBuffers.length === 0) {
      return res.status(400).json({ error: 'Failed to prepare audio buffers' });
    }

    // Update streaming state
    streamingState.isStreamingToDiscord = true;
    streamingState.currentStream = audioBuffers[0];
    streamingState.streamQueue = audioBuffers;
    streamingState.streamPosition = 0;
    streamingState.lastUpdate = Date.now();

    // Trigger streaming to Discord via WebSocket
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'discordStreamingStart',
          data: {
            patternId,
            timestamp: Date.now(),
            bufferCount: audioBuffers.length,
            sampleRate: audioBuffers[0].sampleRate,
            channelCount: audioBuffers[0].numberOfChannels
          }
        }));
      }
    });

    res.json({ 
      success: true, 
      message: 'Discord streaming started',
      patternId,
      bufferCount: audioBuffers.length,
      duration: audioBuffers.reduce((sum, buffer) => sum + buffer.duration, 0)
    });
  } catch (error) {
    console.error('Error starting Discord streaming:', error);
    res.status(500).json({ error: 'Failed to start Discord streaming' });
  }
});

app.post('/discord/stream/stop', async (req, res) => {
  try {
    // Update streaming state
    streamingState.isStreamingToDiscord = false;
    streamingState.currentStream = null;
    streamingState.streamQueue = [];
    streamingState.streamPosition = 0;

    // Notify bots to stop streaming
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'discordStreamingStop',
          data: {
            timestamp: Date.now(),
            reason: 'manual_stop'
          }
        }));
      }
    });

    res.json({ success: true, message: 'Discord streaming stopped' });
  } catch (error) {
    console.error('Error stopping Discord streaming:', error);
    res.status(500).json({ error: 'Failed to stop Discord streaming' });
  }
});

app.post('/discord/stream/sync', async (req, res) => {
  try {
    // Send current streaming state to connected bots
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'discordStreamingSync',
          data: {
            timestamp: Date.now(),
            isStreaming: streamingState.isStreamingToDiscord,
            currentStream: streamingState.currentStream,
            streamPosition: streamingState.streamPosition,
            queueLength: streamingState.streamQueue.length,
            patterns: Array.from(patterns.values()),
            samples: samplePlayer?.getSamples() || []
          }
        }));
      }
    });

    res.json({ success: true, message: 'Discord streaming sync sent' });
  } catch (error) {
    console.error('Error syncing Discord streaming:', error);
    res.status(500).json({ error: 'Failed to sync Discord streaming' });
  }
});

app.post('/discord/stream/pattern', async (req, res) => {
  try {
    initAudioEngine();
    
    const { pattern, action } = req.body;
    
    if (action === 'create') {
      const newPattern: Pattern = {
        id: `pattern-${Date.now()}`,
        name: pattern.name || 'New Pattern',
        steps: pattern.steps || sequencer?.createEmptyPattern().steps || [],
        tempo: pattern.tempo || 120,
      };
      patterns.set(newPattern.id, newPattern);
      console.log('Created new pattern:', newPattern);
    } else if (action === 'update') {
      const existingPattern = patterns.get(pattern.id);
      if (!existingPattern) {
        return res.status(404).json({ error: 'Pattern not found' });
      }
      
      patterns.set(pattern.id, { ...existingPattern, ...pattern });
      console.log('Updated pattern:', pattern.id);
    } else if (action === 'delete') {
      patterns.delete(pattern.id);
      console.log('Deleted pattern:', pattern.id);
    }

    // Notify all connected clients of pattern change
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'patternUpdated',
          data: {
            pattern: action === 'delete' ? { id: pattern.id } : patterns.get(pattern.id),
            action,
            timestamp: Date.now()
          }
        }));
      }
    });

    res.json({ success: true, message: `Pattern ${action} completed` });
  } catch (error) {
    console.error(`Error ${req.body.action} pattern:`, error);
    res.status(500).json({ error: `Failed to ${req.body.action} pattern` });
  }
});

// Original REST API Routes

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Synth parameters
app.get('/synth/parameters', (req, res) => {
  initAudioEngine();
  res.json(synth!.getParameters());
});

app.post('/synth/parameters', (req, res) => {
  initAudioEngine();
  synth!.updateParameters(req.body as Partial<SynthParameters>);
  broadcastToClients({ type: 'synthUpdate', data: synth!.getParameters() });
  res.json({ success: true });
});

app.post('/synth/note', (req, res) => {
  initAudioEngine();
  const { note, duration, velocity } = req.body;
  synth!.playNote(note, duration, velocity);
  res.json({ success: true });
});

app.post('/synth/note-on', (req, res) => {
  initAudioEngine();
  const { note, velocity } = req.body;
  synth!.noteOn(note, velocity);
  res.json({ success: true });
});

app.post('/synth/note-off', (req, res) => {
  initAudioEngine();
  const { note } = req.body;
  synth!.noteOff(note);
  res.json({ success: true });
});

// Patterns
app.get('/patterns', (req, res) => {
  res.json(Array.from(patterns.values()));
});

app.get('/patterns/:id', (req, res) => {
  const pattern = patterns.get(req.params.id);
  if (!pattern) {
    return res.status(404).json({ error: 'Pattern not found' });
  }
  res.json(pattern);
});

app.post('/patterns', (req, res) => {
  initAudioEngine();
  const pattern: Pattern = req.body;
  patterns.set(pattern.id, pattern);
  broadcastToClients({ type: 'patternCreated', data: pattern });
  res.json(pattern);
});

app.put('/patterns/:id', (req, res) => {
  const pattern: Pattern = req.body;
  patterns.set(req.params.id, pattern);
  broadcastToClients({ type: 'patternUpdated', data: pattern });
  res.json(pattern);
});

app.delete('/patterns/:id', (req, res) => {
  patterns.delete(req.params.id);
  broadcastToClients({ type: 'patternDeleted', data: { id: req.params.id } });
  res.json({ success: true });
});

// Sequencer
app.post('/sequencer/play', (req, res) => {
  initAudioEngine();
  const { patternId } = req.body;
  const pattern = patterns.get(patternId);

  if (!pattern) {
    return res.status(404).json({ error: 'Pattern not found' });
  }

  sequencer!.loadPattern(pattern);
  sequencer!.play();
  broadcastToClients({ type: 'sequencerPlay', data: { patternId } });
  res.json({ success: true });
});

app.post('/sequencer/stop', (req, res) => {
  initAudioEngine();
  sequencer!.stop();
  broadcastToClients({ type: 'sequencerStop' });
  res.json({ success: true });
});

app.post('/sequencer/tempo', (req, res) => {
  initAudioEngine();
  const { tempo } = req.body;
  sequencer!.setTempo(tempo);
  broadcastToClients({ type: 'tempoChange', data: { tempo } });
  res.json({ success: true });
});

// Samples
app.get('/samples', (req, res) => {
  initAudioEngine();
  res.json(samplePlayer!.getSamples());
});

app.post('/samples', async (req, res) => {
  initAudioEngine();
  const { id, name, url } = req.body;

  try {
    await samplePlayer!.loadSample(id, name, url);
    broadcastToClients({ type: 'sampleLoaded', data: { id, name, url } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/samples/:id/play', (req, res) => {
  initAudioEngine();
  const { velocity } = req.body;
  try {
    samplePlayer!.playSample(req.params.id, velocity);
    res.json({ success: true });
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

app.delete('/samples/:id', (req, res) => {
  initAudioEngine();
  samplePlayer!.removeSample(req.params.id);
  broadcastToClients({ type: 'sampleRemoved', data: { id: req.params.id } });
  res.json({ success: true });
});

// WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ port: Number(WS_PORT) });

const clients = new Set<any>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');

  // Send current state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      synthParameters: synth!.getParameters(),
      patterns: Array.from(patterns.values()),
      samples: samplePlayer!.getSamples(),
      streamingState: streamingState,
    },
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

function broadcastToClients(message: any) {
  const payload = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`Web API server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);
});