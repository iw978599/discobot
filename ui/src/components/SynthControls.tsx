/**
 * Synthesizer Controls with hardware-style knob layout
 * Organized like a classic analog synthesizer panel
 */

import { useState } from 'react';
import { SynthParameters, OscillatorType, SynthModelId, SynthModelParams } from '../types';
import { SYNTH_MODELS, getSynthModelDefinition } from '../synthModels';
import Knob from './Knob';
import './SynthControls.css';

interface SynthControlsProps {
  parameters: SynthParameters;
  onParameterChange: (params: Partial<SynthParameters>) => void;
  presets: Array<{ id: string; name: string; builtIn?: boolean }>;
  onSavePreset: (name: string) => void;
  onLoadPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  onModelChange: (modelId: SynthModelId) => void;
  onModelParamsChange: (params: Partial<SynthModelParams>) => void;
}

const TOOLTIPS = {
  hold: 'Latch notes on the keyboard until toggled off or tapped again',
  gain: 'Master output volume',
  oscType: 'Waveform shape: Sine (smooth), Square (harsh), Sawtooth (bright), Triangle (soft)',
  detune: 'Fine pitch adjustment in cents (±100 = ±1 semitone)',
  filterFreq: 'Cutoff frequency - Higher = brighter, lower = darker',
  filterQ: 'Resonance - emphasis at cutoff frequency',
  lfoRate: 'LFO speed in cycles per second',
  lfoDepth: 'LFO modulation amount',
  attack: 'Time to reach full volume after key press',
  decay: 'Time to drop from peak to sustain level',
  sustain: 'Volume level held while key is pressed',
  release: 'Time to fade out after key release',
  fxSend: 'Send amount into shared FX loop',
  fxReturn: 'Per-synth return level from the shared FX loop',
  drive: 'Waveshaper drive - adds harmonic distortion and warmth',
  lfo2Enable: 'Enable/disable LFO 2 modulation',
  pan: 'Stereo position - left, center, or right',
  portamentoEnable: 'Enable pitch glide between consecutive notes',
  portamentoGlide: 'Glide time - how long to slide between notes',
};

const parseNumber = (input: string): number | null => {
  const n = Number.parseFloat(input.replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const parsePercent = (min: number, max: number) => (input: string): number | null => {
  const pct = parseNumber(input);
  if (pct === null) return null;
  return min + ((pct / 100) * (max - min));
};

const parseMilliseconds = (input: string): number | null => {
  const ms = parseNumber(input);
  return ms === null ? null : ms / 1000;
};

const parseCutoff = (input: string): number | null => {
  const trimmed = input.trim().toLowerCase();
  const n = parseNumber(trimmed);
  if (n === null) return null;
  return trimmed.includes('k') ? n * 1000 : n;
};

export default function SynthControls({
  parameters,
  onParameterChange,
  presets,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  synthModelId,
  synthModelParams,
  onModelChange,
  onModelParamsChange,
}: SynthControlsProps) {
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const updateOscillator = (updates: Partial<SynthParameters['oscillator']>) => {
    onParameterChange({
      oscillator: { ...parameters.oscillator, ...updates },
    });
  };

  const updateFilter = (updates: Partial<SynthParameters['filter']>) => {
    onParameterChange({
      filter: { ...parameters.filter, ...updates },
    });
  };

  const updateLfo = (lfo: 'lfo1' | 'lfo2', updates: Partial<SynthParameters['lfo1']>) => {
    onParameterChange({
      [lfo]: { ...parameters[lfo], ...updates },
    } as Partial<SynthParameters>);
  };

  const updateEnvelope = (updates: Partial<SynthParameters['envelope']>) => {
    onParameterChange({
      envelope: { ...parameters.envelope, ...updates },
    });
  };

  const updateFxSends = (updates: Partial<SynthParameters['fxSends']>) => {
    onParameterChange({
      fxSends: {
        ...parameters.fxSends,
        ...updates,
      },
    });
  };

  const updatePortamento = (updates: Partial<SynthParameters['portamento']>) => {
    onParameterChange({
      portamento: { ...parameters.portamento, ...updates },
    });
  };

  const updateArpeggiator = (updates: Partial<SynthParameters['arpeggiator']>) => {
    onParameterChange({
      arpeggiator: {
        ...parameters.arpeggiator,
        ...updates,
      },
    });
  };

  const model = getSynthModelDefinition(synthModelId);

  return (
    <div className="synth-controls-panel">
      <div className="synth-header">
        <h2>SYNTHESIZER</h2>
        <div className="synth-octave-controls">
          <label className="synth-toggle" title={TOOLTIPS.hold}>
            <input
              type="checkbox"
              checked={Boolean(parameters.hold)}
              onChange={(e) => onParameterChange({ hold: e.target.checked })}
            />
            <span className="synth-toggle-slider" />
          </label>
          <span className="octave-shift-value">HOLD</span>
          <div className="model-selector-wrap">
            <label>MODEL</label>
            <select
              className="synth-select model-select"
              value={synthModelId}
              onChange={(e) => onModelChange(e.target.value as SynthModelId)}
              title="Synth model - changes the character and behavior of the synthesizer"
            >
              {SYNTH_MODELS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="synth-header-tools">
          <div className="preset-controls">
            <select
              className="synth-select preset-select"
              value={selectedPresetId}
              onChange={(e) => {
                setSelectedPresetId(e.target.value);
                if (e.target.value) onLoadPreset(e.target.value);
              }}
            >
              <option value="" disabled>Preset...</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}{preset.builtIn ? ' *' : ''}
                </option>
              ))}
            </select>
            <input
              className="preset-name-input"
              placeholder="Save preset"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSavePreset(presetName);
                  setPresetName('');
                }
              }}
            />
            <button
              className="octave-shift-btn"
              onClick={() => {
                onSavePreset(presetName);
                setPresetName('');
              }}
            >
              Save
            </button>
            <button
              className="octave-shift-btn"
              disabled={!selectedPresetId || Boolean(presets.find((preset) => preset.id === selectedPresetId)?.builtIn)}
              onClick={() => {
                const selected = presets.find((preset) => preset.id === selectedPresetId);
                if (selected && !selected.builtIn) {
                  onDeletePreset(selected.id);
                  setSelectedPresetId('');
                }
              }}
              title="Delete selected user preset"
            >
              Delete
            </button>
          </div>
          <div className="arp-controls">
            <label className="synth-toggle" title="Enable arpeggiator for this synth">
              <input
                type="checkbox"
                checked={parameters.arpeggiator.enabled}
                onChange={(e) => updateArpeggiator({ enabled: e.target.checked })}
              />
              <span className="synth-toggle-slider" />
            </label>
            <span className="octave-shift-value">ARP</span>
            <select
              className="synth-select arp-select"
              value={parameters.arpeggiator.mode}
              onChange={(e) => updateArpeggiator({ mode: e.target.value as SynthParameters['arpeggiator']['mode'] })}
            >
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="updown">Up/Down</option>
              <option value="downup">Down/Up</option>
              <option value="random">Random</option>
              <option value="converge">Converge</option>
              <option value="diverge">Diverge</option>
            </select>
            <select
              className="synth-select arp-select"
              value={parameters.arpeggiator.rate}
              onChange={(e) => updateArpeggiator({ rate: e.target.value as SynthParameters['arpeggiator']['rate'] })}
            >
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="1/16">1/16</option>
              <option value="1/32">1/32</option>
            </select>
            <label className="arp-gate-label" title="Arpeggiator gate length - proportion of step duration the note plays">
              Gate
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={parameters.arpeggiator.gate}
                onChange={(e) => updateArpeggiator({ gate: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      </div>

      {model.macros.length > 0 && (
        <div className="synth-model-macros">
          <div className="synth-model-header">
            <h3>{model.name}</h3>
            <span>{model.subtitle}</span>
          </div>
          <div className="synth-model-macro-grid">
            {model.macros.map((macro) => (
              <Knob
                key={macro.key}
                label={macro.label}
                value={synthModelParams[macro.key]}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${Math.round(synthModelParams[macro.key] * 100)}%`}
                onChange={(value) => onModelParamsChange({ [macro.key]: value } as Partial<SynthModelParams>)}
                parseInputValue={parsePercent(0, 1)}
                color="#f59e0b"
              />
            ))}
          </div>
        </div>
      )}

      <div className="synth-columns">
        <div className="synth-column">
          <h3>OSC</h3>
          <div className="synth-column-controls">
            <div className="synth-waveform-selector">
              <label>WAVE</label>
              <select
                value={parameters.oscillator.type}
                onChange={(e) => updateOscillator({ type: e.target.value as OscillatorType })}
                className="synth-select"
              >
                <option value="sine">~</option>
                <option value="square">⎍</option>
                <option value="sawtooth">/|</option>
                <option value="triangle">/\</option>
              </select>
            </div>
            <Knob
              label="Detune"
              value={parameters.oscillator.detune}
              min={-100}
              max={100}
              step={1}
              displayValue={`${parameters.oscillator.detune > 0 ? '+' : ''}${parameters.oscillator.detune}`}
              onChange={(v) => updateOscillator({ detune: v })}
              color="#3b82f6"
              tooltip={TOOLTIPS.detune}
            />
          </div>
        </div>

        <div className="synth-column">
          <h3>FILTER</h3>
          <div className="synth-column-controls">
            <div className="synth-filter-type-row">
              <select
                className="synth-filter-type-select"
                value={parameters.filter.type || 'lowpass'}
                onChange={(e) => updateFilter({ type: e.target.value as 'lowpass' | 'highpass' | 'bandpass' | 'notch' })}
              >
                <option value="lowpass">LP</option>
                <option value="highpass">HP</option>
                <option value="bandpass">BP</option>
                <option value="notch">NT</option>
              </select>
            </div>
            <Knob
              label="Cutoff"
              value={parameters.filter.frequency}
              min={20}
              max={20000}
              step={10}
              displayValue={parameters.filter.frequency >= 1000 ? `${(parameters.filter.frequency / 1000).toFixed(1)}k` : `${parameters.filter.frequency}`}
              onChange={(v) => updateFilter({ frequency: v })}
              parseInputValue={parseCutoff}
              color="#10b981"
              tooltip={TOOLTIPS.filterFreq}
            />
            <Knob
              label="Resonance"
              value={parameters.filter.q}
              min={0.1}
              max={20}
              step={0.1}
              onChange={(v) => updateFilter({ q: v })}
              color="#10b981"
              tooltip={TOOLTIPS.filterQ}
            />
          </div>
        </div>

        <div className="synth-column">
          <div className="synth-section-header">
            <h3>LFO 1</h3>
            <label className="synth-toggle">
              <input
                type="checkbox"
                checked={parameters.lfo1.enabled}
                onChange={(e) => updateLfo('lfo1', { enabled: e.target.checked })}
              />
              <span className="synth-toggle-slider" />
            </label>
          </div>
          <div className="synth-column-controls">
            <div className="synth-waveform-selector">
              <label>WAVE</label>
              <select
                value={parameters.lfo1.waveform}
                onChange={(e) => updateLfo('lfo1', { waveform: e.target.value as OscillatorType })}
                className="synth-select"
                disabled={!parameters.lfo1.enabled}
              >
                <option value="sine">~</option>
                <option value="square">⎍</option>
                <option value="sawtooth">/|</option>
                <option value="triangle">/\</option>
              </select>
            </div>
            <div className="synth-waveform-selector">
              <label>TARGET</label>
              <select
                value={parameters.lfo1.target}
                onChange={(e) => updateLfo('lfo1', { target: e.target.value as 'pitch' | 'filter' })}
                className="synth-select"
                disabled={!parameters.lfo1.enabled}
              >
                <option value="pitch">Pitch</option>
                <option value="filter">Filter</option>
              </select>
            </div>
          </div>
        </div>

        <div className="synth-column">
          <h3>LFO 1 MOD</h3>
          <div className="synth-column-controls">
            <div className="synth-lfo-rate-row">
              <label className="synth-toggle small">
                <input
                  type="checkbox"
                  checked={parameters.lfo1.sync ?? false}
                  onChange={(e) => updateLfo('lfo1', { sync: e.target.checked })}
                  disabled={!parameters.lfo1.enabled}
                />
                <span className="synth-toggle-slider" />
              </label>
              <Knob
                label="Rate"
                value={parameters.lfo1.sync ? (parameters.lfo1.rate || 4) : parameters.lfo1.rate}
                min={parameters.lfo1.sync ? 1 : 0.1}
                max={parameters.lfo1.sync ? 128 : 20}
                step={parameters.lfo1.sync ? 1 : 0.1}
                displayValue={parameters.lfo1.sync
                  ? `1/${Math.round(parameters.lfo1.rate || 4)}`
                  : `${parameters.lfo1.rate.toFixed(1)}Hz`}
                onChange={(v) => updateLfo('lfo1', { rate: v })}
                disabled={!parameters.lfo1.enabled}
                color="#06b6d4"
                tooltip="LFO rate - BPM sync converts to note values"
              />
            </div>
            <Knob
              label="Depth"
              value={parameters.lfo1.depth}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.lfo1.depth * 100).toFixed(0)}%`}
              onChange={(v) => updateLfo('lfo1', { depth: v })}
              parseInputValue={parsePercent(0, 1)}
              disabled={!parameters.lfo1.enabled}
              color="#06b6d4"
              tooltip={TOOLTIPS.lfoDepth}
            />
          </div>
        </div>

        <div className="synth-column">
          <div className="synth-section-header">
            <h3>LFO 2</h3>
            <label className="synth-toggle">
              <input
                type="checkbox"
                checked={parameters.lfo2.enabled}
                onChange={(e) => updateLfo('lfo2', { enabled: e.target.checked })}
              />
              <span className="synth-toggle-slider" />
            </label>
          </div>
          <div className="synth-column-controls">
            <div className="synth-waveform-selector">
              <label>WAVE</label>
              <select
                value={parameters.lfo2.waveform}
                onChange={(e) => updateLfo('lfo2', { waveform: e.target.value as OscillatorType })}
                className="synth-select"
                disabled={!parameters.lfo2.enabled}
              >
                <option value="sine">~</option>
                <option value="square">⎍</option>
                <option value="sawtooth">/|</option>
                <option value="triangle">/\</option>
              </select>
            </div>
            <div className="synth-waveform-selector">
              <label>TARGET</label>
              <select
                value={parameters.lfo2.target}
                onChange={(e) => updateLfo('lfo2', { target: e.target.value as 'pitch' | 'filter' })}
                className="synth-select"
                disabled={!parameters.lfo2.enabled}
              >
                <option value="pitch">Pitch</option>
                <option value="filter">Filter</option>
              </select>
            </div>
          </div>
        </div>

        <div className="synth-column">
          <h3>LFO 2 MOD</h3>
          <div className="synth-column-controls">
            <div className="synth-lfo-rate-row">
              <label className="synth-toggle small">
                <input
                  type="checkbox"
                  checked={parameters.lfo2.sync ?? false}
                  onChange={(e) => updateLfo('lfo2', { sync: e.target.checked })}
                  disabled={!parameters.lfo2.enabled}
                />
                <span className="synth-toggle-slider" />
              </label>
              <Knob
                label="Rate"
                value={parameters.lfo2.sync ? (parameters.lfo2.rate || 4) : parameters.lfo2.rate}
                min={parameters.lfo2.sync ? 1 : 0.1}
                max={parameters.lfo2.sync ? 128 : 20}
                step={parameters.lfo2.sync ? 1 : 0.1}
                displayValue={parameters.lfo2.sync
                  ? `1/${Math.round(parameters.lfo2.rate || 4)}`
                  : `${parameters.lfo2.rate.toFixed(1)}Hz`}
                onChange={(v) => updateLfo('lfo2', { rate: v })}
                disabled={!parameters.lfo2.enabled}
                color="#0891b2"
                tooltip="LFO rate - BPM sync converts to note values"
              />
            </div>
            <Knob
              label="Depth"
              value={parameters.lfo2.depth}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.lfo2.depth * 100).toFixed(0)}%`}
              onChange={(v) => updateLfo('lfo2', { depth: v })}
              parseInputValue={parsePercent(0, 1)}
              disabled={!parameters.lfo2.enabled}
              color="#0891b2"
              tooltip={TOOLTIPS.lfoDepth}
            />
          </div>
        </div>

        <div className="synth-column">
          <h3>ENV A</h3>
          <div className="synth-column-controls">
            <Knob
              label="Attack"
              value={parameters.envelope.attack}
              min={0.001}
              max={2}
              step={0.001}
              displayValue={`${(parameters.envelope.attack * 1000).toFixed(0)}ms`}
              onChange={(v) => updateEnvelope({ attack: v })}
              parseInputValue={parseMilliseconds}
              color="#f59e0b"
              tooltip={TOOLTIPS.attack}
            />
            <Knob
              label="Decay"
              value={parameters.envelope.decay}
              min={0.001}
              max={2}
              step={0.001}
              displayValue={`${(parameters.envelope.decay * 1000).toFixed(0)}ms`}
              onChange={(v) => updateEnvelope({ decay: v })}
              parseInputValue={parseMilliseconds}
              color="#f59e0b"
              tooltip={TOOLTIPS.decay}
            />
          </div>
        </div>

        <div className="synth-column synth-env-viz">
          <h3>SHAPE</h3>
          <div className="synth-column-controls" style={{ justifyContent: 'center' }}>
            <svg viewBox="0 0 100 60" width="100%" style={{ maxWidth: 100 }}>
              {(() => {
                const { attack, decay, sustain, release } = parameters.envelope;
                const total = Math.max(0.01, attack + decay + 0.5 + release);
                const xA = (attack / total) * 100;
                const xD = xA + (decay / total) * 100;
                const xS = xD + 50;
                const xR = Math.min(100, xS + (release / total) * 100);
                const sY = 60 - sustain * 50;
                const points = `0,60 ${xA},10 ${xD},${sY} ${xS},${sY} ${xR},60`;
                return <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="1.5" />;
              })()}
            </svg>
          </div>
        </div>

        <div className="synth-column">
          <h3>ENV B</h3>
          <div className="synth-column-controls">
            <Knob
              label="Sustain"
              value={parameters.envelope.sustain}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.envelope.sustain * 100).toFixed(0)}%`}
              onChange={(v) => updateEnvelope({ sustain: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#f59e0b"
              tooltip={TOOLTIPS.sustain}
            />
            <Knob
              label="Release"
              value={parameters.envelope.release}
              min={0.001}
              max={5}
              step={0.001}
              displayValue={`${(parameters.envelope.release * 1000).toFixed(0)}ms`}
              onChange={(v) => updateEnvelope({ release: v })}
              parseInputValue={parseMilliseconds}
              color="#f59e0b"
              tooltip={TOOLTIPS.release}
            />
          </div>
        </div>

        <div className="synth-column">
          <h3>FX SEND A</h3>
          <div className="synth-column-controls">
            <Knob
              label="Reverb"
              value={parameters.fxSends.reverb}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.fxSends.reverb * 100).toFixed(0)}%`}
              onChange={(v) => updateFxSends({ reverb: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#8b5cf6"
              tooltip={TOOLTIPS.fxSend}
            />
            <Knob
              label="Delay"
              value={parameters.fxSends.delay}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.fxSends.delay * 100).toFixed(0)}%`}
              onChange={(v) => updateFxSends({ delay: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#ec4899"
              tooltip={TOOLTIPS.fxSend}
            />
          </div>
        </div>

        <div className="synth-column">
          <h3>FX SEND B</h3>
          <div className="synth-column-controls">
            <Knob
              label="Drive"
              value={parameters.fxSends.drive}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.fxSends.drive * 100).toFixed(0)}%`}
              onChange={(v) => updateFxSends({ drive: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#ef4444"
              tooltip={TOOLTIPS.fxSend}
            />
            <Knob
              label="Phaser"
              value={parameters.fxSends.phaser}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.fxSends.phaser * 100).toFixed(0)}%`}
              onChange={(v) => updateFxSends({ phaser: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#3b82f6"
              tooltip={TOOLTIPS.fxSend}
            />
          </div>
        </div>

        <div className="synth-column">
          <h3>MASTER</h3>
          <div className="synth-column-controls">
            <Knob
              label="Gain"
              value={parameters.gain}
              min={0}
              max={2}
              step={0.01}
              displayValue={`${(parameters.gain * 100).toFixed(0)}%`}
              onChange={(v) => onParameterChange({ gain: v })}
              parseInputValue={parsePercent(0, 2)}
              color="#ef4444"
              tooltip={TOOLTIPS.gain}
            />
            <Knob
              label="FX Return"
              value={parameters.fxReturn}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.fxReturn * 100).toFixed(0)}%`}
              onChange={(v) => onParameterChange({ fxReturn: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#22c55e"
              tooltip={TOOLTIPS.fxReturn}
            />
          </div>
        </div>

        <div className="synth-column">
          <h3>STEREO</h3>
          <div className="synth-column-controls">
            <Knob
              label="Pan"
              value={parameters.pan}
              min={-1}
              max={1}
              step={0.01}
              displayValue={parameters.pan === 0 ? 'C' : `${parameters.pan < 0 ? 'L' : 'R'}${Math.abs(Math.round(parameters.pan * 100))}`}
              onChange={(v) => onParameterChange({ pan: v })}
              color="#8b5cf6"
              tooltip={TOOLTIPS.pan}
            />
            <Knob
              label="Spread"
              value={parameters.spread ?? 0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round((parameters.spread ?? 0) * 100)}%`}
              onChange={(v) => onParameterChange({ spread: v })}
              color="#8b5cf6"
              tooltip="Stereo spread - pans notes across stereo field based on pitch"
            />
            <div className="synth-section-header">
              <h3 style={{ fontSize: '10px' }}>GLIDE</h3>
              <label className="synth-toggle" title={TOOLTIPS.portamentoEnable}>
                <input
                  type="checkbox"
                  checked={parameters.portamento.enabled}
                  onChange={(e) => updatePortamento({ enabled: e.target.checked })}
                />
                <span className="synth-toggle-slider" />
              </label>
            </div>
            <Knob
              label="Glide"
              value={parameters.portamento.glide}
              min={0.001}
              max={0.5}
              step={0.001}
              displayValue={`${(parameters.portamento.glide * 1000).toFixed(0)}ms`}
              onChange={(v) => updatePortamento({ glide: v })}
              disabled={!parameters.portamento.enabled}
              color="#8b5cf6"
              tooltip={TOOLTIPS.portamentoGlide}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
