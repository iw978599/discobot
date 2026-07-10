import express from 'express';
import cors from 'cors';
import WebSocket, { WebSocketServer } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { Synthesizer, Sequencer, SamplePlayer, Pattern, SynthParameters, DrumState, DrumInstrument, DiscordAudioStreamer, DrumSynthesizer, clamp, throttle, AUDIO_MIXING, AUDIO_CONTEXT } from '@discord-synth/engine';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || process.env.WEB_PORT || '3001', 10);

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; style-src-elem 'self' 'unsafe-inline' https:; style-src-attr 'self' 'unsafe-inline' https:; script-src 'self' https:; connect-src 'self' https: ws: wss:; manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests");
  next();
});
app.use(express.json());
app.use((req, _res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    req.url = req.url.slice(4) || '/';
  }
  next();
});

const uiDistPath = path.resolve(__dirname, '..', '..', 'ui', 'dist');
const uiIndexPath = path.join(uiDistPath, 'index.html');
if (fs.existsSync(uiIndexPath)) {
  app.use(express.static(uiDistPath));
  app.get('/', (_req, res) => {
    res.sendFile(uiIndexPath);
  });
}

// Shared audio engine state
let synth: Synthesizer | null = null;
let sequencer: Sequencer | null = null;
let samplePlayer: SamplePlayer | null = null;
let discordStreamer: DiscordAudioStreamer | null = null;
let hasActiveSession = false;
const patterns = new Map<string, Pattern>();
const streamingState = {
  isStreamingToDiscord: false,
  currentStream: null as AudioBuffer | null,
  streamQueue: [] as AudioBuffer[],
  streamPosition: 0,
  lastUpdate: 0
};

const DRUM_INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const isWebSocketOpen = (client: WebSocket): boolean => client.readyState === WebSocket.OPEN;

function createDefaultDrumState(): DrumState {
  const state = {} as DrumState;
  for (const inst of DRUM_INSTRUMENTS) {
    state[inst] = {
      steps: new Array(16).fill(false),
      settings: { volume: 1.0, tone: 0.5, extra: 0.5 },
    };
  }
  return state;
}

let drumState: DrumState = createDefaultDrumState();
let drumMasterVolume = 1.0;

interface SavedPatternData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  steps: Array<{ active: boolean; note?: string; velocity: number }>;
  synthParams: SynthParameters;
  tempo: number;
  drumState: DrumState;
  drumMasterVolume: number;
}

const SAVED_PATTERNS_FILE = path.join(__dirname, '..', 'saved-patterns.json');

function loadSavedPatterns(): SavedPatternData[] {
  try {
    if (fs.existsSync(SAVED_PATTERNS_FILE)) {
      const raw = fs.readFileSync(SAVED_PATTERNS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error('Failed to load saved patterns:', {
      error: error instanceof Error ? error.message : String(error),
      file: SAVED_PATTERNS_FILE,
    });
  }
  return [];
}

function saveSavedPatterns(data: SavedPatternData[]) {
  try {
    fs.writeFileSync(SAVED_PATTERNS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save patterns:', {
      error: error instanceof Error ? error.message : String(error),
      file: SAVED_PATTERNS_FILE,
      patternCount: data.length,
    });
    throw error; // Re-throw so caller knows it failed
  }
}

// Initialize audio engine
function initAudioEngine() {
  if (!synth) {
    synth = new Synthesizer();
    sequencer = new Sequencer(synth);
    samplePlayer = new SamplePlayer();
    discordStreamer = new DiscordAudioStreamer();

    // Broadcast step changes to all clients
    sequencer.onStep((step: number) => {
      broadcastToClients({ type: 'sequencerStep', data: { step } });
    });

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
      if (isWebSocketOpen(client)) {
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
      if (isWebSocketOpen(client)) {
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
      if (isWebSocketOpen(client)) {
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
      if (isWebSocketOpen(client)) {
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
  hasActiveSession = true;

  try {
    synth!.updateParameters(req.body as Partial<SynthParameters>);
    broadcastToClients({ type: 'synthUpdate', data: synth!.getParameters() });
    if (sequencer && sequencer.getIsPlaying()) {
      schedulePatternAudio();
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update synth parameters:', {
      error: error instanceof Error ? error.message : String(error),
      params: req.body,
    });
    res.status(400).json({
      error: 'Invalid parameters',
      message: error instanceof Error ? error.message : 'Failed to update parameters',
    });
  }
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

// Drum machine
app.get('/drum/state', (req, res) => {
  res.json(drumState);
});

app.post('/drum/step', (req, res) => {
  initAudioEngine();
  const { instrument, step, active } = req.body as { instrument: DrumInstrument; step: number; active: boolean };
  if (!DRUM_INSTRUMENTS.includes(instrument) || step < 0 || step > 15) {
    return res.status(400).json({ error: 'Invalid instrument or step' });
  }
  drumState[instrument].steps[step] = active;
  const activeCount = DRUM_INSTRUMENTS.reduce((sum, inst) => sum + drumState[inst].steps.filter(Boolean).length, 0);
  debugLog(`POST /drum/step: ${instrument}[${step}] = ${active}, totalActive=${activeCount}`);
  broadcastToClients({ type: 'drumStep', data: { instrument, step, active } });
  if (sequencer && sequencer.getIsPlaying()) {
    schedulePatternAudio();
  }
  res.json({ success: true });
});

app.post('/drum/settings', (req, res) => {
  initAudioEngine();
  const { instrument, settings } = req.body as { instrument: DrumInstrument; settings: { volume?: number; tone?: number; extra?: number } };
  if (!DRUM_INSTRUMENTS.includes(instrument)) {
    return res.status(400).json({ error: 'Invalid instrument' });
  }
  const s = drumState[instrument].settings;
  if (settings.volume !== undefined) s.volume = clamp(settings.volume, 0, 1);
  if (settings.tone !== undefined) s.tone = clamp(settings.tone, 0, 1);
  if (settings.extra !== undefined) s.extra = clamp(settings.extra, 0, 1);
  broadcastToClients({ type: 'drumSettings', data: { instrument, settings: { ...s } } });
  if (sequencer && sequencer.getIsPlaying()) {
    schedulePatternAudio();
  }
  res.json({ success: true });
});

app.put('/drum/state', (req, res) => {
  const { state } = req.body as { state: DrumState };
  if (!state) return res.status(400).json({ error: 'state is required' });
  drumState = state;
  broadcastToClients({ type: 'drumFullState', data: { drumState: state } });
  if (sequencer && sequencer.getIsPlaying()) {
    schedulePatternAudio();
  }
  res.json({ success: true });
});

app.post('/drum/reset', (req, res) => {
  drumState = createDefaultDrumState();
  broadcastToClients({ type: 'drumReset' });
  if (sequencer && sequencer.getIsPlaying()) {
    schedulePatternAudio();
  }
  res.json({ success: true });
});

app.post('/drum/master-volume', (req, res) => {
  const { volume } = req.body as { volume: number };
  drumMasterVolume = clamp(volume, 0, 2);
  if (sequencer && sequencer.getIsPlaying()) {
    schedulePatternAudio();
  }
  res.json({ success: true });
});

// Saved patterns (persistent storage) - must be before generic :id routes
app.post('/patterns/save', (req, res) => {
  const { name, steps, synthParams, tempo, drumState: ds, drumMasterVolume: dmv } = req.body;
  if (!name || !steps) {
    return res.status(400).json({ error: 'name and steps are required' });
  }

  const saved = loadSavedPatterns();
  const entry: SavedPatternData = {
    id: `saved-${Date.now()}`,
    name: String(name),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps,
    synthParams: synthParams || null,
    tempo: tempo || 120,
    drumState: ds || drumState,
    drumMasterVolume: dmv !== undefined ? dmv : drumMasterVolume,
  };
  saved.push(entry);
  saveSavedPatterns(saved);

  res.json({ id: entry.id, name: entry.name, updatedAt: entry.updatedAt });
});

app.get('/patterns/saved', (req, res) => {
  const saved = loadSavedPatterns();
  const list = saved
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
  res.json(list);
});

app.get('/patterns/saved/:id', (req, res) => {
  const saved = loadSavedPatterns();
  const entry = saved.find((p) => p.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Saved pattern not found' });
  res.json(entry);
});

app.delete('/patterns/saved/:id', (req, res) => {
  let saved = loadSavedPatterns();
  const idx = saved.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Saved pattern not found' });
  saved.splice(idx, 1);
  saveSavedPatterns(saved);
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
  hasActiveSession = true;
  const pattern: Pattern = req.body;
  patterns.set(pattern.id, pattern);
  broadcastToClients({ type: 'patternCreated', data: pattern });
  res.json(pattern);
});

app.put('/patterns/:id', (req, res) => {
  hasActiveSession = true;
  const pattern: Pattern = req.body;
  patterns.set(req.params.id, pattern);
  broadcastToClients({ type: 'patternUpdated', data: pattern });
  if (sequencer && sequencer.getIsPlaying()) {
    sequencer.loadPattern(pattern);
    schedulePatternAudio();
  }
  res.json(pattern);
});

app.delete('/patterns/:id', (req, res) => {
  hasActiveSession = true;
  patterns.delete(req.params.id);
  broadcastToClients({ type: 'patternDeleted', data: { id: req.params.id } });
  res.json({ success: true });
});

// Sequencer
app.post('/sequencer/play', (req, res) => {
  initAudioEngine();
  hasActiveSession = true;
  const { patternId } = req.body;
  const pattern = patterns.get(patternId);

  if (!pattern) {
    return res.status(404).json({ error: 'Pattern not found' });
  }

  sequencer!.loadPattern(pattern);
  sequencer!.play();

  const drumCount = DRUM_INSTRUMENTS.reduce((sum, inst) => sum + drumState[inst].steps.filter(Boolean).length, 0);
  debugLog(`POST /sequencer/play: patternId=${patternId}, drumActiveSteps=${drumCount}`);
  broadcastPatternAudio();
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
  hasActiveSession = true;
  const { tempo } = req.body;

  // Validate tempo
  if (typeof tempo !== 'number' || isNaN(tempo) || tempo < 20 || tempo > 400) {
    return res.status(400).json({
      error: 'Invalid tempo',
      message: 'Tempo must be a number between 20 and 400 BPM',
      received: tempo,
    });
  }

  sequencer!.setTempo(tempo);
  broadcastToClients({ type: 'tempoChange', data: { tempo } });
  if (sequencer && sequencer.getIsPlaying()) {
    schedulePatternAudio();
  }
  res.json({ success: true });
});

// Health check endpoint (for Railway/Docker)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
  });
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
const WS_PATHS = new Set(['/ws', '/ws/']);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const requestPath = req.url?.split('?')[0] ?? '';
  if (!WS_PATHS.has(requestPath)) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

app.get(['/ws', '/ws/'], (_req, res) => {
  res.status(426).json({
    error: 'WebSocket Upgrade Required',
    message: 'Use a WebSocket client with ws:// or wss:// protocol.',
  });
});

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');

  initAudioEngine();

  // Send current state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      hasActiveSession,
      synthParameters: synth!.getParameters(),
      patterns: Array.from(patterns.values()),
      samples: samplePlayer!.getSamples(),
      streamingState: streamingState,
      drumState,
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

const debugLog = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, '..', 'debug.log'), line + '\n'); } catch {}
};

function renderPatternAudio(pattern: Pattern): string | null {
  try {
    const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
    const tempo = clamp(pattern.tempo || 120, 20, 400);
    const drumActiveSteps = DRUM_INSTRUMENTS.reduce((sum, inst) => {
      const track = drumState[inst];
      if (!track || !track.steps) return sum;
      return sum + track.steps.filter(Boolean).length;
    }, 0);
    debugLog(`renderPatternAudio: tempo=${tempo}, drumActiveSteps=${drumActiveSteps}`);
    const beatsPerStep = 60 / tempo / 4;
    const stepDuration = beatsPerStep;
    const totalSamples = Math.floor(16 * stepDuration * sampleRate);
    const fullPCM = new Float32Array(totalSamples);

    for (let i = 0; i < 16; i++) {
      const step = pattern.steps[i];
      if (step.note) {
        const noteDur = Math.max(stepDuration - 0.01, 0.05);
        const notePCM = synth!.renderNote(step.note, noteDur, step.velocity, sampleRate);
        const offset = Math.floor(i * stepDuration * sampleRate);
        for (let j = 0; j < notePCM.length && offset + j < totalSamples; j++) {
          fullPCM[offset + j] += notePCM[j];
        }
      }
    }

    // Mix in drum audio with boost factor, then soft-clip master
    const drumPCM = DrumSynthesizer.renderPattern(drumState, pattern.tempo, sampleRate);
    let drumMax = 0;
    for (let i = 0; i < drumPCM.length; i++) { const a = Math.abs(drumPCM[i]); if (a > drumMax) drumMax = a; }
    debugLog(`renderPatternAudio: drumPCM max=${drumMax.toFixed(4)}, length=${drumPCM.length}`);
    for (let i = 0; i < drumPCM.length && i < totalSamples; i++) {
      fullPCM[i] += drumPCM[i] * AUDIO_MIXING.DRUM_BOOST_FACTOR * drumMasterVolume;
    }

    // Soft-clip master to prevent clipping
    const threshold = AUDIO_MIXING.SOFT_CLIP_THRESHOLD;
    const factor = AUDIO_MIXING.SOFT_CLIP_FACTOR;
    for (let i = 0; i < fullPCM.length; i++) {
      if (fullPCM[i] > threshold) fullPCM[i] = threshold + (fullPCM[i] - threshold) * factor;
      if (fullPCM[i] < -threshold) fullPCM[i] = -threshold + (fullPCM[i] + threshold) * factor;
    }

    const stereoLen = fullPCM.length * 2;
    const int16 = new Int16Array(stereoLen);
    for (let i = 0; i < fullPCM.length; i++) {
      const val = clamp(Math.round(fullPCM[i] * AUDIO_MIXING.MAX_PCM_VALUE), -32768, 32767);
      int16[i * 2] = val;
      int16[i * 2 + 1] = val;
    }

    return Buffer.from(int16.buffer).toString('base64');
  } catch (err) {
    console.error('Failed to render pattern audio:', err);
    return null;
  }
}

function broadcastPatternAudio() {
  if (!sequencer || !sequencer.getIsPlaying()) return;
  const pattern = sequencer.getCurrentPattern();
  if (!pattern) return;
  const audioBase64 = renderPatternAudio(pattern);
  if (audioBase64) {
    broadcastToClients({ type: 'patternAudio', data: { audio: audioBase64, sampleRate: 48000, tempo: pattern.tempo } });
  }
}

const schedulePatternAudio = throttle(broadcastPatternAudio, 300);

function broadcastToClients(message: unknown) {
  const payload = JSON.stringify(message);
  clients.forEach((client) => {
    if (isWebSocketOpen(client)) {
      client.send(payload);
    }
  });
}

// Start server - bind to 0.0.0.0 for Railway/Docker
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web API server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/ws`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
