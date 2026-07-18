import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import SynthUnit from './components/SynthUnit';
import Sequencer from './components/Sequencer';
import KeyboardPanel from './components/KeyboardPanel';
import DrumMachine from './components/DrumMachine';
import EffectsPanel from './components/EffectsPanel';
import MixerPanel from './components/MixerPanel';
import MidiPanel from './components/MidiPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { useSynthAudio } from './hooks/useSynthAudio';
import { useDrumAudio } from './hooks/useDrumAudio';
import { usePatternAudio } from './hooks/usePatternAudio';
import { MidiMode, MidiMessage, useMidiInput } from './hooks/useMidiInput';
import { getWebSocketUrl } from './config';
import { Pattern, SynthParameters, SavedPatternInfo, SavedPatternFull, SavedSynthData, DrumState, DrumInstrument, DrumSettings, DrumKitDefinition, DrumKitId, EffectsLoopState, FxSendLevels, SynthModelId, SynthModelParams } from './types';
import { authFetch, exchangeLoginToken, fetchSessionInfo, setAuthContext, compatibilityLogin } from './authClient';
import { downloadMidiFile, transposeNote } from './utils/midiExport';
import { importMidiFile, readFileAsArrayBuffer, MidiImportResult } from './utils/midiImport';
import { DEFAULT_SYNTH_MODEL_ID, createDefaultSynthModelParams, mapSynthModelToEngineParams, normalizeSynthModelId, normalizeSynthModelParams } from './synthModels';
import './App.css';

const SESSION_TOKEN_STORAGE_KEY = 'discobot_session_token';
const CSRF_TOKEN_STORAGE_KEY = 'discobot_csrf_token';

function writeAuthTokens(sessionToken: string, csrfToken: string) {
  sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, sessionToken);
  sessionStorage.setItem(CSRF_TOKEN_STORAGE_KEY, csrfToken);
}

function clearAuthTokens() {
  sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(CSRF_TOKEN_STORAGE_KEY);
  localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  localStorage.removeItem(CSRF_TOKEN_STORAGE_KEY);
}

function readAuthTokens() {
  const sessionToken = sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  const csrfToken = sessionStorage.getItem(CSRF_TOKEN_STORAGE_KEY);
  if (sessionToken && csrfToken) return { sessionToken, csrfToken };
  const migratedSessionToken = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  const migratedCsrfToken = localStorage.getItem(CSRF_TOKEN_STORAGE_KEY);
  if (migratedSessionToken && migratedCsrfToken) {
    writeAuthTokens(migratedSessionToken, migratedCsrfToken);
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    localStorage.removeItem(CSRF_TOKEN_STORAGE_KEY);
    return { sessionToken: migratedSessionToken, csrfToken: migratedCsrfToken };
  }
  return null;
}

const DEFAULT_PARAMS: SynthParameters = {
  hold: false,
  gain: 1.0,
  fxReturn: 0.85,
  pan: 0,
  portamento: { enabled: false, glide: 0.05 },
  arpeggiator: { enabled: false, mode: 'up', rate: '1/16', gate: 0.7 },
  oscillator: { type: 'sine', detune: 0 },
  lfo1: { enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.2 },
  lfo2: { enabled: false, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.25 },
  filter: { frequency: 20000, q: 1, type: 'lowpass' },
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
  fxSends: { reverb: 0.25, delay: 0.2, drive: 0.15, phaser: 0.1 },
  effects: {
    reverb: { enabled: false, wet: 0.3, decay: 2 },
    delay: { enabled: false, wet: 0.3, time: 0.25, feedback: 0.3 },
  },
};

const DEFAULT_DRUM_FX: { sends: FxSendLevels; returnLevel: number } = {
  sends: { reverb: 0.35, delay: 0.15, drive: 0.2, phaser: 0.1 },
  returnLevel: 0.7,
};

const DEFAULT_EFFECTS_LOOP: EffectsLoopState = {
  enabled: true,
  returns: { synth: 0.85, drums: 0.7 },
  drive: { enabled: true, amount: 0.18, tone: 0.65 },
  phaser: { enabled: false, rate: 0.45, depth: 0.45, feedback: 0.25, mix: 0.25 },
  delay: { enabled: true, time: 0.22, feedback: 0.35, mix: 0.3 },
  reverb: { enabled: true, decay: 2.1, mix: 0.38 },
};

const DEFAULT_DRUM_KIT_ID: DrumKitId = 'clean-analog';
const SYNTH_PRESETS_STORAGE_KEY = 'discobot_synth_presets_v1';
const MAX_HISTORY = 80;

interface SynthPreset {
  id: string;
  name: string;
  params: SynthParameters;
  modelId: SynthModelId;
  modelParams: SynthModelParams;
  builtIn?: boolean;
}

interface PatternSnapshot {
  pattern: Pattern;
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  drumState: DrumState;
  tempo: number;
}

interface PatternHistory {
  undo: PatternSnapshot[];
  redo: PatternSnapshot[];
}

interface SynthState {
  id: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  keyboardMode: 'keyboard' | 'piano-roll';
  stepRecordPointer: number;
  octaveShift: number;
  muted: boolean;
  solo: boolean;
  forceReleaseSignal: boolean;
}

interface PatternAudioPayload {
  audio: string;
  sampleRate: number;
}

function createDefaultDrumState(): DrumState {
  return {
    kick: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    snare: { steps: new Array(16).fill(false), settings: { volume: 0.68, tone: 0.46, extra: 0.68, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    openHH: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    closedHH: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    ride: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    crash: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    snare2: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    clap: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
  };
}

function clonePattern(pattern: Pattern): Pattern {
  return {
    ...pattern,
    steps: pattern.steps.map((step) => ({ ...step })),
  };
}

function cloneDrumState(state: DrumState): DrumState {
  return Object.fromEntries(
    (Object.keys(state) as DrumInstrument[]).map((instrument) => [
      instrument,
      {
        ...state[instrument],
        settings: { ...state[instrument].settings },
        steps: [...state[instrument].steps],
      },
    ])
  ) as DrumState;
}

function cloneSynthParams(params: SynthParameters | null): SynthParameters | null {
  if (!params) return null;
  return {
    ...params,
    arpeggiator: { ...params.arpeggiator },
    oscillator: { ...params.oscillator },
    lfo1: { ...params.lfo1 },
    lfo2: { ...params.lfo2 },
    filter: { ...params.filter },
    envelope: { ...params.envelope },
    fxSends: { ...params.fxSends },
    portamento: { ...params.portamento },
    effects: {
      reverb: { ...params.effects.reverb },
      delay: { ...params.effects.delay },
    },
  };
}

function cloneSynthModelParams(params: SynthModelParams | null | undefined): SynthModelParams {
  const normalized = normalizeSynthModelParams(params);
  return {
    macro1: normalized.macro1,
    macro2: normalized.macro2,
    macro3: normalized.macro3,
    macro4: normalized.macro4,
  };
}

function createBuiltInPresets(): SynthPreset[] {
  return [
    {
      id: 'builtin-pad',
      name: 'Pad',
      builtIn: true,
      modelId: DEFAULT_SYNTH_MODEL_ID,
      modelParams: createDefaultSynthModelParams(),
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'triangle', detune: -4 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 2200, q: 1.8 },
        envelope: { attack: 0.35, decay: 0.7, sustain: 0.78, release: 1.2 },
        fxReturn: 0.9,
        fxSends: { reverb: 0.55, delay: 0.26, drive: 0.05, phaser: 0.24 },
        lfo1: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.3 },
        lfo2: { enabled: true, target: 'pitch', waveform: 'sine', rate: 4.2, depth: 0.12 },
      },
    },
    {
      id: 'builtin-bass',
      name: 'Bass',
      builtIn: true,
      modelId: 'minimoog-model-d',
      modelParams: { macro1: 0.72, macro2: 0.64, macro3: 0.35, macro4: 0.45 },
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'sawtooth', detune: -8 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 420, q: 2.5 },
        envelope: { attack: 0.005, decay: 0.11, sustain: 0.48, release: 0.18 },
        fxReturn: 0.55,
        fxSends: { reverb: 0.08, delay: 0.06, drive: 0.28, phaser: 0.05 },
        lfo1: { enabled: true, target: 'filter', waveform: 'square', rate: 1.5, depth: 0.15 },
        lfo2: { enabled: false, target: 'filter', waveform: 'sine', rate: 0.5, depth: 0.1 },
      },
    },
    {
      id: 'builtin-lead',
      name: 'Lead',
      builtIn: true,
      modelId: 'prophet-5',
      modelParams: { macro1: 0.63, macro2: 0.55, macro3: 0.58, macro4: 0.44 },
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'square', detune: 6 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 5200, q: 1.9 },
        envelope: { attack: 0.012, decay: 0.22, sustain: 0.62, release: 0.28 },
        fxReturn: 0.72,
        fxSends: { reverb: 0.2, delay: 0.34, drive: 0.2, phaser: 0.12 },
        lfo1: { enabled: true, target: 'pitch', waveform: 'sawtooth', rate: 5.5, depth: 0.22 },
        lfo2: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.6, depth: 0.18 },
      },
    },
    {
      id: 'builtin-pluck',
      name: 'Pluck',
      builtIn: true,
      modelId: 'dx7',
      modelParams: { macro1: 0.52, macro2: 0.68, macro3: 0.74, macro4: 0.86 },
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'triangle', detune: 0 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 2900, q: 4.8 },
        envelope: { attack: 0.002, decay: 0.19, sustain: 0.2, release: 0.12 },
        fxReturn: 0.62,
        fxSends: { reverb: 0.18, delay: 0.22, drive: 0.1, phaser: 0.07 },
        lfo1: { enabled: true, target: 'filter', waveform: 'square', rate: 8, depth: 0.25 },
        lfo2: { enabled: false, target: 'pitch', waveform: 'sine', rate: 3, depth: 0.1 },
      },
    },
    {
      id: 'builtin-grand-piano',
      name: 'Grand Piano',
      builtIn: true,
      modelId: 'juno-106',
      modelParams: { macro1: 0.46, macro2: 0.52, macro3: 0.28, macro4: 0.61 },
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'triangle', detune: 2 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 6800, q: 1.35 },
        envelope: { attack: 0.004, decay: 0.42, sustain: 0.22, release: 1.45 },
        fxReturn: 0.82,
        fxSends: { reverb: 0.34, delay: 0.06, drive: 0.02, phaser: 0.02 },
        lfo1: { enabled: true, target: 'pitch', waveform: 'triangle', rate: 4.8, depth: 0.08 },
        lfo2: { enabled: false, target: 'filter', waveform: 'sine', rate: 1, depth: 0.05 },
      },
    },
  ];
}

function loadUserPresets(): SynthPreset[] {
  try {
    const raw = localStorage.getItem(SYNTH_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{
      id: string;
      name: string;
      params: SynthParameters;
      modelId?: SynthModelId;
      modelParams?: SynthModelParams;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && entry.params)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        params: cloneSynthParams(entry.params) || DEFAULT_PARAMS,
        modelId: normalizeSynthModelId(entry.modelId),
        modelParams: cloneSynthModelParams(entry.modelParams),
      }));
  } catch {
    return [];
  }
}

function normalizeFxSends(sends: Partial<FxSendLevels> | undefined): FxSendLevels {
  return {
    reverb: Math.max(0, Math.min(1, sends?.reverb ?? DEFAULT_DRUM_FX.sends.reverb)),
    delay: Math.max(0, Math.min(1, sends?.delay ?? DEFAULT_DRUM_FX.sends.delay)),
    drive: Math.max(0, Math.min(1, sends?.drive ?? DEFAULT_DRUM_FX.sends.drive)),
    phaser: Math.max(0, Math.min(1, sends?.phaser ?? DEFAULT_DRUM_FX.sends.phaser)),
  };
}

function normalizeSynthParams(params: SynthParameters | null): SynthParameters | null {
  if (!params) return null;
  const allowedArpModes: SynthParameters['arpeggiator']['mode'][] = ['up', 'down', 'updown', 'downup', 'random', 'converge', 'diverge'];
  const allowedArpRates: SynthParameters['arpeggiator']['rate'][] = ['1/4', '1/8', '1/16', '1/32'];
  const mode = allowedArpModes.includes(params.arpeggiator?.mode as SynthParameters['arpeggiator']['mode'])
    ? params.arpeggiator.mode
    : DEFAULT_PARAMS.arpeggiator.mode;
  const rate = allowedArpRates.includes(params.arpeggiator?.rate as SynthParameters['arpeggiator']['rate'])
    ? params.arpeggiator.rate
    : DEFAULT_PARAMS.arpeggiator.rate;
  return {
    ...params,
    fxReturn: Math.max(0, Math.min(1, params.fxReturn ?? DEFAULT_PARAMS.fxReturn)),
    arpeggiator: {
      enabled: params.arpeggiator?.enabled ?? DEFAULT_PARAMS.arpeggiator.enabled,
      mode,
      rate,
      gate: Math.max(0.1, Math.min(1, params.arpeggiator?.gate ?? DEFAULT_PARAMS.arpeggiator.gate)),
    },
    fxSends: normalizeFxSends(params.fxSends),
  };
}

function normalizeDrumFx(fx: { sends?: Partial<FxSendLevels>; returnLevel?: number } | undefined) {
  return {
    sends: normalizeFxSends(fx?.sends),
    returnLevel: Math.max(0, Math.min(1, fx?.returnLevel ?? DEFAULT_DRUM_FX.returnLevel)),
  };
}

function normalizeEffectsLoop(loop: Partial<EffectsLoopState> | undefined): EffectsLoopState {
  return {
    enabled: loop?.enabled ?? DEFAULT_EFFECTS_LOOP.enabled,
    returns: {
      synth: Math.max(0, Math.min(1, loop?.returns?.synth ?? DEFAULT_EFFECTS_LOOP.returns.synth)),
      drums: Math.max(0, Math.min(1, loop?.returns?.drums ?? DEFAULT_EFFECTS_LOOP.returns.drums)),
    },
    drive: {
      enabled: loop?.drive?.enabled ?? DEFAULT_EFFECTS_LOOP.drive.enabled,
      amount: Math.max(0, Math.min(1, loop?.drive?.amount ?? DEFAULT_EFFECTS_LOOP.drive.amount)),
      tone: Math.max(0, Math.min(1, loop?.drive?.tone ?? DEFAULT_EFFECTS_LOOP.drive.tone)),
    },
    phaser: {
      enabled: loop?.phaser?.enabled ?? DEFAULT_EFFECTS_LOOP.phaser.enabled,
      rate: Math.max(0.05, Math.min(8, loop?.phaser?.rate ?? DEFAULT_EFFECTS_LOOP.phaser.rate)),
      depth: Math.max(0, Math.min(1, loop?.phaser?.depth ?? DEFAULT_EFFECTS_LOOP.phaser.depth)),
      feedback: Math.max(0, Math.min(0.95, loop?.phaser?.feedback ?? DEFAULT_EFFECTS_LOOP.phaser.feedback)),
      mix: Math.max(0, Math.min(1, loop?.phaser?.mix ?? DEFAULT_EFFECTS_LOOP.phaser.mix)),
    },
    delay: {
      enabled: loop?.delay?.enabled ?? DEFAULT_EFFECTS_LOOP.delay.enabled,
      time: Math.max(0.01, Math.min(1.5, loop?.delay?.time ?? DEFAULT_EFFECTS_LOOP.delay.time)),
      feedback: Math.max(0, Math.min(0.95, loop?.delay?.feedback ?? DEFAULT_EFFECTS_LOOP.delay.feedback)),
      mix: Math.max(0, Math.min(1, loop?.delay?.mix ?? DEFAULT_EFFECTS_LOOP.delay.mix)),
    },
    reverb: {
      enabled: loop?.reverb?.enabled ?? DEFAULT_EFFECTS_LOOP.reverb.enabled,
      decay: Math.max(0.2, Math.min(8, loop?.reverb?.decay ?? DEFAULT_EFFECTS_LOOP.reverb.decay)),
      mix: Math.max(0, Math.min(1, loop?.reverb?.mix ?? DEFAULT_EFFECTS_LOOP.reverb.mix)),
    },
  };
}

function midiNoteToName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = notes[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function TempoDisplay({ tempo, onChange }: { tempo: number; onChange: (bpm: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(tempo));
  const inputRef = useRef<HTMLInputElement>(null);
  const tapTimesRef = useRef<number[]>([]);
  const [tapFlash, setTapFlash] = useState(false);

  useEffect(() => {
    if (!editing) setValue(String(tempo));
  }, [tempo, editing]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  const commit = () => {
    const bpm = parseInt(value, 10);
    if (!isNaN(bpm) && bpm >= 20 && bpm <= 400) onChange(bpm);
    setEditing(false);
  };

  const handleTap = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    taps.push(now);

    if (taps.length > 8) taps.shift();

    if (taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      intervals.sort((a, b) => a - b);
      const mid = Math.floor(intervals.length / 2);
      const trimmed = intervals.length > 2
        ? intervals.slice(Math.max(0, mid - 1), mid + 1)
        : intervals;
      const avgInterval = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
      const bpm = Math.round(60000 / avgInterval);
      if (bpm >= 20 && bpm <= 400) {
        onChange(bpm);
      }
    }

    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 100);

    if (taps.length > 1) {
      const lastInterval = taps[taps.length - 1] - taps[taps.length - 2];
      if (lastInterval > 3000) {
        tapTimesRef.current = [now];
      }
    }
  }, [onChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 't' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        event.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTap]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="tempo-led-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
      />
    );
  }

  return (
    <div className="tempo-display-group">
      <div className={`tempo-led ${tapFlash ? 'tap-flash' : ''}`} onClick={() => setEditing(true)}>
        <span className="tempo-led-label">BPM</span>
        <span className="tempo-led-value">{String(tempo).padStart(3, ' ')}</span>
      </div>
      <button className="tap-tempo-btn" onClick={handleTap} title="Tap Tempo (T)">
        TAP
      </button>
    </div>
  );
}

function SavePattern({
  saving, setSaving, saveName, setSaveName, savedFeedback, setSavedFeedback, onSave,
}: {
  saving: boolean;
  setSaving: (v: boolean) => void;
  saveName: string;
  setSaveName: (v: string) => void;
  savedFeedback: boolean;
  setSavedFeedback: (v: boolean) => void;
  onSave: (name: string) => Promise<boolean>;
}) {
  const handleSaveCommit = async () => {
    const name = saveName.trim();
    if (!name) { setSaving(false); return; }
    const saved = await onSave(name);
    setSaving(false);
    if (saved) {
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2000);
    }
  };

  if (savedFeedback) {
    return <span className="save-feedback">&#10003; Saved!</span>;
  }

  if (saving) {
    return (
      <div className="save-inline">
        <input
          autoFocus
          className="save-name-input"
          placeholder="Pattern name..."
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveCommit(); if (e.key === 'Escape') setSaving(false); }}
        />
        <button className="save-confirm-btn" onClick={() => void handleSaveCommit()}>&#10003;</button>
        <button className="save-cancel-btn" onClick={() => setSaving(false)}>&#10005;</button>
      </div>
    );
  }

  return (
    <button className="save-button" onClick={() => { setSaving(true); setSaveName(''); }}>
      + Save
    </button>
  );
}

function LoadPattern({
  loading,
  savedPatterns,
  onLoad,
  onRefresh,
}: {
  loading: boolean;
  savedPatterns: SavedPatternInfo[];
  onLoad: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="load-inline">
      <select
        className="load-select"
        defaultValue=""
        onFocus={onRefresh}
        onChange={(e) => {
          if (!e.target.value) return;
          onLoad(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="" disabled>{loading ? 'Loading...' : 'Load'}</option>
        {savedPatterns.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="help-modal-overlay" onClick={onClose} role="presentation">
      <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Discobot help">
        <div className="help-modal-header">
          <h2>How to use Discobot</h2>
          <button className="help-close-btn" onClick={onClose} aria-label="Close help">✕</button>
        </div>
        <div className="help-sections">
          <section>
            <h3>Quick start</h3>
            <ol className="help-list">
              <li>Run <strong>/login</strong> in Discord and open the generated link.</li>
              <li>Use <strong>/join</strong> in Discord to route playback to your voice channel.</li>
              <li>Pick a step on a synth lane, then click a key (or paint in Piano Roll) to place notes.</li>
              <li>Program drum hits in <strong>Rhythm Composer</strong>, choose a kit, and shape tone/volume/extra per lane.</li>
              <li>Press <strong>Play All</strong> to start and <strong>Stop All</strong> to stop.</li>
            </ol>
          </section>
          <section>
            <h3>Header controls</h3>
            <ul className="help-list help-list-plain">
              <li><strong>BPM:</strong> click the LED to edit global tempo (20–400).</li>
              <li><strong>MIDI panel:</strong> choose device, mode (live/record/step), channel, and target synth.</li>
              <li><strong>Play/Stop All:</strong> transport for all synth lanes.</li>
              <li><strong>Save/Load:</strong> store and recall full patterns (synth + drums + FX state).</li>
              <li><strong>Export MIDI:</strong> downloads the current arrangement as a .mid file.</li>
            </ul>
          </section>
          <section>
            <h3>Editing safety + shortcuts</h3>
            <ul className="help-list help-list-plain">
              <li><strong>Undo:</strong> Ctrl/Cmd + Z</li>
              <li><strong>Redo:</strong> Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y</li>
              <li>Undo/redo tracks note edits, step velocity, synth params, and drum edits per pattern.</li>
            </ul>
          </section>
          <section>
            <h3>Synth + drum workflow</h3>
            <ul className="help-list help-list-plain">
              <li><strong>Multi-synth:</strong> up to 3 independent synth lanes, each with its own sequencer + controls.</li>
              <li><strong>Arpeggiator:</strong> per synth toggle with modes/rates (1/4 to 1/32) and gate.</li>
              <li><strong>Synth presets:</strong> save/load/delete sound presets without replacing full patterns.</li>
              <li><strong>Drum FX:</strong> set per-drum sends and control both drum <strong>FX Return</strong> and <strong>Loop Return</strong> inside Rhythm Composer.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function App() {
  const synthAudio = useSynthAudio();
  const drumAudio = useDrumAudio();
  const patternAudio = usePatternAudio();
  const [synths, setSynths] = useState<SynthState[]>([]);
  const [selectedSynthId, setSelectedSynthId] = useState(1);
  const [drumState, setDrumState] = useState<DrumState>(createDefaultDrumState);
  const [drumKits, setDrumKits] = useState<DrumKitDefinition[]>([]);
  const [drumKitsLoading, setDrumKitsLoading] = useState(false);
  const [drumKitsError, setDrumKitsError] = useState<string | null>(null);
  const [selectedDrumKitId, setSelectedDrumKitId] = useState<DrumKitId>(DEFAULT_DRUM_KIT_ID);
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const [drumSwing, setDrumSwing] = useState(0);
  const [drumFx, setDrumFx] = useState(DEFAULT_DRUM_FX);
  const [effectsLoop, setEffectsLoop] = useState(DEFAULT_EFFECTS_LOOP);
  const [browserMuted, setBrowserMuted] = useState(false);
  const [browserVolume, setBrowserVolume] = useState(1.0);
  const [globalTempo, setGlobalTempo] = useState(120);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState('Unauthenticated');
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [midiMode, setMidiMode] = useState<MidiMode>('live');
  const [midiChannel, setMidiChannel] = useState(1);
  const [midiTargetSynthId, setMidiTargetSynthId] = useState<number | null>(1);
  const [activeSavedPattern, setActiveSavedPattern] = useState<{ id: string; name: string } | null>(null);
  const [synthPresets, setSynthPresets] = useState<SynthPreset[]>(() => [
    ...createBuiltInPresets(),
    ...loadUserPresets(),
  ]);
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;
  const browserVolumeRef = useRef(browserVolume);
  browserVolumeRef.current = browserVolume;

  const synthsRef = useRef(synths);
  synthsRef.current = synths;
  const midiModeRef = useRef(midiMode);
  midiModeRef.current = midiMode;
  const midiChannelRef = useRef(midiChannel);
  midiChannelRef.current = midiChannel;
  const midiTargetSynthIdRef = useRef(midiTargetSynthId);
  midiTargetSynthIdRef.current = midiTargetSynthId;
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;
  const selectedDrumKitIdRef = useRef(selectedDrumKitId);
  selectedDrumKitIdRef.current = selectedDrumKitId;
  const drumFxRef = useRef(drumFx);
  drumFxRef.current = drumFx;
  const effectsLoopRef = useRef(effectsLoop);
  effectsLoopRef.current = effectsLoop;
  const historyRef = useRef<Record<string, PatternHistory>>({});
  const historyThrottleRef = useRef<Record<string, number>>({});
  const activeHistoryKeyRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  const arpTimeoutsRef = useRef<number[]>([]);
  const lastDrumPreviewStepRef = useRef<number | null>(null);
  const lastPatternAudioRef = useRef<PatternAudioPayload | null>(null);

  useEffect(() => {
    if (synths.length === 0) return;
    if (midiTargetSynthId !== null && synths.some((s) => s.id === midiTargetSynthId)) return;
    setMidiTargetSynthId(synths[0].id);
  }, [synths, midiTargetSynthId]);

  useEffect(() => {
    const firstWithPattern = synths.find((entry) => entry.pattern);
    if (!firstWithPattern?.pattern) return;
    if (!activeHistoryKeyRef.current) {
      activeHistoryKeyRef.current = `${firstWithPattern.id}:${firstWithPattern.pattern.id}`;
    }
  }, [synths]);

  useEffect(() => {
    synthAudio.setVolume(browserVolume);
    drumAudio.setVolume(browserVolume);
    patternAudio.setVolume(browserVolume);
  }, [browserVolume, synthAudio, drumAudio, patternAudio]);

  useEffect(() => {
    if (synths.length === 0) return;
    for (const id of [2, 3]) {
      if (!synths.some(s => s.id === id)) {
        void ensureSynthExists(id);
      }
    }
  }, [synths]);

  useEffect(() => {
    if (synths.length > 0 && !synths.some(s => s.id === selectedSynthId)) {
      setSelectedSynthId(synths[0].id);
    }
  }, [synths, selectedSynthId]);

  useEffect(() => {
    return () => {
      synthAudio.dispose();
      drumAudio.dispose();
      patternAudio.dispose();
      arpTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      arpTimeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    function resumeAudioContexts() {
      if (synthAudio) synthAudio.tryResume();
      if (drumAudio) drumAudio.tryResume();
      if (patternAudio) patternAudio.tryResume();
    }
    window.addEventListener('click', resumeAudioContexts);
    window.addEventListener('keydown', resumeAudioContexts);
    return () => {
      window.removeEventListener('click', resumeAudioContexts);
      window.removeEventListener('keydown', resumeAudioContexts);
    };
  }, [synthAudio, drumAudio, patternAudio]);

  useEffect(() => {
    patternAudio.setMuted(browserMuted);
    if (!browserMuted && lastPatternAudioRef.current && synthsRef.current.some((s) => s.isPlaying)) {
      void patternAudio.playLoop(lastPatternAudioRef.current, false);
    }
  }, [browserMuted, patternAudio]);

  const getHistoryKey = useCallback((synthId: number, patternId: string) => `${synthId}:${patternId}`, []);

  const getSnapshot = useCallback((synthId: number, patternId: string): PatternSnapshot | null => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId && entry.pattern?.id === patternId);
    if (!synth?.pattern) return null;
    return {
      pattern: clonePattern(synth.pattern),
      synthParams: cloneSynthParams(synth.synthParams),
      synthModelId: synth.synthModelId,
      synthModelParams: cloneSynthModelParams(synth.synthModelParams),
      drumState: cloneDrumState(drumStateRef.current),
      tempo: globalTempo,
    };
  }, [globalTempo]);

  const pushHistorySnapshot = useCallback((synthId: number, patternId: string) => {
    if (isRestoringRef.current) return;
    const snapshot = getSnapshot(synthId, patternId);
    if (!snapshot) return;
    const key = getHistoryKey(synthId, patternId);
    activeHistoryKeyRef.current = key;
    const history = historyRef.current[key] || { undo: [], redo: [] };
    history.undo.push(snapshot);
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
    history.redo = [];
    historyRef.current[key] = history;
  }, [getHistoryKey, getSnapshot]);

  const pushHistorySnapshotThrottled = useCallback(
    (synthId: number, patternId: string, keySuffix: string, minIntervalMs = 250) => {
      const now = performance.now();
      const key = `${getHistoryKey(synthId, patternId)}:${keySuffix}`;
      const lastTs = historyThrottleRef.current[key] ?? 0;
      if (now - lastTs < minIntervalMs) return;
      historyThrottleRef.current[key] = now;
      pushHistorySnapshot(synthId, patternId);
    },
    [getHistoryKey, pushHistorySnapshot]
  );

  const applySnapshot = useCallback(async (synthId: number, snapshot: PatternSnapshot) => {
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId
        ? {
          ...entry,
          pattern: clonePattern(snapshot.pattern),
          synthParams: cloneSynthParams(snapshot.synthParams),
          synthModelId: snapshot.synthModelId,
          synthModelParams: cloneSynthModelParams(snapshot.synthModelParams),
          selectedStep: null,
        }
        : entry
    )));
    setDrumState(cloneDrumState(snapshot.drumState));
    setGlobalTempo(snapshot.tempo);
    setActiveSavedPattern(null);
    await Promise.all([
      authFetch(`/synth/${synthId}/patterns/${snapshot.pattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot.pattern),
      }),
      authFetch(`/synth/${synthId}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot.synthParams || DEFAULT_PARAMS),
      }),
      authFetch(`/synth/${synthId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: snapshot.synthModelId,
          modelParams: snapshot.synthModelParams,
        }),
      }),
      authFetch('/drum/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: snapshot.drumState }),
      }),
      authFetch('/tempo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempo: snapshot.tempo }),
      }),
    ]);
  }, []);

  const resolveHistoryTarget = useCallback((): { key: string; synthId: number; patternId: string } | null => {
    const activeKey = activeHistoryKeyRef.current;
    const parseKey = (value: string) => {
      const [synthRaw, patternId] = value.split(':');
      const synthId = Number.parseInt(synthRaw, 10);
      if (!patternId || Number.isNaN(synthId)) return null;
      return { key: value, synthId, patternId };
    };
    if (activeKey) {
      const parsed = parseKey(activeKey);
      if (parsed) {
        const exists = synthsRef.current.some((entry) => entry.id === parsed.synthId && entry.pattern?.id === parsed.patternId);
        if (exists) return parsed;
      }
    }
    const fallback = synthsRef.current.find((entry) => entry.pattern);
    if (!fallback?.pattern) return null;
    const key = getHistoryKey(fallback.id, fallback.pattern.id);
    activeHistoryKeyRef.current = key;
    return { key, synthId: fallback.id, patternId: fallback.pattern.id };
  }, [getHistoryKey]);

  const handleUndo = useCallback(async () => {
    const target = resolveHistoryTarget();
    if (!target) return;
    const history = historyRef.current[target.key];
    if (!history || history.undo.length === 0) return;
    const current = getSnapshot(target.synthId, target.patternId);
    const previous = history.undo.pop();
    if (!previous) return;
    if (current) history.redo.push(current);
    historyRef.current[target.key] = history;
    isRestoringRef.current = true;
    try {
      await applySnapshot(target.synthId, previous);
    } finally {
      isRestoringRef.current = false;
    }
  }, [resolveHistoryTarget, getSnapshot, applySnapshot]);

  const handleRedo = useCallback(async () => {
    const target = resolveHistoryTarget();
    if (!target) return;
    const history = historyRef.current[target.key];
    if (!history || history.redo.length === 0) return;
    const current = getSnapshot(target.synthId, target.patternId);
    const next = history.redo.pop();
    if (!next) return;
    if (current) history.undo.push(current);
    historyRef.current[target.key] = history;
    isRestoringRef.current = true;
    try {
      await applySnapshot(target.synthId, next);
    } finally {
      isRestoringRef.current = false;
    }
  }, [resolveHistoryTarget, getSnapshot, applySnapshot]);

  const handleUnauthorized = useCallback(() => {
    setSessionToken(null);
    setCsrfToken(null);
    setSessionLabel('Session expired');
    setAuthError('Session expired or unauthorized. Use /login in Discord to reconnect.');
    clearAuthTokens();
  }, []);

  useEffect(() => {
    setAuthContext(sessionToken, csrfToken, handleUnauthorized);
  }, [sessionToken, csrfToken, handleUnauthorized]);

  useEffect(() => {
    const initializeAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const loginToken = params.get('loginToken');
      try {
        if (loginToken) {
          const data = await exchangeLoginToken(loginToken);
          const nextSessionToken = data.sessionToken as string;
          const nextCsrfToken = data.csrfToken as string;
          setSessionToken(nextSessionToken);
          setCsrfToken(nextCsrfToken);
          setSessionLabel(`${data.session.username} (${data.session.role})`);
          writeAuthTokens(nextSessionToken, nextCsrfToken);
          params.delete('loginToken');
          const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
          window.history.replaceState({}, '', nextUrl);
          return;
        }

        const storedAuth = readAuthTokens();
        if (storedAuth) {
          const data = await fetchSessionInfo(storedAuth.sessionToken);
          setSessionToken(storedAuth.sessionToken);
          setCsrfToken(storedAuth.csrfToken);
          setSessionLabel(`${data.session.username} (${data.session.role})`);
          return;
        }

        setAuthError('Use /login in Discord to link this browser session.');
        try {
          const compatData = await compatibilityLogin();
          setSessionToken(compatData.sessionToken);
          setCsrfToken(compatData.csrfToken);
          setSessionLabel('Local User (owner)');
          writeAuthTokens(compatData.sessionToken, compatData.csrfToken);
          setAuthError(null);
          return;
        } catch {
        }
      } catch {
        setAuthError('Login token invalid or expired. Run /login in Discord again.');
      }
    };
    void initializeAuth();
  }, []);

  useEffect(() => {
    if (!helpOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    const presetsToPersist = synthPresets
      .filter((preset) => !preset.builtIn)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        params: preset.params,
        modelId: preset.modelId,
        modelParams: preset.modelParams,
      }));
    localStorage.setItem(SYNTH_PRESETS_STORAGE_KEY, JSON.stringify(presetsToPersist));
  }, [synthPresets]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (helpOpen) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        void handleRedo();
        return;
      }
      if (key === 'z') {
        event.preventDefault();
        void handleUndo();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        void handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, handleUndo, handleRedo]);

  const triggerSynthNote = useCallback((synthParams: SynthParameters, note: string, windowSeconds: number, velocity: number = 1) => {
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    const arp = synthParams.arpeggiator;
    if (!arp?.enabled) {
      void synthAudio.playNote(
        note,
        synthParams,
        Math.max(0.05, windowSeconds * 0.92),
        normalizedVelocity,
        browserMutedRef.current,
        effectsLoopRef.current,
        globalTempo
      );
      return;
    }

    const basePattern = [0, 4, 7, 12];
    const semitones = arp.mode === 'down'
      ? [...basePattern].reverse()
      : arp.mode === 'updown'
        ? [0, 4, 7, 12, 7, 4]
        : arp.mode === 'downup'
          ? [12, 7, 4, 0, 4, 7]
          : arp.mode === 'converge'
            ? [0, 12, 4, 7]
            : arp.mode === 'diverge'
              ? [7, 4, 12, 0]
              : basePattern;
    const rateDivisor = arp.rate === '1/4' ? 1 : arp.rate === '1/8' ? 2 : arp.rate === '1/16' ? 4 : 8;
    const interval = (60 / globalTempo) / rateDivisor;
    const noteLength = Math.max(0.03, interval * Math.max(0.1, Math.min(1, arp.gate)));
    const pulseCount = Math.max(1, Math.floor(Math.max(interval, windowSeconds) / interval));
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      const offset = arp.mode === 'random'
        ? semitones[Math.floor(Math.random() * semitones.length)]
        : semitones[pulse % semitones.length];
      const arpNote = transposeNote(note, offset);
      if (!arpNote) continue;
      if (pulse === 0) {
        void synthAudio.playNote(arpNote, synthParams, noteLength, normalizedVelocity, browserMutedRef.current, effectsLoopRef.current, globalTempo);
        continue;
      }
      const timeoutId = window.setTimeout(() => {
        void synthAudio.playNote(arpNote, synthParams, noteLength, normalizedVelocity, browserMutedRef.current, effectsLoopRef.current, globalTempo);
      }, interval * pulse * 1000);
      arpTimeoutsRef.current.push(timeoutId);
    }
  }, [synthAudio, globalTempo]);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init': {
        if (message.data.synths) {
          setSynths(message.data.synths.map((s: any) => ({
            id: s.synthId,
            pattern: s.pattern,
            patterns: s.patterns || [],
            synthParams: normalizeSynthParams(s.synthParams),
            synthModelId: normalizeSynthModelId(s.synthModelId),
            synthModelParams: normalizeSynthModelParams(s.synthModelParams),
            isPlaying: s.isPlaying || false,
            currentStep: 0,
            selectedStep: null,
            keyboardMode: 'keyboard',
            stepRecordPointer: 0,
            octaveShift: 0,
            muted: Boolean(s.muted),
            solo: Boolean(s.solo),
            forceReleaseSignal: false,
          })));
        } else if (message.data.synthParameters) {
          setSynths([{
            id: 1,
            pattern: message.data.patterns?.[0] || null,
            patterns: message.data.patterns || [],
            synthParams: normalizeSynthParams(message.data.synthParameters),
            synthModelId: DEFAULT_SYNTH_MODEL_ID,
            synthModelParams: createDefaultSynthModelParams(),
            isPlaying: false,
            currentStep: 0,
            selectedStep: null,
            keyboardMode: 'keyboard',
            stepRecordPointer: 0,
            octaveShift: 0,
            muted: false,
            solo: false,
            forceReleaseSignal: false,
          }]);
        }
        if (message.data.drumState) setDrumState(message.data.drumState);
        if (Array.isArray(message.data.drumKits)) setDrumKits(message.data.drumKits);
        if (message.data.selectedDrumKitId) setSelectedDrumKitId(message.data.selectedDrumKitId as DrumKitId);
        if (message.data.drumFx) setDrumFx(normalizeDrumFx(message.data.drumFx));
        if (message.data.effectsLoop) setEffectsLoop(normalizeEffectsLoop(message.data.effectsLoop));
        if (message.data.tempo) setGlobalTempo(message.data.tempo);
        if (Array.isArray(message.data.connectedUsers)) setConnectedUsers(message.data.connectedUsers);
        break;
      }
      case 'synthUpdate': {
        const { synthId, parameters } = message.data;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, synthParams: normalizeSynthParams(parameters) } : s
        ));
        break;
      }
      case 'patternCreated': {
        const { synthId, pattern } = message.data;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, patterns: [...s.patterns, pattern] } : s
        ));
        break;
      }
      case 'patternUpdated': {
        const { synthId, pattern } = message.data;
        setSynths(prev => prev.map(s => {
          if (s.id !== synthId) return s;
          const patterns = s.patterns.map(p => p.id === pattern.id ? pattern : p);
          const currentPattern = s.pattern?.id === pattern.id ? pattern : s.pattern;
          return { ...s, patterns, pattern: currentPattern };
        }));
        break;
      }
      case 'synthCreated': {
        const { synthId, pattern, synthParams, synthModelId, synthModelParams } = message.data;
        setSynths(prev => {
          if (prev.some(s => s.id === synthId)) return prev;
          return [...prev, {
            id: synthId,
            pattern,
            patterns: pattern ? [pattern] : [],
            synthParams: normalizeSynthParams(synthParams),
            synthModelId: normalizeSynthModelId(synthModelId),
            synthModelParams: normalizeSynthModelParams(synthModelParams),
            isPlaying: Boolean(message.data.isPlaying),
            currentStep: 0,
            selectedStep: null,
            keyboardMode: 'keyboard',
            stepRecordPointer: 0,
            octaveShift: 0,
            muted: Boolean(message.data.muted),
            solo: Boolean(message.data.solo),
            forceReleaseSignal: false,
          }];
        });
        break;
      }
      case 'synthModelUpdate': {
        const { synthId, modelId, modelParams } = message.data;
        setSynths((prev) => prev.map((s) => (
          s.id === synthId
            ? {
              ...s,
              synthModelId: normalizeSynthModelId(modelId),
              synthModelParams: normalizeSynthModelParams(modelParams),
            }
            : s
        )));
        break;
      }
      case 'synthMix': {
        const { synthId, muted, solo } = message.data;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, muted: Boolean(muted), solo: Boolean(solo) } : s
        ));
        break;
      }
      case 'synthRemoved': {
        const { synthId } = message.data;
        setSynths(prev => prev.filter(s => s.id !== synthId));
        break;
      }
      case 'sequencerPlay': {
        const { synthId } = message.data;
        if (synthId === 1) lastDrumPreviewStepRef.current = null;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: true } : s
        ));
        break;
      }
      case 'sequencerStop': {
        const { synthId } = message.data;
        const hasOtherPlayingSynth = synthsRef.current.some((s) => s.id !== synthId && s.isPlaying);
        if (!hasOtherPlayingSynth) {
          patternAudio.stop();
          lastPatternAudioRef.current = null;
        }
        if (synthId === 1) lastDrumPreviewStepRef.current = null;
        synthAudio.stopAllNotes();
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: false, currentStep: 0, forceReleaseSignal: !s.forceReleaseSignal } : s
        ));
        break;
      }
      case 'patternAudio': {
        const { audio, sampleRate } = message.data || {};
        if (typeof audio === 'string' && audio.length > 0) {
          const payload = {
            audio,
            sampleRate: typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 1000 ? sampleRate : 48000,
          };
          lastPatternAudioRef.current = payload;
          void patternAudio.playLoop(payload, browserMutedRef.current);
        }
        break;
      }
      case 'tempoChange': {
        const { tempo } = message.data;
        setGlobalTempo(tempo);
        break;
      }
      case 'sequencerStep': {
        const { synthId, step } = message.data;
        const synthSnapshot = synthsRef.current;
        const targetSynth = synthSnapshot.find(s => s.id === synthId);
        const hasSynthSolo = synthSnapshot.some(s => s.solo);
        const canPlaySynth = Boolean(targetSynth && !targetSynth.muted && (!hasSynthSolo || targetSynth.solo));
        const synthStepCount = Math.max(1, targetSynth?.pattern?.steps.length || 16);
        const normalizedStep = ((step % synthStepCount) + synthStepCount) % synthStepCount;
        const targetStep = targetSynth?.pattern?.steps[normalizedStep];
        const hasRenderedLoopAudio = patternAudio.isActive();
        if (!hasRenderedLoopAudio && canPlaySynth && targetSynth?.synthParams && targetStep?.active && targetStep.note) {
          const barDurationSeconds = (60 / Math.max(20, globalTempo)) * 4;
          const stepWindowSeconds = barDurationSeconds / synthStepCount;
          triggerSynthNote(targetSynth.synthParams, targetStep.note, stepWindowSeconds, targetStep.velocity);
        }
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, currentStep: step } : s
        ));
        const ds = drumStateRef.current;
        if (!hasRenderedLoopAudio && ds && synthId === 1) {
          const drumStep = Math.floor((normalizedStep / synthStepCount) * 16) % 16;
          if (lastDrumPreviewStepRef.current === drumStep) break;
          lastDrumPreviewStepRef.current = drumStep;
          const hasDrumSolo = (Object.keys(ds) as DrumInstrument[]).some(inst => Boolean(ds[inst].solo));
          for (const inst of Object.keys(ds) as DrumInstrument[]) {
            const track = ds[inst];
            const canPlayDrum = !track.muted && (!hasDrumSolo || track.solo);
            if (track.steps[drumStep] && canPlayDrum) {
              drumAudio.playDrumHit(inst, ds[inst].settings, browserMutedRef.current);
            }
          }
        }
        break;
      }
      case 'drumStep': {
        const { instrument: di, step: ds, active: da } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          next[di as DrumInstrument] = {
            ...next[di as DrumInstrument],
            steps: [...next[di as DrumInstrument].steps],
          };
          next[di as DrumInstrument].steps[ds as number] = da as boolean;
          return next;
        });
        break;
      }
      case 'drumStepVelocity': {
        const { instrument: dvi, step: dvs, velocity: dvv } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          const inst = dvi as DrumInstrument;
          next[inst] = {
            ...next[inst],
            stepVelocities: [...(next[inst].stepVelocities || new Array(16).fill(1))],
          };
          next[inst].stepVelocities![dvs as number] = dvv as number;
          return next;
        });
        break;
      }
      case 'drumSettings': {
        const { instrument: dsi, settings: dss } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          const inst = dsi as DrumInstrument;
          next[inst] = { ...next[inst], settings: { ...next[inst].settings, ...dss } };
          return next;
        });
        break;
      }
      case 'drumMix': {
        const { instrument, muted, solo } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          const inst = instrument as DrumInstrument;
          next[inst] = {
            ...next[inst],
            muted: Boolean(muted),
            solo: Boolean(solo),
          };
          return next;
        });
        break;
      }
      case 'drumReset': {
        setDrumState(createDefaultDrumState());
        break;
      }
      case 'drumFullState': {
        if (message.data.drumState) setDrumState(message.data.drumState);
        break;
      }
      case 'drumSwing': {
        if (typeof message.data.swing === 'number') setDrumSwing(message.data.swing);
        break;
      }
      case 'drumKitChanged': {
        if (message.data.selectedDrumKitId) {
          setSelectedDrumKitId(message.data.selectedDrumKitId as DrumKitId);
        }
        if (message.data.drumState) {
          setDrumState(message.data.drumState as DrumState);
        }
        break;
      }
      case 'drumFxUpdate': {
        if (message.data.drumFx) setDrumFx(normalizeDrumFx(message.data.drumFx));
        break;
      }
      case 'effectsLoopUpdate': {
        if (message.data.effectsLoop) setEffectsLoop(normalizeEffectsLoop(message.data.effectsLoop));
        break;
      }
      case 'connectedUsers': {
        if (Array.isArray(message.data.users)) setConnectedUsers(message.data.users);
        break;
      }
    }
  }, [synthAudio, drumAudio, triggerSynthNote, globalTempo, patternAudio]);

  const connected = useWebSocket(sessionToken ? getWebSocketUrl(sessionToken) : null, handleMessage);


  const handleRemoveSynth = useCallback(async (synthId: number) => {
    if (synthId === 1) return;
    try {
      await authFetch(`/synth/${synthId}`, { method: 'DELETE' });
      setSynths(prev => prev.filter(s => s.id !== synthId));
    } catch (error) {
      console.error('Failed to remove synth:', error);
    }
  }, []);

  const ensureSynthExists = useCallback(async (synthId: number): Promise<boolean> => {
    if (synthsRef.current.some(s => s.id === synthId)) return true;
    if (synthId < 2 || synthId > 3) return false;
    try {
      const res = await authFetch('/synth/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setSynths(prev => {
        if (prev.some(s => s.id === synthId)) return prev;
        return [...prev, {
          id: synthId,
          pattern: data.pattern,
          patterns: data.patterns || [],
          synthParams: normalizeSynthParams(data.synthParams),
          synthModelId: normalizeSynthModelId(data.synthModelId),
          synthModelParams: normalizeSynthModelParams(data.synthModelParams),
          isPlaying: Boolean(data.isPlaying),
          currentStep: 0,
          selectedStep: null,
          keyboardMode: 'keyboard',
          stepRecordPointer: 0,
          octaveShift: 0,
          muted: Boolean(data.muted),
          solo: Boolean(data.solo),
          forceReleaseSignal: false,
        }];
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleOctaveShift = useCallback((synthId: number, direction: 'up' | 'down') => {
    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const newShift = direction === 'up'
        ? Math.min(s.octaveShift + 1, 2)
        : Math.max(s.octaveShift - 1, -2);
      return { ...s, octaveShift: newShift };
    }));
  }, []);

  const handleTempoChange = useCallback(async (bpm: number) => {
    const firstSynth = synthsRef.current[0];
    if (firstSynth?.pattern) pushHistorySnapshot(firstSynth.id, firstSynth.pattern.id);
    setGlobalTempo(bpm);
    setSynths(prev => prev.map(s =>
      s.pattern ? { ...s, pattern: { ...s.pattern, tempo: bpm } } : s
    ));

    await authFetch('/tempo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: bpm }),
    });
  }, [pushHistorySnapshot]);

  const handleGlobalPlayStop = useCallback(async () => {
    const currentSynths = synthsRef.current;
    const isAnyPlaying = currentSynths.some(s => s.isPlaying);
    const playableSynths = currentSynths.filter(s => s.pattern);

    if (!isAnyPlaying) {
      await Promise.all([
        synthAudio.ensureAudioReady(),
        drumAudio.ensureAudioReady(),
        patternAudio.ensureAudioReady(),
      ]);
      const playResponses = await Promise.all(playableSynths.map(async (s) => {
        const response = await authFetch('/sequencer/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthId: s.id, patternId: s.pattern!.id }),
        });
        let patternAudioPayload: PatternAudioPayload | null = null;
        try {
          const data = await response.json() as { patternAudio?: { audio?: string; sampleRate?: number } };
          if (typeof data.patternAudio?.audio === 'string' && data.patternAudio.audio.length > 0) {
            patternAudioPayload = {
              audio: data.patternAudio.audio,
              sampleRate: typeof data.patternAudio.sampleRate === 'number' && Number.isFinite(data.patternAudio.sampleRate)
                ? data.patternAudio.sampleRate
                : 48000,
            };
          }
        } catch {
          // ignore
        }
        return { synthId: s.id, ok: response.ok, patternAudioPayload };
      }));

      const startedSynthIds = playResponses.filter((entry) => entry.ok).map((entry) => entry.synthId);
      if (startedSynthIds.length > 0) {
        setSynths(prev => prev.map(s => (
          startedSynthIds.includes(s.id)
            ? { ...s, isPlaying: true, currentStep: 0 }
            : s
        )));
      }
      const latestPayload = [...playResponses].reverse().find((entry) => entry.patternAudioPayload)?.patternAudioPayload;
      if (latestPayload) {
        lastPatternAudioRef.current = latestPayload;
        void patternAudio.playLoop(latestPayload, browserMutedRef.current);
      }
      return;
    }

    const playingSynthIds = currentSynths.filter(s => s.isPlaying).map((s) => s.id);
    await Promise.all(currentSynths.filter(s => s.isPlaying).map(s =>
      authFetch('/sequencer/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId: s.id }),
      })
    ));
    if (playingSynthIds.length > 0) {
      setSynths(prev => prev.map(s => (
        playingSynthIds.includes(s.id)
          ? { ...s, isPlaying: false, currentStep: 0, forceReleaseSignal: !s.forceReleaseSignal }
          : s
      )));
    }
    arpTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    arpTimeoutsRef.current = [];
    patternAudio.stop();
    lastPatternAudioRef.current = null;
    synthAudio.stopAllNotes();
  }, [synthAudio, drumAudio, patternAudio]);

  const clearActiveSavedPattern = useCallback(() => {
    setActiveSavedPattern(null);
  }, []);

  const handlePatternChange = useCallback(async (synthId: number, pattern: Pattern) => {
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern } : s
    ));
    activeHistoryKeyRef.current = getHistoryKey(synthId, pattern.id);
    clearActiveSavedPattern();
  }, [clearActiveSavedPattern, getHistoryKey]);

  const handleStepChange = useCallback(async (synthId: number, stepIndex: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    const pattern = synth?.pattern;
    if (!synth || !pattern) return;

    const sameSelectedStep = synth.selectedStep === stepIndex;
    const step = pattern.steps[stepIndex];

    if (sameSelectedStep && step?.note) {
      pushHistorySnapshot(synthId, pattern.id);
      const updatedPattern = {
        ...pattern,
        steps: pattern.steps.map((s, i) => (
          i === stepIndex ? { ...s, note: undefined, active: false } : s
        )),
      };

      setSynths(prev => prev.map(s => (
        s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: null } : s
      )));
      clearActiveSavedPattern();

      await authFetch(`/synth/${synthId}/patterns/${pattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPattern),
      });
      return;
    }

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      return { ...s, selectedStep: s.selectedStep === stepIndex ? null : stepIndex };
    }));
  }, [clearActiveSavedPattern, pushHistorySnapshot]);

  const handleKeyboardModeChange = useCallback((synthId: number, mode: 'keyboard' | 'piano-roll') => {
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, keyboardMode: mode } : s
    )));
  }, []);

  const handlePianoRollNoteAssign = useCallback(async (synthId: number, stepIndex: number, note?: string) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    pushHistorySnapshot(synthId, synth.pattern.id);

    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => (
        idx === stepIndex ? { ...step, note, active: Boolean(note) } : step
      )),
    };

    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: stepIndex } : s
    )));
    clearActiveSavedPattern();

    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  }, [clearActiveSavedPattern, pushHistorySnapshot]);

  const handleClearPatternNotes = useCallback(async (synthId: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    pushHistorySnapshot(synthId, synth.pattern.id);
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step) => ({ ...step, note: undefined, active: false })),
    };
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: null } : s
    )));
    clearActiveSavedPattern();
    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  }, [clearActiveSavedPattern, pushHistorySnapshot]);

  const upsertStepNote = useCallback(async (synthId: number, stepIndex: number, note: string, velocity: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    pushHistorySnapshot(synthId, synth.pattern.id);

    const boundedVelocity = Math.max(0, Math.min(1, velocity));
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => (
        idx === stepIndex ? { ...step, note, active: true, velocity: boundedVelocity } : step
      )),
    };

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextPointer = (stepIndex + 1) % updatedPattern.steps.length;
      return { ...s, pattern: updatedPattern, selectedStep: stepIndex, stepRecordPointer: nextPointer };
    }));
    clearActiveSavedPattern();

    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  }, [clearActiveSavedPattern, pushHistorySnapshot]);

  const handleNotePlay = useCallback(async (synthId: number, note: string) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.synthParams) return;

    await synthAudio.ensureAudioReady();
    triggerSynthNote(synth.synthParams, note, 60 / globalTempo, 1);

    const step = synth.selectedStep;
    const pattern = synth.pattern;
    if (step === null || !pattern) return;
    pushHistorySnapshot(synthId, pattern.id);

    const updated = {
      ...pattern,
      steps: pattern.steps.map((s, i) => i === step ? { ...s, note, active: true } : s),
    };

    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern: updated } : s
    ));
    clearActiveSavedPattern();

    await authFetch(`/synth/${synthId}/patterns/${pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  }, [synthAudio, triggerSynthNote, globalTempo, pushHistorySnapshot, clearActiveSavedPattern]);

  const handleNoteRelease = useCallback(async (synthId: number, note: string) => {
    const synthParams = synthsRef.current.find(s => s.id === synthId)?.synthParams;
    if (!synthParams) return;
    synthAudio.stopNote(note, synthParams);
  }, [synthAudio]);

  const handleMidiMessage = useCallback((message: MidiMessage) => {
    if (message.channel !== midiChannelRef.current) return;

    const synthSnapshot = synthsRef.current;
    const targetSynth = synthSnapshot.find(s => s.id === midiTargetSynthIdRef.current) ?? synthSnapshot[0];
    if (!targetSynth) return;
    if (message.type === 'controlChange') return;
    const noteName = midiNoteToName(message.note);

    if (message.type === 'noteOff') {
      void handleNoteRelease(targetSynth.id, noteName);
      return;
    }
    if (message.type !== 'noteOn') return;

    const velocity = message.velocity / 127;
    const mode = midiModeRef.current;

    if (mode === 'live') {
      if (targetSynth.synthParams) triggerSynthNote(targetSynth.synthParams, noteName, 60 / globalTempo, velocity);
      return;
    }

    const pattern = targetSynth.pattern;
    if (!pattern || pattern.steps.length === 0) return;

    if (mode === 'record') {
      if (!targetSynth.isPlaying) return;
      const stepIndex = targetSynth.currentStep % pattern.steps.length;
      void upsertStepNote(targetSynth.id, stepIndex, noteName, velocity);
      return;
    }

    const stepIndex = targetSynth.stepRecordPointer % pattern.steps.length;
    void upsertStepNote(targetSynth.id, stepIndex, noteName, velocity);
  }, [handleNoteRelease, upsertStepNote, triggerSynthNote, globalTempo]);

  const midiState = useMidiInput({ onMessage: handleMidiMessage });

  const handleParameterChange = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (synth?.pattern) pushHistorySnapshotThrottled(synthId, synth.pattern.id, `synth-params-${synthId}`);
    await authFetch(`/synth/${synthId}/parameters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleSynthModelChange = useCallback(async (
    synthId: number,
    modelId: SynthModelId,
    modelParams?: Partial<SynthModelParams>
  ) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth) return;
    if (synth.pattern) pushHistorySnapshot(synthId, synth.pattern.id);
    const normalizedModelId = normalizeSynthModelId(modelId);
    const normalizedModelParams = normalizeSynthModelParams({
      ...synth.synthModelParams,
      ...modelParams,
    });
    clearActiveSavedPattern();
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId
        ? {
          ...entry,
          synthModelId: normalizedModelId,
          synthModelParams: normalizedModelParams,
        }
        : entry
    )));
    await authFetch(`/synth/${synthId}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: normalizedModelId,
        modelParams: normalizedModelParams,
      }),
    });
    const mapped = mapSynthModelToEngineParams(normalizedModelId, normalizedModelParams);
    if (Object.keys(mapped).length > 0) {
      await authFetch(`/synth/${synthId}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapped),
      });
    }
  }, [pushHistorySnapshot, clearActiveSavedPattern]);

  const handleStepCountChange = useCallback(async (synthId: number, stepCount: 16 | 32) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    if (synth.pattern.steps.length === stepCount) return;
    pushHistorySnapshot(synthId, synth.pattern.id);

    const nextSteps = Array.from({ length: stepCount }, (_, i) => (
      synth.pattern!.steps[i]
        ? { ...synth.pattern!.steps[i] }
        : { active: false, velocity: 0.7 as const }
    ));
    const nextPattern = { ...synth.pattern, steps: nextSteps };

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextSelectedStep = s.selectedStep !== null && s.selectedStep >= stepCount ? null : s.selectedStep;
      return {
        ...s,
        pattern: nextPattern,
        selectedStep: nextSelectedStep,
        currentStep: s.currentStep % stepCount,
      };
    }));
    clearActiveSavedPattern();

    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPattern),
    });
  }, [clearActiveSavedPattern, pushHistorySnapshot]);

  const handleStepVelocityChange = useCallback(async (synthId: number, stepIndex: number, velocity: number) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    pushHistorySnapshot(synthId, synth.pattern.id);
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (
        index === stepIndex ? { ...step, velocity: normalizedVelocity } : step
      )),
    };
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId ? { ...entry, pattern: nextPattern } : entry
    )));
    clearActiveSavedPattern();
    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPattern),
    });
  }, [pushHistorySnapshot, clearActiveSavedPattern]);

  const handleSynthMixChange = useCallback(async (synthId: number, mix: { muted?: boolean; solo?: boolean }) => {
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, ...mix } : s
    ));
    await authFetch(`/synth/${synthId}/mix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mix),
    });
  }, []);

  const handleSavePattern = useCallback(async (synthId: number, name: string): Promise<boolean> => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern || !synth.synthParams) return false;
    const pattern = synth.pattern;
    const synthParams = synth.synthParams;

    const allSynthsData: SavedSynthData[] = synthsRef.current
      .filter((s): s is typeof s & { pattern: NonNullable<typeof s.pattern>; synthParams: NonNullable<typeof s.synthParams> } => Boolean(s.pattern && s.synthParams))
      .map((s) => ({
        id: s.id,
        steps: s.pattern.steps,
        synthParams: s.synthParams,
        synthModelId: s.synthModelId,
        synthModelParams: s.synthModelParams,
      }));

    const saveRequest = async (overwriteId?: string) => authFetch('/patterns/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        overwriteId,
        synthId,
        steps: pattern.steps,
        synthParams,
        synthModelId: synth.synthModelId,
        synthModelParams: synth.synthModelParams,
        tempo: pattern.tempo,
        drumState: drumStateRef.current,
        drumKitId: selectedDrumKitIdRef.current,
        drumMasterVolume,
        drumFx: drumFxRef.current,
        effectsLoop: effectsLoopRef.current,
        synths: allSynthsData,
      }),
    });

    try {
      let response = await saveRequest();
      if (response.status === 409) {
        const conflict = await response.json().catch(() => null);
        const conflictName = conflict?.name || name;
        const shouldOverwrite = window.confirm(`Pattern "${conflictName}" already exists. Overwrite it?`);
        if (!shouldOverwrite) return false;
        response = await saveRequest(conflict?.id);
      }
      if (!response.ok) return false;
      const saved = await response.json();
      if (saved?.id && saved?.name) {
        setActiveSavedPattern({ id: saved.id, name: saved.name });
      }
      return true;
    } catch (error) {
      console.error('Pattern save error:', error);
      return false;
    }
  }, [drumMasterVolume]);

  const refreshSavedPatterns = useCallback(async () => {
    setLoadingSavedPatterns(true);
    try {
      const res = await authFetch('/patterns/saved');
      if (res.ok) {
        const data: SavedPatternInfo[] = await res.json();
        setSavedPatterns(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSavedPatterns(false);
    }
  }, []);

  const handleSaveSynthPreset = useCallback((synthId: number, name: string) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.synthParams) return;
    const presetName = name.trim();
    if (!presetName) return;
    const userPreset: SynthPreset = {
      id: `user-${Date.now()}`,
      name: presetName,
      params: cloneSynthParams(synth.synthParams) || cloneSynthParams(DEFAULT_PARAMS)!,
      modelId: synth.synthModelId,
      modelParams: cloneSynthModelParams(synth.synthModelParams),
    };
    setSynthPresets((prev) => [...prev, userPreset]);
  }, []);

  const handleLoadSynthPreset = useCallback(async (synthId: number, presetId: string) => {
    const preset = synthPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    await handleSynthModelChange(synthId, preset.modelId, preset.modelParams);
    await handleParameterChange(synthId, cloneSynthParams(preset.params) || DEFAULT_PARAMS);
  }, [synthPresets, handleParameterChange, handleSynthModelChange]);

  const handleDeleteSynthPreset = useCallback((presetId: string) => {
    setSynthPresets((prev) => prev.filter((preset) => preset.id !== presetId || preset.builtIn));
  }, []);

  const handleExportMidi = useCallback(() => {
    const synthLanes = synthsRef.current
      .filter((entry) => entry.pattern)
      .map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!) }));
    downloadMidiFile(
      {
        tempo: globalTempo,
        synthLanes,
        drumState: cloneDrumState(drumStateRef.current),
      },
      `discobot-${Date.now()}.mid`
    );
  }, [globalTempo]);

  const midiImportFileRef = useRef<HTMLInputElement>(null);
  const [midiImportData, setMidiImportData] = useState<MidiImportResult | null>(null);
  const [midiImportAssignments, setMidiImportAssignments] = useState<Record<number, number | null>>({});

  const handleMidiImportClick = useCallback(() => {
    midiImportFileRef.current?.click();
  }, []);

  const handleMidiImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const result = importMidiFile(buffer);
      if (result.patterns.length === 0) {
        alert('No note tracks found in MIDI file.');
        return;
      }
      const autoAssign: Record<number, number | null> = {};
      const synthIds = [1, 2, 3];
      result.trackNames.forEach((_, i) => {
        autoAssign[i] = i < synthIds.length ? synthIds[i] : null;
      });
      setMidiImportAssignments(autoAssign);
      setMidiImportData(result);
    } catch (err) {
      alert(`Failed to import MIDI: ${err instanceof Error ? err.message : err}`);
    }
    e.target.value = '';
  }, []);

  const handleMidiImportApplyAll = useCallback(async () => {
    if (!midiImportData) return;
    const tempo = midiImportData.detectedTempo;
    setGlobalTempo(tempo);
    void authFetch('/tempo', {
      method: 'PUT',
      body: JSON.stringify({ tempo }),
    });

    for (const [trackIdx, synthId] of Object.entries(midiImportAssignments)) {
      if (synthId === null || synthId === undefined) continue;
      const idx = Number(trackIdx);
      const pattern = midiImportData.patterns[idx];
      if (!pattern) continue;
      const exists = synthsRef.current.some(s => s.id === synthId);
      if (!exists) {
        await ensureSynthExists(synthId);
      }
      setSynths(prev => prev.map(s =>
        s.id === synthId ? { ...s, pattern } : s
      ));
      void authFetch(`/synth/${synthId}/patterns/${pattern.id}`, {
        method: 'PUT',
        body: JSON.stringify(pattern),
      });
    }
    setMidiImportData(null);
    setMidiImportAssignments({});
  }, [midiImportData, midiImportAssignments, ensureSynthExists]);

  const handleSaveGlobal = useCallback(async (name: string): Promise<boolean> => {
    const firstSynth = synthsRef.current[0];
    if (!firstSynth?.pattern || !firstSynth.synthParams) return false;

    const saved = await handleSavePattern(firstSynth.id, name);
    if (saved) await refreshSavedPatterns();
    return saved;
  }, [handleSavePattern, refreshSavedPatterns]);

  useEffect(() => {
    if (!sessionToken) return;
    void refreshSavedPatterns();
  }, [sessionToken, refreshSavedPatterns]);

  useEffect(() => {
    if (!sessionToken) return;
    const fetchDrumKits = async () => {
      setDrumKitsLoading(true);
      setDrumKitsError(null);
      try {
        const res = await authFetch('/drum/kits');
        if (!res.ok) {
          setDrumKitsError('Unable to load drum kits.');
          return;
        }
        const data = await res.json();
        if (Array.isArray(data.kits)) {
          setDrumKits(data.kits);
          const hasSelected = data.kits.some((kit: DrumKitDefinition) => kit.id === selectedDrumKitIdRef.current);
          if (!hasSelected && data.defaultKitId) {
            setSelectedDrumKitId(data.defaultKitId as DrumKitId);
          }
        }
      } catch {
        setDrumKitsError('Unable to load drum kits.');
      } finally {
        setDrumKitsLoading(false);
      }
    };
    void fetchDrumKits();
  }, [sessionToken]);

  const handleLoadSavedPattern = useCallback(async (
    synthId: number,
    data: SavedPatternFull,
    meta?: { id: string; name: string }
  ) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const updated = { ...synth.pattern, steps: data.steps, tempo: data.tempo };
    const historyKey = getHistoryKey(synthId, updated.id);
    historyRef.current[historyKey] = { undo: [], redo: [] };
    activeHistoryKeyRef.current = historyKey;
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern: updated, selectedStep: null } : s
    ));

    if (data.drumKitId) {
      setSelectedDrumKitId(data.drumKitId);
      await authFetch('/drum/kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kitId: data.drumKitId, applyDefaults: false }),
      });
    }
    if (data.drumState) {
      setDrumState(data.drumState);
      await authFetch('/drum/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.drumState }),
      });
    }
    if (data.drumMasterVolume !== undefined) {
      setDrumMasterVolume(data.drumMasterVolume);
      await authFetch('/drum/master-volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: data.drumMasterVolume }),
      });
    }
    if (data.drumSwing !== undefined) {
      setDrumSwing(data.drumSwing);
      await authFetch('/drum/swing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swing: data.drumSwing }),
      });
    }
    if (data.drumFx) {
      const nextDrumFx = normalizeDrumFx(data.drumFx);
      setDrumFx(nextDrumFx);
      await authFetch('/drum/fx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextDrumFx),
      });
    }
    if (data.effectsLoop) {
      const nextEffectsLoop = normalizeEffectsLoop(data.effectsLoop);
      setEffectsLoop(nextEffectsLoop);
      await authFetch('/effects-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextEffectsLoop),
      });
    }
    const nextModelId = normalizeSynthModelId(data.synthModelId);
    const nextModelParams = normalizeSynthModelParams(data.synthModelParams);
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId
        ? {
          ...entry,
          synthModelId: nextModelId,
          synthModelParams: nextModelParams,
        }
        : entry
    )));
    await authFetch(`/synth/${synthId}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: nextModelId,
        modelParams: nextModelParams,
      }),
    });
    if (data.synthParams) {
      await authFetch(`/synth/${synthId}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizeSynthParams(data.synthParams)),
      });
    }
    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (meta?.id && meta?.name) {
      setActiveSavedPattern({ id: meta.id, name: meta.name });
    } else {
      setActiveSavedPattern(null);
    }
  }, [getHistoryKey]);

  const loadSynthFromSavedData = useCallback(async (synthId: number, saved: { steps: SavedPatternFull['steps']; synthParams?: SynthParameters | null; synthModelId?: SynthModelId; synthModelParams?: SynthModelParams; tempo?: number }) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const tempo = saved.tempo || synth.pattern.tempo;
    const updated = { ...synth.pattern, steps: saved.steps, tempo };
    const historyKey = getHistoryKey(synthId, updated.id);
    historyRef.current[historyKey] = { undo: [], redo: [] };
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern: updated, selectedStep: null } : s
    ));
    const nextModelId = normalizeSynthModelId(saved.synthModelId);
    const nextModelParams = normalizeSynthModelParams(saved.synthModelParams);
    setSynths(prev => prev.map(entry =>
      entry.id === synthId ? { ...entry, synthModelId: nextModelId, synthModelParams: nextModelParams } : entry
    ));
    await authFetch(`/synth/${synthId}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: nextModelId, modelParams: nextModelParams }),
    });
    if (saved.synthParams) {
      await authFetch(`/synth/${synthId}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizeSynthParams(saved.synthParams)),
      });
    }
    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  }, [getHistoryKey]);

  const handleLoadGlobal = useCallback(async (savedId: string) => {
    const targetSynthId = synthsRef.current[0]?.id;
    if (!targetSynthId) return;
    try {
      const res = await authFetch(`/patterns/saved/${savedId}`);
      if (!res.ok) return;
      const data: SavedPatternFull = await res.json();
      await handleLoadSavedPattern(targetSynthId, data, { id: savedId, name: data.name });

      if (Array.isArray(data.synths)) {
        for (const savedSynth of data.synths) {
          if (savedSynth.id === targetSynthId) continue;
          const exists = synthsRef.current.some(s => s.id === savedSynth.id);
          if (!exists) {
            await ensureSynthExists(savedSynth.id);
          }
          await loadSynthFromSavedData(savedSynth.id, savedSynth);
        }
      }
    } catch {
      // ignore
    }
  }, [handleLoadSavedPattern, ensureSynthExists, loadSynthFromSavedData]);

  const handleDrumKitChange = useCallback(async (kitId: DrumKitId, applyDefaults: boolean): Promise<DrumState | undefined> => {
    setSelectedDrumKitId(kitId);
    try {
      const res = await authFetch('/drum/kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kitId, applyDefaults }),
      });
      if (!res.ok) return undefined;
      const data = await res.json();
      if (data.selectedDrumKitId) setSelectedDrumKitId(data.selectedDrumKitId as DrumKitId);
      if (data.drumState) {
        setDrumState(data.drumState);
        return data.drumState as DrumState;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }, []);

  const handleDrumStepToggle = useCallback((instrument: DrumInstrument, step: number, active: boolean) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], steps: [...next[instrument].steps] };
      next[instrument].steps[step] = active;
      return next;
    });
    authFetch('/drum/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, step, active }),
    });
  }, [pushHistorySnapshot]);

  const handleDrumStepVelocity = useCallback((instrument: DrumInstrument, step: number, velocity: number) => {
    setDrumState(prev => {
      const next = { ...prev };
      const track = next[instrument];
      next[instrument] = { ...track, stepVelocities: [...(track.stepVelocities || new Array(16).fill(1))] };
      next[instrument].stepVelocities![step] = velocity;
      return next;
    });
    authFetch('/drum/step-velocity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, step, velocity }),
    });
  }, []);

  const handleDrumSettingsChange = useCallback((instrument: DrumInstrument, settings: Partial<DrumSettings>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) {
      pushHistorySnapshotThrottled(synth.id, synth.pattern.id, `drum-settings-${instrument}`, 300);
    }
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], settings: { ...next[instrument].settings, ...settings } };
      return next;
    });
    authFetch('/drum/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, settings }),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleDrumMixChange = useCallback((instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], ...mix };
      return next;
    });
    authFetch('/drum/mix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, ...mix }),
    });
  }, [pushHistorySnapshot]);

  const handleDrumReset = useCallback(() => {
    setDrumState(createDefaultDrumState());
    authFetch('/drum/reset', { method: 'POST' });
  }, []);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'drum-master-volume', 300);
    setDrumMasterVolume(volume);
    authFetch('/drum/master-volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    });
    }, [pushHistorySnapshotThrottled]);

  const handleDrumSwingChange = useCallback((swing: number) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'drum-swing', 300);
    setDrumSwing(swing);
    authFetch('/drum/swing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swing }),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleDrumFxChange = useCallback((next: Partial<{ sends: Partial<FxSendLevels>; returnLevel: number }>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'drum-fx', 300);
    const previous = drumFxRef.current;
    const updated = normalizeDrumFx({
      sends: { ...previous.sends, ...(next.sends || {}) },
      returnLevel: next.returnLevel ?? previous.returnLevel,
    });
    setDrumFx(updated);
    void (async () => {
      try {
        const res = await authFetch('/drum/fx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (!res.ok) {
          setDrumFx(previous);
          return;
        }
        const data = await res.json();
        if (data.drumFx) {
          setDrumFx(normalizeDrumFx(data.drumFx));
        }
      } catch {
        setDrumFx(previous);
      }
    })();
  }, [pushHistorySnapshotThrottled]);

  const handleEffectsLoopChange = useCallback((next: Partial<EffectsLoopState>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'effects-loop', 300);
    const previous = effectsLoopRef.current;
    const updated = normalizeEffectsLoop({
      ...previous,
      ...next,
    });
    setEffectsLoop(updated);
    void (async () => {
      try {
        const res = await authFetch('/effects-loop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (!res.ok) {
          setEffectsLoop(previous);
          return;
        }
        const data = await res.json();
        if (data.effectsLoop) {
          setEffectsLoop(normalizeEffectsLoop(data.effectsLoop));
        }
      } catch {
        setEffectsLoop(previous);
      }
    })();
  }, [pushHistorySnapshotThrottled]);

  const handleDrumEffectsReturnChange = useCallback((value: number) => {
    handleEffectsLoopChange({
      returns: {
        ...effectsLoopRef.current.returns,
        drums: value,
      },
    });
  }, [handleEffectsLoopChange]);

  const handleDrumMuteAll = useCallback((muted: boolean) => {
    const nextState = Object.fromEntries(
      (Object.keys(drumStateRef.current) as DrumInstrument[]).map(inst => [
        inst,
        { ...drumStateRef.current[inst], muted },
      ])
    ) as DrumState;
    setDrumState(nextState);
    authFetch('/drum/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: nextState }),
    });
  }, []);

  const handleDrumSoloAll = useCallback(() => {
    const nextState = Object.fromEntries(
      (Object.keys(drumStateRef.current) as DrumInstrument[]).map(inst => [
        inst,
        { ...drumStateRef.current[inst], solo: false },
      ])
    ) as DrumState;
    setDrumState(nextState);
    authFetch('/drum/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: nextState }),
    });
  }, []);

  const handleReset = useCallback(async () => {
    arpTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    arpTimeoutsRef.current = [];
    const currentSynths = synthsRef.current;
    for (const synth of currentSynths) {
      await authFetch(`/synth/${synth.id}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
      });
      await authFetch(`/synth/${synth.id}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: DEFAULT_SYNTH_MODEL_ID,
          modelParams: createDefaultSynthModelParams(),
        }),
      });
      await authFetch(`/synth/${synth.id}/mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: false, solo: false }),
      });
      if (synth.pattern) {
        const cleared = {
          ...synth.pattern,
          steps: synth.pattern.steps.map(s => ({ ...s, active: false, note: undefined })),
        };
        await authFetch(`/synth/${synth.id}/patterns/${synth.pattern.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleared),
        });
      }
      if (synth.isPlaying) {
        await authFetch('/sequencer/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthId: synth.id }),
        });
      }
    }
    setSynths(prev => prev.map(s => ({
      ...s,
      pattern: s.pattern ? {
        ...s.pattern,
        steps: s.pattern.steps.map(st => ({ ...st, active: false, note: undefined })),
      } : null,
      synthParams: DEFAULT_PARAMS,
      synthModelId: DEFAULT_SYNTH_MODEL_ID,
      synthModelParams: createDefaultSynthModelParams(),
      isPlaying: false,
      currentStep: 0,
      selectedStep: null,
      stepRecordPointer: 0,
      muted: false,
      solo: false,
      forceReleaseSignal: !s.forceReleaseSignal,
    })));
    setDrumFx(DEFAULT_DRUM_FX);
    void authFetch('/drum/fx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_DRUM_FX),
    });
    setEffectsLoop(DEFAULT_EFFECTS_LOOP);
    void authFetch('/effects-loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_EFFECTS_LOOP),
    });
    setActiveSavedPattern(null);
    handleDrumReset();
  }, [handleDrumReset]);

  const memoizedDrumState = useMemo(() => drumState, [drumState]);

  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [savedPatterns, setSavedPatterns] = useState<SavedPatternInfo[]>([]);
  const [loadingSavedPatterns, setLoadingSavedPatterns] = useState(false);
  const isAnyPlaying = synths.some(s => s.isPlaying);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title-wrap">
          <h1>Discobot</h1>
          {activeSavedPattern && (
            <span className="active-pattern-name" title={activeSavedPattern.name}>
              {activeSavedPattern.name}
            </span>
          )}
        </div>
        <div className="header-controls">
          <div className="header-primary-controls">
            <TempoDisplay tempo={globalTempo} onChange={handleTempoChange} />
            <button className="play-all-button" onClick={handleGlobalPlayStop}>
              {isAnyPlaying ? '⏹ Stop All' : '▶ Play All'}
            </button>
            <SavePattern
              saving={saving}
              setSaving={setSaving}
              saveName={saveName}
              setSaveName={setSaveName}
              savedFeedback={savedFeedback}
              setSavedFeedback={setSavedFeedback}
              onSave={handleSaveGlobal}
            />
            <LoadPattern
              loading={loadingSavedPatterns}
              savedPatterns={savedPatterns}
              onLoad={(id) => { void handleLoadGlobal(id); }}
              onRefresh={() => { void refreshSavedPatterns(); }}
            />
          </div>
          <div className="header-secondary-controls">
            <MidiPanel
              supported={midiState.supported}
              connected={midiState.connected}
              devices={midiState.devices}
              allDevicesId={midiState.allDevicesId}
              selectedDeviceId={midiState.selectedDeviceId}
              onDeviceChange={midiState.setSelectedDeviceId}
              mode={midiMode}
              onModeChange={setMidiMode}
              channel={midiChannel}
              onChannelChange={setMidiChannel}
              synthIds={synths.map((s) => s.id)}
              targetSynthId={midiTargetSynthId}
              onTargetSynthChange={setMidiTargetSynthId}
              lastMessage={midiState.lastMessage}
              error={midiState.error}
            />
            <button className="help-button" onClick={() => setHelpOpen(true)} title="How to use Discobot">
              Help
            </button>
            <button className="header-secondary-button" onClick={() => { void handleUndo(); }} title="Undo (Ctrl/Cmd+Z)">
              Undo
            </button>
            <button className="header-secondary-button" onClick={() => { void handleRedo(); }} title="Redo (Ctrl/Cmd+Shift+Z)">
              Redo
            </button>
            <button className="header-secondary-button" onClick={handleExportMidi} title="Export MIDI (.mid)">
              Export MIDI
            </button>
            <button
              className="header-secondary-button"
              onClick={() => {
                const url = new URL('/export/wav', window.location.origin);
                window.open(url.toString(), '_blank');
              }}
              title="Download pattern as WAV audio"
            >
              Download WAV
            </button>
            <button className="header-secondary-button" onClick={handleMidiImportClick} title="Import MIDI file">
              Import MIDI
            </button>
            <input
              ref={midiImportFileRef}
              type="file"
              accept=".mid,.midi"
              style={{ display: 'none' }}
              onChange={handleMidiImportFile}
            />
            <button className="reset-button" onClick={handleReset} title="Reset all synths and drums">
              &#8634;
            </button>
            <button
              className={`mute-button ${browserMuted ? 'muted' : ''}`}
              onClick={() => setBrowserMuted(m => !m)}
              title={browserMuted ? 'Unmute browser audio' : 'Mute browser audio'}
            >
              {browserMuted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={browserVolume}
              onChange={(e) => setBrowserVolume(Number(e.target.value))}
              title={`Volume: ${Math.round(browserVolume * 100)}%`}
              style={{
                width: '70px', accentColor: '#3b82f6', cursor: 'pointer',
                height: '18px', margin: '0',
              }}
            />
            <div className="status">
              <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`} />
              {connected ? 'Connected' : 'Disconnected'} · {sessionLabel}
              {connected && connectedUsers.length > 0 && (
                <span className="connected-users"> · {connectedUsers.join(', ')}</span>
              )}
            </div>
          </div>
        </div>
      </header>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {authError && <div className="auth-error-banner">{authError}</div>}

      <div className="app-content">
        <div className="app-main-left">
          <div className="shared-sequencer-section">
            <div className="synth-tabs">
              {[1, 2, 3].map(id => {
                const synth = synths.find(s => s.id === id);
                return (
                  <button
                    key={id}
                    className={`synth-tab ${selectedSynthId === id ? 'active' : ''}`}
                    onClick={() => setSelectedSynthId(id)}
                    disabled={!synth}
                  >
                    Synth {id}
                  </button>
                );
              })}
            </div>

            {(() => {
              const selected = synths.find(s => s.id === selectedSynthId);
              if (!selected) return null;
              return (
                <>
                  <Sequencer
                    pattern={selected.pattern}
                    patterns={selected.patterns}
                    isPlaying={selected.isPlaying}
                    currentStep={selected.currentStep}
                    selectedStep={selected.selectedStep}
                    onPatternChange={(p) => handlePatternChange(selected.id, p)}
                    onStepChange={(step) => handleStepChange(selected.id, step)}
                    onStepCountChange={(stepCount) => handleStepCountChange(selected.id, stepCount)}
                    onStepVelocityChange={(stepIndex, velocity) => { void handleStepVelocityChange(selected.id, stepIndex, velocity); }}
                    onSavePattern={(name) => handleSavePattern(selected.id, name)}
                    onLoadSavedPattern={(data, savedId) => handleLoadSavedPattern(
                      selected.id,
                      data,
                      savedId ? { id: savedId, name: data.name } : undefined
                    )}
                  />
                  <KeyboardPanel
                    mode={selected.keyboardMode}
                    onModeChange={(mode) => handleKeyboardModeChange(selected.id, mode)}
                    pattern={selected.pattern}
                    currentStep={selected.currentStep}
                    isPlaying={selected.isPlaying}
                    selectedStep={selected.selectedStep}
                    octaveShift={selected.octaveShift}
                    onOctaveShift={(dir) => handleOctaveShift(selected.id, dir)}
                    holdEnabled={Boolean(selected.synthParams?.hold)}
                    releaseSignal={selected.forceReleaseSignal}
                    onStepSelect={(step) => handleStepChange(selected.id, step)}
                    onNoteAssign={(stepIndex, note) => handlePianoRollNoteAssign(selected.id, stepIndex, note)}
                    onClearPattern={() => { void handleClearPatternNotes(selected.id); }}
                    onNotePlay={(note) => handleNotePlay(selected.id, note)}
                    onNoteRelease={(note) => handleNoteRelease(selected.id, note)}
                  />
                </>
              );
            })()}
          </div>

          <div className="synth-panels-row">
            {(() => {
              const synth = synths.find(s => s.id === selectedSynthId);
              if (!synth) return null;
              return (
                <SynthUnit
                  key={synth.id}
                  synthId={synth.id}
                  synthParams={synth.synthParams}
                  muted={synth.muted}
                  solo={synth.solo}
                  selected={true}
                  showRemoveButton={synth.id !== 1}
                  onToggleMute={() => handleSynthMixChange(synth.id, { muted: !synth.muted })}
                  onToggleSolo={() => handleSynthMixChange(synth.id, { solo: !synth.solo })}
                  onParameterChange={(params) => handleParameterChange(synth.id, params)}
                  presets={synthPresets}
                  onSavePreset={(name) => handleSaveSynthPreset(synth.id, name)}
                  onLoadPreset={(presetId) => { void handleLoadSynthPreset(synth.id, presetId); }}
                  onDeletePreset={handleDeleteSynthPreset}
                  synthModelId={synth.synthModelId}
                  synthModelParams={synth.synthModelParams}
                  onSynthModelChange={(modelId) => { void handleSynthModelChange(synth.id, modelId); }}
                  onSynthModelParamsChange={(params) => { void handleSynthModelChange(synth.id, synth.synthModelId, params); }}
                  onSelect={() => {}}
                  onRemove={synth.id !== 1 ? () => handleRemoveSynth(synth.id) : undefined}
                />
              );
            })()}
          </div>
        </div>
        <div className="app-main-right">
          <DrumMachine
            drumState={memoizedDrumState}
            isPlaying={synths.some(s => s.isPlaying)}
            currentStep={(synths[0]?.currentStep || 0) % 16}
            onStepToggle={handleDrumStepToggle}
            onSettingsChange={handleDrumSettingsChange}
            onMixChange={handleDrumMixChange}
            onReset={handleDrumReset}
            drumKits={drumKits}
            drumKitsLoading={drumKitsLoading}
            drumKitsError={drumKitsError}
            selectedDrumKitId={selectedDrumKitId}
            onDrumKitChange={handleDrumKitChange}
            drumMasterVolume={drumMasterVolume}
            onMasterVolumeChange={handleDrumMasterVolumeChange}
            drumFx={drumFx}
            onDrumFxChange={handleDrumFxChange}
            drumEffectsReturn={effectsLoop.returns.drums}
            onDrumEffectsReturnChange={handleDrumEffectsReturnChange}
            drumSwing={drumSwing}
            onDrumSwingChange={handleDrumSwingChange}
            onStepVelocityChange={handleDrumStepVelocity}
            onMuteAll={handleDrumMuteAll}
            onSoloAll={handleDrumSoloAll}
            drumAudio={drumAudio}
          />
          <EffectsPanel effectsLoop={effectsLoop} onChange={handleEffectsLoopChange} />
          <MixerPanel
            synths={synths}
            drumState={memoizedDrumState}
            drumMasterVolume={drumMasterVolume}
            effectsLoop={effectsLoop}
            onSynthGainChange={(id, gain) => handleParameterChange(id, { gain })}
            onSynthPanChange={(id, pan) => handleParameterChange(id, { pan })}
            onSynthFxReturnChange={(id, fxReturn) => handleParameterChange(id, { fxReturn })}
            onSynthMuteChange={handleSynthMixChange}
            onSynthSoloChange={(id, solo) => handleSynthMixChange(id, { solo })}
            onDrumMasterVolumeChange={handleDrumMasterVolumeChange}
            onDrumFxReturnChange={handleDrumEffectsReturnChange}
            onEffectsReturnChange={(which, value) => {
              const newReturns = { ...effectsLoop.returns, [which]: value };
              handleEffectsLoopChange({ returns: newReturns });
            }}
          />
        </div>
      </div>

      {midiImportData && (
        <div className="help-modal-overlay" onClick={() => setMidiImportData(null)} role="presentation">
          <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Import MIDI">
            <div className="help-modal-header">
              <h2>Import MIDI</h2>
              <button className="help-modal-close" onClick={() => setMidiImportData(null)}>&times;</button>
            </div>
            <div style={{ padding: '1rem', color: '#cfd6df', fontSize: '0.85rem' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                Detected tempo: <strong>{midiImportData.detectedTempo} BPM</strong> &middot;
                Step count: <strong>{midiImportData.detectedStepCount}</strong>
              </div>
              <div style={{ marginBottom: '0.5rem', color: '#9ca3af' }}>Assign each track to a synth:</div>
              {midiImportData.trackNames.map((name, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.4rem 0.6rem', marginBottom: '0.3rem',
                  border: '1px solid #4a4a4a', borderRadius: '4px', background: '#1a1a1a',
                }}>
                  <span style={{ flex: 1, color: '#cfd6df' }}>{name}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.75rem', marginRight: '0.25rem' }}>{midiImportData.trackNoteCounts[i]} notes</span>
                  <select
                    value={midiImportAssignments[i] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMidiImportAssignments(prev => ({ ...prev, [i]: val === '' ? null : Number(val) }));
                    }}
                    style={{ background: '#1a1a1a', color: '#cfd6df', border: '1px solid #4a4a4a', borderRadius: '3px', padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                  >
                    <option value="">Skip</option>
                    <option value={1}>Synth 1</option>
                    <option value={2}>Synth 2</option>
                    <option value={3}>Synth 3</option>
                  </select>
                </div>
              ))}
              <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { void handleMidiImportApplyAll(); }}
                  style={{
                    background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px',
                    padding: '0.4rem 1rem', fontSize: '0.85rem', cursor: 'pointer',
                  }}
                >
                  Apply All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
