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
  onMixChange: (instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) => void;
  onReset: () => void;
  drumMasterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  onMuteAll: (muted: boolean) => void;
  onSoloAll: () => void;
  drumAudio: ReturnType<typeof import('../hooks/useDrumAudio').useDrumAudio>;
}

const INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride', 'crash'];
const STEPS = Array.from({ length: 16 }, (_, i) => i);

const INSTRUMENT_LABELS: Record<DrumInstrument, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  closedHH: 'Closed Hat',
  openHH: 'Open Hat',
  snare2: 'Low Tom',
  ride: 'High Tom',
  crash: 'Cymbal',
};

const INSTRUMENT_SHORT_LABELS: Record<DrumInstrument, string> = {
  kick: 'BD',
  snare: 'SD',
  clap: 'CP',
  closedHH: 'CH',
  openHH: 'OH',
  snare2: 'LT',
  ride: 'HT',
  crash: 'CY',
};

const INSTRUMENT_COLORS: Record<DrumInstrument, string> = {
  kick: '#ef4444',
  snare: '#f59e0b',
  clap: '#f97316',
  closedHH: '#3b82f6',
  openHH: '#22c55e',
  snare2: '#14b8a6',
  ride: '#8b5cf6',
  crash: '#ec4899',
};

const EXTRA_LABELS: Record<DrumInstrument, { knob: string; display: (v: number) => string }> = {
  kick: { knob: 'Punch', display: (v) => `${(20 + v * 80).toFixed(0)}%` },
  snare: { knob: 'Snap', display: (v) => `${(10 + v * 90).toFixed(0)}%` },
  clap: { knob: 'Spread', display: (v) => `${(8 + (1 - v) * 28).toFixed(0)}ms` },
  closedHH: { knob: 'Tight', display: (v) => `${(15 + (1 - v) * 130).toFixed(0)}ms` },
  openHH: { knob: 'Decay', display: (v) => `${((0.22 + v * 0.85) * 1000).toFixed(0)}ms` },
  snare2: { knob: 'Bend', display: (v) => `${(20 + v * 80).toFixed(0)}%` },
  ride: { knob: 'Bend', display: (v) => `${(25 + v * 75).toFixed(0)}%` },
  crash: { knob: 'Wash', display: (v) => `${((0.8 + v * 2.1) * 1000).toFixed(0)}ms` },
};

export default function DrumMachine({
  drumState,
  isPlaying,
  currentStep,
  onStepToggle,
  onSettingsChange,
  onMixChange,
  onReset,
  drumMasterVolume,
  onMasterVolumeChange,
  onMuteAll,
  onSoloAll,
  drumAudio,
}: DrumMachineProps) {
  const [selectedInstrument, setSelectedInstrument] = useState<DrumInstrument>('kick');
  const allMuted = INSTRUMENTS.every((inst) => Boolean(drumState[inst].muted));
  const anySolo = INSTRUMENTS.some((inst) => Boolean(drumState[inst].solo));

  const handleStepClick = useCallback((step: number) => {
    console.log('Step clicked:', selectedInstrument, 'step:', step);

    const hasSolo = INSTRUMENTS.some((inst) => drumState[inst].solo);
    const selectedTrack = drumState[selectedInstrument];
    const canPreview = !selectedTrack.muted && (!hasSolo || selectedTrack.solo);

    // Play drum hit immediately for instant feedback (before WebSocket roundtrip)
    if (canPreview) {
      const settings = selectedTrack.settings;
      console.log('Playing drum hit for step:', selectedInstrument, settings);
      drumAudio.playDrumHit(selectedInstrument, settings);
    }

    // Then update state (which will send to server)
    const current = drumState[selectedInstrument].steps[step];
    onStepToggle(selectedInstrument, step, !current);
  }, [drumState, selectedInstrument, onStepToggle, drumAudio]);

  const handleInstrumentSelect = useCallback((instrument: DrumInstrument) => {
    console.log('Instrument selected:', instrument);
    setSelectedInstrument(instrument);

    const hasSolo = INSTRUMENTS.some((inst) => drumState[inst].solo);
    const selectedTrack = drumState[instrument];
    const canPreview = !selectedTrack.muted && (!hasSolo || selectedTrack.solo);

    // Play drum hit preview when selecting instrument
    if (canPreview) {
      const settings = selectedTrack.settings;
      console.log('Playing drum hit for instrument:', instrument, settings);
      drumAudio.playDrumHit(instrument, settings);
    }
  }, [drumState, drumAudio]);

  return (
    <div className="drum-machine">
      <div className="drum-machine-header">
        <h2>Rhythm Composer</h2>
        <span className="drum-machine-model">Hybrid analog model</span>
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
              <div className="drum-global-mix">
                <button
                  className={`drum-global-mix-btn ${allMuted ? 'active' : ''}`}
                  onClick={() => onMuteAll(!allMuted)}
                >
                  Mute All
                </button>
                <button
                  className={`drum-global-mix-btn ${!anySolo ? 'active' : ''}`}
                  onClick={onSoloAll}
                >
                  Solo All
                </button>
              </div>
            </div>
          </div>

          <div className="drum-instrument-select">
            <div className="drum-section-title">Instrument Select</div>
            <div className="drum-instrument-control-grid">
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-volume`}
                    label="Volume"
                    value={drumState[inst].settings.volume}
                    displayValue={Math.round(drumState[inst].settings.volume * 100) + '%'}
                    onChange={(v) => onSettingsChange(inst, { volume: v })}
                  />
                ))}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-tone`}
                    label="Tone"
                    value={drumState[inst].settings.tone}
                    displayValue={drumState[inst].settings.tone.toFixed(2)}
                    onChange={(v) => onSettingsChange(inst, { tone: v })}
                  />
                ))}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-extra`}
                    label={EXTRA_LABELS[inst].knob}
                    value={drumState[inst].settings.extra}
                    displayValue={EXTRA_LABELS[inst].display(drumState[inst].settings.extra)}
                    onChange={(v) => onSettingsChange(inst, { extra: v })}
                  />
                ))}
              </div>
            </div>
            <div className="drum-instrument-buttons">
              {INSTRUMENTS.map((inst) => (
                <div key={inst} className="drum-instrument-button-stack">
                  <button
                    className={`drum-instrument-btn ${selectedInstrument === inst ? 'selected' : ''}`}
                    style={{ '--drum-color': INSTRUMENT_COLORS[inst] } as React.CSSProperties}
                    onClick={() => handleInstrumentSelect(inst)}
                    title={INSTRUMENT_LABELS[inst]}
                  >
                    <span>{INSTRUMENT_SHORT_LABELS[inst]}</span>
                  </button>
                  <div className="drum-instrument-mix">
                    <button
                      className={`drum-instrument-mix-btn ${drumState[inst].muted ? 'active' : ''}`}
                      onClick={() => onMixChange(inst, { muted: !drumState[inst].muted })}
                    >
                      M
                    </button>
                    <button
                      className={`drum-instrument-mix-btn ${drumState[inst].solo ? 'active' : ''}`}
                      onClick={() => onMixChange(inst, { solo: !drumState[inst].solo })}
                    >
                      S
                    </button>
                  </div>
                </div>
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
