import { useState, useCallback } from 'react';
import { DrumState, DrumInstrument } from '../types';
import DrumKnob from './DrumKnob';
import './DrumMachine.css';

export interface DrumMachineProps {
  drumState: DrumState;
  isPlaying: boolean;
  currentStep: number;
  onStepToggle: (instrument: DrumInstrument, step: number, active: boolean) => void;
  onSettingsChange: (instrument: DrumInstrument, settings: { volume?: number; tone?: number; extra?: number }) => void;
  onReset: () => void;
  drumMasterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
}

const INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const STEPS = Array.from({ length: 16 }, (_, i) => i);

const INSTRUMENT_LABELS: Record<DrumInstrument, string> = {
  kick: 'Kick',
  snare: 'Snare',
  openHH: 'Open HH',
  closedHH: 'Closed HH',
  ride: 'Ride',
  crash: 'Crash',
  snare2: 'Snare 2',
  clap: 'Clap',
};

const INSTRUMENT_SHORT_LABELS: Record<DrumInstrument, string> = {
  kick: 'BD',
  snare: 'SD',
  openHH: 'OH',
  closedHH: 'CH',
  ride: 'RD',
  crash: 'CR',
  snare2: 'SD2',
  clap: 'CP',
};

const INSTRUMENT_COLORS: Record<DrumInstrument, string> = {
  kick: '#ef4444',
  snare: '#f59e0b',
  openHH: '#22c55e',
  closedHH: '#3b82f6',
  ride: '#8b5cf6',
  crash: '#ec4899',
  snare2: '#14b8a6',
  clap: '#f97316',
};

const EXTRA_LABELS: Record<DrumInstrument, { knob: string; display: (v: number) => string }> = {
  kick: { knob: 'Decay', display: (v) => `${((0.08 + v * 0.52) * 1000).toFixed(0)}ms` },
  snare: { knob: 'Snappy', display: (v) => v.toFixed(2) },
  openHH: { knob: 'Decay', display: (v) => `${((0.1 + v * 0.6) * 1000).toFixed(0)}ms` },
  closedHH: { knob: 'Tight', display: (v) => v.toFixed(2) },
  ride: { knob: 'Bright', display: (v) => v.toFixed(2) },
  crash: { knob: 'Decay', display: (v) => `${((0.3 + v * 1.5) * 1000).toFixed(0)}ms` },
  snare2: { knob: 'Snappy', display: (v) => v.toFixed(2) },
  clap: { knob: 'Room', display: (v) => `${(10 + v * 80).toFixed(0)}ms` },
};

export default function DrumMachine({
  drumState,
  isPlaying,
  currentStep,
  onStepToggle,
  onSettingsChange,
  onReset,
  drumMasterVolume,
  onMasterVolumeChange,
}: DrumMachineProps) {
  const [selectedInstrument, setSelectedInstrument] = useState<DrumInstrument>('kick');

  const handleStepClick = useCallback((step: number) => {
    const current = drumState[selectedInstrument].steps[step];
    onStepToggle(selectedInstrument, step, !current);
  }, [drumState, selectedInstrument, onStepToggle]);

  const handleKnobChange = useCallback((key: 'volume' | 'tone' | 'extra', val: number) => {
    onSettingsChange(selectedInstrument, { [key]: val });
  }, [selectedInstrument, onSettingsChange]);

  const selectedTrack = drumState[selectedInstrument];
  const extraLabel = EXTRA_LABELS[selectedInstrument];

  return (
    <div className="drum-machine">
      <div className="drum-machine-header">
        <h2>Rhythm Composer</h2>
        <span className="drum-machine-model">TR-808 style</span>
        <button className="drum-reset-btn" onClick={onReset} title="Reset drum pattern and settings">
          &#8634;
        </button>
      </div>

      <div className="drum-machine-body">
        <div className="drum-sequencer-panel">
          <div className="drum-top-controls">
            <div className="drum-controls">
              <div className="drum-controls-header">
                <span className="drum-controls-subtle">Master</span>
                <span>Volume</span>
              </div>
              <DrumKnob
                label="Master"
                value={drumMasterVolume}
                displayValue={Math.round(drumMasterVolume * 100) + '%'}
                onChange={onMasterVolumeChange}
              />
            </div>

            <div className="drum-controls">
              <div className="drum-controls-header">
                <span
                  style={{ color: INSTRUMENT_COLORS[selectedInstrument], fontWeight: 600 }}
                >
                  {INSTRUMENT_LABELS[selectedInstrument]}
                </span>
              </div>
              <div className="drum-knobs">
                <DrumKnob
                  label="Volume"
                  value={selectedTrack.settings.volume}
                  displayValue={Math.round(selectedTrack.settings.volume * 100) + '%'}
                  onChange={(v) => handleKnobChange('volume', v)}
                />
                <DrumKnob
                  label="Tone"
                  value={selectedTrack.settings.tone}
                  displayValue={selectedTrack.settings.tone.toFixed(2)}
                  onChange={(v) => handleKnobChange('tone', v)}
                />
                <DrumKnob
                  label={extraLabel.knob}
                  value={selectedTrack.settings.extra}
                  displayValue={extraLabel.display(selectedTrack.settings.extra)}
                  onChange={(v) => handleKnobChange('extra', v)}
                />
              </div>
            </div>
          </div>

          <div className="drum-instrument-select">
            <div className="drum-section-title">Instrument Select</div>
            <div className="drum-instrument-buttons">
              {INSTRUMENTS.map((inst) => (
                <button
                  key={inst}
                  className={`drum-instrument-btn ${selectedInstrument === inst ? 'selected' : ''}`}
                  style={{ '--drum-color': INSTRUMENT_COLORS[inst] } as React.CSSProperties}
                  onClick={() => setSelectedInstrument(inst)}
                  title={INSTRUMENT_LABELS[inst]}
                >
                  <span>{INSTRUMENT_SHORT_LABELS[inst]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="drum-step-programmer">
            <div className="drum-step-header">
              <div className="drum-selected-instrument">
                <span
                  className="drum-selected-dot"
                  style={{ backgroundColor: INSTRUMENT_COLORS[selectedInstrument] }}
                />
                <span>{INSTRUMENT_LABELS[selectedInstrument]}</span>
              </div>
              <div className="drum-step-indicators">
                {STEPS.map((i) => (
                  <div key={i} className={`drum-step-indicator ${isPlaying && currentStep === i ? 'active' : ''}`}>
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>
            <div className="drum-step-row">
              {STEPS.map((step) => {
                const active = drumState[selectedInstrument].steps[step];
                const stepBand = step < 4 ? 'band-a' : step < 8 ? 'band-b' : step < 12 ? 'band-c' : 'band-d';
                return (
                  <button
                    key={step}
                    className={`drum-step-btn ${stepBand} ${active ? 'active' : ''} ${isPlaying && currentStep === step ? 'current' : ''}`}
                    style={{ '--drum-color': INSTRUMENT_COLORS[selectedInstrument] } as React.CSSProperties}
                    onClick={() => handleStepClick(step)}
                  >
                    <span className="drum-step-led" />
                  </button>
                );
              })}
            </div>
            <div className="drum-step-note">
              Select an instrument, then program its 16 steps.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
