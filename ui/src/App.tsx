import { useState, useCallback } from 'react';
import Sequencer from './components/Sequencer';
import Keyboard from './components/Keyboard';
import SynthControls from './components/SynthControls';
import { useWebSocket } from './hooks/useWebSocket';
import { Pattern, SynthParameters } from './types';
import './App.css';

function App() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [currentPattern, setCurrentPattern] = useState<Pattern | null>(null);
  const [synthParams, setSynthParams] = useState<SynthParameters | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init':
        setSynthParams(message.data.synthParameters);
        setPatterns(message.data.patterns);
        if (message.data.patterns.length > 0) {
          setCurrentPattern(message.data.patterns[0]);
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
      case 'sequencerStep':
        setCurrentStep(message.data.step);
        break;
    }
  }, []);

  const connected = useWebSocket('ws://localhost:8080', handleMessage);

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

  const handleStepChange = async (stepIndex: number, active: boolean, note?: string) => {
    if (!currentPattern) return;

    const updatedPattern = { ...currentPattern };
    updatedPattern.steps[stepIndex] = {
      ...updatedPattern.steps[stepIndex],
      active,
      note,
    };

    await fetch(`http://localhost:3001/patterns/${currentPattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  };

  const handleNotePlay = async (note: string) => {
    if (selectedStep !== null && currentPattern) {
      const updatedPattern = { ...currentPattern };
      updatedPattern.steps[selectedStep] = {
        ...updatedPattern.steps[selectedStep],
        active: true,
        note,
      };

      await fetch(`http://localhost:3001/patterns/${currentPattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPattern),
      });
      setCurrentPattern(updatedPattern);
    }

    await fetch('http://localhost:3001/synth/note-on', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, velocity: 0.7 }),
    });
  };

  const handleNoteRelease = async (note: string) => {
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Discord Synth Bot</h1>
        <div className="status">
          <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : 'Disconnected'}
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
            onSelectStep={setSelectedStep}
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
