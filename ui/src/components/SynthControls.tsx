/**
 * Synthesizer Controls with hardware-style knob layout
 * Organized like a classic analog synthesizer panel
 */

import { useState, type ReactNode } from 'react';
import { createDefaultSynthParameters } from '@discobot/engine';
import { SynthParameters, OscillatorType, SynthModelId } from '../types';
import { SYNTH_MODELS } from '../synthModels';
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
  onModelChange: (modelId: SynthModelId) => void;
  tab: SynthTab;
  onTabChange: (tab: SynthTab) => void;
  // shown on the Notes tab: step tools and the keyboard
  notes: ReactNode;
  onRemove?: () => void;
}

export type SynthTab = 'notes' | 'osc' | 'filter' | 'amp' | 'lfo' | 'arp' | 'sends';
const TABS: Array<{ id: SynthTab; label: string }> = [
  { id: 'notes', label: 'Notes' }, { id: 'osc', label: 'Osc' }, { id: 'filter', label: 'Filter' }, { id: 'amp', label: 'Amp' },
  { id: 'lfo', label: 'LFO' }, { id: 'arp', label: 'Arp' }, { id: 'sends', label: 'Sends' },
];
const COLUMN_TABS: Record<string, SynthTab> = {
  OSC: 'osc', FM: 'osc', 'OSC 2': 'osc', MIX: 'osc', VOICE: 'osc',
  FILTER: 'filter', 'FILTER MOD': 'filter', 'FILTER ENV': 'filter',
  'ENV A': 'amp', SHAPE: 'amp', 'ENV B': 'amp', MASTER: 'amp', STEREO: 'amp',
  'LFO 1': 'lfo', 'LFO 1 MOD': 'lfo', 'LFO 2': 'lfo', 'LFO 2 MOD': 'lfo',
  'FX SEND A': 'sends', 'FX SEND B': 'sends',
};

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
  pulseWidth: 'Pulse width of the square wave - 50% is a plain square, narrower is thinner and more nasal',
  osc2Semitones: 'Oscillator 2 pitch offset in semitones',
  osc2Detune: 'Oscillator 2 fine tuning in cents - a few cents against oscillator 1 gives a thick, beating sound',
  osc2Level: 'Oscillator 2 level in the mix',
  sub: 'Square wave one octave below oscillator 1',
  noise: 'White noise level',
  envAmount: 'How far the filter envelope moves the cutoff - negative closes the filter instead of opening it',
  keyTracking: 'How much the cutoff follows the note played, so high notes stay bright',
  filterDrive: 'Overdrive into the filter',
  velocityAmp: 'How much step or key velocity changes loudness',
  velocityFilter: 'How much velocity opens the filter - this is the accent on an acid bassline',
  fmRatio: 'Modulator frequency as a multiple of the note - whole numbers are harmonic, others are bell-like',
  fmIndex: 'Modulation depth - more adds brightness and bite',
  fmDecay: 'How quickly the modulation fades after the note starts - short gives a pluck',
  fmFeedback: 'Modulator feedback - adds grit',
};

const DEFAULTS = createDefaultSynthParameters();

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

const parsePan = (input: string): number | null => {
  const text = input.trim().toUpperCase();
  if (text === 'C') return 0;
  const n = parseNumber(text);
  return n === null ? null : (text.startsWith('L') ? -Math.abs(n) : n) / 100;
};

const parseSyncedRate = (input: string): number | null => parseNumber(input.includes('/') ? input.split('/').pop()! : input);

const parseCutoff = (input: string): number | null => {
  const trimmed = input.trim().toLowerCase();
  const n = parseNumber(trimmed);
  if (n === null) return null;
  return trimmed.includes('k') ? n * 1000 : n;
};

export function createNamedSynthPresets(base: SynthParameters) {
  const sounds: Array<[string, OscillatorType, number, number, number, number, number, number]> = [
    ['Bass — Deep Sub', 'sine', 420, 0.8, 0.003, 0.18, 0.8, 0.12],
    ['Bass — Acid Pulse', 'sawtooth', 780, 9, 0.003, 0.2, 0.35, 0.08],
    ['Bass — Rubber Square', 'square', 1100, 3.2, 0.008, 0.24, 0.45, 0.16],
    ['Lead — Bright Saw', 'sawtooth', 7600, 2.5, 0.012, 0.2, 0.7, 0.22],
    ['Lead — Soft Triangle', 'triangle', 3800, 1.2, 0.035, 0.25, 0.65, 0.35],
    ['Lead — Singing Pulse', 'square', 4400, 4, 0.06, 0.3, 0.72, 0.4],
    ['Pad — Warm Cloud', 'triangle', 1800, 1.4, 0.75, 0.8, 0.82, 1.8],
    ['Pad — Glass Air', 'sine', 9800, 0.8, 0.45, 0.9, 0.75, 1.4],
    ['Pad — Analog Strings', 'sawtooth', 2600, 2, 0.65, 0.55, 0.8, 1.2],
    ['Pluck — Bell', 'sine', 12000, 1, 0.002, 0.55, 0.05, 0.45],
    ['Pluck — Wooden', 'triangle', 1900, 2, 0.002, 0.18, 0, 0.12],
    ['Pluck — Short Wire', 'sawtooth', 4800, 3, 0.001, 0.12, 0, 0.08],
  ];
  return sounds.map(([name, type, frequency, q, attack, decay, sustain, release], index) => {
    const pad = name.startsWith('Pad');
    const bass = name.startsWith('Bass');
    return {
      id: `builtin-named-${index}`,
      name,
      builtIn: true,
      modelId: 'generic' as SynthModelId,
      modelParams: { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 },
      params: {
        ...base,
        hold: false,
        gain: bass ? 0.55 : 0.45,
        pan: 0,
        spread: pad ? 0.55 : 0,
        oscillator: { type, detune: pad ? 7 : 0 },
        filter: { ...base.filter, type: 'lowpass' as const, frequency, q },
        envelope: { attack, decay, sustain, release },
        lfo1: { ...base.lfo1, enabled: pad, sync: false, rate: 0.6, depth: 0.15, target: 'filter' as const },
        lfo2: { ...base.lfo2, enabled: false, sync: false },
        arpeggiator: { ...base.arpeggiator, enabled: false },
        portamento: { ...base.portamento, enabled: false },
        fxSends: { reverb: bass ? 0.03 : pad ? 0.5 : 0.22, delay: bass ? 0 : 0.18, drive: bass ? 0.2 : 0.05, phaser: pad ? 0.15 : 0 },
      },
    };
  });
}

export default function SynthControls({
  parameters,
  onParameterChange,
  presets,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  synthModelId,
  onModelChange,
  tab,
  onTabChange,
  notes,
  onRemove,
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

  const updateLfoSync = (lfo: 'lfo1' | 'lfo2', sync: boolean) => {
    const rate = parameters[lfo].rate;
    updateLfo(lfo, {
      sync,
      rate: sync ? Math.max(1, Math.min(128, Math.round(rate))) : Math.max(0.1, Math.min(20, rate)),
    });
  };

  // Projects saved before these sections existed load without them.
  const osc2 = parameters.oscillator2 ?? DEFAULTS.oscillator2!;
  const mixer = parameters.mixer ?? DEFAULTS.mixer!;
  const filterEnvelope = parameters.filterEnvelope ?? DEFAULTS.filterEnvelope!;
  const velocity = parameters.velocity ?? DEFAULTS.velocity!;
  const fm = parameters.fm ?? DEFAULTS.fm!;
  const isFm = parameters.engine === 'fm';

  const updateOscillator2 = (updates: Partial<NonNullable<SynthParameters['oscillator2']>>) => {
    onParameterChange({ oscillator2: { ...osc2, ...updates } });
  };
  const updateMixer = (updates: Partial<NonNullable<SynthParameters['mixer']>>) => {
    onParameterChange({ mixer: { ...mixer, ...updates } });
  };
  const updateFilterEnvelope = (updates: Partial<SynthParameters['envelope']>) => {
    onParameterChange({ filterEnvelope: { ...filterEnvelope, ...updates } });
  };
  const updateVelocity = (updates: Partial<NonNullable<SynthParameters['velocity']>>) => {
    onParameterChange({ velocity: { ...velocity, ...updates } });
  };
  const updateFm = (updates: Partial<NonNullable<SynthParameters['fm']>>) => {
    onParameterChange({ fm: { ...fm, ...updates } });
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

  return (
    <div className="synth-controls-panel">
      <div className="synth-header">
        <div className="synth-octave-controls">
          <label className="synth-toggle" title={TOOLTIPS.hold}>
            <input
              type="checkbox"
              aria-label="Hold notes"
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
              aria-label="Synth model"
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
          {onRemove && (
            <button className="octave-shift-btn" onClick={onRemove} title="Remove this synth lane">Remove</button>
          )}
          <div className="preset-controls">
            <select
              className="synth-select preset-select"
              aria-label="Synth preset"
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
              aria-label="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (!presetName.trim()) return;
                  onSavePreset(presetName.trim());
                  setPresetName('');
                }
              }}
            />
            <button
              className="octave-shift-btn"
              disabled={!presetName.trim()}
              onClick={() => {
                onSavePreset(presetName.trim());
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
        </div>
      </div>

      <div className="synth-tabs" role="tablist" aria-label="Synth editor">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'active' : ''}
            onClick={() => onTabChange(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'notes' && notes}
      {tab === 'arp' && (
        <div className="synth-arp-panel">
        <div className="arp-controls">
          <label className="synth-toggle" title="Enable arpeggiator for this synth">
            <input
              type="checkbox"
              aria-label="Arpeggiator enabled"
              checked={parameters.arpeggiator.enabled}
              onChange={(e) => updateArpeggiator({ enabled: e.target.checked })}
            />
            <span className="synth-toggle-slider" />
          </label>
          <span className="octave-shift-value">ARP</span>
          <select
            className="synth-select arp-select"
            aria-label="Arpeggiator mode"
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
            aria-label="Arpeggiator rate"
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
      )}

      <div className="synth-columns" data-tab={tab}>
        <div className="synth-column" data-tab={COLUMN_TABS['OSC']}>
          <h3>OSC</h3>
          <div className="synth-column-controls">
            <div className="synth-waveform-selector">
              <label>ENGINE</label>
              <select
                value={isFm ? 'fm' : 'subtractive'}
                aria-label="Synth engine"
                onChange={(e) => onParameterChange({ engine: e.target.value as 'subtractive' | 'fm' })}
                className="synth-select"
              >
                <option value="subtractive">Analog</option>
                <option value="fm">FM</option>
              </select>
            </div>
            <div className="synth-waveform-selector">
              <label>WAVE</label>
              <select
                value={parameters.oscillator.type}
                aria-label="Oscillator waveform"
                onChange={(e) => updateOscillator({ type: e.target.value as OscillatorType })}
                className="synth-select"
                disabled={isFm}
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
            <Knob
              label="Pulse W"
              value={parameters.oscillator.pulseWidth ?? 0.5}
              min={0.05}
              max={0.95}
              step={0.01}
              displayValue={`${Math.round((parameters.oscillator.pulseWidth ?? 0.5) * 100)}%`}
              onChange={(v) => updateOscillator({ pulseWidth: v })}
              parseInputValue={parsePercent(0, 1)}
              disabled={isFm || parameters.oscillator.type !== 'square'}
              color="#3b82f6"
              tooltip={TOOLTIPS.pulseWidth}
            />
          </div>
        </div>

        {isFm ? (
          <div className="synth-column" data-tab={COLUMN_TABS['FM']}>
            <h3>FM</h3>
            <div className="synth-column-controls">
              <div className="synth-waveform-selector">
                <label>ALGO</label>
                <select
                  value={fm.algorithm}
                  aria-label="FM algorithm"
                  onChange={(e) => updateFm({ algorithm: Number(e.target.value) })}
                  className="synth-select"
                >
                  <option value={0}>Stack</option>
                  <option value={1}>Dual</option>
                  <option value={2}>Fan</option>
                  <option value={3}>Organ</option>
                </select>
              </div>
              <Knob
                label="Ratio"
                value={fm.ratio}
                min={0.5}
                max={14}
                step={0.5}
                displayValue={`${fm.ratio}x`}
                onChange={(v) => updateFm({ ratio: v })}
                color="#f97316"
                tooltip={TOOLTIPS.fmRatio}
              />
              <Knob
                label="Amount"
                value={fm.index}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${Math.round(fm.index * 100)}%`}
                onChange={(v) => updateFm({ index: v })}
                parseInputValue={parsePercent(0, 1)}
                color="#f97316"
                tooltip={TOOLTIPS.fmIndex}
              />
              <Knob
                label="Mod Decay"
                value={fm.decay}
                min={0.02}
                max={4}
                step={0.01}
                displayValue={`${(fm.decay * 1000).toFixed(0)}ms`}
                onChange={(v) => updateFm({ decay: v })}
                parseInputValue={parseMilliseconds}
                color="#f97316"
                tooltip={TOOLTIPS.fmDecay}
              />
              <Knob
                label="Feedback"
                value={fm.feedback}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${Math.round(fm.feedback * 100)}%`}
                onChange={(v) => updateFm({ feedback: v })}
                parseInputValue={parsePercent(0, 1)}
                color="#f97316"
                tooltip={TOOLTIPS.fmFeedback}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="synth-column" data-tab={COLUMN_TABS['OSC 2']}>
              <div className="synth-section-header">
                <h3>OSC 2</h3>
                <label className="synth-toggle">
                  <input
                    type="checkbox"
                    checked={osc2.enabled}
                    aria-label="Oscillator 2 enabled"
                    onChange={(e) => updateOscillator2({ enabled: e.target.checked })}
                  />
                  <span className="synth-toggle-slider" />
                </label>
              </div>
              <div className="synth-column-controls">
                <div className="synth-waveform-selector">
                  <label>WAVE</label>
                  <select
                    value={osc2.type}
                    aria-label="Oscillator 2 waveform"
                    onChange={(e) => updateOscillator2({ type: e.target.value as OscillatorType })}
                    className="synth-select"
                    disabled={!osc2.enabled}
                  >
                    <option value="sine">~</option>
                    <option value="square">⎍</option>
                    <option value="sawtooth">/|</option>
                    <option value="triangle">/\</option>
                  </select>
                </div>
                <Knob
                  label="Semi"
                  value={osc2.semitones}
                  min={-24}
                  max={24}
                  step={1}
                  displayValue={`${osc2.semitones > 0 ? '+' : ''}${osc2.semitones}`}
                  onChange={(v) => updateOscillator2({ semitones: Math.round(v) })}
                  disabled={!osc2.enabled}
                  color="#6366f1"
                  tooltip={TOOLTIPS.osc2Semitones}
                />
                <Knob
                  label="Fine"
                  value={osc2.detune}
                  min={-50}
                  max={50}
                  step={1}
                  displayValue={`${osc2.detune > 0 ? '+' : ''}${osc2.detune}`}
                  onChange={(v) => updateOscillator2({ detune: v })}
                  disabled={!osc2.enabled}
                  color="#6366f1"
                  tooltip={TOOLTIPS.osc2Detune}
                />
              </div>
            </div>

            <div className="synth-column" data-tab={COLUMN_TABS['MIX']}>
              <h3>MIX</h3>
              <div className="synth-column-controls">
                <Knob
                  label="Osc 2"
                  value={osc2.level}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round(osc2.level * 100)}%`}
                  onChange={(v) => updateOscillator2({ level: v })}
                  parseInputValue={parsePercent(0, 1)}
                  disabled={!osc2.enabled}
                  color="#6366f1"
                  tooltip={TOOLTIPS.osc2Level}
                />
                <Knob
                  label="Sub"
                  value={mixer.sub}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round(mixer.sub * 100)}%`}
                  onChange={(v) => updateMixer({ sub: v })}
                  parseInputValue={parsePercent(0, 1)}
                  color="#6366f1"
                  tooltip={TOOLTIPS.sub}
                />
                <Knob
                  label="Noise"
                  value={mixer.noise}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round(mixer.noise * 100)}%`}
                  onChange={(v) => updateMixer({ noise: v })}
                  parseInputValue={parsePercent(0, 1)}
                  color="#6366f1"
                  tooltip={TOOLTIPS.noise}
                />
              </div>
            </div>
          </>
        )}

        <div className="synth-column" data-tab={COLUMN_TABS['FILTER']}>
          <h3>FILTER</h3>
          <div className="synth-column-controls">
            <div className="synth-filter-type-row">
              <select
                className="synth-filter-type-select"
                aria-label="Filter type"
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

        <div className="synth-column" data-tab={COLUMN_TABS['FILTER MOD']}>
          <h3>FILTER MOD</h3>
          <div className="synth-column-controls">
            <Knob
              label="Env Amt"
              value={parameters.filter.envAmount ?? 0}
              min={-1}
              max={1}
              step={0.01}
              displayValue={`${Math.round((parameters.filter.envAmount ?? 0) * 100)}%`}
              onChange={(v) => updateFilter({ envAmount: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#14b8a6"
              tooltip={TOOLTIPS.envAmount}
            />
            <Knob
              label="Key Trk"
              value={parameters.filter.keyTracking ?? 0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round((parameters.filter.keyTracking ?? 0) * 100)}%`}
              onChange={(v) => updateFilter({ keyTracking: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#14b8a6"
              tooltip={TOOLTIPS.keyTracking}
            />
            <Knob
              label="Flt Drive"
              value={parameters.filter.drive ?? 0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round((parameters.filter.drive ?? 0) * 100)}%`}
              onChange={(v) => updateFilter({ drive: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#14b8a6"
              tooltip={TOOLTIPS.filterDrive}
            />
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['FILTER ENV']}>
          <h3>FILTER ENV</h3>
          <div className="synth-column-controls">
            <Knob
              label="F Attack"
              value={filterEnvelope.attack}
              min={0.001}
              max={2}
              step={0.001}
              displayValue={`${(filterEnvelope.attack * 1000).toFixed(0)}ms`}
              onChange={(v) => updateFilterEnvelope({ attack: v })}
              parseInputValue={parseMilliseconds}
              color="#14b8a6"
              tooltip="Time for the filter envelope to reach its peak"
            />
            <Knob
              label="F Decay"
              value={filterEnvelope.decay}
              min={0.001}
              max={2}
              step={0.001}
              displayValue={`${(filterEnvelope.decay * 1000).toFixed(0)}ms`}
              onChange={(v) => updateFilterEnvelope({ decay: v })}
              parseInputValue={parseMilliseconds}
              color="#14b8a6"
              tooltip="Time for the filter envelope to fall to its sustain level"
            />
            <Knob
              label="F Sustain"
              value={filterEnvelope.sustain}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(filterEnvelope.sustain * 100).toFixed(0)}%`}
              onChange={(v) => updateFilterEnvelope({ sustain: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#14b8a6"
              tooltip="Filter envelope level held while the key is down"
            />
            <Knob
              label="F Release"
              value={filterEnvelope.release}
              min={0.001}
              max={5}
              step={0.001}
              displayValue={`${(filterEnvelope.release * 1000).toFixed(0)}ms`}
              onChange={(v) => updateFilterEnvelope({ release: v })}
              parseInputValue={parseMilliseconds}
              color="#14b8a6"
              tooltip="Time for the filter envelope to close after the key is released"
            />
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['VOICE']}>
          <h3>VOICE</h3>
          <div className="synth-column-controls">
            <div className="synth-waveform-selector">
              <label>MODE</label>
              <select
                value={parameters.voiceMode ?? 'poly'}
                aria-label="Voice mode"
                onChange={(e) => onParameterChange({ voiceMode: e.target.value as 'poly' | 'mono' })}
                className="synth-select"
                title="Poly plays chords. Mono plays one note at a time and glides between tied notes."
              >
                <option value="poly">Poly</option>
                <option value="mono">Mono</option>
              </select>
            </div>
            <Knob
              label="Vel Amp"
              value={velocity.amp}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(velocity.amp * 100)}%`}
              onChange={(v) => updateVelocity({ amp: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#eab308"
              tooltip={TOOLTIPS.velocityAmp}
            />
            <Knob
              label="Accent"
              value={velocity.filter}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(velocity.filter * 100)}%`}
              onChange={(v) => updateVelocity({ filter: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#eab308"
              tooltip={TOOLTIPS.velocityFilter}
            />
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['LFO 1']}>
          <div className="synth-section-header">
            <h3>LFO 1</h3>
            <label className="synth-toggle">
              <input
                type="checkbox"
                checked={parameters.lfo1.enabled}
                aria-label="LFO 1 enabled"
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
                aria-label="LFO 1 waveform"
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
                aria-label="LFO 1 target"
                onChange={(e) => updateLfo('lfo1', { target: e.target.value as SynthParameters['lfo1']['target'] })}
                className="synth-select"
                disabled={!parameters.lfo1.enabled}
              >
                <option value="pitch">Pitch</option>
                <option value="filter">Filter</option>
                <option value="amp">Amp</option>
                <option value="pulseWidth">Pulse W</option>
              </select>
            </div>
            <div className="synth-waveform-selector">
              <label>PHASE</label>
              <select
                value={parameters.lfo1.retrigger === false ? 'free' : 'retrigger'}
                aria-label="LFO 1 phase mode"
                onChange={(e) => updateLfo('lfo1', { retrigger: e.target.value !== 'free' })}
                className="synth-select"
                disabled={!parameters.lfo1.enabled}
                title="Retrig restarts the LFO on every note. Free keeps one LFO running for the whole lane."
              >
                <option value="retrigger">Retrig</option>
                <option value="free">Free</option>
              </select>
            </div>
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['LFO 1 MOD']}>
          <h3>LFO 1 MOD</h3>
          <div className="synth-column-controls">
            <div className="synth-lfo-rate-row">
              <label className="synth-toggle small">
                <input
                  type="checkbox"
                  checked={parameters.lfo1.sync ?? false}
                  aria-label="LFO 1 tempo sync"
                  onChange={(e) => updateLfoSync('lfo1', e.target.checked)}
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
                parseInputValue={parameters.lfo1.sync ? parseSyncedRate : parseNumber}
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

        <div className="synth-column" data-tab={COLUMN_TABS['LFO 2']}>
          <div className="synth-section-header">
            <h3>LFO 2</h3>
            <label className="synth-toggle">
              <input
                type="checkbox"
                checked={parameters.lfo2.enabled}
                aria-label="LFO 2 enabled"
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
                aria-label="LFO 2 waveform"
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
                aria-label="LFO 2 target"
                onChange={(e) => updateLfo('lfo2', { target: e.target.value as SynthParameters['lfo1']['target'] })}
                className="synth-select"
                disabled={!parameters.lfo2.enabled}
              >
                <option value="pitch">Pitch</option>
                <option value="filter">Filter</option>
                <option value="amp">Amp</option>
                <option value="pulseWidth">Pulse W</option>
              </select>
            </div>
            <div className="synth-waveform-selector">
              <label>PHASE</label>
              <select
                value={parameters.lfo2.retrigger === false ? 'free' : 'retrigger'}
                aria-label="LFO 2 phase mode"
                onChange={(e) => updateLfo('lfo2', { retrigger: e.target.value !== 'free' })}
                className="synth-select"
                disabled={!parameters.lfo2.enabled}
                title="Retrig restarts the LFO on every note. Free keeps one LFO running for the whole lane."
              >
                <option value="retrigger">Retrig</option>
                <option value="free">Free</option>
              </select>
            </div>
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['LFO 2 MOD']}>
          <h3>LFO 2 MOD</h3>
          <div className="synth-column-controls">
            <div className="synth-lfo-rate-row">
              <label className="synth-toggle small">
                <input
                  type="checkbox"
                  checked={parameters.lfo2.sync ?? false}
                  aria-label="LFO 2 tempo sync"
                  onChange={(e) => updateLfoSync('lfo2', e.target.checked)}
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
                parseInputValue={parameters.lfo2.sync ? parseSyncedRate : parseNumber}
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

        <div className="synth-column" data-tab={COLUMN_TABS['ENV A']}>
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

        <div className="synth-column synth-env-viz" data-tab={COLUMN_TABS['SHAPE']}>
          <h3>SHAPE</h3>
          <div className="synth-column-controls" style={{ justifyContent: 'center' }}>
            <svg viewBox="0 0 100 60" width="100%" style={{ maxWidth: 100 }}>
              {(() => {
                const { attack, decay, sustain, release } = parameters.envelope;
                const total = Math.max(0.01, attack + decay + 0.5 + release);
                const xA = (attack / total) * 100;
                const xD = xA + (decay / total) * 100;
                const xS = xD + (0.5 / total) * 100;
                const xR = Math.min(100, xS + (release / total) * 100);
                const sY = 60 - sustain * 50;
                const points = `0,60 ${xA},10 ${xD},${sY} ${xS},${sY} ${xR},60`;
                return <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="1.5" />;
              })()}
            </svg>
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['ENV B']}>
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

        <div className="synth-column" data-tab={COLUMN_TABS['FX SEND A']}>
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

        <div className="synth-column" data-tab={COLUMN_TABS['FX SEND B']}>
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

        <div className="synth-column" data-tab={COLUMN_TABS['MASTER']}>
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
              parseInputValue={parsePercent(0, 1)}
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

        <div className="synth-column" data-tab={COLUMN_TABS['STEREO']}>
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
              parseInputValue={parsePan}
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
                  aria-label="Portamento enabled"
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
              parseInputValue={parseMilliseconds}
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
