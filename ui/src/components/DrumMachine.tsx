import { useState, useCallback } from 'react';
import { DrumState, DrumInstrument, DrumKitDefinition, DrumKitId, FxSendLevels, CymbalType } from '../types';
import DrumKnob from './DrumKnob';
import './DrumMachine.css';

export interface DrumMachineProps {
  drumState: DrumState;
  isPlaying: boolean;
  currentStep: number;
  onStepToggle: (instrument: DrumInstrument, step: number, active: boolean) => void;
  onSettingsChange: (instrument: DrumInstrument, settings: { volume?: number; tone?: number; extra?: number; tune?: number; humanize?: number; pan?: number; cymbalType?: CymbalType }) => void;
  onMixChange: (instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) => void;
  onReset: () => void;
  drumKits: DrumKitDefinition[];
  drumKitsLoading: boolean;
  drumKitsError: string | null;
  selectedDrumKitId: DrumKitId;
  onDrumKitChange: (kitId: DrumKitId, applyDefaults: boolean) => Promise<DrumState | undefined>;
  drumMasterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  drumFx: { sends: FxSendLevels; returnLevel: number };
  onDrumFxChange: (fx: Partial<{ sends: Partial<FxSendLevels>; returnLevel: number }>) => void;
  drumEffectsReturn: number;
  onDrumEffectsReturnChange: (value: number) => void;
  drumSwing: number;
  onDrumSwingChange: (swing: number) => void;
  onStepVelocityChange: (instrument: DrumInstrument, step: number, velocity: number) => void;
  onStepDetailChange: (instrument: DrumInstrument, step: number, detail: { probability?: number; ratchet?: number }) => void;
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
  ride: { knob: 'Decay', display: (v) => `${((0.4 + v * 1.2) * 1000).toFixed(0)}ms` },
  crash: { knob: 'Wash', display: (v) => `${((0.8 + v * 2.1) * 1000).toFixed(0)}ms` },
};

const parseNumber = (input: string): number | null => {
  const n = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const parsePercent = (input: string): number | null => {
  const n = parseNumber(input);
  if (n === null) return null;
  return n / 100;
};

const parseTuneSemitones = (input: string): number | null => {
  const n = parseNumber(input);
  if (n === null) return null;
  return n / 12;
};

const parsePan = (input: string): number | null => {
  const text = input.trim().toUpperCase();
  if (text === 'C') return 0;
  const n = parseNumber(text);
  return n === null ? null : (text.startsWith('L') ? -Math.abs(n) : n) / 50;
};

const parseExtraByInstrument: Record<DrumInstrument, (input: string) => number | null> = {
  kick: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (n - 20) / 80;
  },
  snare: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (n - 10) / 90;
  },
  clap: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (36 - n) / 28;
  },
  closedHH: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (145 - n) / 130;
  },
  openHH: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (n / 1000 - 0.22) / 0.85;
  },
  snare2: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (n - 20) / 80;
  },
  ride: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (n / 1000 - 0.4) / 1.2;
  },
  crash: (input) => {
    const n = parseNumber(input);
    return n === null ? null : (n / 1000 - 0.8) / 2.1;
  },
};

export default function DrumMachine({
  drumState,
  isPlaying,
  currentStep,
  onStepToggle,
  onSettingsChange,
  onMixChange,
  onReset,
  drumKits,
  drumKitsLoading,
  drumKitsError,
  selectedDrumKitId,
  onDrumKitChange,
  drumMasterVolume,
  onMasterVolumeChange,
  drumFx,
  onDrumFxChange,
  drumEffectsReturn,
  onDrumEffectsReturnChange,
  onDrumSwingChange,
  drumSwing,
  onStepVelocityChange,
  onStepDetailChange,
  onMuteAll,
  onSoloAll,
  drumAudio,
}: DrumMachineProps) {
  const [selectedInstrument, setSelectedInstrument] = useState<DrumInstrument>('kick');
  const [selectedVelocityStep, setSelectedVelocityStep] = useState(0);
  const allMuted = INSTRUMENTS.every((inst) => Boolean(drumState[inst].muted));
  const anySolo = INSTRUMENTS.some((inst) => Boolean(drumState[inst].solo));

  const handleStepClick = useCallback((step: number, shiftKey: boolean) => {
    setSelectedVelocityStep(step);
    const hasSolo = INSTRUMENTS.some((inst) => drumState[inst].solo);
    const selectedTrack = drumState[selectedInstrument];
    const canPreview = !selectedTrack.muted && (!hasSolo || selectedTrack.solo);

    if (shiftKey && selectedTrack.steps[step]) {
      const currentVel = selectedTrack.stepVelocities?.[step] ?? 1;
      const levels = [0.25, 0.5, 0.75, 1.0];
      const nextVel = levels[(levels.indexOf(currentVel) + 1) % levels.length] ?? 1;
      onStepVelocityChange(selectedInstrument, step, nextVel);
      if (canPreview) drumAudio.playDrumHit(selectedInstrument, selectedTrack.settings, nextVel);
      return;
    }

    if (canPreview && !selectedTrack.steps[step]) {
      const settings = selectedTrack.settings;
      drumAudio.playDrumHit(selectedInstrument, settings, selectedTrack.stepVelocities?.[step] ?? 1);
    }

    const current = drumState[selectedInstrument].steps[step];
    onStepToggle(selectedInstrument, step, !current);
  }, [drumState, selectedInstrument, onStepToggle, drumAudio, onStepVelocityChange]);

  // The pattern tools move steps around; chance and repeats travel with their step.
  const moveStepDetails = (sourceFor: (step: number) => number) => {
    const track = drumState[selectedInstrument];
    if (!track.stepProbabilities && !track.stepRatchets) return;
    STEPS.forEach((step) => {
      const from = sourceFor(step);
      const probability = track.stepProbabilities?.[from] ?? 1;
      const ratchet = track.stepRatchets?.[from] ?? 1;
      if (probability !== (track.stepProbabilities?.[step] ?? 1) || ratchet !== (track.stepRatchets?.[step] ?? 1)) {
        onStepDetailChange(selectedInstrument, step, { probability, ratchet });
      }
    });
  };

  const handleInstrumentSelect = useCallback((instrument: DrumInstrument) => {
    setSelectedInstrument(instrument);

    const hasSolo = INSTRUMENTS.some((inst) => drumState[inst].solo);
    const selectedTrack = drumState[instrument];
    const canPreview = !selectedTrack.muted && (!hasSolo || selectedTrack.solo);

    // Play drum hit preview when selecting instrument
    if (canPreview) {
      const settings = selectedTrack.settings;
      drumAudio.playDrumHit(instrument, settings);
    }
  }, [drumState, drumAudio]);

  const previewInstrument = useCallback((instrument: DrumInstrument, sourceState: DrumState) => {
    const hasSolo = INSTRUMENTS.some((inst) => sourceState[inst].solo);
    const selectedTrack = sourceState[instrument];
    const canPreview = !selectedTrack.muted && (!hasSolo || selectedTrack.solo);
    if (canPreview) {
      drumAudio.playDrumHit(instrument, selectedTrack.settings);
    }
  }, [drumAudio]);

  const handleKitSelect = useCallback(async (kitId: DrumKitId) => {
    const nextState = await onDrumKitChange(kitId, true);
    previewInstrument(selectedInstrument, nextState || drumState);
  }, [onDrumKitChange, previewInstrument, selectedInstrument, drumState]);

  const handleApplyKit = useCallback(async () => {
    const nextState = await onDrumKitChange(selectedDrumKitId, true);
    previewInstrument(selectedInstrument, nextState || drumState);
  }, [onDrumKitChange, selectedDrumKitId, previewInstrument, selectedInstrument, drumState]);

  return (
    <div className="drum-machine">
      <div className="drum-machine-header">
        <h2>Rhythm Composer</h2>
        <span className="drum-machine-model">
          {(drumKits.find((kit) => kit.id === selectedDrumKitId)?.name || 'Hybrid analog model')}
        </span>
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
              <div className="drum-kit-row">
                <select
                  className="drum-kit-select"
                  aria-label="Drum kit"
                  value={selectedDrumKitId}
                  disabled={drumKitsLoading || drumKits.length === 0}
                  onChange={(e) => { void handleKitSelect(e.target.value as DrumKitId); }}
                >
                  {drumKitsLoading && <option value={selectedDrumKitId}>Loading kits...</option>}
                  {!drumKitsLoading && drumKits.length === 0 && <option value={selectedDrumKitId}>No kits available</option>}
                  {drumKits.map((kit) => (
                    <option key={kit.id} value={kit.id}>{kit.name}</option>
                  ))}
                </select>
                <button
                  className="drum-kit-apply-btn"
                  disabled={drumKitsLoading || drumKits.length === 0}
                  onClick={() => { void handleApplyKit(); }}
                  title="Apply selected kit defaults to all instruments"
                >
                  Apply Kit
                </button>
              </div>
              {drumKitsError && <div className="drum-kits-status">{drumKitsError}</div>}
              <DrumKnob
                label="Master"
                value={drumMasterVolume}
                displayValue={Math.round(drumMasterVolume * 100) + '%'}
                parseInputValue={parsePercent}
                onChange={onMasterVolumeChange}
                title="Master volume for all drum instruments"
              />
              <DrumKnob
                label="Swing"
                value={drumSwing}
                min={0}
                max={0.75}
                displayValue={Math.round(drumSwing * 100) + '%'}
                parseInputValue={parsePercent}
                onChange={onDrumSwingChange}
                title="Swing amount - delays off-beat steps for groove"
              />
              <div className="drum-fx-sends">
                <DrumKnob
                  label="Rev Send"
                  value={drumFx.sends.reverb}
                  displayValue={Math.round(drumFx.sends.reverb * 100) + '%'}
                  parseInputValue={parsePercent}
                  onChange={(v) => onDrumFxChange({ sends: { reverb: v } })}
                  title="Amount of drum signal sent to reverb"
                />
                <DrumKnob
                  label="Dly Send"
                  value={drumFx.sends.delay}
                  displayValue={Math.round(drumFx.sends.delay * 100) + '%'}
                  parseInputValue={parsePercent}
                  onChange={(v) => onDrumFxChange({ sends: { delay: v } })}
                  title="Amount of drum signal sent to delay"
                />
                <DrumKnob
                  label="Drv Send"
                  value={drumFx.sends.drive}
                  displayValue={Math.round(drumFx.sends.drive * 100) + '%'}
                  parseInputValue={parsePercent}
                  onChange={(v) => onDrumFxChange({ sends: { drive: v } })}
                  title="Amount of drum signal sent to waveshaper drive"
                />
                <DrumKnob
                  label="Phs Send"
                  value={drumFx.sends.phaser}
                  displayValue={Math.round(drumFx.sends.phaser * 100) + '%'}
                  parseInputValue={parsePercent}
                  onChange={(v) => onDrumFxChange({ sends: { phaser: v } })}
                  title="Amount of drum signal sent to phaser"
                />
                <DrumKnob
                  label="FX Return"
                  value={drumFx.returnLevel}
                  displayValue={Math.round(drumFx.returnLevel * 100) + '%'}
                  parseInputValue={parsePercent}
                  onChange={(v) => onDrumFxChange({ returnLevel: v })}
                  title="Master level of the effects return signal"
                />
                <DrumKnob
                  label="Loop Return"
                  value={drumEffectsReturn}
                  displayValue={Math.round(drumEffectsReturn * 100) + '%'}
                  parseInputValue={parsePercent}
                  onChange={onDrumEffectsReturnChange}
                  title="Shared drum effects return level"
                />
              </div>
              <div className="drum-global-mix">
                <button
                  className={`drum-global-mix-btn ${allMuted ? 'active' : ''}`}
                  aria-pressed={allMuted}
                  onClick={() => onMuteAll(!allMuted)}
                  title={allMuted ? 'Unmute all drum tracks' : 'Mute all drum tracks'}
                >
                  Mute All
                </button>
                <button
                  className="drum-global-mix-btn"
                  disabled={!anySolo}
                  onClick={onSoloAll}
                  title="Clear all drum track solos"
                >
                  Clear Solos
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
                    ariaLabel={`${INSTRUMENT_LABELS[inst]} volume`}
                    value={drumState[inst].settings.volume}
                    displayValue={Math.round(drumState[inst].settings.volume * 100) + '%'}
                    parseInputValue={parsePercent}
                    onChange={(v) => onSettingsChange(inst, { volume: v })}
                  />
                ))}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-tone`}
                    label="Tone"
                    ariaLabel={`${INSTRUMENT_LABELS[inst]} tone`}
                    value={drumState[inst].settings.tone}
                    displayValue={drumState[inst].settings.tone.toFixed(2)}
                    parseInputValue={parseNumber}
                    onChange={(v) => onSettingsChange(inst, { tone: v })}
                  />
                ))}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-tune`}
                    label="Tune"
                    ariaLabel={`${INSTRUMENT_LABELS[inst]} tune`}
                    value={drumState[inst].settings.tune ?? 0}
                    min={-1}
                    max={1}
                    displayValue={`${((drumState[inst].settings.tune ?? 0) * 12).toFixed(1)} st`}
                    parseInputValue={parseTuneSemitones}
                    onChange={(v) => onSettingsChange(inst, { tune: v })}
                  />
                ))}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => {
                  const isCrashRide = inst === 'crash' && drumState.crash.settings.cymbalType === 'ride';
                  const labels = isCrashRide ? EXTRA_LABELS.ride : EXTRA_LABELS[inst];
                  const parseFn = isCrashRide ? parseExtraByInstrument.ride : parseExtraByInstrument[inst];
                  return (
                    <DrumKnob
                      key={`${inst}-extra`}
                      label={labels.knob}
                      ariaLabel={`${INSTRUMENT_LABELS[inst]} ${labels.knob}`}
                      value={drumState[inst].settings.extra}
                      displayValue={labels.display(drumState[inst].settings.extra)}
                      parseInputValue={parseFn}
                      onChange={(v) => onSettingsChange(inst, { extra: v })}
                    />
                  );
                })}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-humanize`}
                    label="Human"
                    ariaLabel={`${INSTRUMENT_LABELS[inst]} humanize`}
                    value={drumState[inst].settings.humanize ?? 0.35}
                    displayValue={Math.round((drumState[inst].settings.humanize ?? 0.35) * 100) + '%'}
                    parseInputValue={parsePercent}
                    onChange={(v) => onSettingsChange(inst, { humanize: v })}
                  />
                ))}
              </div>
              <div className="drum-instrument-control-row">
                {INSTRUMENTS.map((inst) => (
                  <DrumKnob
                    key={`${inst}-pan`}
                    label="Pan"
                    ariaLabel={`${INSTRUMENT_LABELS[inst]} pan`}
                    min={-1}
                    max={1}
                    value={drumState[inst].settings.pan ?? 0}
                    displayValue={(() => {
                      const p = drumState[inst].settings.pan ?? 0;
                      if (Math.abs(p) < 0.05) return 'C';
                      return p < 0 ? `L${Math.round(Math.abs(p) * 50)}` : `R${Math.round(p * 50)}`;
                    })()}
                    parseInputValue={parsePan}
                    onChange={(v) => onSettingsChange(inst, { pan: v })}
                  />
                ))}
              </div>
            </div>
            <div className="drum-instrument-buttons">
              {INSTRUMENTS.map((inst) => (
                <div key={inst} className="drum-instrument-button-stack">
                  <button
                    className={`drum-instrument-btn ${selectedInstrument === inst ? 'selected' : ''}`}
                    aria-label={`Select ${INSTRUMENT_LABELS[inst]}`}
                    aria-pressed={selectedInstrument === inst}
                    style={{ '--drum-color': INSTRUMENT_COLORS[inst] } as React.CSSProperties}
                    onClick={() => handleInstrumentSelect(inst)}
                    title={`Select ${INSTRUMENT_LABELS[inst]} — click to preview sound`}
                  >
                    <span>{inst === 'crash' && drumState.crash.settings.cymbalType === 'ride' ? 'RD' : INSTRUMENT_SHORT_LABELS[inst]}</span>
                  </button>
                  <div className="drum-instrument-mix">
                    <button
                      className={`drum-instrument-mix-btn ${drumState[inst].muted ? 'active' : ''}`}
                      aria-label={`Mute ${INSTRUMENT_LABELS[inst]}`}
                      aria-pressed={Boolean(drumState[inst].muted)}
                      onClick={() => onMixChange(inst, { muted: !drumState[inst].muted })}
                      title={`${drumState[inst].muted ? 'Unmute' : 'Mute'} ${INSTRUMENT_LABELS[inst]}`}
                    >
                      M
                    </button>
                    <button
                      className={`drum-instrument-mix-btn ${drumState[inst].solo ? 'active' : ''}`}
                      aria-label={`Solo ${INSTRUMENT_LABELS[inst]}`}
                      aria-pressed={Boolean(drumState[inst].solo)}
                      onClick={() => onMixChange(inst, { solo: !drumState[inst].solo })}
                      title={`${drumState[inst].solo ? 'Unsolo' : 'Solo'} ${INSTRUMENT_LABELS[inst]}`}
                    >
                      S
                    </button>
                  </div>
                  {inst === 'crash' && (
                    <button
                      className="drum-cymbal-toggle"
                      aria-label="Switch cymbal type"
                      onClick={() => {
                        const current = drumState.crash.settings.cymbalType || 'crash';
                        const next: CymbalType = current === 'crash' ? 'ride' : 'crash';
                        onSettingsChange('crash', { cymbalType: next });
                      }}
                      title={`Switch between ride and crash (currently: ${drumState.crash.settings.cymbalType || 'crash'})`}
                    >
                      {drumState.crash.settings.cymbalType === 'ride' ? 'Ride' : 'Crash'}
                    </button>
                  )}
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
              <div className="drum-fill-tools">
                <button
                  className="drum-fill-btn"
                  onClick={() => {
                    const newSteps = drumState[selectedInstrument].steps.map(() => Math.random() < 0.4);
                    newSteps.forEach((active, i) => {
                      if (active !== drumState[selectedInstrument].steps[i]) {
                        onStepToggle(selectedInstrument, i, active);
                      }
                    });
                  }}
                  title="Random fill for selected instrument"
                >
                  Fill
                </button>
                <button
                  className="drum-fill-btn"
                  onClick={() => {
                    const steps = [...drumState[selectedInstrument].steps];
                    const shifted = [steps[15], ...steps.slice(0, 15)];
                    const velocities = drumState[selectedInstrument].stepVelocities ?? steps.map(() => 1);
                    moveStepDetails((i) => (i + 15) % 16);
                    shifted.forEach((active, i) => {
                      onStepVelocityChange(selectedInstrument, i, velocities[(i + 15) % 16]);
                      if (active !== drumState[selectedInstrument].steps[i]) {
                        onStepToggle(selectedInstrument, i, active);
                      }
                    });
                  }}
                  title="Shift pattern right"
                >
                  &#8594;
                </button>
                <button
                  className="drum-fill-btn"
                  onClick={() => {
                    const reversed = [...drumState[selectedInstrument].steps].reverse();
                    const velocities = drumState[selectedInstrument].stepVelocities ?? reversed.map(() => 1);
                    moveStepDetails((i) => 15 - i);
                    reversed.forEach((active, i) => {
                      onStepVelocityChange(selectedInstrument, i, velocities[15 - i]);
                      if (active !== drumState[selectedInstrument].steps[i]) {
                        onStepToggle(selectedInstrument, i, active);
                      }
                    });
                  }}
                  title="Reverse pattern"
                >
                  &#8644;
                </button>
                <button
                  className="drum-fill-btn"
                  onClick={() => {
                    const steps = [...drumState[selectedInstrument].steps];
                    for (let i = 0; i < 8; i++) steps[i + 8] = steps[i];
                    const velocities = drumState[selectedInstrument].stepVelocities ?? steps.map(() => 1);
                    moveStepDetails((i) => (i >= 8 ? i - 8 : i));
                    steps.forEach((active, i) => {
                      if (i >= 8) onStepVelocityChange(selectedInstrument, i, velocities[i - 8]);
                      if (active !== drumState[selectedInstrument].steps[i]) {
                        onStepToggle(selectedInstrument, i, active);
                      }
                    });
                  }}
                  title="Duplicate first 8 steps to last 8"
                >
                  &#8648;
                </button>
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
                const vel = drumState[selectedInstrument].stepVelocities?.[step] ?? 1;
                const chance = drumState[selectedInstrument].stepProbabilities?.[step] ?? 1;
                const repeats = drumState[selectedInstrument].stepRatchets?.[step] ?? 1;
                const stepBand = step < 4 ? 'band-a' : step < 8 ? 'band-b' : step < 12 ? 'band-c' : 'band-d';
                return (
                  <button
                    key={step}
                    className={`drum-step-btn ${stepBand} ${active ? 'active' : ''} ${active && chance < 1 ? 'chance' : ''} ${isPlaying && currentStep === step ? 'current' : ''}`}
                    aria-label={`${INSTRUMENT_LABELS[selectedInstrument]} step ${step + 1}`}
                    aria-pressed={active}
                    style={{ '--drum-color': INSTRUMENT_COLORS[selectedInstrument] } as React.CSSProperties}
                    onClick={(e) => handleStepClick(step, e.shiftKey)}
                    title={active ? `Velocity: ${Math.round(vel * 100)}% (Shift+click to change) · Chance: ${Math.round(chance * 100)}% · Repeats: ${repeats}` : ''}
                  >
                    <span className="drum-step-led" />
                    {active && <span className="drum-step-velocity" style={{ height: `${vel * 100}%` }} />}
                    {active && repeats > 1 && <span className="drum-step-repeats">×{repeats}</span>}
                  </button>
                );
              })}
            </div>
            <div className="drum-step-note">
              Select an instrument, then program its 16 steps.
            </div>
            <label className="drum-step-note">
              Step {selectedVelocityStep + 1} velocity
              <input
                type="range"
                aria-label={`${INSTRUMENT_LABELS[selectedInstrument]} step ${selectedVelocityStep + 1} velocity`}
                min={0}
                max={1}
                step={0.01}
                value={drumState[selectedInstrument].stepVelocities?.[selectedVelocityStep] ?? 1}
                onChange={(event) => onStepVelocityChange(selectedInstrument, selectedVelocityStep, Number(event.target.value))}
              />
            </label>
            <div className="drum-step-details">
              <label className="drum-step-note" title="How often this step plays each time the pattern comes round">
                Chance
                <input
                  type="range"
                  aria-label={`${INSTRUMENT_LABELS[selectedInstrument]} step ${selectedVelocityStep + 1} chance`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={drumState[selectedInstrument].stepProbabilities?.[selectedVelocityStep] ?? 1}
                  onChange={(event) => onStepDetailChange(selectedInstrument, selectedVelocityStep, { probability: Number(event.target.value) })}
                />
                <span>{Math.round((drumState[selectedInstrument].stepProbabilities?.[selectedVelocityStep] ?? 1) * 100)}%</span>
              </label>
              <label className="drum-step-note" title="Hits packed evenly into this step">
                Repeats
                <select
                  aria-label={`${INSTRUMENT_LABELS[selectedInstrument]} step ${selectedVelocityStep + 1} repeats`}
                  value={drumState[selectedInstrument].stepRatchets?.[selectedVelocityStep] ?? 1}
                  onChange={(event) => onStepDetailChange(selectedInstrument, selectedVelocityStep, { ratchet: Number(event.target.value) })}
                >
                  {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
