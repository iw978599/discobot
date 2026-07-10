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

  const handleCellClick = useCallback((instrument: DrumInstrument, step: number) => {
    const current = drumState[instrument].steps[step];
    onStepToggle(instrument, step, !current);
    setSelectedInstrument(instrument);
  }, [drumState, onStepToggle]);

  const handleKnobChange = useCallback((key: 'volume' | 'tone' | 'extra', val: number) => {
    onSettingsChange(selectedInstrument, { [key]: val });
  }, [selectedInstrument, onSettingsChange]);

  const selectedTrack = drumState[selectedInstrument];
  const extraLabel = EXTRA_LABELS[selectedInstrument];

  return (
    <div className="drum-machine">
      <div className="drum-machine-header">
        <h2>Drum Machine</h2>
        <button className="drum-reset-btn" onClick={onReset} title="Reset drum pattern and settings">
          &#8634;
        </button>
      </div>

      <div className="drum-machine-body">
        <div className="drum-grid-wrapper">
          <div className="drum-grid">
            <div className="drum-row drum-row-header">
              <div className="drum-label-cell" />
              {Array.from({ length: 16 }, (_, i) => (
                <div key={i} className={`drum-step-indicator ${isPlaying && currentStep === i ? 'active' : ''}`}>
                  {i + 1}
                </div>
              ))}
            </div>
            {INSTRUMENTS.map((inst) => (
              <div
                key={inst}
                className={`drum-row ${selectedInstrument === inst ? 'selected' : ''}`}
                onClick={() => setSelectedInstrument(inst)}
              >
                <div
                  className="drum-label-cell"
                  style={{ color: INSTRUMENT_COLORS[inst] }}
                >
                  {INSTRUMENT_LABELS[inst]}
                </div>
                {Array.from({ length: 16 }, (_, step) => {
                  const active = drumState[inst].steps[step];
                  return (
                    <button
                      key={step}
                      className={`drum-cell ${active ? 'active' : ''} ${isPlaying && currentStep === step ? 'current' : ''}`}
                      style={{
                        '--drum-color': INSTRUMENT_COLORS[inst],
                        backgroundColor: active ? INSTRUMENT_COLORS[inst] : undefined,
                      } as React.CSSProperties}
                      onClick={(e) => { e.stopPropagation(); handleCellClick(inst, step); }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="drum-controls">
          <div className="drum-controls-header">
            Master Vol
          </div>
          <DrumKnob
            label="Master"
            value={drumMasterVolume}
            displayValue={Math.round(drumMasterVolume * 100) + '%'}
            onChange={onMasterVolumeChange}
          />
          <div style={{ width: '100%', height: 1, background: '#3a3a3a', margin: '0.5rem 0' }} />
          <div className="drum-controls-header">
            <span style={{ color: INSTRUMENT_COLORS[selectedInstrument], fontWeight: 600 }}>
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
    </div>
  );
}
