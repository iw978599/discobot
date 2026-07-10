import { useState, useCallback, useRef } from 'react';
import Sequencer from './components/Sequencer';
import Keyboard from './components/Keyboard';
import SynthControls from './components/SynthControls';
import { useWebSocket } from './hooks/useWebSocket';
import { Pattern, SynthParameters, SavedPatternFull } from './types';
import './App.css';

const DEFAULT_PARAMS: SynthParameters = {
  oscillator: { type: 'sine', detune: 0 },
  filter: { frequency: 20000, q: 1, type: 'lowpass' },
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
  effects: {
    reverb: { enabled: false, wet: 0.3, decay: 2 },
    delay: { enabled: false, wet: 0.3, time: 0.25, feedback: 0.3 },
  },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_FREQ: Record<string, number> = {};
for (let oct = 3; oct <= 5; oct++) {
  for (let i = 0; i < NOTE_NAMES.length; i++) {
    const midi = (oct + 1) * 12 + i;
    NOTE_FREQ[`${NOTE_NAMES[i]}${oct}`] = 440 * Math.pow(2, (midi - 69) / 12);
  }
}

function App() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeVoices = useRef<Map<string, { osc: OscillatorNode; gain: GainNode }>>(new Map());

  function getAudioContext() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function playBrowserNote(note: string, duration?: number) {
    if (browserMutedRef.current) return;
    const freq = NOTE_FREQ[note];
    if (!freq) return;
    try {
      const ctx = getAudioContext();
      const p = synthParamsRef.current;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = p?.oscillator.type || 'sine';
      osc.frequency.value = freq;
      osc.detune.value = p?.oscillator.detune || 0;

      if (p) {
        const filter = ctx.createBiquadFilter();
        filter.type = (p.filter.type || 'lowpass') as BiquadFilterType;
        filter.frequency.value = p.filter.frequency;
        filter.Q.value = p.filter.q;
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }

      if (p?.effects.delay.enabled && p.effects.delay.wet > 0) {
        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const delayNode = ctx.createDelay(p.effects.delay.time);
        const feedbackGain = ctx.createGain();
        const outputGain = ctx.createGain();

        dryGain.gain.value = 1 - p.effects.delay.wet;
        wetGain.gain.value = p.effects.delay.wet;
        delayNode.delayTime.value = p.effects.delay.time;
        feedbackGain.gain.value = p.effects.delay.feedback;

        gain.connect(dryGain);
        gain.connect(delayNode);
        delayNode.connect(wetGain);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        dryGain.connect(outputGain);
        wetGain.connect(outputGain);
        outputGain.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      const attack = p?.envelope.attack ?? 0.01;
      const decay = p?.envelope.decay ?? 0.1;
      const sustainLvl = p?.envelope.sustain ?? 0.7;
      const release = p?.envelope.release ?? 0.3;
      const volume = 0.15;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + attack);
      gain.gain.linearRampToValueAtTime(volume * sustainLvl, now + attack + decay);

      osc.start(now);

      if (duration) {
        const end = now + Math.max(duration, attack + decay + 0.01);
        gain.gain.setValueAtTime(volume * sustainLvl, end - release);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        osc.stop(end);
      } else {
        activeVoices.current.set(note, { osc, gain });
      }
    } catch {}
  }

  function stopBrowserNote(note: string) {
    const voice = activeVoices.current.get(note);
    if (voice) {
      try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;
        const release = synthParamsRef.current?.envelope.release ?? 0.3;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.exponentialRampToValueAtTime(0.001, now + release);
        voice.osc.stop(now + release);
      } catch {}
      activeVoices.current.delete(note);
    }
  }
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [currentPattern, setCurrentPattern] = useState<Pattern | null>(null);
  const [synthParams, setSynthParams] = useState<SynthParameters | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const currentPatternRef = useRef(currentPattern);
  currentPatternRef.current = currentPattern;
  const selectedStepRef = useRef(selectedStep);
  selectedStepRef.current = selectedStep;
  const [browserMuted, setBrowserMuted] = useState(false);
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;
  const synthParamsRef = useRef(synthParams);
  synthParamsRef.current = synthParams;

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init':
        setSynthParams(message.data.synthParameters);
        setPatterns(message.data.patterns);
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
          playBrowserNote(cur.steps[stepIndex].note!, 0.15);
        }
        break;
      }
    }
  }, []);

  const connected = useWebSocket('ws://localhost:8080', handleMessage);

  const handleTempoChange = async (bpm: number) => {
    if (!currentPattern) return;

    const updatedPattern = { ...currentPattern, tempo: bpm };
    setCurrentPattern(updatedPattern);

    await Promise.all([
      fetch(`http://localhost:3001/patterns/${currentPattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPattern),
      }),
      fetch('http://localhost:3001/sequencer/tempo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempo: bpm }),
      }),
    ]);
  };

  const handlePlayStop = async () => {
    if (!currentPattern) return;

    const endpoint = isPlaying ? '/sequencer/stop' : '/sequencer/play';
    const body = isPlaying ? {} : { patternId: currentPattern.id };

    await fetch(`http://localhost:3001${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const handlePatternChange = (pattern: Pattern) => {
    setCurrentPattern(pattern);
  };

  const handleStepChange = async (stepIndex: number) => {
    if (!currentPattern) return;
    setSelectedStep((prev) => (prev === stepIndex ? null : stepIndex));
  };

  const handleNotePlay = (note: string) => {
    playBrowserNote(note);

    const step = selectedStepRef.current;
    const pattern = currentPatternRef.current;
    if (step === null || !pattern) return;

    const updated = { ...pattern };
    updated.steps = updated.steps.map((s, i) =>
      i === step ? { ...s, note, active: true } : s
    );

    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setCurrentPattern(updated);

    fetch(`http://localhost:3001/patterns/${pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
  };



  const handleNoteRelease = async (note: string) => {
    stopBrowserNote(note);

    await fetch('http://localhost:3001/synth/note-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
  };

  const handleSynthParamChange = async (params: Partial<SynthParameters>) => {
    await fetch('http://localhost:3001/synth/parameters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  };

  const handleSavePattern = async (name: string) => {
    const pattern = currentPatternRef.current;
    if (!pattern || !synthParamsRef.current) return;
    try {
      await fetch('http://localhost:3001/patterns/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          steps: pattern.steps,
          synthParams: synthParamsRef.current,
          tempo: pattern.tempo,
        }),
      });
    } catch { /* ignore */ }
  };

  const handleLoadSavedPattern = async (data: SavedPatternFull) => {
    if (!currentPatternRef.current) return;
    const pattern = currentPatternRef.current;
    const updated = { ...pattern, steps: data.steps, tempo: data.tempo };
    setCurrentPattern(updated);
    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedStep(null);
    if (data.synthParams) {
      setSynthParams(data.synthParams);
      await fetch('http://localhost:3001/synth/parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.synthParams),
      });
    }
    await fetch(`http://localhost:3001/patterns/${pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    await fetch('http://localhost:3001/sequencer/tempo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: data.tempo }),
    });
  };

  const handleReset = () => {
    setSynthParams(DEFAULT_PARAMS);
    if (currentPatternRef.current) {
      const pattern = currentPatternRef.current;
      const cleared = { ...pattern };
      cleared.steps = cleared.steps.map((s) => ({ ...s, active: false, note: undefined }));
      setCurrentPattern(cleared);
      setPatterns((prev) => prev.map((p) => (p.id === cleared.id ? cleared : p)));
      setSelectedStep(null);
      setIsPlaying(false);
      setCurrentStep(0);

      fetch(`http://localhost:3001/patterns/${pattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleared),
      }).catch(() => {});
      fetch('http://localhost:3001/synth/parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
      }).catch(() => {});

      if (isPlaying) {
        fetch('http://localhost:3001/sequencer/stop', { method: 'POST' }).catch(() => {});
      }
    }
  };

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
        </div>

        <div className="right-panel">
          {synthParams && (
            <SynthControls
              parameters={synthParams}
              onParameterChange={handleSynthParamChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
