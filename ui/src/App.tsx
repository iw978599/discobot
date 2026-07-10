import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Sequencer from './components/Sequencer';
import Keyboard from './components/Keyboard';
import SynthControls from './components/SynthControls';
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

function App() {
  // Use custom hooks for audio playback
  const synthAudio = useSynthAudio();
  const drumAudio = useDrumAudio();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [currentPattern, setCurrentPattern] = useState<Pattern | null>(null);
  const [synthParams, setSynthParams] = useState<SynthParameters | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const defaultDrumState = (): DrumState => ({
    kick: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    snare: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    openHH: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    closedHH: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    ride: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    crash: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    snare2: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    clap: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
  });
  const [drumState, setDrumState] = useState<DrumState>(defaultDrumState);
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const currentPatternRef = useRef(currentPattern);
  currentPatternRef.current = currentPattern;
  const selectedStepRef = useRef(selectedStep);
  selectedStepRef.current = selectedStep;
  const [browserMuted, setBrowserMuted] = useState(false);
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;
  const synthParamsRef = useRef(synthParams);
  synthParamsRef.current = synthParams;

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      synthAudio.dispose();
      drumAudio.dispose();
    };
  }, [synthAudio, drumAudio]);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init':
        setSynthParams(message.data.synthParameters);
        setPatterns(message.data.patterns);
        if (message.data.drumState) setDrumState(message.data.drumState);
        if (message.data.patterns.length > 0) {
          setCurrentPattern(message.data.patterns[0]);
        }
        if (!message.data.hasActiveSession) {
          setIsPlaying(false);
          setCurrentStep(0);
        }
        break;
      case 'synthUpdate':
        setSynthParams(message.data);
        break;
      case 'patternCreated':
        setPatterns((prev: Pattern[]) => [...prev, message.data]);
        break;
      case 'patternUpdated':
        setPatterns((prev: Pattern[]) =>
          prev.map((p: Pattern) => (p.id === message.data.id ? message.data : p))
        );
        setCurrentPattern((prev: Pattern | null) =>
          prev?.id === message.data.id ? message.data : prev
        );
        break;
      case 'sequencerPlay':
        setIsPlaying(true);
        break;
      case 'sequencerStop':
        setIsPlaying(false);
        setCurrentStep(0);
        break;
      case 'sequencerStep': {
        const stepIndex = message.data.step;
        setCurrentStep(stepIndex);
        const cur = currentPatternRef.current;
        if (cur && cur.steps[stepIndex]?.note) {
          synthAudio.playNote(cur.steps[stepIndex].note!, synthParamsRef.current, 0.15, browserMutedRef.current);
        }
        const ds = drumStateRef.current;
        if (ds) {
          for (const inst of Object.keys(ds) as DrumInstrument[]) {
            const track = ds[inst];
            if (track.steps[stepIndex]) {
              drumAudio.playDrumHit(inst, track.settings, browserMutedRef.current);
            }
          }
        }
        break;
      }
      case 'drumStep': {
        const { instrument: di, step: ds, active: da } = message.data;
        setDrumState((prev) => {
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
        setDrumState((prev) => {
          const next = { ...prev };
          const inst = dsi as DrumInstrument;
          next[inst] = {
            ...next[inst],
            settings: { ...next[inst].settings, ...dss },
          };
          return next;
        });
        break;
      }
      case 'drumReset': {
        setDrumState(defaultDrumState());
        break;
      }
      case 'drumFullState': {
        if (message.data.drumState) setDrumState(message.data.drumState);
        break;
      }
    }
  }, []);

  const connected = useWebSocket(getWebSocketUrl(), handleMessage);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleTempoChange = useCallback(async (bpm: number) => {
    if (!currentPattern) return;

    const updatedPattern = { ...currentPattern, tempo: bpm };
    setCurrentPattern(updatedPattern);

    await Promise.all([
      fetch(apiUrl(`/patterns/${currentPattern.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPattern),
      }),
      fetch(apiUrl('/sequencer/tempo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempo: bpm }),
      }),
    ]);
  }, [currentPattern]);

  const handlePlayStop = useCallback(async () => {
    if (!currentPattern) return;

    const endpoint = isPlaying ? '/sequencer/stop' : '/sequencer/play';
    const body = isPlaying ? {} : { patternId: currentPattern.id };

    await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, [currentPattern, isPlaying]);

  const handlePatternChange = useCallback((pattern: Pattern) => {
    setCurrentPattern(pattern);
  }, []);

  const handleStepChange = useCallback(async (stepIndex: number) => {
    if (!currentPattern) return;
    setSelectedStep((prev) => (prev === stepIndex ? null : stepIndex));
  }, [currentPattern]);

  const handleNotePlay = useCallback((note: string) => {
    synthAudio.playNote(note, synthParamsRef.current, undefined, browserMutedRef.current);

    const step = selectedStepRef.current;
    const pattern = currentPatternRef.current;
    if (step === null || !pattern) return;

    const updated = { ...pattern };
    updated.steps = updated.steps.map((s, i) =>
      i === step ? { ...s, note, active: true } : s
    );

    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setCurrentPattern(updated);

    fetch(apiUrl(`/patterns/${pattern.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
  }, [synthAudio, browserMutedRef, synthParamsRef]);

  const handleNoteRelease = useCallback(async (note: string) => {
    synthAudio.stopNote(note, synthParamsRef.current);

    await fetch(apiUrl('/synth/note-off'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
  }, [synthAudio, synthParamsRef]);

  const handleSynthParamChange = useCallback(async (params: Partial<SynthParameters>) => {
    await fetch(apiUrl('/synth/parameters'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }, []);

  const handleDrumStepToggle = useCallback((instrument: DrumInstrument, step: number, active: boolean) => {
    drumAudio.playDrumHit(instrument, drumStateRef.current[instrument].settings, browserMutedRef.current);
    setDrumState((prev) => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], steps: [...next[instrument].steps] };
      next[instrument].steps[step] = active;
      return next;
    });
    fetch(apiUrl('/drum/step'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, step, active }),
    }).catch(() => {});
  }, [drumAudio, browserMutedRef]);

  const handleDrumSettingsChange = useCallback((instrument: DrumInstrument, settings: Partial<DrumSettings>) => {
    setDrumState((prev) => {
      const next = { ...prev };
      next[instrument] = {
        ...next[instrument],
        settings: { ...next[instrument].settings, ...settings },
      };
      return next;
    });
    fetch(apiUrl('/drum/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, settings }),
    }).catch(() => {});
  }, []);

  const handleDrumReset = useCallback(() => {
    setDrumState(defaultDrumState());
    fetch(apiUrl('/drum/reset'), { method: 'POST' }).catch(() => {});
  }, []);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    setDrumMasterVolume(volume);
    fetch(apiUrl('/drum/master-volume'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    }).catch(() => {});
  }, []);

  const handleSavePattern = async (name: string): Promise<boolean> => {
    const pattern = currentPatternRef.current;
    if (!pattern || !synthParamsRef.current) return false;

    try {
      const response = await fetch(apiUrl('/patterns/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          steps: pattern.steps,
          synthParams: synthParamsRef.current,
          tempo: pattern.tempo,
          drumState: drumStateRef.current,
          drumMasterVolume,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to save pattern:', {
          status: response.status,
          error,
        });
        // TODO: Show user notification
        return false;
      }
      return true;
    } catch (error) {
      console.error('Pattern save error:', {
        error: error instanceof Error ? error.message : String(error),
        patternName: name,
      });
      // TODO: Show user notification
      return false;
    }
  };

  const handleLoadSavedPattern = async (data: SavedPatternFull) => {
    if (!currentPatternRef.current) return;
    const pattern = currentPatternRef.current;
    const updated = { ...pattern, steps: data.steps, tempo: data.tempo };
    setCurrentPattern(updated);
    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedStep(null);
    if (data.drumState && typeof data.drumState === 'object') {
      setDrumState(data.drumState);
      await fetch(apiUrl('/drum/state'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.drumState }),
      }).catch(() => {});
    }
    if (data.drumMasterVolume !== undefined) {
      setDrumMasterVolume(data.drumMasterVolume);
      await fetch(apiUrl('/drum/master-volume'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: data.drumMasterVolume }),
      }).catch(() => {});
    }
    if (data.synthParams) {
      setSynthParams(data.synthParams);
      await fetch(apiUrl('/synth/parameters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.synthParams),
      }).catch(() => {});
    }
    await fetch(apiUrl(`/patterns/${pattern.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
    await fetch(apiUrl('/sequencer/tempo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: data.tempo }),
    }).catch(() => {});
  };

  const handleReset = useCallback(() => {
    setSynthParams(DEFAULT_PARAMS);
    handleDrumReset();
    if (currentPatternRef.current) {
      const pattern = currentPatternRef.current;
      const cleared = { ...pattern };
      cleared.steps = cleared.steps.map((s) => ({ ...s, active: false, note: undefined }));
      setCurrentPattern(cleared);
      setPatterns((prev) => prev.map((p) => (p.id === cleared.id ? cleared : p)));
      setSelectedStep(null);
      setIsPlaying(false);
      setCurrentStep(0);

      fetch(apiUrl(`/patterns/${pattern.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleared),
      }).catch(() => {});
      fetch(apiUrl('/synth/parameters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
      }).catch(() => {});

      if (isPlaying) {
        fetch(apiUrl('/sequencer/stop'), { method: 'POST' }).catch(() => {});
      }
    }
  }, [currentPatternRef, handleDrumReset, isPlaying]);

  // Memoize frequently accessed values
  const memoizedDrumState = useMemo(() => drumState, [drumState]);
  const memoizedSynthParams = useMemo(() => synthParams, [synthParams]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Discord Synth Bot</h1>
        <div className="header-controls">
          <button className="reset-button" onClick={handleReset} title="Reset pattern and synth to defaults">
            &#8634;
          </button>
          <button
            className={`mute-button ${browserMuted ? 'muted' : ''}`}
            onClick={() => setBrowserMuted((m) => !m)}
            title={browserMuted ? 'Unmute browser audio (Discord audio unaffected)' : 'Mute browser audio (Discord audio unaffected)'}
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
        <div className="left-panel">
          <Sequencer
            pattern={currentPattern}
            patterns={patterns}
            isPlaying={isPlaying}
            currentStep={currentStep}
            selectedStep={selectedStep}
            onPlayStop={handlePlayStop}
            onPatternChange={handlePatternChange}
            onStepChange={handleStepChange}
            onTempoChange={handleTempoChange}
            onSavePattern={handleSavePattern}
            onLoadSavedPattern={handleLoadSavedPattern}
          />

          <Keyboard onNotePlay={handleNotePlay} onNoteRelease={handleNoteRelease} />

          <DrumMachine
            drumState={memoizedDrumState}
            isPlaying={isPlaying}
            currentStep={currentStep}
            onStepToggle={handleDrumStepToggle}
            onSettingsChange={handleDrumSettingsChange}
            onReset={handleDrumReset}
            drumMasterVolume={drumMasterVolume}
            onMasterVolumeChange={handleDrumMasterVolumeChange}
            drumAudio={drumAudio}
          />
        </div>

        <div className="right-panel">
          {memoizedSynthParams && (
            <SynthControls
              parameters={memoizedSynthParams}
              onParameterChange={handleSynthParamChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
