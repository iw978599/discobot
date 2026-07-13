import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import SynthUnit from './components/SynthUnit';
import DrumMachine from './components/DrumMachine';
import EffectsPanel from './components/EffectsPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { useSynthAudio } from './hooks/useSynthAudio';
import { useDrumAudio } from './hooks/useDrumAudio';
import { getWebSocketUrl } from './config';
import { Pattern, SynthParameters, SavedPatternInfo, SavedPatternFull, DrumState, DrumInstrument, DrumSettings, DrumKitDefinition, DrumKitId, EffectsLoopState, FxSendLevels } from './types';
import { authFetch, exchangeLoginToken, fetchSessionInfo, setAuthContext } from './authClient';
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

interface SynthState {
  id: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  octaveShift: number;
  muted: boolean;
  solo: boolean;
  forceReleaseSignal: boolean;
}

function createDefaultDrumState(): DrumState {
  return {
    kick: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    snare: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    openHH: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    closedHH: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    ride: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    crash: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    snare2: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
    clap: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5 }, muted: false, solo: false },
  };
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
  return {
    ...params,
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

function TempoDisplay({ tempo, onChange }: { tempo: number; onChange: (bpm: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(tempo));
  const inputRef = useRef<HTMLInputElement>(null);

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
    <div className="tempo-led" onClick={() => setEditing(true)}>
      <span className="tempo-led-label">BPM</span>
      <span className="tempo-led-value">{String(tempo).padStart(3, ' ')}</span>
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
        <ol className="help-list">
          <li>Run <strong>/login</strong> in Discord and open the generated link.</li>
          <li>Use the sequencer grid: select a step, then click a keyboard note.</li>
          <li>Press <strong>Play All</strong> to start and <strong>Stop All</strong> to stop.</li>
          <li>Adjust synth controls, effects, and drum settings in real time.</li>
          <li>Save patterns from the header and load them from the Load dropdown.</li>
          <li>Use <strong>/join</strong> in Discord to route playback to your voice channel.</li>
        </ol>
      </div>
    </div>
  );
}

function App() {
  const synthAudio = useSynthAudio();
  const drumAudio = useDrumAudio();
  const [synths, setSynths] = useState<SynthState[]>([]);
  const [drumState, setDrumState] = useState<DrumState>(createDefaultDrumState);
  const [drumKits, setDrumKits] = useState<DrumKitDefinition[]>([]);
  const [drumKitsLoading, setDrumKitsLoading] = useState(false);
  const [drumKitsError, setDrumKitsError] = useState<string | null>(null);
  const [selectedDrumKitId, setSelectedDrumKitId] = useState<DrumKitId>(DEFAULT_DRUM_KIT_ID);
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const [drumFx, setDrumFx] = useState(DEFAULT_DRUM_FX);
  const [effectsLoop, setEffectsLoop] = useState(DEFAULT_EFFECTS_LOOP);
  const [browserMuted, setBrowserMuted] = useState(false);
  const [globalTempo, setGlobalTempo] = useState(120);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState('Unauthenticated');
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;

  const synthsRef = useRef(synths);
  synthsRef.current = synths;
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;
  const selectedDrumKitIdRef = useRef(selectedDrumKitId);
  selectedDrumKitIdRef.current = selectedDrumKitId;
  const drumFxRef = useRef(drumFx);
  drumFxRef.current = drumFx;
  const effectsLoopRef = useRef(effectsLoop);
  effectsLoopRef.current = effectsLoop;

  useEffect(() => {
    return () => {
      synthAudio.dispose();
      drumAudio.dispose();
    };
  }, []);

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

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init': {
        if (message.data.synths) {
          setSynths(message.data.synths.map((s: any) => ({
            id: s.synthId,
            pattern: s.pattern,
            patterns: s.patterns || [],
            synthParams: normalizeSynthParams(s.synthParams),
            isPlaying: s.isPlaying || false,
            currentStep: 0,
            selectedStep: null,
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
            isPlaying: false,
            currentStep: 0,
            selectedStep: null,
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
        const { synthId, pattern, synthParams } = message.data;
        setSynths(prev => {
          if (prev.some(s => s.id === synthId)) return prev;
          return [...prev, {
            id: synthId,
            pattern,
            patterns: pattern ? [pattern] : [],
            synthParams: normalizeSynthParams(synthParams),
            isPlaying: Boolean(message.data.isPlaying),
            currentStep: 0,
            selectedStep: null,
            octaveShift: 0,
            muted: Boolean(message.data.muted),
            solo: Boolean(message.data.solo),
            forceReleaseSignal: false,
          }];
        });
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
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: true } : s
        ));
        break;
      }
      case 'sequencerStop': {
        const { synthId } = message.data;
        synthAudio.stopAllNotes();
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: false, currentStep: 0, forceReleaseSignal: !s.forceReleaseSignal } : s
        ));
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
        if (canPlaySynth && targetSynth?.pattern?.steps[step]?.note) {
          synthAudio.playNote(
            targetSynth.pattern.steps[step].note!,
            targetSynth.synthParams!,
            0.15,
            browserMutedRef.current
          );
        }
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, currentStep: step } : s
        ));
        const ds = drumStateRef.current;
        if (ds && synthId === 1) {
          const hasDrumSolo = (Object.keys(ds) as DrumInstrument[]).some(inst => Boolean(ds[inst].solo));
          for (const inst of Object.keys(ds) as DrumInstrument[]) {
            const track = ds[inst];
            const canPlayDrum = !track.muted && (!hasDrumSolo || track.solo);
            if (track.steps[step] && canPlayDrum) {
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
  }, [synthAudio, drumAudio]);

  const connected = useWebSocket(sessionToken ? getWebSocketUrl(sessionToken) : null, handleMessage);

  const handleAddSynth = useCallback(async () => {
    const currentSynths = synthsRef.current;
    if (currentSynths.length >= 3) return;
    const nextSynthId = [2, 3].find(id => !currentSynths.some(s => s.id === id));
    if (!nextSynthId) return;

    try {
      const res = await authFetch('/synth/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId: nextSynthId }),
      });
      if (res.ok) {
        const data = await res.json();
        setSynths(prev => {
          if (prev.some(s => s.id === nextSynthId)) return prev;
          return [...prev, {
            id: nextSynthId,
            pattern: data.pattern,
            patterns: data.patterns || [],
            synthParams: normalizeSynthParams(data.synthParams),
            isPlaying: Boolean(data.isPlaying),
            currentStep: 0,
            selectedStep: null,
            octaveShift: 0,
            muted: Boolean(data.muted),
            solo: Boolean(data.solo),
            forceReleaseSignal: false,
          }];
        });
      }
    } catch (error) {
      console.error('Failed to add synth:', error);
    }
  }, []);

  const handleRemoveSynth = useCallback(async (synthId: number) => {
    if (synthId === 1) return;
    try {
      await authFetch(`/synth/${synthId}`, { method: 'DELETE' });
      setSynths(prev => prev.filter(s => s.id !== synthId));
    } catch (error) {
      console.error('Failed to remove synth:', error);
    }
  }, []);

  const handleOctaveShift = useCallback((synthId: number, direction: 'up' | 'down') => {
    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const newShift = direction === 'up'
        ? Math.min(s.octaveShift + 1, 1)
        : Math.max(s.octaveShift - 1, -1);
      return { ...s, octaveShift: newShift };
    }));
  }, []);

  const handleTempoChange = useCallback(async (bpm: number) => {
    setGlobalTempo(bpm);
    setSynths(prev => prev.map(s =>
      s.pattern ? { ...s, pattern: { ...s.pattern, tempo: bpm } } : s
    ));

    await authFetch('/tempo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: bpm }),
    });
  }, []);

  const handleGlobalPlayStop = useCallback(async () => {
    const currentSynths = synthsRef.current;
    const isAnyPlaying = currentSynths.some(s => s.isPlaying);
    const playableSynths = currentSynths.filter(s => s.pattern);

    if (!isAnyPlaying) {
      await Promise.all([
        synthAudio.ensureAudioReady(),
        drumAudio.ensureAudioReady(),
      ]);
      await Promise.all(playableSynths.map(s =>
        authFetch('/sequencer/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthId: s.id, patternId: s.pattern!.id }),
        })
      ));
      return;
    }

    await Promise.all(currentSynths.filter(s => s.isPlaying).map(s =>
      authFetch('/sequencer/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId: s.id }),
      })
    ));
    synthAudio.stopAllNotes();
  }, [synthAudio, drumAudio]);

  const handlePatternChange = useCallback(async (synthId: number, pattern: Pattern) => {
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern } : s
    ));
  }, []);

  const handleStepChange = useCallback(async (synthId: number, stepIndex: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    const pattern = synth?.pattern;
    if (!synth || !pattern) return;

    const sameSelectedStep = synth.selectedStep === stepIndex;
    const step = pattern.steps[stepIndex];

    if (sameSelectedStep && step?.note) {
      const updatedPattern = {
        ...pattern,
        steps: pattern.steps.map((s, i) => (
          i === stepIndex ? { ...s, note: undefined, active: false } : s
        )),
      };

      setSynths(prev => prev.map(s => (
        s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: null } : s
      )));

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
  }, []);

  const handleNotePlay = useCallback(async (synthId: number, note: string) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.synthParams) return;

    await synthAudio.ensureAudioReady();
    await synthAudio.playNote(note, synth.synthParams, undefined, browserMutedRef.current);

    const step = synth.selectedStep;
    const pattern = synth.pattern;
    if (step === null || !pattern) return;

    const updated = {
      ...pattern,
      steps: pattern.steps.map((s, i) => i === step ? { ...s, note, active: true } : s),
    };

    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern: updated } : s
    ));

    await authFetch(`/synth/${synthId}/patterns/${pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  }, [synthAudio]);

  const handleNoteRelease = useCallback(async (synthId: number, note: string) => {
    const synthParams = synthsRef.current.find(s => s.id === synthId)?.synthParams;
    if (!synthParams) return;
    synthAudio.stopNote(note, synthParams);
  }, [synthAudio]);

  const handleParameterChange = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    await authFetch(`/synth/${synthId}/parameters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }, []);

  const handleStepCountChange = useCallback(async (synthId: number, stepCount: 16 | 32) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    if (synth.pattern.steps.length === stepCount) return;

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

    await authFetch(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPattern),
    });
  }, []);

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

    try {
      const response = await authFetch('/patterns/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          synthId,
          steps: synth.pattern.steps,
          synthParams: synth.synthParams,
          tempo: synth.pattern.tempo,
          drumState: drumStateRef.current,
          drumKitId: selectedDrumKitIdRef.current,
          drumMasterVolume,
          drumFx: drumFxRef.current,
          effectsLoop: effectsLoopRef.current,
        }),
      });
      return response.ok;
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

  const handleLoadSavedPattern = useCallback(async (synthId: number, data: SavedPatternFull) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const updated = { ...synth.pattern, steps: data.steps, tempo: data.tempo };
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
  }, []);

  const handleLoadGlobal = useCallback(async (savedId: string) => {
    const targetSynthId = synthsRef.current[0]?.id;
    if (!targetSynthId) return;
    try {
      const res = await authFetch(`/patterns/saved/${savedId}`);
      if (!res.ok) return;
      const data: SavedPatternFull = await res.json();
      await handleLoadSavedPattern(targetSynthId, data);
    } catch {
      // ignore
    }
  }, [handleLoadSavedPattern]);

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
  }, []);

  const handleDrumSettingsChange = useCallback((instrument: DrumInstrument, settings: Partial<DrumSettings>) => {
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
  }, []);

  const handleDrumMixChange = useCallback((instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) => {
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
  }, []);

  const handleDrumReset = useCallback(() => {
    setDrumState(createDefaultDrumState());
    authFetch('/drum/reset', { method: 'POST' });
  }, []);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    setDrumMasterVolume(volume);
    authFetch('/drum/master-volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    });
  }, []);

  const handleDrumFxChange = useCallback((next: Partial<{ sends: Partial<FxSendLevels>; returnLevel: number }>) => {
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
  }, []);

  const handleEffectsLoopChange = useCallback((next: Partial<EffectsLoopState>) => {
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
  }, []);

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
    const currentSynths = synthsRef.current;
    for (const synth of currentSynths) {
      await authFetch(`/synth/${synth.id}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
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
      isPlaying: false,
      currentStep: 0,
      selectedStep: null,
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
        <h1>Discobot</h1>
        <div className="header-controls">
          <TempoDisplay tempo={globalTempo} onChange={handleTempoChange} />
          <button className="help-button" onClick={() => setHelpOpen(true)} title="How to use Discobot">
            Help
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
          <button className="play-all-button" onClick={handleGlobalPlayStop}>
            {isAnyPlaying ? '⏹ Stop All' : '▶ Play All'}
          </button>

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
          <div className="status">
            <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? 'Connected' : 'Disconnected'} · {sessionLabel}
            {connectedUsers.length > 0 && (
              <span className="connected-users"> · {connectedUsers.join(', ')}</span>
            )}
          </div>
        </div>
      </header>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      {authError && <div className="auth-error-banner">{authError}</div>}

      <div className="app-content">
        <div className="app-main-left">
          <div className={`synth-units-container ${synths.length > 1 ? 'multi' : 'single'}`}>
            {synths.map(synth => (
              <SynthUnit
                key={synth.id}
                synthId={synth.id}
                pattern={synth.pattern}
                patterns={synth.patterns}
                synthParams={synth.synthParams}
                isPlaying={synth.isPlaying}
                currentStep={synth.currentStep}
                selectedStep={synth.selectedStep}
                octaveShift={synth.octaveShift}
                muted={synth.muted}
                solo={synth.solo}
                forceReleaseSignal={synth.forceReleaseSignal}
                showRemoveButton={synth.id !== 1}
                onToggleMute={() => handleSynthMixChange(synth.id, { muted: !synth.muted })}
                onToggleSolo={() => handleSynthMixChange(synth.id, { solo: !synth.solo })}
                onPatternChange={(p) => handlePatternChange(synth.id, p)}
                onStepChange={(step) => handleStepChange(synth.id, step)}
                onStepCountChange={(stepCount) => handleStepCountChange(synth.id, stepCount)}
                onSavePattern={(name) => handleSavePattern(synth.id, name)}
                onLoadSavedPattern={(data) => handleLoadSavedPattern(synth.id, data)}
                onParameterChange={(params) => handleParameterChange(synth.id, params)}
                onOctaveShift={(dir) => handleOctaveShift(synth.id, dir)}
                onRemove={synth.id !== 1 ? () => handleRemoveSynth(synth.id) : undefined}
                onPlayNote={(note) => handleNotePlay(synth.id, note)}
                onNoteRelease={(note) => handleNoteRelease(synth.id, note)}
              />
            ))}
          </div>
          {synths.length < 3 && (
            <button className="add-synth-btn" onClick={handleAddSynth}>
              + Add Synth {[2, 3].find(id => !synths.some(s => s.id === id)) ?? 3}
            </button>
          )}
        </div>
        <div className="app-main-right">
          <EffectsPanel effectsLoop={effectsLoop} onChange={handleEffectsLoopChange} />
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
            onMuteAll={handleDrumMuteAll}
            onSoloAll={handleDrumSoloAll}
            drumAudio={drumAudio}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
