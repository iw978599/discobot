import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import * as http from 'http';
import dotenv from 'dotenv';
import { Synthesizer, Sequencer, SamplePlayer, Pattern, SynthParameters } from '@discord-synth/engine';

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
const patterns = new Map<string, Pattern>();

// Initialize audio engine
function initAudioEngine() {
  if (!synth) {
    synth = new Synthesizer();
    sequencer = new Sequencer(synth);
    samplePlayer = new SamplePlayer();

    // Create default pattern
    const defaultPattern = sequencer.createEmptyPattern('Default');
    patterns.set(defaultPattern.id, defaultPattern);
  }
}

// REST API Routes

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
  initAudioEngine();
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      synthParameters: synth!.getParameters(),
      patterns: Array.from(patterns.values()),
      samples: samplePlayer!.getSamples(),
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

// Setup sequencer step callback for real-time updates
initAudioEngine();
sequencer!.onStep((step) => {
  broadcastToClients({ type: 'sequencerStep', data: { step } });
});

// Start server
server.listen(PORT, () => {
  console.log(`Web API server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);
});
