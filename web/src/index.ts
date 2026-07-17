import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import WebSocket, { WebSocketServer } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { Synthesizer, Sequencer, SamplePlayer, Pattern, SynthParameters, DrumState, DrumInstrument, DrumKitDefinition, DrumKitId, DrumKitModelVariant, DrumInstrumentDefaults, DiscordAudioStreamer, DrumSynthesizer, EffectsLoopState, FxSendLevels, SynthModelId, SynthModelParams, clamp, throttle, AUDIO_MIXING, AUDIO_CONTEXT, StreamingSynth } from '@discord-synth/engine';
import { assignRole, canControl, SessionRole } from './sessionAuth';
import { getWebSocketChannel, getWebSocketRequestPath, isAllowedUpgradeOrigin } from './wsHelpers';
import { shouldUseCompatibilityFallback } from './authFallback';

dotenv.config();

const app = express();
app.disable('x-powered-by');
const PORT = parseInt(process.env.PORT || process.env.WEB_PORT || '3001', 10);
const AUTH_MODE = process.env.AUTH_MODE === 'strict' ? 'strict' : 'compatibility';
const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || process.env.DISCORD_TOKEN || 'discobot-dev-secret';
const BOT_SHARED_SECRET = process.env.BOT_SHARED_SECRET || process.env.DISCORD_TOKEN || 'discobot-bot-secret';
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SIGNATURE_MAX_SKEW_MS = 60_000;
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  process.env.PUBLIC_URL,
  process.env.UI_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined,
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (AUTH_MODE === 'strict') {
  if (TOKEN_SECRET === 'discobot-dev-secret') throw new Error('AUTH_TOKEN_SECRET must be set in strict mode');
  if (BOT_SHARED_SECRET === 'discobot-bot-secret') throw new Error('BOT_SHARED_SECRET must be set in strict mode');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-bot-timestamp', 'x-bot-signature'],
}));
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; style-src-elem 'self' 'unsafe-inline' https:; style-src-attr 'self' 'unsafe-inline' https:; script-src 'self' https:; connect-src 'self' https: ws: wss:; manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});
app.use(express.json({
  limit: '1mb',
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
  modelId: SynthModelId;
  modelParams: SynthModelParams;
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
  selectedDrumKitId: DrumKitId;
  drumMasterVolume: number;
  drumFx: {
    sends: FxSendLevels;
    returnLevel: number;
  };
  effectsLoop: EffectsLoopState;
  globalTempo: number;
}

interface SavedPatternData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  steps: Array<{ active: boolean; note?: string; velocity: number }>;
  synthParams: SynthParameters;
  synthModelId?: SynthModelId;
  synthModelParams?: SynthModelParams;
  tempo: number;
  drumState: DrumState;
  drumKitId?: DrumKitId;
  drumMasterVolume: number;
  drumFx?: {
    sends: FxSendLevels;
    returnLevel: number;
  };
  effectsLoop?: EffectsLoopState;
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
const DEFAULT_DRUM_KIT_ID: DrumKitId = 'clean-analog';
const SYNTH_MODEL_IDS: SynthModelId[] = ['generic', 'minimoog-model-d', 'juno-106', 'dx7', 'tb-303', 'prophet-5'];
const DEFAULT_SYNTH_MODEL_ID: SynthModelId = 'generic';
const DRUM_KITS: DrumKitDefinition[] = [
  {
    id: 'clean-analog',
    name: 'Clean / Analog',
    description: 'Balanced vintage-inspired kit with round transients.',
    modelVariant: 'analog',
    instrumentDefaults: {
      kick: { volume: 0.62, tone: 0.48, extra: 0.52 },
      snare: { volume: 0.68, tone: 0.46, extra: 0.68 },
      openHH: { volume: 0.45, tone: 0.52, extra: 0.48 },
      closedHH: { volume: 0.48, tone: 0.55, extra: 0.58 },
      ride: { volume: 0.43, tone: 0.52, extra: 0.48 },
      crash: { volume: 0.44, tone: 0.5, extra: 0.45 },
      snare2: { volume: 0.52, tone: 0.45, extra: 0.5 },
      clap: { volume: 0.5, tone: 0.5, extra: 0.5 },
    },
  },
  {
    id: 'punchy-modern',
    name: 'Punchy / Modern',
    description: 'Sharper transient-focused kit with tighter low-end.',
    modelVariant: 'modern',
    instrumentDefaults: {
      kick: { volume: 0.7, tone: 0.6, extra: 0.68 },
      snare: { volume: 0.74, tone: 0.54, extra: 0.82 },
      openHH: { volume: 0.48, tone: 0.66, extra: 0.56 },
      closedHH: { volume: 0.54, tone: 0.7, extra: 0.72 },
      ride: { volume: 0.48, tone: 0.66, extra: 0.58 },
      crash: { volume: 0.5, tone: 0.62, extra: 0.62 },
      snare2: { volume: 0.6, tone: 0.62, extra: 0.62 },
      clap: { volume: 0.56, tone: 0.6, extra: 0.66 },
    },
  },
  {
    id: 'lofi-dirty',
    name: 'Lo-Fi / Dirty',
    description: 'Crunchier, noisier kit with darker body and gritty tails.',
    modelVariant: 'dirty',
    instrumentDefaults: {
      kick: { volume: 0.58, tone: 0.38, extra: 0.46 },
      snare: { volume: 0.66, tone: 0.4, extra: 0.78 },
      openHH: { volume: 0.42, tone: 0.4, extra: 0.66 },
      closedHH: { volume: 0.44, tone: 0.36, extra: 0.48 },
      ride: { volume: 0.4, tone: 0.34, extra: 0.5 },
      crash: { volume: 0.42, tone: 0.35, extra: 0.7 },
      snare2: { volume: 0.5, tone: 0.35, extra: 0.6 },
      clap: { volume: 0.48, tone: 0.38, extra: 0.58 },
    },
  },
  {
    id: 'tr-808',
    name: 'Roland TR-808',
    description: 'Deep sub-bass kick, crispy hats, snappy snare with long decay.',
    modelVariant: 'analog',
    instrumentDefaults: {
      kick: { volume: 0.75, tone: 0.25, extra: 0.72 },
      snare: { volume: 0.65, tone: 0.55, extra: 0.85 },
      openHH: { volume: 0.4, tone: 0.7, extra: 0.65 },
      closedHH: { volume: 0.45, tone: 0.75, extra: 0.5 },
      ride: { volume: 0.38, tone: 0.6, extra: 0.55 },
      crash: { volume: 0.42, tone: 0.55, extra: 0.8 },
      snare2: { volume: 0.55, tone: 0.5, extra: 0.7 },
      clap: { volume: 0.52, tone: 0.48, extra: 0.6 },
    },
  },
  {
    id: 'tr-909',
    name: 'Roland TR-909',
    description: 'Punchy mid-range kick, tight snare, metallic open hat.',
    modelVariant: 'modern',
    instrumentDefaults: {
      kick: { volume: 0.72, tone: 0.58, extra: 0.65 },
      snare: { volume: 0.7, tone: 0.62, extra: 0.78 },
      openHH: { volume: 0.46, tone: 0.72, extra: 0.52 },
      closedHH: { volume: 0.52, tone: 0.68, extra: 0.62 },
      ride: { volume: 0.44, tone: 0.65, extra: 0.48 },
      crash: { volume: 0.48, tone: 0.6, extra: 0.65 },
      snare2: { volume: 0.58, tone: 0.58, extra: 0.68 },
      clap: { volume: 0.54, tone: 0.55, extra: 0.62 },
    },
  },
  {
    id: 'linndrum',
    name: 'LinnDrum',
    description: 'Classic 80s sample-based kit with snappy snare and punchy toms.',
    modelVariant: 'modern',
    instrumentDefaults: {
      kick: { volume: 0.68, tone: 0.52, extra: 0.6 },
      snare: { volume: 0.72, tone: 0.58, extra: 0.82 },
      openHH: { volume: 0.44, tone: 0.65, extra: 0.55 },
      closedHH: { volume: 0.5, tone: 0.68, extra: 0.58 },
      ride: { volume: 0.42, tone: 0.62, extra: 0.52 },
      crash: { volume: 0.46, tone: 0.58, extra: 0.68 },
      snare2: { volume: 0.6, tone: 0.55, extra: 0.72 },
      clap: { volume: 0.52, tone: 0.52, extra: 0.65 },
    },
  },
  {
    id: 'oberheim-dmx',
    name: 'Oberheim DMX',
    description: 'Dry, tight kit with punchy kick and crisp hi-hats.',
    modelVariant: 'analog',
    instrumentDefaults: {
      kick: { volume: 0.7, tone: 0.55, extra: 0.58 },
      snare: { volume: 0.68, tone: 0.52, extra: 0.75 },
      openHH: { volume: 0.43, tone: 0.68, extra: 0.48 },
      closedHH: { volume: 0.48, tone: 0.72, extra: 0.55 },
      ride: { volume: 0.4, tone: 0.65, extra: 0.45 },
      crash: { volume: 0.44, tone: 0.6, extra: 0.62 },
      snare2: { volume: 0.55, tone: 0.5, extra: 0.65 },
      clap: { volume: 0.5, tone: 0.55, extra: 0.58 },
    },
  },
  {
    id: 'tr-707',
    name: 'Roland TR-707',
    description: 'Mid-range focused kit with tight decay and punchy attack.',
    modelVariant: 'modern',
    instrumentDefaults: {
      kick: { volume: 0.68, tone: 0.5, extra: 0.62 },
      snare: { volume: 0.66, tone: 0.55, extra: 0.72 },
      openHH: { volume: 0.42, tone: 0.62, extra: 0.52 },
      closedHH: { volume: 0.48, tone: 0.65, extra: 0.58 },
      ride: { volume: 0.4, tone: 0.58, extra: 0.48 },
      crash: { volume: 0.44, tone: 0.55, extra: 0.65 },
      snare2: { volume: 0.54, tone: 0.52, extra: 0.62 },
      clap: { volume: 0.5, tone: 0.52, extra: 0.6 },
    },
  },
];
const DEFAULT_PERSISTENCE_DIR = path.resolve(process.cwd(), 'data');
const PERSISTENCE_DIR = process.env.PERSISTENCE_DIR || process.env.DATA_DIR || DEFAULT_PERSISTENCE_DIR;
const SAVED_PATTERNS_FILE = path.join(PERSISTENCE_DIR, 'saved-patterns.json');
const LEGACY_SAVED_PATTERNS_FILE = path.join(__dirname, '..', 'saved-patterns.json');
const guildStates = new Map<string, GuildRuntimeState>();
const authSessions = new Map<string, AuthSession>();
const loginTokens = new Map<string, LoginToken>();
const wsClients = new Map<WebSocket, { guildId: string; sessionToken: string; username: string }>();
const botClients = new Set<WebSocket>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function ensurePersistenceStorage() {
  try {
    fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
    if (!fs.existsSync(SAVED_PATTERNS_FILE) && fs.existsSync(LEGACY_SAVED_PATTERNS_FILE)) {
      fs.copyFileSync(LEGACY_SAVED_PATTERNS_FILE, SAVED_PATTERNS_FILE);
    }
  } catch (error) {
    console.error('Failed to prepare persistence storage:', error);
  }
}

ensurePersistenceStorage();

function createDefaultDrumState(): DrumState {
  const state = {} as DrumState;
  const defaults = getDrumKitDefaults(DEFAULT_DRUM_KIT_ID);
  for (const inst of DRUM_INSTRUMENTS) {
    state[inst] = {
      steps: new Array(16).fill(false),
      settings: {
        volume: defaults[inst].volume,
        tone: defaults[inst].tone,
        extra: defaults[inst].extra,
        tune: defaults[inst].tune ?? 0,
        humanize: defaults[inst].humanize ?? 0.35,
      },
      muted: false,
      solo: false,
    };
  }
  return state;
}

function getDrumKit(kitId: DrumKitId): DrumKitDefinition | undefined {
  return DRUM_KITS.find((kit) => kit.id === kitId);
}

function normalizeDrumKitId(kitId: unknown): DrumKitId {
  if (typeof kitId !== 'string') return DEFAULT_DRUM_KIT_ID;
  const found = DRUM_KITS.find((kit) => kit.id === kitId);
  return found?.id ?? DEFAULT_DRUM_KIT_ID;
}

function getDrumKitDefaults(kitId: DrumKitId): DrumInstrumentDefaults {
  return (getDrumKit(normalizeDrumKitId(kitId)) || DRUM_KITS[0]).instrumentDefaults;
}

function getDrumKitModelVariant(kitId: DrumKitId): DrumKitModelVariant {
  return (getDrumKit(normalizeDrumKitId(kitId)) || DRUM_KITS[0]).modelVariant;
}

function applyKitDefaultsToDrumState(state: DrumState, kitId: DrumKitId): DrumState {
  const defaults = getDrumKitDefaults(kitId);
  const next = normalizeDrumState(state);
  for (const inst of DRUM_INSTRUMENTS) {
    next[inst] = {
      ...next[inst],
      settings: {
        volume: defaults[inst].volume,
        tone: defaults[inst].tone,
        extra: defaults[inst].extra,
        tune: defaults[inst].tune ?? next[inst].settings.tune ?? 0,
        humanize: defaults[inst].humanize ?? next[inst].settings.humanize ?? 0.35,
      },
    };
  }
  return next;
}

function createDefaultFxSends(): FxSendLevels {
  return { reverb: 0.35, delay: 0.15, drive: 0.2, phaser: 0.1 };
}

function createDefaultDrumFx() {
  return {
    sends: createDefaultFxSends(),
    returnLevel: 0.7,
  };
}

function createDefaultEffectsLoop(): EffectsLoopState {
  return {
    enabled: true,
    returns: { synth: 0.85, drums: 0.7 },
    drive: { enabled: true, amount: 0.18, tone: 0.65 },
    phaser: { enabled: false, rate: 0.45, depth: 0.45, feedback: 0.25, mix: 0.25 },
    delay: { enabled: true, time: 0.22, feedback: 0.35, mix: 0.3 },
    reverb: { enabled: true, decay: 2.1, mix: 0.38 },
  };
}

function normalizeFxSends(sends: Partial<FxSendLevels> | undefined, fallback?: FxSendLevels): FxSendLevels {
  const base = fallback ?? createDefaultFxSends();
  return {
    reverb: clamp(sends?.reverb ?? base.reverb, 0, 1),
    delay: clamp(sends?.delay ?? base.delay, 0, 1),
    drive: clamp(sends?.drive ?? base.drive, 0, 1),
    phaser: clamp(sends?.phaser ?? base.phaser, 0, 1),
  };
}

function normalizeDrumFx(drumFx: { sends?: Partial<FxSendLevels>; returnLevel?: number } | undefined) {
  const defaults = createDefaultDrumFx();
  return {
    sends: normalizeFxSends(drumFx?.sends, defaults.sends),
    returnLevel: clamp(drumFx?.returnLevel ?? defaults.returnLevel, 0, 1),
  };
}

function normalizeEffectsLoop(effectsLoop: Partial<EffectsLoopState> | undefined): EffectsLoopState {
  const defaults = createDefaultEffectsLoop();
  return {
    enabled: effectsLoop?.enabled ?? defaults.enabled,
    returns: {
      synth: clamp(effectsLoop?.returns?.synth ?? defaults.returns.synth, 0, 1),
      drums: clamp(effectsLoop?.returns?.drums ?? defaults.returns.drums, 0, 1),
    },
    drive: {
      enabled: effectsLoop?.drive?.enabled ?? defaults.drive.enabled,
      amount: clamp(effectsLoop?.drive?.amount ?? defaults.drive.amount, 0, 1),
      tone: clamp(effectsLoop?.drive?.tone ?? defaults.drive.tone, 0, 1),
    },
    phaser: {
      enabled: effectsLoop?.phaser?.enabled ?? defaults.phaser.enabled,
      rate: clamp(effectsLoop?.phaser?.rate ?? defaults.phaser.rate, 0.05, 8),
      depth: clamp(effectsLoop?.phaser?.depth ?? defaults.phaser.depth, 0, 1),
      feedback: clamp(effectsLoop?.phaser?.feedback ?? defaults.phaser.feedback, 0, 0.95),
      mix: clamp(effectsLoop?.phaser?.mix ?? defaults.phaser.mix, 0, 1),
    },
    delay: {
      enabled: effectsLoop?.delay?.enabled ?? defaults.delay.enabled,
      time: clamp(effectsLoop?.delay?.time ?? defaults.delay.time, 0.01, 1.5),
      feedback: clamp(effectsLoop?.delay?.feedback ?? defaults.delay.feedback, 0, 0.95),
      mix: clamp(effectsLoop?.delay?.mix ?? defaults.delay.mix, 0, 1),
    },
    reverb: {
      enabled: effectsLoop?.reverb?.enabled ?? defaults.reverb.enabled,
      decay: clamp(effectsLoop?.reverb?.decay ?? defaults.reverb.decay, 0.2, 8),
      mix: clamp(effectsLoop?.reverb?.mix ?? defaults.reverb.mix, 0, 1),
    },
  };
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
        tune: clamp(src.settings?.tune ?? base[inst].settings.tune ?? 0, -1, 1),
        humanize: clamp(src.settings?.humanize ?? base[inst].settings.humanize ?? 0.35, 0, 1),
        cymbalType: (src.settings?.cymbalType === 'ride' || src.settings?.cymbalType === 'crash') ? src.settings.cymbalType : undefined,
      },
      muted: Boolean(src.muted),
      solo: Boolean(src.solo),
    };
    while (base[inst].steps.length < 16) base[inst].steps.push(false);
  }
  return base;
}

function createDefaultSynthModelParams(): SynthModelParams {
  return { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
}

function normalizeSynthModelId(modelId: unknown): SynthModelId {
  if (typeof modelId !== 'string') return DEFAULT_SYNTH_MODEL_ID;
  return SYNTH_MODEL_IDS.includes(modelId as SynthModelId) ? modelId as SynthModelId : DEFAULT_SYNTH_MODEL_ID;
}

function normalizeSynthModelParams(modelParams: unknown): SynthModelParams {
  const defaults = createDefaultSynthModelParams();
  if (!modelParams || typeof modelParams !== 'object') return defaults;
  const params = modelParams as Partial<SynthModelParams>;
  return {
    macro1: clamp(params.macro1 ?? defaults.macro1, 0, 1),
    macro2: clamp(params.macro2 ?? defaults.macro2, 0, 1),
    macro3: clamp(params.macro3 ?? defaults.macro3, 0, 1),
    macro4: clamp(params.macro4 ?? defaults.macro4, 0, 1),
  };
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
    selectedDrumKitId: DEFAULT_DRUM_KIT_ID,
    drumMasterVolume: 1,
    drumFx: createDefaultDrumFx(),
    effectsLoop: createDefaultEffectsLoop(),
    globalTempo: 120,
  };
}

function getGuildState(guildId: string): GuildRuntimeState {
  let state = guildStates.get(guildId);
  if (!state) {
    state = createGuildRuntimeState(guildId);
    guildStates.set(guildId, state);
  }
  state.selectedDrumKitId = normalizeDrumKitId(state.selectedDrumKitId);
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

function sanitizePatternName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (normalized.length < 1 || normalized.length > 80) return null;
  return normalized;
}

function sanitizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function sanitizeSampleUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
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
  const providedBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
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
  if (AUTH_MODE === 'compatibility' && shouldUseCompatibilityFallback(req.headers.authorization)) {
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
  synth.updateParameters({ fxSends: createDefaultFxSends() });
  const sequencer = new Sequencer(synth);
  sequencer.setTempo(state.globalTempo);
  const pattern = sequencer.createEmptyPattern(`Synth ${synthId}`);
  pattern.tempo = state.globalTempo;
  const patterns: Pattern[] = [pattern];

  sequencer.onStep((step: number) => {
    broadcastToClients({ type: 'sequencerStep', data: { guildId: state.guildId, synthId, step } }, state.guildId);
  });

  state.synths.set(synthId, {
    synth,
    sequencer,
    pattern,
    patterns,
    modelId: DEFAULT_SYNTH_MODEL_ID,
    modelParams: createDefaultSynthModelParams(),
  });
  state.synthMixState.set(synthId, { muted: false, solo: false });
}

function initAudioEngine(state: GuildRuntimeState) {
  if (!state.synths.has(1)) {
    initSynth(state, 1);
  }
  if (!state.samplePlayer) {
    state.samplePlayer = new SamplePlayer();
  }
  if (!state.discordStreamer) {
    state.discordStreamer = new DiscordAudioStreamer();
  }
}

const isWebSocketOpen = (client: WebSocket): boolean => client.readyState === WebSocket.OPEN;

function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, '..', 'debug.log'), line + '\n'); } catch {}
}

function applyDrive(samples: Float32Array, amount: number, tone: number): Float32Array {
  const out = new Float32Array(samples.length);
  const preGain = 1 + amount * 18;
  const postGain = 1 / (1 + amount * 3.2);
  let toneState = 0;
  const toneAlpha = 0.015 + tone * 0.12;
  for (let i = 0; i < samples.length; i++) {
    const driven = Math.tanh(samples[i] * preGain) * postGain;
    toneState += toneAlpha * (driven - toneState);
    out[i] = driven * (0.35 + tone * 0.65) + toneState * (1 - tone * 0.45);
  }
  return out;
}

function applyDelay(samples: Float32Array, sampleRate: number, time: number, feedback: number, mix: number): Float32Array {
  const out = new Float32Array(samples.length);
  const delaySamples = Math.max(1, Math.floor(time * sampleRate));
  const delayBuffer = new Float32Array(delaySamples);
  let write = 0;
  const dry = 1 - mix;
  for (let i = 0; i < samples.length; i++) {
    const delayed = delayBuffer[write];
    delayBuffer[write] = samples[i] + delayed * feedback;
    write = (write + 1) % delaySamples;
    out[i] = samples[i] * dry + delayed * mix;
  }
  return out;
}

function applyReverb(samples: Float32Array, sampleRate: number, decay: number, mix: number): Float32Array {
  const out = new Float32Array(samples.length);
  const dry = 1 - mix;
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((sec) => Math.max(1, Math.floor(sec * sampleRate)));
  const combBuffers = combDelays.map((len) => new Float32Array(len));
  const combIndices = new Array(combDelays.length).fill(0);
  const feedback = clamp(0.55 + decay * 0.04, 0.5, 0.94);

  for (let i = 0; i < samples.length; i++) {
    let accum = 0;
    for (let c = 0; c < combBuffers.length; c++) {
      const buffer = combBuffers[c];
      const idx = combIndices[c];
      const delayed = buffer[idx];
      buffer[idx] = samples[i] + delayed * feedback;
      combIndices[c] = (idx + 1) % buffer.length;
      accum += delayed;
    }
    out[i] = samples[i] * dry + (accum / combBuffers.length) * mix;
  }
  return out;
}

function applyPhaser(samples: Float32Array, sampleRate: number, rate: number, depth: number, feedback: number, mix: number): Float32Array {
  const out = new Float32Array(samples.length);
  const dry = 1 - mix;
  let phase = 0;
  let fb = 0;
  const minDelay = 18;
  const maxDelay = Math.max(minDelay + 1, Math.floor(minDelay + depth * 320));
  const delayBuffer = new Float32Array(maxDelay + 2);
  let write = 0;
  for (let i = 0; i < samples.length; i++) {
    phase += rate / sampleRate;
    if (phase >= 1) phase -= 1;
    const lfo = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
    const delay = minDelay + lfo * (maxDelay - minDelay);
    const read = (write - delay + delayBuffer.length) % delayBuffer.length;
    const idx0 = Math.floor(read);
    const idx1 = (idx0 + 1) % delayBuffer.length;
    const frac = read - idx0;
    const delayed = delayBuffer[idx0] * (1 - frac) + delayBuffer[idx1] * frac;
    const input = samples[i] + fb * feedback;
    delayBuffer[write] = input;
    write = (write + 1) % delayBuffer.length;
    fb = delayed;
    out[i] = samples[i] * dry + delayed * mix;
  }
  return out;
}

function processEffectsLoopBus(input: Float32Array, sampleRate: number, loop: EffectsLoopState): Float32Array {
  if (!loop.enabled) return new Float32Array(input.length);
  let bus = input;
  if (loop.drive.enabled && loop.drive.amount > 0) {
    bus = applyDrive(bus, loop.drive.amount, loop.drive.tone);
  }
  if (loop.phaser.enabled && loop.phaser.mix > 0) {
    bus = applyPhaser(bus, sampleRate, loop.phaser.rate, loop.phaser.depth, loop.phaser.feedback, loop.phaser.mix);
  }
  if (loop.delay.enabled && loop.delay.mix > 0) {
    bus = applyDelay(bus, sampleRate, loop.delay.time, loop.delay.feedback, loop.delay.mix);
  }
  if (loop.reverb.enabled && loop.reverb.mix > 0) {
    bus = applyReverb(bus, sampleRate, loop.reverb.decay, loop.reverb.mix);
  }
  return bus;
}

function applyTransientShaper(samples: Float32Array, attack: number, sustain: number): Float32Array {
  const out = new Float32Array(samples.length);
  let env = 0;
  const envAttack = 0.16;
  const envRelease = 0.0008;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    env += (abs - env) * (abs > env ? envAttack : envRelease);
    const transient = samples[i] - Math.sign(samples[i]) * env;
    out[i] = samples[i] + transient * attack + Math.sign(samples[i]) * env * sustain;
  }
  return out;
}

function applyBusCompressor(samples: Float32Array, threshold: number, ratio: number, makeup: number): Float32Array {
  const out = new Float32Array(samples.length);
  let gain = 1;
  const attack = 0.08;
  const release = 0.002;
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i];
    const level = Math.abs(input);
    let targetGain = 1;
    if (level > threshold) {
      const compressed = threshold + (level - threshold) / ratio;
      targetGain = compressed / (level + 1e-6);
    }
    gain += (targetGain - gain) * (targetGain < gain ? attack : release);
    out[i] = input * gain * makeup;
  }
  return out;
}

function processDrumBus(input: Float32Array, modelVariant: DrumKitModelVariant): Float32Array {
  const profile = modelVariant === 'modern'
    ? { satMix: 0.34, satAmount: 0.26, satTone: 0.62, attack: 0.35, sustain: -0.08, threshold: 0.4, ratio: 2.8, makeup: 1.14 }
    : modelVariant === 'dirty'
      ? { satMix: 0.46, satAmount: 0.4, satTone: 0.42, attack: 0.24, sustain: -0.16, threshold: 0.36, ratio: 2.2, makeup: 1.08 }
      : { satMix: 0.28, satAmount: 0.2, satTone: 0.55, attack: 0.2, sustain: -0.05, threshold: 0.42, ratio: 2.3, makeup: 1.1 };
  const saturated = applyDrive(input, profile.satAmount, profile.satTone);
  const parallel = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    parallel[i] = input[i] * (1 - profile.satMix) + saturated[i] * profile.satMix;
  }
  const shaped = applyTransientShaper(parallel, profile.attack, profile.sustain);
  return applyBusCompressor(shaped, profile.threshold, profile.ratio, profile.makeup);
}

function renderPatternAudio(state: GuildRuntimeState): string | null {
  try {
    const playingSynths = Array.from(state.synths.entries()).filter(([, data]) => data.sequencer.getIsPlaying());
    if (playingSynths.length === 0) return null;

    const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
    const tempo = clamp(state.globalTempo || 120, 20, 400);
    const barDuration = (60 / tempo) * 4;
    const totalSamples = Math.floor(barDuration * sampleRate);
    const dryPCML = new Float32Array(totalSamples);
    const dryPCMR = new Float32Array(totalSamples);
    const synthSendPCM: Record<keyof FxSendLevels, Float32Array> = {
      reverb: new Float32Array(totalSamples),
      delay: new Float32Array(totalSamples),
      drive: new Float32Array(totalSamples),
      phaser: new Float32Array(totalSamples),
    };
    const drumSendPCM: Record<keyof FxSendLevels, Float32Array> = {
      reverb: new Float32Array(totalSamples),
      delay: new Float32Array(totalSamples),
      drive: new Float32Array(totalSamples),
      phaser: new Float32Array(totalSamples),
    };

    const hasSynthSolo = playingSynths.some(([id]) => Boolean(state.synthMixState.get(id)?.solo));

    for (const [id, synthData] of playingSynths) {
      const mix = state.synthMixState.get(id) || { muted: false, solo: false };
      if (mix.muted) continue;
      if (hasSynthSolo && !mix.solo) continue;
      const synthParams = synthData.synth.getParameters();
      const pan = clamp(synthParams.pan ?? 0, -1, 1);
      const panAngle = (pan + 1) * Math.PI / 4;
      const panL = Math.cos(panAngle);
      const panR = Math.sin(panAngle);
      const sends = normalizeFxSends(synthParams.fxSends);
      const returnLevel = clamp(synthParams.fxReturn ?? 0.85, 0, 1);
      const stepCount = Math.max(1, synthData.pattern.steps.length);
      const stepDuration = barDuration / stepCount;
      for (let i = 0; i < synthData.pattern.steps.length; i++) {
        const step = synthData.pattern.steps[i];
        if (step.active && step.note) {
          const noteDur = Math.max(stepDuration - 0.01, 0.05);
          const notePCM = synthData.synth.renderNote(step.note, noteDur, step.velocity, sampleRate, { applyInsertEffects: false });
          const offset = Math.floor(i * stepDuration * sampleRate);
          for (let j = 0; j < notePCM.length && offset + j < totalSamples; j++) {
            const idx = offset + j;
            const sample = notePCM[j];
            dryPCML[idx] += sample * panL;
            dryPCMR[idx] += sample * panR;
            synthSendPCM.reverb[idx] += sample * sends.reverb * returnLevel;
            synthSendPCM.delay[idx] += sample * sends.delay * returnLevel;
            synthSendPCM.drive[idx] += sample * sends.drive * returnLevel;
            synthSendPCM.phaser[idx] += sample * sends.phaser * returnLevel;
          }
        }
      }
    }

    const kitVariant = getDrumKitModelVariant(state.selectedDrumKitId);
    const drumPCM = DrumSynthesizer.renderPattern(state.drumState, tempo, sampleRate, {
      modelVariant: kitVariant,
      humanizeAmount: kitVariant === 'modern' ? 0.35 : kitVariant === 'dirty' ? 0.8 : 0.55,
    });
    const drumBusDry = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      drumBusDry[i] = drumPCM[i % drumPCM.length] * AUDIO_MIXING.DRUM_BOOST_FACTOR * state.drumMasterVolume;
    }
    const processedDrumDry = processDrumBus(drumBusDry, kitVariant);
    const drumFx = normalizeDrumFx(state.drumFx);
    for (let i = 0; i < totalSamples; i++) {
      const sample = processedDrumDry[i];
      dryPCML[i] += sample;
      dryPCMR[i] += sample;
      drumSendPCM.reverb[i] += sample * drumFx.sends.reverb;
      drumSendPCM.delay[i] += sample * drumFx.sends.delay;
      drumSendPCM.drive[i] += sample * drumFx.sends.drive;
      drumSendPCM.phaser[i] += sample * drumFx.sends.phaser;
    }

    const effectsLoop = normalizeEffectsLoop(state.effectsLoop);
    const synthWetIn = new Float32Array(totalSamples);
    const drumWetIn = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      synthWetIn[i] = synthSendPCM.reverb[i] + synthSendPCM.delay[i] + synthSendPCM.drive[i] + synthSendPCM.phaser[i];
      drumWetIn[i] = drumSendPCM.reverb[i] + drumSendPCM.delay[i] + drumSendPCM.drive[i] + drumSendPCM.phaser[i];
    }
    const synthWetOut = processEffectsLoopBus(synthWetIn, sampleRate, effectsLoop);
    const drumWetOut = processEffectsLoopBus(drumWetIn, sampleRate, effectsLoop);

    const fullPCML = new Float32Array(totalSamples);
    const fullPCMR = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const wetSynth = synthWetOut[i] * effectsLoop.returns.synth;
      const wetDrum = drumWetOut[i] * effectsLoop.returns.drums * drumFx.returnLevel;
      fullPCML[i] = dryPCML[i] + wetSynth + wetDrum;
      fullPCMR[i] = dryPCMR[i] + wetSynth + wetDrum;
    }

    const threshold = AUDIO_MIXING.SOFT_CLIP_THRESHOLD;
    const factor = AUDIO_MIXING.SOFT_CLIP_FACTOR;
    for (let i = 0; i < totalSamples; i++) {
      if (fullPCML[i] > threshold) fullPCML[i] = threshold + (fullPCML[i] - threshold) * factor;
      if (fullPCML[i] < -threshold) fullPCML[i] = -threshold + (fullPCML[i] + threshold) * factor;
      if (fullPCMR[i] > threshold) fullPCMR[i] = threshold + (fullPCMR[i] - threshold) * factor;
      if (fullPCMR[i] < -threshold) fullPCMR[i] = -threshold + (fullPCMR[i] + threshold) * factor;
    }
    let peak = 0;
    for (let i = 0; i < totalSamples; i++) {
      const absL = Math.abs(fullPCML[i]);
      const absR = Math.abs(fullPCMR[i]);
      if (absL > peak) peak = absL;
      if (absR > peak) peak = absR;
    }
    if (peak > 1) {
      const scale = 1 / peak;
      for (let i = 0; i < totalSamples; i++) {
        fullPCML[i] *= scale;
        fullPCMR[i] *= scale;
      }
    }

    const stereoLen = totalSamples * 2;
    const int16 = new Int16Array(stereoLen);
    for (let i = 0; i < totalSamples; i++) {
      const valL = clamp(Math.round(fullPCML[i] * AUDIO_MIXING.MAX_PCM_VALUE), -32768, 32767);
      const valR = clamp(Math.round(fullPCMR[i] * AUDIO_MIXING.MAX_PCM_VALUE), -32768, 32767);
      int16[i * 2] = valL;
      int16[i * 2 + 1] = valR;
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

function getConnectedUsernames(guildId: string): string[] {
  const names = new Set<string>();
  wsClients.forEach((meta) => {
    if (meta.guildId === guildId) names.add(meta.username);
  });
  return Array.from(names).sort();
}

function broadcastConnectedUsers(guildId: string) {
  broadcastToClients({ type: 'connectedUsers', data: { users: getConnectedUsernames(guildId) } }, guildId);
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

interface GuildStreamingState {
  streamingSynths: Map<number, StreamingSynth>;
  currentStep: number;
  stepIntervalMs: number;
  timerId: ReturnType<typeof setTimeout> | null;
  drumLoopPCM: Float32Array;
  drumLoopReadOffset: number;
  isStreaming: boolean;
  lastRenderTimeMs: number;
  samplesSinceLastChunk: number;
}

const guildStreamingStates = new Map<string, GuildStreamingState>();

function createStreamingManager(guildId: string, state: GuildRuntimeState): GuildStreamingState {
  const tempo = clamp(state.globalTempo || 120, 20, 400);
  const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
  const barDuration = (60 / tempo) * 4;
  const totalSamples = Math.floor(barDuration * sampleRate);

  const streamingSynths = new Map<number, StreamingSynth>();
  for (const [id, synthData] of state.synths.entries()) {
    const mix = state.synthMixState.get(id);
    if (mix?.muted) continue;
    const hasSolo = Array.from(state.synthMixState.entries()).some(([, m]) => m.solo);
    if (hasSolo && !mix?.solo) continue;

    const synth = new StreamingSynth(sampleRate, 8);
    synth.updateParameters(synthData.synth.getParameters());
    streamingSynths.set(id, synth);
  }

  const drumPCM = DrumSynthesizer.renderPattern(state.drumState, tempo, sampleRate, {
    modelVariant: getDrumKitModelVariant(state.selectedDrumKitId),
    humanizeAmount: getDrumKitModelVariant(state.selectedDrumKitId) === 'modern' ? 0.35
      : getDrumKitModelVariant(state.selectedDrumKitId) === 'dirty' ? 0.8 : 0.55,
  });
  const drumLoop = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    drumLoop[i] = drumPCM[i % drumPCM.length] * AUDIO_MIXING.DRUM_BOOST_FACTOR * state.drumMasterVolume;
  }
  const drumFx = normalizeDrumFx(state.drumFx);
  const processedDrumLoop = processDrumBus(drumLoop, getDrumKitModelVariant(state.selectedDrumKitId));
  for (let i = 0; i < totalSamples; i++) {
    drumLoop[i] = processedDrumLoop[i];
  }

  const patternLengths = Array.from(state.synths.entries())
    .filter(([id]) => {
      const mix = state.synthMixState.get(id);
      if (mix?.muted) return false;
      const hasSolo = Array.from(state.synthMixState.entries()).some(([, m]) => m.solo);
      if (hasSolo && !mix?.solo) return false;
      return true;
    })
    .map(([, sd]) => sd.pattern?.steps?.length || 16);
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const baseStepCount = patternLengths.length > 0
    ? patternLengths.reduce((a, b) => gcd(a, b))
    : 16;
  const stepCount = Math.max(16, baseStepCount);
  const stepIntervalMs = (barDuration * 1000) / stepCount;

  return {
    streamingSynths,
    currentStep: 0,
    stepIntervalMs,
    timerId: null,
    drumLoopPCM: drumLoop,
    drumLoopReadOffset: 0,
    isStreaming: false,
    lastRenderTimeMs: 0,
    samplesSinceLastChunk: 0,
  };
}

function sendStreamingChunk(guildId: string, state: GuildRuntimeState, streamingState: GuildStreamingState) {
  if (!streamingState.isStreaming) return;
  if (streamingState.streamingSynths.size === 0) {
    stopStreaming(guildId);
    return;
  }

  const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
  const chunkSamples = Math.floor(0.02 * sampleRate);
  const tempo = clamp(state.globalTempo || 120, 20, 400);
  const barDuration = (60 / tempo) * 4;
  const totalBarSamples = Math.floor(barDuration * sampleRate);

  for (const [id, synth] of streamingState.streamingSynths.entries()) {
    const synthData = state.synths.get(id);
    if (!synthData) continue;

    const totalSteps = synthData.pattern?.steps?.length || 16;
    const stepDurationSamples = Math.floor((barDuration / totalSteps) * sampleRate);
    const samplesPerStep = totalBarSamples / totalSteps;

    const stepAtStart = Math.floor(streamingState.drumLoopReadOffset / samplesPerStep) % totalSteps;
    const stepAtEnd = Math.floor((streamingState.drumLoopReadOffset + chunkSamples) / samplesPerStep) % totalSteps;

    for (let step = 0; step < totalSteps; step++) {
      const stepStart = step * samplesPerStep;
      const stepEnd = (step + 1) * samplesPerStep;
      const chunkStart = streamingState.drumLoopReadOffset;
      const chunkEnd = chunkStart + chunkSamples;
      if (stepStart < chunkEnd && stepEnd > chunkStart) {
        const activeStep = synthData.pattern.steps[step];
        if (activeStep?.active && activeStep.note) {
          const noteDurSamples = Math.floor(stepDurationSamples * 0.9);
          synth.noteOn(activeStep.note, activeStep.velocity);
          synth.scheduleNoteOff(activeStep.note, noteDurSamples);
        }
      }
    }
  }

  const synthChunk = { left: new Float32Array(chunkSamples), right: new Float32Array(chunkSamples) };
  for (const synth of streamingState.streamingSynths.values()) {
    const rendered = synth.renderChunk(chunkSamples);
    for (let i = 0; i < chunkSamples; i++) {
      synthChunk.left[i] += rendered.left[i];
      synthChunk.right[i] += rendered.right[i];
    }
  }

  const drumLeft = new Float32Array(chunkSamples);
  const drumRight = new Float32Array(chunkSamples);
  const effectsLoop = normalizeEffectsLoop(state.effectsLoop);
  const drumFx = normalizeDrumFx(state.drumFx);
  for (let i = 0; i < chunkSamples; i++) {
    const drumIdx = (streamingState.drumLoopReadOffset + i) % totalBarSamples;
    const drumSample = streamingState.drumLoopPCM[drumIdx];
    drumLeft[i] = drumSample;
    drumRight[i] = drumSample;
  }

  const fullLeft = new Float32Array(chunkSamples);
  const fullRight = new Float32Array(chunkSamples);
  for (let i = 0; i < chunkSamples; i++) {
    fullLeft[i] = synthChunk.left[i] + drumLeft[i] * effectsLoop.returns.drums * drumFx.returnLevel;
    fullRight[i] = synthChunk.right[i] + drumRight[i] * effectsLoop.returns.drums * drumFx.returnLevel;
  }

  const threshold = AUDIO_MIXING.SOFT_CLIP_THRESHOLD;
  const factor = AUDIO_MIXING.SOFT_CLIP_FACTOR;
  for (let i = 0; i < chunkSamples; i++) {
    if (fullLeft[i] > threshold) fullLeft[i] = threshold + (fullLeft[i] - threshold) * factor;
    if (fullLeft[i] < -threshold) fullLeft[i] = -threshold + (fullLeft[i] + threshold) * factor;
    if (fullRight[i] > threshold) fullRight[i] = threshold + (fullRight[i] - threshold) * factor;
    if (fullRight[i] < -threshold) fullRight[i] = -threshold + (fullRight[i] + threshold) * factor;
  }

  let peak = 0;
  for (let i = 0; i < chunkSamples; i++) {
    const absL = Math.abs(fullLeft[i]);
    const absR = Math.abs(fullRight[i]);
    if (absL > peak) peak = absL;
    if (absR > peak) peak = absR;
  }
  if (peak > 1) {
    const scale = 1 / peak;
    for (let i = 0; i < chunkSamples; i++) {
      fullLeft[i] *= scale;
      fullRight[i] *= scale;
    }
  }

  const int16 = new Int16Array(chunkSamples * 2);
  for (let i = 0; i < chunkSamples; i++) {
    const valL = clamp(Math.round(fullLeft[i] * AUDIO_MIXING.MAX_PCM_VALUE), -32768, 32767);
    const valR = clamp(Math.round(fullRight[i] * AUDIO_MIXING.MAX_PCM_VALUE), -32768, 32767);
    int16[i * 2] = valL;
    int16[i * 2 + 1] = valR;
  }

  const audioBase64 = Buffer.from(int16.buffer).toString('base64');
  const event = { type: 'streamingAudioChunk', data: { guildId, audio: audioBase64, sampleRate, tempo } };
  broadcastToClients(event, guildId);
  broadcastToBotClients(event);

  streamingState.drumLoopReadOffset = (streamingState.drumLoopReadOffset + chunkSamples) % totalBarSamples;
}

function streamingLoop(guildId: string) {
  const streamingState = guildStreamingStates.get(guildId);
  if (!streamingState || !streamingState.isStreaming) return;
  const state = getGuildState(guildId);
  const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
  const chunkSamples = Math.floor(0.02 * sampleRate);

  const now = performance.now();
  if (streamingState.lastRenderTimeMs === 0) {
    streamingState.lastRenderTimeMs = now;
    sendStreamingChunk(guildId, state, streamingState);
    streamingState.samplesSinceLastChunk = chunkSamples;
    streamingState.lastRenderTimeMs = now;
    streamingState.timerId = setTimeout(() => streamingLoop(guildId), 16);
    return;
  }

  const elapsedMs = now - streamingState.lastRenderTimeMs;
  const samplesExpected = Math.floor((elapsedMs / 1000) * sampleRate);
  streamingState.samplesSinceLastChunk += samplesExpected;
  streamingState.lastRenderTimeMs = now;

  let chunksSent = 0;
  while (streamingState.samplesSinceLastChunk >= chunkSamples && chunksSent < 4) {
    sendStreamingChunk(guildId, state, streamingState);
    streamingState.samplesSinceLastChunk -= chunkSamples;
    chunksSent++;
  }
  if (chunksSent === 0) {
    streamingState.samplesSinceLastChunk -= chunkSamples;
  }

  streamingState.timerId = setTimeout(() => streamingLoop(guildId), 16);
}

function startStreaming(guildId: string) {
  const existingState = guildStreamingStates.get(guildId);
  if (existingState?.isStreaming) return;

  const state = getGuildState(guildId);
  const playingSynths = Array.from(state.synths.entries()).filter(([, data]) => data.sequencer.getIsPlaying());
  if (playingSynths.length === 0) return;

  let streamingState = guildStreamingStates.get(guildId);
  if (!streamingState) {
    streamingState = createStreamingManager(guildId, state);
    guildStreamingStates.set(guildId, streamingState);
  }

  streamingState.isStreaming = true;
  streamingState.drumLoopReadOffset = 0;
  streamingLoop(guildId);
}

function stopStreaming(guildId: string) {
  const streamingState = guildStreamingStates.get(guildId);
  if (!streamingState) return;
  streamingState.isStreaming = false;
  if (streamingState.timerId) {
    clearTimeout(streamingState.timerId);
    streamingState.timerId = null;
  }
  for (const synth of streamingState.streamingSynths.values()) {
    synth.allNotesOff();
  }
  guildStreamingStates.delete(guildId);
  streamingEffectsLoopUpdateThrottles.delete(guildId);
}

function updateStreamingSynthParams(guildId: string, synthId: number, params: Partial<SynthParameters>) {
  const streamingState = guildStreamingStates.get(guildId);
  if (!streamingState) return;
  const synth = streamingState.streamingSynths.get(synthId);
  if (synth) synth.updateParameters(params);
}

const streamingEffectsLoopUpdateThrottles = new Map<string, () => void>();

function updateStreamingEffectsLoopNow(guildId: string) {
  const streamingState = guildStreamingStates.get(guildId);
  if (!streamingState || !streamingState.isStreaming) return;
  const state = getGuildState(guildId);
  const tempo = clamp(state.globalTempo || 120, 20, 400);
  const sampleRate = AUDIO_CONTEXT.RENDER_SAMPLE_RATE;
  const barDuration = (60 / tempo) * 4;
  const totalBarSamples = Math.floor(barDuration * sampleRate);
  const drumPCM = DrumSynthesizer.renderPattern(state.drumState, tempo, sampleRate, {
    modelVariant: getDrumKitModelVariant(state.selectedDrumKitId),
    humanizeAmount: getDrumKitModelVariant(state.selectedDrumKitId) === 'modern' ? 0.35
      : getDrumKitModelVariant(state.selectedDrumKitId) === 'dirty' ? 0.8 : 0.55,
  });
  const drumLoop = new Float32Array(totalBarSamples);
  for (let i = 0; i < totalBarSamples; i++) {
    drumLoop[i] = drumPCM[i % drumPCM.length] * AUDIO_MIXING.DRUM_BOOST_FACTOR * state.drumMasterVolume;
  }
  const processedDrumLoop = processDrumBus(drumLoop, getDrumKitModelVariant(state.selectedDrumKitId));
  streamingState.drumLoopPCM = processedDrumLoop;

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const patternLengths = Array.from(state.synths.entries())
    .filter(([id]) => {
      const mix = state.synthMixState.get(id);
      if (mix?.muted) return false;
      const hasSolo = Array.from(state.synthMixState.entries()).some(([, m]) => m.solo);
      if (hasSolo && !mix?.solo) return false;
      return true;
    })
    .map(([, sd]) => sd.pattern?.steps?.length || 16);
  const baseStepCount = patternLengths.length > 0
    ? patternLengths.reduce((a, b) => gcd(a, b))
    : 16;
  streamingState.stepIntervalMs = (barDuration * 1000) / Math.max(16, baseStepCount);
}

function updateStreamingEffectsLoop(guildId: string) {
  let throttled = streamingEffectsLoopUpdateThrottles.get(guildId);
  if (!throttled) {
    throttled = throttle(() => updateStreamingEffectsLoopNow(guildId), 120);
    streamingEffectsLoopUpdateThrottles.set(guildId, throttled);
  }
  if (typeof throttled === 'function') throttled();
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

app.post('/auth/compatibility', applyRateLimit(10, 60_000), (req, res) => {
  if (AUTH_MODE !== 'compatibility') {
    return res.status(404).json({ error: 'Not available' });
  }
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const session: AuthSession = {
    token: sessionToken,
    guildId: 'legacy',
    userId: 'legacy-user',
    username: 'Local User',
    role: 'owner',
    csrfToken,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  authSessions.set(sessionToken, session);
  res.json({ sessionToken, csrfToken, expiresAt: session.expiresAt, role: 'owner', username: 'Local User' });
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
  const referencePlaying = Array.from(state.synths.entries()).find(
    ([id, data]) => id !== synthId && data.sequencer.getIsPlaying()
  );
  const shouldAutoPlay = Boolean(referencePlaying);

  if (referencePlaying) {
    const [, refSynth] = referencePlaying;
    const startStep = refSynth.sequencer.getCurrentStep();
    const startAt = refSynth.sequencer.getNextStepTime() ?? undefined;
    synthData.sequencer.loadPattern(synthData.pattern);
    synthData.sequencer.play(startStep, startAt);
  }

  broadcastToClients({
    type: 'synthCreated',
    data: {
      guildId: session.guildId,
      synthId,
      pattern: synthData.pattern,
      synthParams: synthData.synth.getParameters(),
      synthModelId: synthData.modelId,
      synthModelParams: synthData.modelParams,
      muted: false,
      solo: false,
      isPlaying: shouldAutoPlay,
    },
  }, session.guildId);

  if (shouldAutoPlay) {
    broadcastToClients({ type: 'sequencerPlay', data: { guildId: session.guildId, synthId, patternId: synthData.pattern.id } }, session.guildId);
    broadcastToBotClients({ type: 'sequencerPlay', data: { guildId: session.guildId, synthId, patternId: synthData.pattern.id } });
    startStreaming(session.guildId);
  }

  res.json({
    synthId,
    pattern: synthData.pattern,
    patterns: synthData.patterns,
    synthParams: synthData.synth.getParameters(),
    synthModelId: synthData.modelId,
    synthModelParams: synthData.modelParams,
    muted: false,
    solo: false,
    isPlaying: shouldAutoPlay,
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
    stopStreaming(session.guildId);
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
    const incoming = req.body as Partial<SynthParameters>;
    const normalized: Partial<SynthParameters> = {
      ...incoming,
      fxReturn: incoming.fxReturn !== undefined ? clamp(incoming.fxReturn, 0, 1) : undefined,
      fxSends: incoming.fxSends ? normalizeFxSends(incoming.fxSends, synthData.synth.getParameters().fxSends) : undefined,
    };
    synthData.synth.updateParameters(normalized);
    broadcastToClients({ type: 'synthUpdate', data: { guildId: session.guildId, synthId, parameters: synthData.synth.getParameters() } }, session.guildId);
    if (synthData.sequencer.getIsPlaying()) {
      updateStreamingSynthParams(session.guildId, synthId, normalized);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({
      error: 'Invalid parameters',
      message: error instanceof Error ? error.message : 'Failed to update parameters',
    });
  }
});

app.get('/synth/:synthId/model', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const synthData = state.synths.get(parseInt(req.params.synthId, 10));
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  res.json({
    modelId: synthData.modelId,
    modelParams: synthData.modelParams,
  });
});

app.post('/synth/:synthId/model', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const synthId = parseInt(req.params.synthId, 10);
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  const incoming = req.body as { modelId?: SynthModelId; modelParams?: Partial<SynthModelParams> };
  synthData.modelId = normalizeSynthModelId(incoming.modelId);
  synthData.modelParams = normalizeSynthModelParams({
    ...synthData.modelParams,
    ...incoming.modelParams,
  });
  const data = {
    guildId: session.guildId,
    synthId,
    modelId: synthData.modelId,
    modelParams: synthData.modelParams,
  };
  broadcastToClients({ type: 'synthModelUpdate', data }, session.guildId);
  res.json({ success: true, ...data });
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
  }
  updateStreamingEffectsLoop(session.guildId);
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

app.get('/drum/kits', (req, res) => {
  getSession(req);
  res.json({
    kits: DRUM_KITS,
    defaultKitId: DEFAULT_DRUM_KIT_ID,
  });
});

app.post('/drum/kit', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const { kitId, applyDefaults } = req.body as { kitId?: DrumKitId; applyDefaults?: boolean };
  const selectedDrumKitId = normalizeDrumKitId(kitId);
  state.selectedDrumKitId = selectedDrumKitId;
  if (applyDefaults) {
    state.drumState = applyKitDefaultsToDrumState(state.drumState, selectedDrumKitId);
  }
  broadcastToClients({
    type: 'drumKitChanged',
    data: {
      guildId: session.guildId,
      selectedDrumKitId,
      applyDefaults: Boolean(applyDefaults),
      drumState: applyDefaults ? state.drumState : undefined,
    },
  }, session.guildId);
  updateStreamingEffectsLoop(session.guildId);
  res.json({
    success: true,
    selectedDrumKitId,
    drumState: state.drumState,
  });
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
  res.json({ success: true });
});

app.post('/drum/settings', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { instrument, settings } = req.body as { instrument: DrumInstrument; settings: { volume?: number; tone?: number; extra?: number; tune?: number; humanize?: number; cymbalType?: 'ride' | 'crash' } };
  if (!DRUM_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'Invalid instrument' });
  const s = state.drumState[instrument].settings;
  if (settings.volume !== undefined) s.volume = clamp(settings.volume, 0, 1);
  if (settings.tone !== undefined) s.tone = clamp(settings.tone, 0, 1);
  if (settings.extra !== undefined) s.extra = clamp(settings.extra, 0, 1);
  if (settings.tune !== undefined) s.tune = clamp(settings.tune, -1, 1);
  if (settings.humanize !== undefined) s.humanize = clamp(settings.humanize, 0, 1);
  if (settings.cymbalType !== undefined) s.cymbalType = settings.cymbalType;
  broadcastToClients({ type: 'drumSettings', data: { guildId: session.guildId, instrument, settings: { ...s } } }, session.guildId);
  updateStreamingEffectsLoop(session.guildId);
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
  res.json({ success: true });
});

app.put('/drum/state', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const { state: incoming } = req.body as { state: DrumState };
  if (!incoming) return res.status(400).json({ error: 'state is required' });
  state.drumState = normalizeDrumState(incoming);
  broadcastToClients({ type: 'drumFullState', data: { guildId: session.guildId, drumState: state.drumState } }, session.guildId);
  updateStreamingEffectsLoop(session.guildId);
  res.json({ success: true });
});

app.post('/drum/reset', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  state.drumState = applyKitDefaultsToDrumState(createDefaultDrumState(), state.selectedDrumKitId);
  broadcastToClients({ type: 'drumReset', data: { guildId: session.guildId } }, session.guildId);
  updateStreamingEffectsLoop(session.guildId);
  res.json({ success: true });
});

app.post('/drum/master-volume', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  state.drumMasterVolume = clamp((req.body as { volume: number }).volume, 0, 2);
  updateStreamingEffectsLoop(session.guildId);
  res.json({ success: true });
});

app.get('/effects-loop', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  state.effectsLoop = normalizeEffectsLoop(state.effectsLoop);
  res.json(state.effectsLoop);
});

app.post('/effects-loop', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const incoming = req.body as Partial<EffectsLoopState>;
  state.effectsLoop = normalizeEffectsLoop({ ...state.effectsLoop, ...incoming });
  broadcastToClients({ type: 'effectsLoopUpdate', data: { guildId: session.guildId, effectsLoop: state.effectsLoop } }, session.guildId);
  updateStreamingEffectsLoop(session.guildId);
  res.json({ success: true, effectsLoop: state.effectsLoop });
});

app.get('/drum/fx', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  state.drumFx = normalizeDrumFx(state.drumFx);
  res.json(state.drumFx);
});

app.post('/drum/fx', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const incoming = req.body as { sends?: Partial<FxSendLevels>; returnLevel?: number };
  state.drumFx = normalizeDrumFx({
    sends: { ...state.drumFx.sends, ...incoming.sends },
    returnLevel: incoming.returnLevel ?? state.drumFx.returnLevel,
  });
  broadcastToClients({ type: 'drumFxUpdate', data: { guildId: session.guildId, drumFx: state.drumFx } }, session.guildId);
  res.json({ success: true, drumFx: state.drumFx });
});

app.post('/patterns/save', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  const {
    name,
    steps,
    synthParams,
    synthModelId,
    synthModelParams,
    tempo,
    drumState,
    drumMasterVolume,
    drumFx,
    effectsLoop,
    drumKitId,
    overwriteId,
  } = req.body;
  const patternName = sanitizePatternName(name);
  if (!patternName || !Array.isArray(steps) || steps.length === 0 || steps.length > 64) {
    return res.status(400).json({ error: 'Invalid pattern payload' });
  }

  const guild = getPersistedGuild(session.guildId);
  const safeOverwriteId = sanitizeId(typeof overwriteId === 'string' ? overwriteId : undefined);
  const normalizedName = patternName.toLowerCase();
  const existingByName = guild.savedPatterns.find((entry) => entry.name.toLowerCase() === normalizedName);
  if (existingByName && existingByName.id !== safeOverwriteId) {
    return res.status(409).json({ error: 'Pattern name already exists', id: existingByName.id, name: existingByName.name });
  }

  const overwriteTarget = safeOverwriteId
    ? guild.savedPatterns.find((entry) => entry.id === safeOverwriteId)
    : null;
  if (safeOverwriteId && !overwriteTarget) {
    return res.status(404).json({ error: 'Pattern to overwrite not found' });
  }

  const now = Date.now();
  const entry: SavedPatternData = {
    id: overwriteTarget?.id || `saved-${now}`,
    name: patternName,
    createdAt: overwriteTarget?.createdAt || now,
    updatedAt: now,
    steps,
    synthParams: synthParams || null,
    synthModelId: normalizeSynthModelId(synthModelId),
    synthModelParams: normalizeSynthModelParams(synthModelParams),
    tempo: tempo || state.globalTempo,
    drumState: drumState || state.drumState,
    drumKitId: normalizeDrumKitId(drumKitId ?? state.selectedDrumKitId),
    drumMasterVolume: drumMasterVolume !== undefined ? drumMasterVolume : state.drumMasterVolume,
    drumFx: normalizeDrumFx(drumFx || state.drumFx),
    effectsLoop: normalizeEffectsLoop(effectsLoop || state.effectsLoop),
  };
  if (overwriteTarget) {
    const overwriteIndex = guild.savedPatterns.findIndex((p) => p.id === overwriteTarget.id);
    guild.savedPatterns[overwriteIndex] = entry;
  } else {
    guild.savedPatterns.push(entry);
  }
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
  res.json({
    ...entry,
    synthModelId: normalizeSynthModelId(entry.synthModelId),
    synthModelParams: normalizeSynthModelParams(entry.synthModelParams),
    drumKitId: normalizeDrumKitId(entry.drumKitId),
    drumState: normalizeDrumState(entry.drumState),
    drumFx: normalizeDrumFx(entry.drumFx),
    effectsLoop: normalizeEffectsLoop(entry.effectsLoop),
  });
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

  broadcastToClients({ type: 'sequencerPlay', data: { guildId: session.guildId, synthId, patternId: pattern.id } }, session.guildId);
  broadcastToBotClients({ type: 'sequencerPlay', data: { guildId: session.guildId, synthId, patternId: pattern.id } });
  startStreaming(session.guildId);
  res.json({ success: true });
});

app.post('/sequencer/stop', (req, res) => {
  const session = getSession(req);
  const state = getGuildState(session.guildId);
  initAudioEngine(state);
  const { synthId = 1 } = req.body;
  const synthData = state.synths.get(synthId);
  if (!synthData) return res.status(404).json({ error: 'Synth not found' });
  synthData.sequencer.stop();
  stopStreaming(session.guildId);
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
  const sampleId = sanitizeId(id);
  const sampleName = sanitizeOptionalText(name, 80);
  const sampleUrl = sanitizeSampleUrl(url);
  if (!sampleId || !sampleName || !sampleUrl) {
    return res.status(400).json({ error: 'Invalid sample payload' });
  }

  try {
    await state.samplePlayer!.loadSample(sampleId, sampleName, sampleUrl);
    broadcastToClients({ type: 'sampleLoaded', data: { guildId: session.guildId, id: sampleId, name: sampleName, url: sampleUrl } }, session.guildId);
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

const WS_PING_INTERVAL_MS = 15_000;
const WS_PONG_TIMEOUT_MS = 10_000;

function setupWsKeepalive(wss: WebSocketServer) {
  wss.on('connection', (ws) => {
    let alive = true;
    ws.on('pong', () => { alive = true; });

    const interval = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, WS_PING_INTERVAL_MS);

    ws.on('close', () => clearInterval(interval));
  });
}
setupWsKeepalive(wssUi);
setupWsKeepalive(wssBot);

function rejectUpgrade(socket: any, statusCode: number, statusText: string, body: string) {
  const message = `${body}\n`;
  const response = [
    `HTTP/1.1 ${statusCode} ${statusText}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(message)}`,
    '',
    message,
  ].join('\r\n');
  try {
    socket.write(response);
  } finally {
    socket.destroy();
  }
}

server.on('upgrade', (req, socket, head) => {
  const requestPath = getWebSocketRequestPath(req.url);
  const requestHost = typeof req.headers['x-forwarded-host'] === 'string' && req.headers['x-forwarded-host']
    ? req.headers['x-forwarded-host']
    : req.headers.host;
  const origin = req.headers.origin;
  const channel = getWebSocketChannel(requestPath, WS_UI_PATHS, WS_BOT_PATHS);

  if (!isAllowedUpgradeOrigin(origin, requestHost, ALLOWED_ORIGINS)) {
    console.warn(`[ws] upgrade rejected: disallowed origin path=${requestPath} origin=${origin || '-'} host=${requestHost || '-'}`);
    rejectUpgrade(socket, 403, 'Forbidden', 'WebSocket origin not allowed');
    return;
  }
  if (!channel) {
    console.warn(`[ws] upgrade rejected: unsupported path=${requestPath} origin=${origin || '-'} host=${requestHost || '-'}`);
    rejectUpgrade(socket, 404, 'Not Found', 'WebSocket path not found');
    return;
  }
  console.log(`[ws] upgrade accepted: channel=${channel} path=${requestPath} origin=${origin || '-'} host=${requestHost || '-'}`);
  const targetServer = channel === 'ui' ? wssUi : wssBot;
  targetServer.handleUpgrade(req, socket, head, (ws) => targetServer.emit('connection', ws, req));
});

app.get(['/ws', '/ws/', '/ws/bot', '/ws/bot/'], (_req, res) => {
  res.status(426).json({
    error: 'WebSocket Upgrade Required',
    message: 'Use a WebSocket client with ws:// or wss:// protocol.',
  });
});

wssUi.on('connection', (ws, req) => {
  const requestPath = getWebSocketRequestPath(req.url);
  console.log(`[ws] ui connected path=${requestPath}`);
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
  wsClients.set(ws, { guildId, sessionToken: session.token, username: session.username });
  const state = getGuildState(guildId);
  initAudioEngine(state);

  const synthsData = Array.from(state.synths.entries())
    .sort(([a], [b]) => a - b)
    .map(([id, data]) => ({
    synthId: id,
    pattern: data.pattern,
    patterns: data.patterns,
    synthParams: data.synth.getParameters(),
    synthModelId: data.modelId,
    synthModelParams: data.modelParams,
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
      drumKits: DRUM_KITS,
      selectedDrumKitId: normalizeDrumKitId(state.selectedDrumKitId),
      drumFx: normalizeDrumFx(state.drumFx),
      effectsLoop: normalizeEffectsLoop(state.effectsLoop),
      tempo: state.globalTempo,
      connectedUsers: getConnectedUsernames(guildId),
      session: {
        guildId: session.guildId,
        userId: session.userId,
        username: session.username,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    },
  }));

  broadcastConnectedUsers(guildId);

  ws.on('close', () => {
    console.log('[ws] ui disconnected');
    const meta = wsClients.get(ws);
    wsClients.delete(ws);
    if (meta) broadcastConnectedUsers(meta.guildId);
  });

  ws.on('error', (error) => {
    console.error(`[ws] ui error: ${error instanceof Error ? error.message : 'unknown error'}`);
    ws.terminate();
  });
});

wssBot.on('connection', (ws, req) => {
  const requestPath = getWebSocketRequestPath(req.url);
  console.log(`[ws] bot connected path=${requestPath}`);
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
  ws.on('close', () => {
    console.log('[ws] bot disconnected');
    botClients.delete(ws);
  });
  ws.on('error', (error) => {
    console.error(`[ws] bot error: ${error instanceof Error ? error.message : 'unknown error'}`);
    botClients.delete(ws);
  });
});

wssUi.on('error', (error) => {
  console.error(`[ws] ui server error: ${error instanceof Error ? error.message : 'unknown error'}`);
});

wssBot.on('error', (error) => {
  console.error(`[ws] bot server error: ${error instanceof Error ? error.message : 'unknown error'}`);
});

server.on('error', (error) => {
  console.error(`[server] http error: ${error instanceof Error ? error.message : 'unknown error'}`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web API server running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/ws`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth mode: ${AUTH_MODE}`);
});
