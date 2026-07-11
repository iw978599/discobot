import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import WebSocket, { WebSocketServer } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { Synthesizer, Sequencer, SamplePlayer, Pattern, SynthParameters, DrumState, DrumInstrument, DiscordAudioStreamer, DrumSynthesizer, clamp, throttle, AUDIO_MIXING, AUDIO_CONTEXT } from '@discord-synth/engine';
import { assignRole, canControl, SessionRole } from './sessionAuth';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || process.env.WEB_PORT || '3001', 10);
const AUTH_MODE = process.env.AUTH_MODE === 'strict' ? 'strict' : 'compatibility';
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || process.env.DISCORD_TOKEN || 'discobot-dev-secret';
const BOT_SHARED_SECRET = process.env.BOT_SHARED_SECRET || process.env.DISCORD_TOKEN || 'discobot-bot-secret';
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SIGNATURE_MAX_SKEW_MS = 60_000;

if (AUTH_MODE === 'strict') {
  if (TOKEN_SECRET === 'discobot-dev-secret') throw new Error('AUTH_TOKEN_SECRET must be set in strict mode');
  if (BOT_SHARED_SECRET === 'discobot-bot-secret') throw new Error('BOT_SHARED_SECRET must be set in strict mode');
}

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; style-src-elem 'self' 'unsafe-inline' https:; style-src-attr 'self' 'unsafe-inline' https:; script-src 'self' https:; connect-src 'self' https: ws: wss:; manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests");
  next();
});
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
  },
}));
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

interface AuthSession {
  token: string;
  guildId: string;
  userId: string;
  username: string;
  role: SessionRole;
  csrfToken: string;
  expiresAt: number;
  createdAt: number;
  lastSeenAt: number;
}

interface LoginToken {
  token: string;
  guildId: string;
  userId: string;
  username: string;
  expiresAt: number;
  createdAt: number;
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

interface GuildRuntimeState {
  guildId: string;
  synths: Map<number, SynthData>;
  synthMixState: Map<number, SynthMixState>;
  samplePlayer: SamplePlayer | null;
  discordStreamer: DiscordAudioStreamer | null;
  hasActiveSession: boolean;
  streamingState: {
    isStreamingToDiscord: boolean;
    currentStream: AudioBuffer | null;
    streamQueue: AudioBuffer[];
    streamPosition: number;
    lastUpdate: number;
  };
  drumState: DrumState;
  drumMasterVolume: number;
  globalTempo: number;
}

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

interface GuildMemberRecord {
  userId: string;
  username: string;
  role: 'owner' | 'collaborator';
  addedAt: number;
  lastSeenAt: number;
}

interface GuildPersistedData {
  guildId: string;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
  members: GuildMemberRecord[];
  savedPatterns: SavedPatternData[];
}

interface PersistedStore {
  version: 2;
  guilds: Record<string, GuildPersistedData>;
}

const DRUM_INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const SAVED_PATTERNS_FILE = path.join(__dirname, '..', 'saved-patterns.json');
const guildStates = new Map<string, GuildRuntimeState>();
const authSessions = new Map<string, AuthSession>();
const loginTokens = new Map<string, LoginToken>();
const wsClients = new Map<WebSocket, { guildId: string; sessionToken: string }>();
const botClients = new Set<WebSocket>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function createDefaultDrumState(): DrumState {
  const state = {} as DrumState;
  for (const inst of DRUM_INSTRUMENTS) {
    state[inst] = {
      steps: new Array(16).fill(false),
      settings: { volume: 0.5, tone: 0.5, extra: 0.5 },
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

function createGuildRuntimeState(guildId: string): GuildRuntimeState {
  return {
    guildId,
    synths: new Map<number, SynthData>(),
    synthMixState: new Map<number, SynthMixState>(),
    samplePlayer: null,
    discordStreamer: null,
    hasActiveSession: false,
    streamingState: {
      isStreamingToDiscord: false,
      currentStream: null,
      streamQueue: [],
      streamPosition: 0,
      lastUpdate: 0,
    },
    drumState: createDefaultDrumState(),
    drumMasterVolume: 1,
    globalTempo: 120,
  };
}

function getGuildState(guildId: string): GuildRuntimeState {
  let state = guildStates.get(guildId);
  if (!state) {
    state = createGuildRuntimeState(guildId);
    guildStates.set(guildId, state);
  }
  return state;
}

function randomToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function sanitizeId(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(value)) return null;
  return value;
}

function signPayload(payload: object): string {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

function verifySignedPayload(token: string): any | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [raw, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(raw).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function readPersistedStore(): PersistedStore {
  try {
    if (!fs.existsSync(SAVED_PATTERNS_FILE)) {
      return { version: 2, guilds: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(SAVED_PATTERNS_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      const now = Date.now();
      return {
        version: 2,
        guilds: {
          legacy: {
            guildId: 'legacy',
            ownerUserId: null,
            createdAt: now,
            updatedAt: now,
            members: [],
            savedPatterns: parsed,
          },
        },
      };
    }
    if (parsed?.version === 2 && parsed?.guilds) {
      return parsed;
    }
  } catch (error) {
    console.error('Failed to read persisted data:', error);
  }
  return { version: 2, guilds: {} };
}

function writePersistedStore(data: PersistedStore) {
  fs.writeFileSync(SAVED_PATTERNS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getPersistedGuild(guildId: string): GuildPersistedData {
  const data = readPersistedStore();
  if (!data.guilds[guildId]) {
    const now = Date.now();
    data.guilds[guildId] = {
      guildId,
      ownerUserId: null,
      createdAt: now,
      updatedAt: now,
      members: [],
      savedPatterns: [],
    };
    writePersistedStore(data);
  }
  return data.guilds[guildId];
}

function savePersistedGuild(guild: GuildPersistedData) {
  const data = readPersistedStore();
  data.guilds[guild.guildId] = { ...guild, updatedAt: Date.now() };
  writePersistedStore(data);
}

function upsertGuildMember(guildId: string, userId: string, username: string): SessionRole {
  const guild = getPersistedGuild(guildId);
  const now = Date.now();
  let member = guild.members.find((m) => m.userId === userId);
  if (!member) {
    const role: 'owner' | 'collaborator' = assignRole(guild.ownerUserId, userId);
    member = { userId, username, role, addedAt: now, lastSeenAt: now };
    guild.members.push(member);
    if (!guild.ownerUserId) guild.ownerUserId = userId;
  } else {
    member.username = username;
    member.lastSeenAt = now;
  }
  savePersistedGuild(guild);
  return member.role;
}

function ensureOwnerOrCollaborator(session: AuthSession): boolean {
  return canControl(session.role);
}

function getAuthSessionFromHeader(req: Request): AuthSession | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    authSessions.delete(token);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

function getRequestSession(req: Request): AuthSession | null {
  const session = getAuthSessionFromHeader(req);
  if (session) return session;
  if (AUTH_MODE === 'compatibility') {
    return {
      token: 'compatibility',
      guildId: 'legacy',
      userId: 'legacy-user',
      username: 'Legacy User',
      role: 'owner',
      csrfToken: 'compatibility-csrf',
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
  }
  return null;
}

function verifyBotSignature(req: Request): boolean {
  const ts = req.header('x-bot-timestamp');
  const sig = req.header('x-bot-signature');
  if (!ts || !sig) return false;
  const parsedTs = Number(ts);
  if (!Number.isFinite(parsedTs)) return false;
  if (Math.abs(Date.now() - parsedTs) > SIGNATURE_MAX_SKEW_MS) return false;
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
  const expected = crypto.createHmac('sha256', BOT_SHARED_SECRET).update(`${ts}.${rawBody}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

function requireSession(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/auth/') || req.path === '/health' || req.path === '/ws' || req.path === '/ws/' || req.path === '/') {
    next();
    return;
  }
  const session = getRequestSession(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    return;
  }
  (req as Request & { session?: AuthSession }).session = session;
  next();
}

function requirePermission(req: Request, res: Response, next: NextFunction) {
  const session = (req as Request & { session?: AuthSession }).session ?? getRequestSession(req);
  if (!session || !ensureOwnerOrCollaborator(session)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH';
  if (!mutating || req.path.startsWith('/auth/')) {
    next();
    return;
  }
  const session = (req as Request & { session?: AuthSession }).session ?? getRequestSession(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (AUTH_MODE === 'compatibility' && session.token === 'compatibility') {
    next();
    return;
  }
  const csrf = req.header('x-csrf-token');
  if (!csrf || csrf !== session.csrfToken) {
    res.status(403).json({ error: 'CSRF validation failed' });
    return;
  }
  next();
}

function applyRateLimit(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const current = rateLimitMap.get(key);
    if (!current || current.resetAt <= now) {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (current.count >= limit) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    current.count += 1;
    next();
  };
}

app.use(applyRateLimit(300, 60_000));
app.use(requireSession);
app.use(requireCsrf);

function getSession(req: Request): AuthSession {
  const session = (req as Request & { session?: AuthSession }).session;
  if (!session) throw new Error('Session missing');
  return session;
}

function initSynth(state: GuildRuntimeState, synthId: number) {
  if (state.synths.has(synthId)) return;
  const synth = new Synthesizer();
  const sequencer = new Sequencer(synth);
  sequencer.setTempo(state.globalTempo);
  const pattern = sequencer.createEmptyPattern(`Synth ${synthId}`);
  pattern.tempo = state.globalTempo;
  const patterns: Pattern[] = [pattern];

  sequencer.onStep((step: number) => {
    broadcastToClients({ type: 'sequencerStep', data: { guildId: state.guildId, synthId, step } }, state.guildId);
  });

  state.synths.set(synthId, { synth, sequencer, pattern, patterns });
  state.synthMixState.set(synthId, { muted: false, solo: false });
}

function initAudioEngine(state: GuildRuntimeState) {
  if (state.synths.size === 0) {
    initSynth(state, 1);
    state.samplePlayer = new SamplePlayer();
    state.discordStreamer = new DiscordAudioStreamer();
  }
}

const isWebSocketOpen = (client: WebSocket): boolean => client.readyState === WebSocket.OPEN;

function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, '..', 'debug.log'), line + '\n'); } catch {}
}

function renderPatternAudio(state: GuildRuntimeState): string | null {
  try {
    const playingSynths = Array.from(state.synths.entries()).filter(([, data]) => data.sequencer.getIsPlaying());
    if (playingSynths.length === 0) return null;

    const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
    const tempo = clamp(state.globalTempo || 120, 20, 400);
    const beatsPerStep = 60 / tempo / 4;
    const stepDuration = beatsPerStep;
    const totalSamples = Math.floor(16 * stepDuration * sampleRate);
    const fullPCM = new Float32Array(totalSamples);

    const hasSynthSolo = playingSynths.some(([id]) => Boolean(state.synthMixState.get(id)?.solo));

    for (const [id, synthData] of playingSynths) {
      const mix = state.synthMixState.get(id) || { muted: false, solo: false };
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

    const drumPCM = DrumSynthesizer.renderPattern(state.drumState, tempo, sampleRate);
    for (let i = 0; i < drumPCM.length && i < totalSamples; i++) {
      fullPCM[i] += drumPCM[i] * AUDIO_MIXING.DRUM_BOOST_FACTOR * state.drumMasterVolume;
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

function getPatternAudioPayload(state: GuildRuntimeState): { audio: string; sampleRate: number; tempo: number } | null {
  const audioBase64 = renderPatternAudio(state);
  if (!audioBase64) return null;
  return { audio: audioBase64, sampleRate: AUDIO_CONTEXT.RENDER_SAMPLE_RATE, tempo: state.globalTempo };
}

function broadcastToClients(message: unknown, guildId: string) {
  const payload = JSON.stringify(message);
  wsClients.forEach((meta, client) => {
    if (meta.guildId === guildId && isWebSocketOpen(client)) {
      client.send(payload);
    }
  });
}

function broadcastToBotClients(message: unknown) {
  const payload = JSON.stringify(message);
  for (const client of botClients) {
    if (isWebSocketOpen(client)) client.send(payload);
  }
}

function broadcastPatternAudio(state: GuildRuntimeState) {
  const anyPlaying = Array.from(state.synths.values()).some((data) => data.sequencer.getIsPlaying());
  if (!anyPlaying) return;
  const patternAudioPayload = getPatternAudioPayload(state);
  if (patternAudioPayload) {
    const event = { type: 'patternAudio', data: { guildId: state.guildId, synthId: 0, ...patternAudioPayload } };
    broadcastToClients(event, state.guildId);
    broadcastToBotClients(event);
  }
}

const schedulePatternAudioThrottles = new Map<string, () => void>();

function schedulePatternAudio(guildId: string) {
  let throttled = schedulePatternAudioThrottles.get(guildId);
  if (!throttled) {
    throttled = throttle(() => broadcastPatternAudio(getGuildState(guildId)), 300);
    schedulePatternAudioThrottles.set(guildId, throttled);
  }
  if (typeof throttled === 'function') throttled();
}

function schedulePatternAudioForPlayingSynths(guildId: string) {
  schedulePatternAudio(guildId);
}

app.use('/auth', applyRateLimit(120, 60_000));

app.post('/auth/discord/token', applyRateLimit(30, 60_000), (req, res) => {
  if (!verifyBotSignature(req)) {
    return res.status(401).json({ error: 'Invalid bot signature' });
  }

  const { guildId: rawGuildId, userId: rawUserId, username } = req.body as { guildId?: string; userId?: string; username?: string };
  const guildId = sanitizeId(rawGuildId);
  const userId = sanitizeId(rawUserId);
  if (!guildId || !userId || !username) {
    return res.status(400).json({ error: 'guildId, userId, username are required' });
  }

  const role = upsertGuildMember(guildId, userId, username);
  const tokenData = {
    jti: randomToken(),
    guildId,
    userId,
    username,
    role,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const loginToken = signPayload(tokenData);
  loginTokens.set(tokenData.jti, {
    token: tokenData.jti,
    guildId,
    userId,
    username,
    createdAt: Date.now(),
    expiresAt: tokenData.exp,
  });

  res.json({ loginToken, expiresAt: tokenData.exp, guildId, role });
});

app.post('/auth/bot/session', applyRateLimit(60, 60_000), (req, res) => {
  if (!verifyBotSignature(req)) {
    return res.status(401).json({ error: 'Invalid bot signature' });
  }

  const guildId = sanitizeId((req.body as { guildId?: string }).guildId);
  if (!guildId) return res.status(400).json({ error: 'guildId is required' });
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const session: AuthSession = {
    token: sessionToken,
    guildId,
    userId: 'bot',
    username: 'Discord Bot',
    role: 'bot',
    csrfToken,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  authSessions.set(sessionToken, session);
  res.json({ sessionToken, csrfToken, guildId, expiresAt: session.expiresAt });
});

app.post('/auth/exchange', applyRateLimit(60, 60_000), (req, res) => {
  const { loginToken } = req.body as { loginToken?: string };
  if (!loginToken) return res.status(400).json({ error: 'loginToken is required' });

  const payload = verifySignedPayload(loginToken);
  if (!payload?.jti || payload.exp < Date.now()) {
    return res.status(401).json({ error: 'Login token expired or invalid' });
  }
  const guildId = sanitizeId(payload.guildId);
  const userId = sanitizeId(payload.userId);
  if (!guildId || !userId || typeof payload.username !== 'string') {
    return res.status(401).json({ error: 'Login token payload is invalid' });
  }

  const tracked = loginTokens.get(payload.jti);
  if (!tracked || tracked.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Login token already used or invalid' });
  }
  loginTokens.delete(payload.jti);

  const role = upsertGuildMember(guildId, userId, payload.username);
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const session: AuthSession = {
    token: sessionToken,
    guildId,
    userId,
    username: payload.username,
    role,
    csrfToken,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  authSessions.set(sessionToken, session);

  const guild = getPersistedGuild(guildId);
  savePersistedGuild({ ...guild, updatedAt: Date.now() });

  res.json({
    mode: AUTH_MODE,
    sessionToken,
    csrfToken,
    session: {
      guildId: session.guildId,
      userId: session.userId,
      username: session.username,
      role: session.role,
      expiresAt: session.expiresAt,
    },
  });
});

app.get('/auth/session', (req, res) => {
  const session = getRequestSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  res.json({
    mode: AUTH_MODE,
    session: {
      guildId: session.guildId,
      userId: session.userId,
      username: session.username,
      role: session.role,
      expiresAt: session.expiresAt,
    },
  });
});

app.post('/auth/logout', (req, res) => {
  const session = getAuthSessionFromHeader(req);
  if (session) authSessions.delete(session.token);
  res.json({ success: true });
});

app.use(requirePermission);

app.post('/synth/create', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { synthId } = req.body;

  if (!synthId || synthId < 1 || synthId > 3 || state.synths.has(synthId)) {
    return res.status(400).json({ error: 'Invalid synthId' });
  }

  initSynth(state, synthId);
  const synthData = state.synths.get(synthId)!;

  broadcastToClients({
    type: 'synthCreated',
    data: {
      guildId: session.guildId,
      synthId,
      pattern: synthData.pattern,
      synthParams: synthData.synth.getParameters(),
      muted: false,
      solo: false,
    },
  }, session.guildId);

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
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const synthId = parseInt(req.params.synthId);
  if (synthId === 1) return res.status(400).json({ error: 'Cannot remove synth 1' });

  const synthData = state.synths.get(synthId);
  if (synthData) {
    synthData.sequencer.stop();
    state.synths.delete(synthId);
    state.synthMixState.delete(synthId);
  }

  broadcastToClients({ type: 'synthRemoved', data: { guildId: session.guildId, synthId } }, session.guildId);
  res.json({ success: true });
});

app.get('/synth/:synthId/parameters', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const synthData = state.synths.get(parseInt(req.params.synthId));
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  res.json(synthData.synth.getParameters());
});

app.post('/synth/:synthId/parameters', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const synthId = parseInt(req.params.synthId);
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  try {
    state.hasActiveSession = true;
    synthData.synth.updateParameters(req.body as Partial<SynthParameters>);
    broadcastToClients({ type: 'synthUpdate', data: { guildId: session.guildId, synthId, parameters: synthData.synth.getParameters() } }, session.guildId);
    if (synthData.sequencer.getIsPlaying()) schedulePatternAudio(session.guildId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({
      error: 'Invalid parameters',
      message: error instanceof Error ? error.message : 'Failed to update parameters',
    });
  }
});

app.post('/synth/:synthId/mix', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const synthId = parseInt(req.params.synthId);
  if (!state.synths.has(synthId)) return res.status(404).json({ error: 'Synth not found' });

  const current = state.synthMixState.get(synthId) || { muted: false, solo: false };
  const { muted, solo } = req.body as { muted?: boolean; solo?: boolean };
  const next: SynthMixState = {
    muted: typeof muted === 'boolean' ? muted : current.muted,
    solo: typeof solo === 'boolean' ? solo : current.solo,
  };
  state.synthMixState.set(synthId, next);
  broadcastToClients({ type: 'synthMix', data: { guildId: session.guildId, synthId, ...next } }, session.guildId);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true, synthId, ...next });
});

app.post('/synth/:synthId/note', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const synthData = state.synths.get(parseInt(req.params.synthId));
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  const { note, duration, velocity } = req.body;
  synthData.synth.playNote(note, duration, velocity);
  res.json({ success: true });
});

app.post('/synth/:synthId/note-on', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const synthData = state.synths.get(parseInt(req.params.synthId));
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  const { note, velocity } = req.body;
  synthData.synth.noteOn(note, velocity);
  res.json({ success: true });
});

app.post('/synth/:synthId/note-off', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const synthData = state.synths.get(parseInt(req.params.synthId));
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  if (synthData.sequencer.getIsPlaying()) return res.json({ success: true });
  synthData.synth.noteOff(req.body.note);
  res.json({ success: true });
});

app.post('/synth/:synthId/tempo', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { tempo } = req.body;
  if (typeof tempo !== 'number' || Number.isNaN(tempo) || tempo < 20 || tempo > 400) {
    return res.status(400).json({ error: 'Invalid tempo', message: 'Tempo must be between 20 and 400 BPM' });
  }
  state.globalTempo = tempo;
  for (const [, data] of state.synths) {
    data.sequencer.setTempo(tempo);
    data.pattern = { ...data.pattern, tempo };
  }
  broadcastToClients({ type: 'tempoChange', data: { guildId: session.guildId, tempo } }, session.guildId);
  res.json({ success: true });
});

app.get('/synth/:synthId/patterns', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const synthData = state.synths.get(parseInt(req.params.synthId));
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  res.json(synthData.patterns);
});

app.put('/synth/:synthId/patterns/:patternId', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const synthId = parseInt(req.params.synthId);
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  const pattern: Pattern = req.body;
  synthData.pattern = pattern;
  synthData.patterns = synthData.patterns.map(p => p.id === pattern.id ? pattern : p);
  broadcastToClients({ type: 'patternUpdated', data: { guildId: session.guildId, synthId, pattern } }, session.guildId);
  if (synthData.sequencer.getIsPlaying()) {
    synthData.sequencer.loadPattern(pattern);
    schedulePatternAudio(session.guildId);
  }
  res.json(pattern);
});

app.post('/synth/:synthId/patterns', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const synthId = parseInt(req.params.synthId);
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  state.hasActiveSession = true;
  const pattern = synthData.sequencer.createEmptyPattern(req.body.name || 'New Pattern');
  synthData.patterns.push(pattern);
  broadcastToClients({ type: 'patternCreated', data: { guildId: session.guildId, synthId, pattern } }, session.guildId);
  res.json(pattern);
});

app.get('/drum/state', (req, res) => {
  const session = getSession(req);
  res.json(getGuildState(session.guildId).drumState);
});

app.post('/drum/step', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { instrument, step, active } = req.body as { instrument: DrumInstrument; step: number; active: boolean };
  if (!DRUM_INSTRUMENTS.includes(instrument) || step < 0 || step > 15) {
    return res.status(400).json({ error: 'Invalid instrument or step' });
  }
  state.drumState[instrument].steps[step] = active;
  debugLog(`POST /drum/step guild=${session.guildId}: ${instrument}[${step}] = ${active}`);
  broadcastToClients({ type: 'drumStep', data: { guildId: session.guildId, instrument, step, active } }, session.guildId);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true });
});

app.post('/drum/settings', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { instrument, settings } = req.body as { instrument: DrumInstrument; settings: { volume?: number; tone?: number; extra?: number } };
  if (!DRUM_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'Invalid instrument' });
  const s = state.drumState[instrument].settings;
  if (settings.volume !== undefined) s.volume = clamp(settings.volume, 0, 1);
  if (settings.tone !== undefined) s.tone = clamp(settings.tone, 0, 1);
  if (settings.extra !== undefined) s.extra = clamp(settings.extra, 0, 1);
  broadcastToClients({ type: 'drumSettings', data: { guildId: session.guildId, instrument, settings: { ...s } } }, session.guildId);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true });
});

app.post('/drum/mix', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { instrument, muted, solo } = req.body as { instrument: DrumInstrument; muted?: boolean; solo?: boolean };
  if (!DRUM_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'Invalid instrument' });
  const track = state.drumState[instrument];
  if (typeof muted === 'boolean') track.muted = muted;
  if (typeof solo === 'boolean') track.solo = solo;
  broadcastToClients({ type: 'drumMix', data: { guildId: session.guildId, instrument, muted: Boolean(track.muted), solo: Boolean(track.solo) } }, session.guildId);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true });
});

app.put('/drum/state', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const { state: incoming } = req.body as { state: DrumState };
  if (!incoming) return res.status(400).json({ error: 'state is required' });
  state.drumState = normalizeDrumState(incoming);
  broadcastToClients({ type: 'drumFullState', data: { guildId: session.guildId, drumState: state.drumState } }, session.guildId);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true });
});

app.post('/drum/reset', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  state.drumState = createDefaultDrumState();
  broadcastToClients({ type: 'drumReset', data: { guildId: session.guildId } }, session.guildId);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true });
});

app.post('/drum/master-volume', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  state.drumMasterVolume = clamp((req.body as { volume: number }).volume, 0, 2);
  schedulePatternAudioForPlayingSynths(session.guildId);
  res.json({ success: true });
});

app.post('/patterns/save', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const { name, steps, synthParams, tempo, drumState, drumMasterVolume } = req.body;
  if (!name || !steps) return res.status(400).json({ error: 'name and steps are required' });

  const guild = getPersistedGuild(session.guildId);
  const entry: SavedPatternData = {
    id: `saved-${Date.now()}`,
    name: String(name),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps,
    synthParams: synthParams || null,
    tempo: tempo || state.globalTempo,
    drumState: drumState || state.drumState,
    drumMasterVolume: drumMasterVolume !== undefined ? drumMasterVolume : state.drumMasterVolume,
  };
  guild.savedPatterns.push(entry);
  savePersistedGuild(guild);
  res.json({ id: entry.id, name: entry.name, updatedAt: entry.updatedAt });
});

app.get('/patterns/saved', (req, res) => {
  const session = getSession(req);
  const guild = getPersistedGuild(session.guildId);
  res.json(guild.savedPatterns.sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })));
});

app.get('/patterns/saved/:id', (req, res) => {
  const session = getSession(req);
  const guild = getPersistedGuild(session.guildId);
  const entry = guild.savedPatterns.find((p) => p.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Saved pattern not found' });
  res.json({ ...entry, drumState: normalizeDrumState(entry.drumState) });
});

app.delete('/patterns/saved/:id', (req, res) => {
  const session = getSession(req);
  const guild = getPersistedGuild(session.guildId);
  const idx = guild.savedPatterns.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Saved pattern not found' });
  guild.savedPatterns.splice(idx, 1);
  savePersistedGuild(guild);
  res.json({ success: true });
});

app.post('/sequencer/play', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  state.hasActiveSession = true;
  const { synthId = 1, patternId } = req.body;
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });

  const pattern = patternId ? synthData.patterns.find(p => p.id === patternId) : synthData.pattern;
  if (!pattern) return res.status(404).json({ error: 'Pattern not found' });

  synthData.sequencer.loadPattern(pattern);
  synthData.sequencer.play();
  synthData.pattern = pattern;

  const patternAudioPayload = getPatternAudioPayload(state);
  if (patternAudioPayload) {
    const event = { type: 'patternAudio', data: { guildId: session.guildId, synthId: 0, ...patternAudioPayload } };
    broadcastToClients(event, session.guildId);
    broadcastToBotClients(event);
  }
  broadcastToClients({ type: 'sequencerPlay', data: { guildId: session.guildId, synthId, patternId: pattern.id } }, session.guildId);
  broadcastToBotClients({ type: 'sequencerPlay', data: { guildId: session.guildId, synthId, patternId: pattern.id } });
  res.json({ success: true, patternAudio: patternAudioPayload });
});

app.post('/sequencer/stop', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { synthId = 1 } = req.body;
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  synthData.sequencer.stop();
  const event = { type: 'sequencerStop', data: { guildId: session.guildId, synthId } };
  broadcastToClients(event, session.guildId);
  broadcastToBotClients(event);
  res.json({ success: true });
});

app.get('/tempo', (req, res) => {
  const session = getSession(req);
  res.json({ tempo: getGuildState(session.guildId).globalTempo });
});

app.post('/tempo', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { tempo } = req.body;
  if (typeof tempo !== 'number' || Number.isNaN(tempo) || tempo < 20 || tempo > 400) {
    return res.status(400).json({ error: 'Invalid tempo', message: 'Tempo must be between 20 and 400 BPM' });
  }

  state.globalTempo = tempo;
  for (const [, data] of state.synths) {
    data.sequencer.setTempo(tempo);
    data.pattern = { ...data.pattern, tempo };
  }
  broadcastToClients({ type: 'tempoChange', data: { guildId: session.guildId, tempo } }, session.guildId);
  res.json({ success: true });
});

app.get('/samples', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  res.json(state.samplePlayer!.getSamples());
});

app.post('/samples', async (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { id, name, url } = req.body;

  try {
    await state.samplePlayer!.loadSample(id, name, url);
    broadcastToClients({ type: 'sampleLoaded', data: { guildId: session.guildId, id, name, url } }, session.guildId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/samples/:id/play', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  try {
    state.samplePlayer!.playSample(req.params.id, req.body.velocity);
    res.json({ success: true });
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

app.delete('/samples/:id', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  state.samplePlayer!.removeSample(req.params.id);
  broadcastToClients({ type: 'sampleRemoved', data: { guildId: session.guildId, id: req.params.id } }, session.guildId);
  res.json({ success: true });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    authMode: AUTH_MODE,
  });
});

const server = http.createServer(app);
const WS_UI_PATHS = new Set(['/ws', '/ws/']);
const WS_BOT_PATHS = new Set(['/ws/bot', '/ws/bot/']);
const wssUi = new WebSocketServer({ noServer: true });
const wssBot = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const requestPath = req.url?.split('?')[0] ?? '';
  if (WS_UI_PATHS.has(requestPath)) {
    wssUi.handleUpgrade(req, socket, head, (ws) => wssUi.emit('connection', ws, req));
    return;
  }
  if (WS_BOT_PATHS.has(requestPath)) {
    wssBot.handleUpgrade(req, socket, head, (ws) => wssBot.emit('connection', ws, req));
    return;
  }
  socket.destroy();
});

app.get(['/ws', '/ws/'], (_req, res) => {
  res.status(426).json({
    error: 'WebSocket Upgrade Required',
    message: 'Use a WebSocket client with ws:// or wss:// protocol.',
  });
});

wssUi.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/ws', 'http://localhost');
  const token = requestUrl.searchParams.get('sessionToken');
  if (!token) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  const session = authSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  const guildId = session.guildId;
  wsClients.set(ws, { guildId, sessionToken: session.token });
  const state = getGuildState(guildId);
  initAudioEngine(state);

  const synthsData = Array.from(state.synths.entries()).map(([id, data]) => ({
    synthId: id,
    pattern: data.pattern,
    patterns: data.patterns,
    synthParams: data.synth.getParameters(),
    isPlaying: data.sequencer.getIsPlaying(),
    muted: state.synthMixState.get(id)?.muted ?? false,
    solo: state.synthMixState.get(id)?.solo ?? false,
  }));

  ws.send(JSON.stringify({
    type: 'init',
    data: {
      guildId,
      hasActiveSession: state.hasActiveSession,
      synths: synthsData,
      samples: state.samplePlayer!.getSamples(),
      streamingState: state.streamingState,
      drumState: state.drumState,
      tempo: state.globalTempo,
      session: {
        guildId: session.guildId,
        userId: session.userId,
        username: session.username,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    },
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
  });

  ws.on('error', () => {
    wsClients.delete(ws);
  });
});

wssBot.on('connection', (ws, req) => {
  const ts = req.headers['x-bot-timestamp'];
  const sig = req.headers['x-bot-signature'];
  if (typeof ts !== 'string' || typeof sig !== 'string') {
    ws.close(1008, 'Unauthorized');
    return;
  }
  const parsedTs = Number(ts);
  if (!Number.isFinite(parsedTs)) {
    ws.close(1008, 'Unauthorized');
    return;
  }
  const body = '';
  const expected = crypto.createHmac('sha256', BOT_SHARED_SECRET).update(`${ts}.${body}`).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(sig);
  if (
    Math.abs(Date.now() - parsedTs) > SIGNATURE_MAX_SKEW_MS ||
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  botClients.add(ws);
  ws.on('close', () => botClients.delete(ws));
  ws.on('error', () => botClients.delete(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web API server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/ws`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth mode: ${AUTH_MODE}`);
});
