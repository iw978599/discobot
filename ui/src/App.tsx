import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import SynthUnit from './components/SynthUnit';
import DrumMachine from './components/DrumMachine';
import { useWebSocket } from './hooks/useWebSocket';
import { useSynthAudio } from './hooks/useSynthAudio';
import { useDrumAudio } from './hooks/useDrumAudio';
import { apiUrl, getWebSocketUrl } from './config';
import { Pattern, SynthParameters, SavedPatternFull, DrumState, DrumInstrument, DrumSettings } from './types';
import './App.css';

const DEFAULT_PARAMS: SynthParameters = {
  gain: 1.0,
  oscillator: { type: 'sine', detune: 0 },
  filter: { frequency: 20000, q: 1, type: 'lowpass' },
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
  effects: {
    reverb: { enabled: false, wet: 0.3, decay: 2 },
    delay: { enabled: false, wet: 0.3, time: 0.25, feedback: 0.3 },
  },
};

interface SynthState {
  id: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  octaveShift: number;
}

function createDefaultDrumState(): DrumState {
  return {
    kick: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    snare: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    openHH: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    closedHH: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    ride: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    crash: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    snare2: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    clap: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
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

function App() {
  const synthAudio = useSynthAudio();
  const drumAudio = useDrumAudio();
  const [synths, setSynths] = useState<SynthState[]>([]);
  const [drumState, setDrumState] = useState<DrumState>(createDefaultDrumState);
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const [browserMuted, setBrowserMuted] = useState(false);
  const [globalTempo, setGlobalTempo] = useState(120);
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;

  const synthsRef = useRef(synths);
  synthsRef.current = synths;
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;

  useEffect(() => {
    return () => {
      synthAudio.dispose();
      drumAudio.dispose();
    };
  }, [synthAudio, drumAudio]);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init': {
        if (message.data.synths) {
          setSynths(message.data.synths.map((s: any) => ({
            id: s.synthId,
            pattern: s.pattern,
            patterns: s.patterns || [],
            synthParams: s.synthParams,
            isPlaying: s.isPlaying || false,
            currentStep: 0,
            selectedStep: null,
            octaveShift: 0,
          })));
        } else if (message.data.synthParameters) {
          setSynths([{
            id: 1,
            pattern: message.data.patterns?.[0] || null,
            patterns: message.data.patterns || [],
            synthParams: message.data.synthParameters,
            isPlaying: false,
            currentStep: 0,
            selectedStep: null,
            octaveShift: 0,
          }]);
        }
        if (message.data.drumState) setDrumState(message.data.drumState);
        if (message.data.tempo) setGlobalTempo(message.data.tempo);
        break;
      }
      case 'synthUpdate': {
        const { synthId, parameters } = message.data;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, synthParams: parameters } : s
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
            synthParams,
            isPlaying: false,
            currentStep: 0,
            selectedStep: null,
            octaveShift: 0,
          }];
        });
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
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: false, currentStep: 0 } : s
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
        setSynths(prev => prev.map(s => {
          if (s.id !== synthId) return s;
          if (s.pattern?.steps[step]?.note) {
            synthAudio.playNote(
              s.pattern.steps[step].note!,
              s.synthParams!,
              0.15,
              browserMutedRef.current
            );
          }
          return { ...s, currentStep: step };
        }));
        const ds = drumStateRef.current;
        if (ds) {
          for (const inst of Object.keys(ds) as DrumInstrument[]) {
            if (ds[inst].steps[step]) {
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
      case 'drumReset': {
        setDrumState(createDefaultDrumState());
        break;
      }
      case 'drumFullState': {
        if (message.data.drumState) setDrumState(message.data.drumState);
        break;
      }
    }
  }, [synthAudio, drumAudio]);

  const connected = useWebSocket(getWebSocketUrl(), handleMessage);

  const handleAddSynth = useCallback(async () => {
    const currentSynths = synthsRef.current;
    if (currentSynths.length >= 2) return;

    try {
      const res = await fetch(apiUrl('/synth/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId: 2 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSynths(prev => {
          if (prev.some(s => s.id === 2)) return prev;
          return [...prev, {
            id: 2,
            pattern: data.pattern,
            patterns: data.patterns || [],
            synthParams: data.synthParams,
            isPlaying: false,
            currentStep: 0,
            selectedStep: null,
            octaveShift: 0,
          }];
        });
      }
    } catch (error) {
      console.error('Failed to add synth:', error);
    }
  }, []);

  const handleRemoveSynth = useCallback(async () => {
    try {
      await fetch(apiUrl('/synth/2'), { method: 'DELETE' });
      setSynths(prev => prev.filter(s => s.id !== 2));
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

    await fetch(apiUrl('/tempo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: bpm }),
    });
  }, []);

  const handlePlayStop = useCallback(async (synthId: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    if (!synth.isPlaying) {
      await Promise.all([
        synthAudio.ensureAudioReady(),
        drumAudio.ensureAudioReady(),
      ]);
    }

    const endpoint = synth.isPlaying ? '/sequencer/stop' : '/sequencer/play';
    const body = synth.isPlaying ? { synthId } : { synthId, patternId: synth.pattern.id };

    await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, [synthAudio, drumAudio]);

  const handlePatternChange = useCallback(async (synthId: number, pattern: Pattern) => {
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern } : s
    ));
  }, []);

  const handleStepChange = useCallback((synthId: number, stepIndex: number) => {
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

    await fetch(apiUrl(`/synth/${synthId}/patterns/${pattern.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  }, [synthAudio]);

  const handleNoteRelease = useCallback(async (synthId: number, note: string) => {
    const synthParams = synthsRef.current.find(s => s.id === synthId)?.synthParams;
    if (!synthParams) return;
    synthAudio.stopNote(note, synthParams);

    await fetch(apiUrl(`/synth/${synthId}/note-off`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
  }, [synthAudio]);

  const handleParameterChange = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    await fetch(apiUrl(`/synth/${synthId}/parameters`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }, []);

  const handleSavePattern = useCallback(async (synthId: number, name: string): Promise<boolean> => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern || !synth.synthParams) return false;

    try {
      const response = await fetch(apiUrl('/patterns/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          synthId,
          steps: synth.pattern.steps,
          synthParams: synth.synthParams,
          tempo: synth.pattern.tempo,
          drumState: drumStateRef.current,
          drumMasterVolume,
        }),
      });
      return response.ok;
    } catch (error) {
      console.error('Pattern save error:', error);
      return false;
    }
  }, [drumMasterVolume]);

  const handleSaveGlobal = useCallback(async (name: string): Promise<boolean> => {
    const firstSynth = synthsRef.current[0];
    if (!firstSynth?.pattern || !firstSynth.synthParams) return false;

    return handleSavePattern(firstSynth.id, name);
  }, [handleSavePattern]);

  const handleLoadSavedPattern = useCallback(async (synthId: number, data: SavedPatternFull) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const updated = { ...synth.pattern, steps: data.steps, tempo: data.tempo };
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern: updated, selectedStep: null } : s
    ));

    if (data.drumState) {
      setDrumState(data.drumState);
      await fetch(apiUrl('/drum/state'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.drumState }),
      });
    }
    if (data.drumMasterVolume !== undefined) {
      setDrumMasterVolume(data.drumMasterVolume);
      await fetch(apiUrl('/drum/master-volume'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: data.drumMasterVolume }),
      });
    }
    if (data.synthParams) {
      await fetch(apiUrl(`/synth/${synthId}/parameters`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.synthParams),
      });
    }
    await fetch(apiUrl(`/synth/${synthId}/patterns/${synth.pattern.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  }, []);

  const handleDrumStepToggle = useCallback((instrument: DrumInstrument, step: number, active: boolean) => {
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], steps: [...next[instrument].steps] };
      next[instrument].steps[step] = active;
      return next;
    });
    fetch(apiUrl('/drum/step'), {
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
    fetch(apiUrl('/drum/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, settings }),
    });
  }, []);

  const handleDrumReset = useCallback(() => {
    setDrumState(createDefaultDrumState());
    fetch(apiUrl('/drum/reset'), { method: 'POST' });
  }, []);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    setDrumMasterVolume(volume);
    fetch(apiUrl('/drum/master-volume'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    });
  }, []);

  const handleReset = useCallback(async () => {
    const currentSynths = synthsRef.current;
    for (const synth of currentSynths) {
      await fetch(apiUrl(`/synth/${synth.id}/parameters`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
      });
      if (synth.pattern) {
        const cleared = {
          ...synth.pattern,
          steps: synth.pattern.steps.map(s => ({ ...s, active: false, note: undefined })),
        };
        await fetch(apiUrl(`/synth/${synth.id}/patterns/${synth.pattern.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleared),
        });
      }
      if (synth.isPlaying) {
        await fetch(apiUrl('/sequencer/stop'), {
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
    })));
    handleDrumReset();
  }, [handleDrumReset]);

  const memoizedDrumState = useMemo(() => drumState, [drumState]);

  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedFeedback, setSavedFeedback] = useState(false);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Discobot</h1>
        <div className="header-controls">
          <TempoDisplay tempo={globalTempo} onChange={handleTempoChange} />
          
          <SavePattern
            saving={saving}
            setSaving={setSaving}
            saveName={saveName}
            setSaveName={setSaveName}
            savedFeedback={savedFeedback}
            setSavedFeedback={setSavedFeedback}
            onSave={handleSaveGlobal}
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
          <div className="status">
            <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </header>

      <div className="app-content">
        <div className="synth-units-container">
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
              showRemoveButton={synth.id === 2}
              onPlayStop={() => handlePlayStop(synth.id)}
              onPatternChange={(p) => handlePatternChange(synth.id, p)}
              onStepChange={(step) => handleStepChange(synth.id, step)}
              onSavePattern={(name) => handleSavePattern(synth.id, name)}
              onLoadSavedPattern={(data) => handleLoadSavedPattern(synth.id, data)}
              onParameterChange={(params) => handleParameterChange(synth.id, params)}
              onOctaveShift={(dir) => handleOctaveShift(synth.id, dir)}
              onRemove={synth.id === 2 ? handleRemoveSynth : undefined}
              onPlayNote={(note) => handleNotePlay(synth.id, note)}
              onNoteRelease={(note) => handleNoteRelease(synth.id, note)}
            />
          ))}

          {synths.length < 2 && (
            <button className="add-synth-btn" onClick={handleAddSynth}>
              + Add Synth 2
            </button>
          )}
        </div>

        <DrumMachine
          drumState={memoizedDrumState}
          isPlaying={synths.some(s => s.isPlaying)}
          currentStep={synths[0]?.currentStep || 0}
          onStepToggle={handleDrumStepToggle}
          onSettingsChange={handleDrumSettingsChange}
          onReset={handleDrumReset}
          drumMasterVolume={drumMasterVolume}
          onMasterVolumeChange={handleDrumMasterVolumeChange}
          drumAudio={drumAudio}
        />
      </div>
    </div>
  );
}

export default App;
