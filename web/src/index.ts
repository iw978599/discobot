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

interface SynthData {
  synth: Synthesizer;
  sequencer: Sequencer;
  pattern: Pattern;
  patterns: Pattern[];
}

interface SynthMixState {
  muted: boolean;
  solo: boolean;
}

const synths = new Map<number, SynthData>();
const synthMixState = new Map<number, SynthMixState>();
let samplePlayer: SamplePlayer | null = null;
let discordStreamer: DiscordAudioStreamer | null = null;
let hasActiveSession = false;
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
      muted: false,
      solo: false,
    };
  }
  return state;
}

function normalizeDrumState(state: DrumState): DrumState {
  const base = createDefaultDrumState();
  for (const inst of DRUM_INSTRUMENTS) {
    const src = state?.[inst];
    if (!src) continue;
    base[inst] = {
      steps: Array.isArray(src.steps) ? src.steps.slice(0, 16) : base[inst].steps,
      settings: {
        volume: clamp(src.settings?.volume ?? base[inst].settings.volume, 0, 1),
        tone: clamp(src.settings?.tone ?? base[inst].settings.tone, 0, 1),
        extra: clamp(src.settings?.extra ?? base[inst].settings.extra, 0, 1),
      },
      muted: Boolean(src.muted),
      solo: Boolean(src.solo),
    };
    while (base[inst].steps.length < 16) base[inst].steps.push(false);
  }
  return base;
}

let drumState: DrumState = createDefaultDrumState();
let drumMasterVolume = 1.0;
let globalTempo = 120;

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
    throw error;
  }
}

function initSynth(synthId: number) {
  if (synths.has(synthId)) return;

  const synth = new Synthesizer();
  const sequencer = new Sequencer(synth);
  sequencer.setTempo(globalTempo);
  const pattern = sequencer.createEmptyPattern(`Synth ${synthId}`);
  pattern.tempo = globalTempo;
  const patterns: Pattern[] = [pattern];

  sequencer.onStep((step: number) => {
    broadcastToClients({ type: 'sequencerStep', data: { synthId, step } });
  });

  synths.set(synthId, { synth, sequencer, pattern, patterns });
  synthMixState.set(synthId, { muted: false, solo: false });
}

function initAudioEngine() {
  if (synths.size === 0) {
    initSynth(1);
    samplePlayer = new SamplePlayer();
    discordStreamer = new DiscordAudioStreamer();
  }
}

function schedulePatternAudioForPlayingSynths() {
  schedulePatternAudio();
}

const debugLog = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, '..', 'debug.log'), line + '\n'); } catch {}
};

// Synth CRUD endpoints
app.post('/synth/create', (req, res) => {
  initAudioEngine();
  const { synthId } = req.body;

  if (!synthId || synthId < 1 || synthId > 2 || synths.has(synthId)) {
    return res.status(400).json({ error: 'Invalid synthId' });
  }

  initSynth(synthId);
  const synthData = synths.get(synthId)!;

  broadcastToClients({
    type: 'synthCreated',
    data: {
      synthId,
      pattern: synthData.pattern,
      synthParams: synthData.synth.getParameters(),
      muted: false,
      solo: false,
    },
  });

  res.json({
    synthId,
    pattern: synthData.pattern,
    patterns: synthData.patterns,
    synthParams: synthData.synth.getParameters(),
    muted: false,
    solo: false,
  });
});

app.delete('/synth/:synthId', (req, res) => {
  const synthId = parseInt(req.params.synthId);

  if (synthId === 1) {
    return res.status(400).json({ error: 'Cannot remove synth 1' });
  }

  const synthData = synths.get(synthId);
  if (synthData) {
    synthData.sequencer.stop();
    synths.delete(synthId);
    synthMixState.delete(synthId);
  }

  broadcastToClients({ type: 'synthRemoved', data: { synthId } });
  res.json({ success: true });
});

// Synth parameters
app.get('/synth/:synthId/parameters', (req, res) => {
  initAudioEngine();
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  res.json(synthData.synth.getParameters());
});

app.post('/synth/:synthId/parameters', (req, res) => {
  initAudioEngine();
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  hasActiveSession = true;

  try {
    synthData.synth.updateParameters(req.body as Partial<SynthParameters>);
    broadcastToClients({ type: 'synthUpdate', data: { synthId, parameters: synthData.synth.getParameters() } });
    if (synthData.sequencer && synthData.sequencer.getIsPlaying()) {
      schedulePatternAudio();
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update synth parameters:', {
      error: error instanceof Error ? error.message : String(error),
      params: req.body,
    });

    app.post('/synth/:synthId/mix', (req, res) => {
      initAudioEngine();
      const synthId = parseInt(req.params.synthId);
      if (!synths.has(synthId)) return res.status(404).json({ error: 'Synth not found' });

      const current = synthMixState.get(synthId) || { muted: false, solo: false };
      const { muted, solo } = req.body as { muted?: boolean; solo?: boolean };

      const next: SynthMixState = {
        muted: typeof muted === 'boolean' ? muted : current.muted,
        solo: typeof solo === 'boolean' ? solo : current.solo,
      };

      synthMixState.set(synthId, next);
      broadcastToClients({ type: 'synthMix', data: { synthId, ...next } });
      schedulePatternAudioForPlayingSynths();
      res.json({ success: true, synthId, ...next });
    });
    res.status(400).json({
      error: 'Invalid parameters',
      message: error instanceof Error ? error.message : 'Failed to update parameters',
    });
  }
});

app.post('/synth/:synthId/note', (req, res) => {
  initAudioEngine();
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  const { note, duration, velocity } = req.body;
  synthData.synth.playNote(note, duration, velocity);
  res.json({ success: true });
});

app.post('/synth/:synthId/note-on', (req, res) => {
  initAudioEngine();
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  const { note, velocity } = req.body;
  synthData.synth.noteOn(note, velocity);
  res.json({ success: true });
});

app.post('/synth/:synthId/note-off', (req, res) => {
  initAudioEngine();
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  if (synthData.sequencer.getIsPlaying()) {
    return res.json({ success: true });
  }

  const { note } = req.body;
  synthData.synth.noteOff(note);
  res.json({ success: true });
});

app.post('/synth/:synthId/tempo', (req, res) => {
  initAudioEngine();

  const { tempo } = req.body;
  if (typeof tempo !== 'number' || isNaN(tempo) || tempo < 20 || tempo > 400) {
    return res.status(400).json({ error: 'Invalid tempo', message: 'Tempo must be between 20 and 400 BPM' });
  }

  globalTempo = tempo;

  for (const [id, data] of synths) {
    data.sequencer.setTempo(tempo);
    data.pattern = { ...data.pattern, tempo };
  }

  broadcastToClients({ type: 'tempoChange', data: { tempo } });
  res.json({ success: true });
});

// Patterns per synth
app.get('/synth/:synthId/patterns', (req, res) => {
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  res.json(synthData.patterns);
});

app.put('/synth/:synthId/patterns/:patternId', (req, res) => {
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  const pattern: Pattern = req.body;
  synthData.pattern = pattern;
  synthData.patterns = synthData.patterns.map(p => p.id === pattern.id ? pattern : p);

  broadcastToClients({ type: 'patternUpdated', data: { synthId, pattern } });
  if (synthData.sequencer && synthData.sequencer.getIsPlaying()) {
    synthData.sequencer.loadPattern(pattern);
    schedulePatternAudio();
  }
  res.json(pattern);
});

app.post('/synth/:synthId/patterns', (req, res) => {
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  hasActiveSession = true;
  const pattern = synthData.sequencer.createEmptyPattern(req.body.name || 'New Pattern');
  synthData.patterns.push(pattern);

  broadcastToClients({ type: 'patternCreated', data: { synthId, pattern } });
  res.json(pattern);
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
  schedulePatternAudioForPlayingSynths();
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
  schedulePatternAudioForPlayingSynths();
  res.json({ success: true });
});

app.post('/drum/mix', (req, res) => {
  initAudioEngine();
  const { instrument, muted, solo } = req.body as { instrument: DrumInstrument; muted?: boolean; solo?: boolean };
  if (!DRUM_INSTRUMENTS.includes(instrument)) {
    return res.status(400).json({ error: 'Invalid instrument' });
  }

  const track = drumState[instrument];
  if (typeof muted === 'boolean') track.muted = muted;
  if (typeof solo === 'boolean') track.solo = solo;

  broadcastToClients({
    type: 'drumMix',
    data: { instrument, muted: Boolean(track.muted), solo: Boolean(track.solo) },
  });
  schedulePatternAudioForPlayingSynths();
  res.json({ success: true });
});

app.put('/drum/state', (req, res) => {
  const { state } = req.body as { state: DrumState };
  if (!state) return res.status(400).json({ error: 'state is required' });
  drumState = normalizeDrumState(state);
  broadcastToClients({ type: 'drumFullState', data: { drumState } });
  schedulePatternAudioForPlayingSynths();
  res.json({ success: true });
});

app.post('/drum/reset', (req, res) => {
  drumState = createDefaultDrumState();
  broadcastToClients({ type: 'drumReset' });
  schedulePatternAudioForPlayingSynths();
  res.json({ success: true });
});

app.post('/drum/master-volume', (req, res) => {
  const { volume } = req.body as { volume: number };
  drumMasterVolume = clamp(volume, 0, 2);
  schedulePatternAudioForPlayingSynths();
  res.json({ success: true });
});

// Saved patterns
app.post('/patterns/save', (req, res) => {
  const { name, steps, synthParams, tempo, drumState: ds, drumMasterVolume: dmv, synthId } = req.body;
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
  res.json({ ...entry, drumState: normalizeDrumState(entry.drumState) });
});

app.delete('/patterns/saved/:id', (req, res) => {
  let saved = loadSavedPatterns();
  const idx = saved.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Saved pattern not found' });
  saved.splice(idx, 1);
  saveSavedPatterns(saved);
  res.json({ success: true });
});

// Sequencer
app.post('/sequencer/play', (req, res) => {
  initAudioEngine();
  hasActiveSession = true;
  const { synthId = 1, patternId } = req.body;
  const synthData = synths.get(synthId);

  if (!synthData) {
    return res.status(404).json({ error: 'Synth not found' });
  }

  const pattern = patternId ? synthData.patterns.find(p => p.id === patternId) : synthData.pattern;
  if (!pattern) {
    return res.status(404).json({ error: 'Pattern not found' });
  }

  synthData.sequencer.loadPattern(pattern);
  synthData.sequencer.play();
  synthData.pattern = pattern;

  const drumCount = DRUM_INSTRUMENTS.reduce((sum, inst) => sum + drumState[inst].steps.filter(Boolean).length, 0);
  debugLog(`POST /sequencer/play: synthId=${synthId}, patternId=${pattern.id}, drumActiveSteps=${drumCount}`);
  broadcastPatternAudio();
  broadcastToClients({ type: 'sequencerPlay', data: { synthId, patternId: pattern.id } });
  res.json({ success: true });
});

app.post('/sequencer/stop', (req, res) => {
  initAudioEngine();
  const { synthId = 1 } = req.body;
  const synthData = synths.get(synthId);

  if (!synthData) {
    return res.status(404).json({ error: 'Synth not found' });
  }

  synthData.sequencer.stop();
  broadcastToClients({ type: 'sequencerStop', data: { synthId } });
  res.json({ success: true });
});

// Global tempo
app.get('/tempo', (req, res) => {
  res.json({ tempo: globalTempo });
});

app.post('/tempo', (req, res) => {
  initAudioEngine();

  const { tempo } = req.body;
  if (typeof tempo !== 'number' || isNaN(tempo) || tempo < 20 || tempo > 400) {
    return res.status(400).json({ error: 'Invalid tempo', message: 'Tempo must be between 20 and 400 BPM' });
  }

  globalTempo = tempo;

  for (const [id, data] of synths) {
    data.sequencer.setTempo(tempo);
    data.pattern = { ...data.pattern, tempo };
  }

  broadcastToClients({ type: 'tempoChange', data: { tempo } });
  res.json({ success: true });
});

// Health check endpoint
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

  const synthsData = Array.from(synths.entries()).map(([id, data]) => ({
    synthId: id,
    pattern: data.pattern,
    patterns: data.patterns,
    synthParams: data.synth.getParameters(),
    isPlaying: data.sequencer.getIsPlaying(),
    muted: synthMixState.get(id)?.muted ?? false,
    solo: synthMixState.get(id)?.solo ?? false,
  }));

  ws.send(JSON.stringify({
    type: 'init',
    data: {
      hasActiveSession,
      synths: synthsData,
      samples: samplePlayer!.getSamples(),
      streamingState,
      drumState,
      tempo: globalTempo,
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

function renderPatternAudio(): string | null {
  try {
    const playingSynths = Array.from(synths.entries()).filter(([, data]) => data.sequencer.getIsPlaying());
    if (playingSynths.length === 0) return null;

    const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
    const tempo = clamp(globalTempo || 120, 20, 400);
    const drumActiveSteps = DRUM_INSTRUMENTS.reduce((sum, inst) => {
      const track = drumState[inst];
      if (!track || !track.steps) return sum;
      return sum + track.steps.filter(Boolean).length;
    }, 0);
    debugLog(`renderPatternAudio synths=${playingSynths.length}: tempo=${tempo}, drumActiveSteps=${drumActiveSteps}`);
    const beatsPerStep = 60 / tempo / 4;
    const stepDuration = beatsPerStep;
    const totalSamples = Math.floor(16 * stepDuration * sampleRate);
    const fullPCM = new Float32Array(totalSamples);

    const hasSynthSolo = playingSynths.some(([id]) => Boolean(synthMixState.get(id)?.solo));

    for (const [id, synthData] of playingSynths) {
      const mix = synthMixState.get(id) || { muted: false, solo: false };
      if (mix.muted) continue;
      if (hasSynthSolo && !mix.solo) continue;
      for (let i = 0; i < 16; i++) {
        const step = synthData.pattern.steps[i];
        if (step.note) {
          const noteDur = Math.max(stepDuration - 0.01, 0.05);
          const notePCM = synthData.synth.renderNote(step.note, noteDur, step.velocity, sampleRate);
          const offset = Math.floor(i * stepDuration * sampleRate);
          for (let j = 0; j < notePCM.length && offset + j < totalSamples; j++) {
            fullPCM[offset + j] += notePCM[j];
          }
        }
      }
    }

    const drumPCM = DrumSynthesizer.renderPattern(drumState, tempo, sampleRate);
    let drumMax = 0;
    for (let i = 0; i < drumPCM.length; i++) { const a = Math.abs(drumPCM[i]); if (a > drumMax) drumMax = a; }
    debugLog(`renderPatternAudio drumPCM max=${drumMax.toFixed(4)}, length=${drumPCM.length}`);
    for (let i = 0; i < drumPCM.length && i < totalSamples; i++) {
      fullPCM[i] += drumPCM[i] * AUDIO_MIXING.DRUM_BOOST_FACTOR * drumMasterVolume;
    }

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
  const anyPlaying = Array.from(synths.values()).some((data) => data.sequencer.getIsPlaying());
  if (!anyPlaying) return;
  const audioBase64 = renderPatternAudio();
  if (audioBase64) {
    broadcastToClients({ type: 'patternAudio', data: { synthId: 0, audio: audioBase64, sampleRate: 48000, tempo: globalTempo } });
  }
}

const schedulePatternAudio = throttle(() => broadcastPatternAudio(), 300);

function broadcastToClients(message: unknown) {
  const payload = JSON.stringify(message);
  clients.forEach((client) => {
    if (isWebSocketOpen(client)) {
      client.send(payload);
    }
  });
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web API server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/ws`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
