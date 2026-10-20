/**
 * Synthesizer Controls with hardware-style knob layout
 * Organized like a classic analog synthesizer panel
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MAX_MOD_ROUTES, MOD_DESTINATIONS, MOD_SOURCES, createDefaultSynthParameters, type ModDestination, type ModRoute, type ModSource } from '@discobot/engine';
import { SynthParameters, OscillatorType, RateSync, SynthModelId } from '../types';
import { SYNTH_MODELS, SYNTH_MODEL_GROUPS } from '../synthModels';
import { groupPresets, type PresetKind } from '../services/presetKinds';
import NestedMenu, { type NestedMenuItem } from '../rack/NestedMenu';
import { listSamples, saveSample } from '../services/sampleStore';
import { BUILT_IN_WAVES } from '../services/builtInWaves';
import { RATE_SYNCS, RATE_SYNC_LABELS } from '../services/rateSync';
import { INSERT_DEFAULT } from '../services/effectSettings';
import Knob from './Knob';
import './SynthControls.css';

interface SynthControlsProps {
  parameters: SynthParameters;
  onParameterChange: (params: Partial<SynthParameters>) => void;
  presets: Array<{ id: string; name: string; builtIn?: boolean; kind?: PresetKind }>;
  onSavePreset: (name: string) => void;
  onLoadPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  // Reads a preset file from Discobot or another synth; saves the lane's sound as a file.
  onImportPreset: (file: File) => void;
  onExportPreset: (name: string) => void;
  synthModelId: SynthModelId;
  onModelChange: (modelId: SynthModelId) => void;
  tab: SynthTab;
  onTabChange: (tab: SynthTab) => void;
  // shown on the Notes level: step tools and the keyboard
  notes: ReactNode;
  onRemove?: () => void;
  // Goes up when samples arrive from somewhere else (an imported project file), so the list is read again.
  sampleStoreVersion?: number;
  onSampleError?: (message: string) => void;
}

export type SynthTab = 'notes' | 'osc' | 'filter' | 'amp' | 'lfo' | 'arp' | 'sends' | 'inserts';
// The editor has two levels: what the lane plays, and what it sounds like. Sound has a page for
// each of the rest of `SynthTab`; a lane on any of them is on the Sound level.
type SynthLevel = 'notes' | 'sound';
const LEVELS: Array<{ id: SynthLevel; label: string }> = [{ id: 'notes', label: 'Notes' }, { id: 'sound', label: 'Sound' }];
const SOUND_TABS: Array<{ id: SynthTab; label: string }> = [
  { id: 'osc', label: 'Osc' }, { id: 'filter', label: 'Filter' }, { id: 'amp', label: 'Amp' },
  { id: 'lfo', label: 'LFO' }, { id: 'arp', label: 'Arp' }, { id: 'inserts', label: 'Inserts' }, { id: 'sends', label: 'Sends' },
];
const INSERT_DELAY_SYNCS: RateSync[] = ['off', '1/2', '1/4d', '1/4', '1/8d', '1/4t', '1/8', '1/8t', '1/16'];

// In a row of tabs the arrow keys, Home and End move to a tab and open it; Tab leaves the row.
const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const at = tabs.indexOf(event.target as HTMLElement);
  const to = event.key === 'ArrowRight' ? (at + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (at + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1 : -1;
  if (at < 0 || to < 0 || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  tabs[to].focus();
  tabs[to].click();
};
const COLUMN_TABS: Record<string, SynthTab> = {
  OSC: 'osc', FM: 'osc', 'OSC 2': 'osc', MIX: 'osc', VOICE: 'osc',
  FILTER: 'filter', 'FILTER MOD': 'filter', 'FILTER ENV': 'filter',
  'ENV A': 'amp', SHAPE: 'amp', 'ENV B': 'amp', MASTER: 'amp', STEREO: 'amp',
  'LFO 1': 'lfo', 'LFO 1 MOD': 'lfo', 'LFO 2': 'lfo', 'LFO 2 MOD': 'lfo', ROUTING: 'lfo',
  'FX SEND A': 'sends', 'FX SEND B': 'sends',
};

const MOD_SOURCE_NAMES: Record<ModSource, string> = {
  lfo1: 'LFO 1', lfo2: 'LFO 2', ampEnv: 'Level envelope', filterEnv: 'Filter envelope', velocity: 'Velocity', key: 'Key', random: 'Random', modWheel: 'Mod wheel',
};
const MOD_DESTINATION_NAMES: Record<ModDestination, string> = {
  pitch: 'Pitch', osc2Pitch: 'Osc 2 pitch', filter: 'Filter', amp: 'Level', pulseWidth: 'Pulse width', pan: 'Pan', fmIndex: 'FM amount',
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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
// A note typed by name (C4, f#3) or as its MIDI number.
const parseNote = (input: string): number | null => {
  const named = /^([a-g])(#?)(-?\d)$/i.exec(input.trim());
  if (!named) return parseNumber(input);
  return NOTE_NAMES.indexOf(named[1].toUpperCase() + named[2]) + (Number(named[3]) + 1) * 12;
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

const LFO_SYNCS: Array<[number, string]> = [[1, RATE_SYNC_LABELS['1bar']], [2, '1/2'], [4, '1/4'], [8, '1/8'], [16, '1/16'], [32, '1/32']];
const parseSyncedRate = (input: string): number | null => parseNumber(input.includes('/') ? input.split('/').pop()! : input);

const parseCutoff = (input: string): number | null => {
  const trimmed = input.trim().toLowerCase();
  const n = parseNumber(trimmed);
  if (n === null) return null;
  return trimmed.includes('k') ? n * 1000 : n;
};

// A preset that comes with the app carries this after its name, in the menu and on its button;
// a person's own has none, and is under "My presets".
const BUILT_IN_MARK = ' *';
const BUILT_IN_HINT = 'Built in';
// A row of the model menu, with what the model is as its hint.
const modelItem = (entry: typeof SYNTH_MODELS[number]): NestedMenuItem => ({ id: entry.id, label: entry.name, title: entry.subtitle });

export default function SynthControls({
  parameters,
  onParameterChange,
  presets,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onImportPreset,
  onExportPreset,
  synthModelId,
  onModelChange,
  tab,
  onTabChange,
  notes,
  onRemove,
  sampleStoreVersion,
  onSampleError,
}: SynthControlsProps) {
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const level: SynthLevel = tab === 'notes' ? 'notes' : 'sound';
  // The page Sound was last on, which is where it opens again after a look at the notes.
  const [soundTab, setSoundTab] = useState<SynthTab>(tab === 'notes' ? 'osc' : tab);
  const open = (next: SynthTab) => {
    if (next !== 'notes') setSoundTab(next);
    onTabChange(next);
  };
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

  // An LFO's sync is stored as a switch and a rate of N, one sweep each 1/N note. Its menu is the
  // effects' Sync menu as far as an LFO goes (nothing slower than a bar), with whichever other
  // note value the sound already has.
  const lfoSyncNow = (lfo: 'lfo1' | 'lfo2') => (parameters[lfo].sync ? Math.max(1, Math.min(128, Math.round(parameters[lfo].rate || 4))) : 0);
  const lfoSyncChoices = (lfo: 'lfo1' | 'lfo2'): Array<[number, string]> => {
    const now = lfoSyncNow(lfo);
    return [[0, RATE_SYNC_LABELS.off], ...LFO_SYNCS, ...(now > 0 && !LFO_SYNCS.some(([value]) => value === now) ? [[now, `1/${now}`] as [number, string]] : [])];
  };
  const chooseLfoSync = (lfo: 'lfo1' | 'lfo2', value: number) => {
    if (value > 0) updateLfo(lfo, { sync: true, rate: value });
    else updateLfoSync(lfo, false);
  };

  // Projects saved before these sections existed load without them.
  const osc2 = parameters.oscillator2 ?? DEFAULTS.oscillator2!;
  const mixer = parameters.mixer ?? DEFAULTS.mixer!;
  const filterEnvelope = parameters.filterEnvelope ?? DEFAULTS.filterEnvelope!;
  const velocity = parameters.velocity ?? DEFAULTS.velocity!;
  const fm = parameters.fm ?? DEFAULTS.fm!;
  const unison = parameters.unison ?? DEFAULTS.unison!;
  const layer = parameters.layer ?? DEFAULTS.layer!;
  const isFm = parameters.engine === 'fm';
  const isSample = parameters.engine === 'sample';
  const sample = parameters.sample ?? DEFAULTS.sample!;
  const updateSample = (updates: Partial<NonNullable<SynthParameters['sample']>>) => {
    onParameterChange({ sample: { ...sample, ...updates } });
  };
  // Imported samples the sample engine can play. Read when the engine is chosen, and again when one arrives.
  const [samples, setSamples] = useState<Array<{ id: string; name: string }> | null>(null);
  const sampleFileRef = useRef<HTMLInputElement>(null);
  const refreshSamples = () => listSamples().then(list => setSamples(list.map(({ id, name }) => ({ id, name })))).catch(() => {});
  useEffect(() => { if (isSample) void refreshSamples(); }, [isSample, sample.id, sampleStoreVersion]);
  const builtIn = BUILT_IN_WAVES.find(wave => wave.id === sample.wave);
  const sequenceSynced = Boolean(sample.sync && sample.sync !== 'off');
  const sampleMissing = !sample.wave && Boolean(sample.id) && samples !== null && !samples.some(entry => entry.id === sample.id);

  const updateOscillator2 = (updates: Partial<NonNullable<SynthParameters['oscillator2']>>) => {
    onParameterChange({ oscillator2: { ...osc2, ...updates } });
  };
  const updateLayer = (updates: Partial<NonNullable<SynthParameters['layer']>>) => {
    onParameterChange({ layer: { ...layer, ...updates } });
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

  // A lane's insert effects. Every change sends the whole of them, with 'off' for a sync that is not
  // set: the store's merge would keep a value that was merely left out.
  const inserts = parameters.inserts ?? {};
  const insertChorus = { ...INSERT_DEFAULT.chorus, sync: undefined as RateSync | undefined, ...inserts.chorus };
  const insertDelay = { ...INSERT_DEFAULT.delay, sync: undefined as RateSync | undefined, ...inserts.delay };
  const updateInserts = (updates: Partial<NonNullable<SynthParameters['inserts']>>) => {
    onParameterChange({
      inserts: {
        drive: inserts.drive ?? 0, tone: inserts.tone ?? 0,
        chorus: { ...insertChorus, sync: insertChorus.sync ?? 'off' }, delay: { ...insertDelay, sync: insertDelay.sync ?? 'off' },
        ...updates,
      },
    });
  };
  const updateInsertChorus = (updates: Partial<typeof insertChorus>) => updateInserts({ chorus: { ...insertChorus, sync: insertChorus.sync ?? 'off', ...updates } });
  const updateInsertDelay = (updates: Partial<typeof insertDelay>) => updateInserts({ delay: { ...insertDelay, sync: insertDelay.sync ?? 'off', ...updates } });

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
      <div className="synth-level-row">
        <div className="synth-tabs synth-levels" role="tablist" aria-label="Synth editor" onKeyDown={tabKeys}>
          {LEVELS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={level === entry.id}
              tabIndex={level === entry.id ? 0 : -1}
              className={level === entry.id ? 'active' : ''}
              onClick={() => open(entry.id === 'notes' ? 'notes' : soundTab)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="synth-header-tools">
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
          {onRemove && (
            <button className="rack-btn" onClick={onRemove} title="Remove this synth lane">Remove</button>
          )}
        </div>
      </div>

      {level === 'sound' && (
        <>
          <div className="synth-header">
            <div className="model-selector-wrap">
              <label>MODEL</label>
              <NestedMenu
                label="Synth model"
                text={SYNTH_MODELS.find(entry => entry.id === synthModelId)?.name ?? 'Generic'}
                title="Synth model: changes the character and behaviour of the synthesizer"
                top={SYNTH_MODELS.filter(entry => !entry.group).map(modelItem)}
                groups={SYNTH_MODEL_GROUPS.map(group => ({ label: group, items: SYNTH_MODELS.filter(entry => entry.group === group).map(modelItem) }))}
                onSelect={(id) => onModelChange(id as SynthModelId)}
              />
            </div>
            <div className="preset-controls">
              <NestedMenu
                label="Synth preset"
                search="Search presets"
                text={selectedPreset?.name ?? 'Preset…'}
                mark={selectedPreset?.builtIn ? BUILT_IN_MARK : undefined}
                title={selectedPreset ? `${selectedPreset.name} (${selectedPreset.builtIn ? 'built in' : 'one of your own'})` : 'Choose a preset for this lane'}
                groups={groupPresets(presets).map((group) => ({
                  label: group.label,
                  items: group.presets.map((preset) => ({
                    id: preset.id,
                    label: preset.name,
                    mark: preset.builtIn ? BUILT_IN_MARK : undefined,
                    title: preset.builtIn ? BUILT_IN_HINT : undefined,
                  })),
                }))}
                onSelect={(id) => {
                  setSelectedPresetId(id);
                  onLoadPreset(id);
                }}
              />
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
                className="rack-btn"
                disabled={!presetName.trim()}
                onClick={() => {
                  onSavePreset(presetName.trim());
                  setPresetName('');
                }}
              >
                Save
              </button>
              <button
                className="rack-btn"
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
              <label className="rack-btn preset-import" title="Load a preset file: one saved from Discobot, or one from another synth that Discobot knows how to translate">
                Import
                <input
                  type="file"
                  accept=".json,application/json"
                  aria-label="Import synth preset"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) onImportPreset(file);
                  }}
                />
              </label>
              <button
                className="rack-btn"
                title="Save this lane's sound as a file"
                onClick={() => onExportPreset(presetName.trim() || presets.find(preset => preset.id === selectedPresetId)?.name || '')}
              >
                Export
              </button>
            </div>
          </div>
          <div className="synth-tabs synth-pages" role="tablist" aria-label="Sound pages" onKeyDown={tabKeys}>
            {SOUND_TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={tab === entry.id}
                tabIndex={tab === entry.id ? 0 : -1}
                className={tab === entry.id ? 'active' : ''}
                onClick={() => open(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </>
      )}

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
          <select
            className="synth-select arp-select"
            value={parameters.arpeggiator.octaves || 0}
            aria-label="Arpeggiator range"
            title="How many octaves the arpeggio runs through. Auto: a single note through three octaves, a chord through its own notes"
            onChange={(e) => updateArpeggiator({ octaves: Number(e.target.value) })}
          >
            <option value={0}>Auto</option>
            <option value={1}>1 oct</option>
            <option value={2}>2 oct</option>
            <option value={3}>3 oct</option>
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
                value={isFm ? 'fm' : isSample ? 'sample' : 'subtractive'}
                aria-label="Synth engine"
                title="Analog: oscillators. FM: four operators. Sample: an imported sample played up and down the keyboard"
                onChange={(e) => onParameterChange({ engine: e.target.value as 'subtractive' | 'fm' | 'sample' })}
                className="synth-select"
              >
                <option value="subtractive">Analog</option>
                <option value="fm">FM</option>
                <option value="sample">Sample</option>
              </select>
            </div>
            <div className="synth-waveform-selector">
              <label>WAVE</label>
              <select
                value={parameters.oscillator.type}
                aria-label="Oscillator waveform"
                onChange={(e) => updateOscillator({ type: e.target.value as OscillatorType })}
                className="synth-select"
                disabled={isFm || isSample}
              >
                <option value="sine">~</option>
                <option value="square">⎍</option>
                <option value="sawtooth">/|</option>
                <option value="triangle">/\</option>
              </select>
            </div>
            <Knob
              label="Detune"
              param="detune"
              value={parameters.oscillator.detune}
              defaultValue={DEFAULTS.oscillator.detune}
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
              param="pulseWidth"
              value={parameters.oscillator.pulseWidth ?? 0.5}
              defaultValue={DEFAULTS.oscillator.pulseWidth ?? 0.5}
              min={0.05}
              max={0.95}
              step={0.01}
              displayValue={`${Math.round((parameters.oscillator.pulseWidth ?? 0.5) * 100)}%`}
              onChange={(v) => updateOscillator({ pulseWidth: v })}
              parseInputValue={parsePercent(0, 1)}
              disabled={isFm || isSample || parameters.oscillator.type !== 'square'}
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
                defaultValue={DEFAULTS.fm!.ratio}
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
                defaultValue={DEFAULTS.fm!.index}
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
                defaultValue={DEFAULTS.fm!.decay}
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
                defaultValue={DEFAULTS.fm!.feedback}
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
        ) : isSample ? (
          <div className="synth-column" data-tab="osc">
            <h3>SAMPLE</h3>
            <div className="synth-column-controls">
              <div className="synth-waveform-selector">
                <label>SOUND</label>
                <select
                  className="synth-select synth-sample-select"
                  aria-label="Synth sample"
                  title="The imported sample this lane plays up and down the keyboard, through its filter and envelopes"
                  value={sample.wave ? `wave:${sample.wave}` : sample.id ?? ''}
                  onFocus={() => { void refreshSamples(); }}
                  onChange={(event) => {
                    const chosen = event.target.value;
                    if (chosen === 'import') sampleFileRef.current?.click();
                    // An empty name or id is sent, not left out: the store keeps whatever a change does not mention.
                    else if (chosen.startsWith('wave:')) updateSample({ wave: chosen.slice(5), id: '', scan: sample.scan ?? 2, fade: sample.fade ?? 1 });
                    else updateSample({ id: chosen, wave: '' });
                  }}
                >
                  <option value="">None</option>
                  <optgroup label="Built in">
                    {BUILT_IN_WAVES.map(wave => <option key={wave.id} value={`wave:${wave.id}`}>{wave.name}</option>)}
                    {sample.wave && !builtIn && <option value={`wave:${sample.wave}`}>Not in this version</option>}
                  </optgroup>
                  <optgroup label="Imported">
                    {(samples ?? []).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                    {!sample.wave && sample.id && (samples === null || sampleMissing) && <option value={sample.id}>{sampleMissing ? 'Sample not on this device' : '…'}</option>}
                    <option value="import">Import a sample…</option>
                  </optgroup>
                </select>
              </div>
              <input
                ref={sampleFileRef}
                type="file"
                hidden
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
                aria-label="Import synth sample"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  void saveSample(file)
                    .then(async (stored) => { await refreshSamples(); updateSample({ id: stored.id, wave: '' }); })
                    .catch((cause) => onSampleError?.(cause instanceof Error ? cause.message : 'The sample could not be imported.'));
                }}
              />
              <Knob
                label="Root"
                ariaLabel="Sample root note"
                value={sample.root}
                defaultValue={DEFAULTS.sample!.root}
                min={24}
                max={96}
                step={1}
                displayValue={noteName(sample.root)}
                onChange={(v) => updateSample({ root: Math.round(v) })}
                parseInputValue={parseNote}
                disabled={Boolean(sample.wave)}
                tooltip="The note at which the sample plays at the pitch it was recorded. Other notes play it faster or slower"
              />
              <Knob
                label="Level"
                ariaLabel="Sample level"
                value={mixer.osc ?? 1}
                defaultValue={DEFAULTS.mixer!.osc ?? 1}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${Math.round((mixer.osc ?? 1) * 100)}%`}
                onChange={(v) => updateMixer({ osc: v })}
                parseInputValue={parsePercent(0, 1)}
                tooltip="How loud the sample is"
              />
              {(builtIn?.steps ?? 0) > 1 && (
                <>
                  <div className="synth-waveform-selector">
                    <label>SYNC</label>
                    <select
                      className="synth-select"
                      aria-label="Sequence sync"
                      title="Step through the sequence in time: one wave each note value, whatever the tempo"
                      value={sample.sync ?? 'off'}
                      onChange={(e) => updateSample({ sync: e.target.value as RateSync })}
                    >
                      {RATE_SYNCS.map(value => <option key={value} value={value}>{RATE_SYNC_LABELS[value]}</option>)}
                    </select>
                  </div>
                  <Knob
                    label="Speed"
                    ariaLabel="Sequence speed"
                    value={sample.scan ?? 2}
                    defaultValue={DEFAULTS.sample!.scan ?? 2}
                    min={0}
                    max={16}
                    step={0.05}
                    displayValue={sequenceSynced ? RATE_SYNC_LABELS[sample.sync!] : `${(sample.scan ?? 2).toFixed(2)}/s`}
                    onChange={(v) => updateSample({ scan: v, sync: 'off' })}
                    parseInputValue={parseNumber}
                    tooltip={sequenceSynced ? 'Following the tempo. Turn the knob to set a free speed instead' : 'How many waves of the sequence go by each second. At 0 it stays on the first'}
                  />
                  <Knob
                    label="Fade"
                    ariaLabel="Sequence crossfade"
                    value={sample.fade ?? 1}
                    defaultValue={DEFAULTS.sample!.fade ?? 1}
                    min={0}
                    max={1}
                    step={0.01}
                    displayValue={`${Math.round((sample.fade ?? 1) * 100)}%`}
                    onChange={(v) => updateSample({ fade: v })}
                    parseInputValue={parsePercent(0, 1)}
                    tooltip="How much of each wave's turn is spent melting into the next: none at 0%, so each starts abruptly"
                  />
                </>
              )}
              <label className="synth-sync" title="Go round again while the note is held, instead of playing once">
                <input
                  type="checkbox"
                  aria-label="Loop the sample"
                  disabled={Boolean(builtIn?.steps)}
                  checked={sample.loop}
                  onChange={(e) => updateSample({ loop: e.target.checked })}
                />
                Loop
              </label>
              {!builtIn?.steps && (
                <>
                <Knob
                  label="Start"
                  ariaLabel="Sample start"
                  value={sample.start ?? 0}
                  defaultValue={0}
                  min={0}
                  max={0.99}
                  step={0.01}
                  displayValue={`${Math.round((sample.start ?? 0) * 100)}%`}
                  onChange={(v) => updateSample({ start: v })}
                  parseInputValue={parsePercent(0, 1)}
                  disabled={false}
                  tooltip="Where in the recording a note begins: 0% is its beginning"
                />
                  <Knob
                  label="Loop From"
                  ariaLabel="Sample loop start"
                  value={sample.loopStart ?? 0}
                  defaultValue={0}
                  min={0}
                  max={0.99}
                  step={0.01}
                  displayValue={`${Math.round((sample.loopStart ?? 0) * 100)}%`}
                  onChange={(v) => updateSample({ loopStart: v })}
                  parseInputValue={parsePercent(0, 1)}
                  disabled={!sample.loop}
                  tooltip="With Loop on: where the part that goes round begins"
                />
                  <Knob
                  label="Loop To"
                  ariaLabel="Sample loop end"
                  value={sample.loopEnd ?? 1}
                  defaultValue={1}
                  min={0.01}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round((sample.loopEnd ?? 1) * 100)}%`}
                  onChange={(v) => updateSample({ loopEnd: v })}
                  parseInputValue={parsePercent(0, 1)}
                  disabled={!sample.loop}
                  tooltip="With Loop on: where the part that goes round ends, and goes back to Loop From"
                />
                  </>
              )}
              {builtIn?.file && (
                <p className="synth-sample-note">
                  This instrument is fetched the first time it is used. Until it arrives, or if this device is offline and has not had it yet, the lane plays its oscillator.
                </p>
              )}
              {!sample.wave && (!sample.id || sampleMissing) && (
                <p className="synth-sample-note" role="status">
                  {sampleMissing ? 'This sample is not on this device, so the lane plays its oscillator.' : 'Choose a sample. Until then the lane plays its oscillator.'}
                </p>
              )}
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
                  defaultValue={DEFAULTS.oscillator2!.semitones}
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
                  defaultValue={DEFAULTS.oscillator2!.detune}
                  min={-50}
                  max={50}
                  step={1}
                  displayValue={`${osc2.detune > 0 ? '+' : ''}${osc2.detune}`}
                  onChange={(v) => updateOscillator2({ detune: v })}
                  disabled={!osc2.enabled}
                  color="#6366f1"
                  tooltip={TOOLTIPS.osc2Detune}
                />
                <label className="synth-sync" title="Hard sync: oscillator 2 starts its wave again each time oscillator 1 does. It takes oscillator 1's pitch, and its own tuning becomes its tone">
                  <input
                    type="checkbox"
                    aria-label="Sync oscillator 2 to oscillator 1"
                    checked={osc2.sync ?? false}
                    disabled={!osc2.enabled}
                    onChange={(e) => updateOscillator2({ sync: e.target.checked })}
                  />
                  Sync
                </label>
              </div>
            </div>

            <div className="synth-column" data-tab={COLUMN_TABS['MIX']}>
              <h3>MIX</h3>
              <div className="synth-column-controls">
                <Knob
                  label="Osc 2"
                  value={osc2.level}
                  defaultValue={DEFAULTS.oscillator2!.level}
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
                  label="Osc 1"
                  ariaLabel="Oscillator 1 level"
                  value={mixer.osc ?? 1}
                  defaultValue={DEFAULTS.mixer!.osc ?? 1}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round((mixer.osc ?? 1) * 100)}%`}
                  onChange={(v) => updateMixer({ osc: v })}
                  parseInputValue={parsePercent(0, 1)}
                  color="#6366f1"
                  tooltip="How loud the first oscillator is. Turn it down to hear the second oscillator, the sub or the noise alone"
                />
                <Knob
                  label="Sub"
                  param="sub"
                  value={mixer.sub}
                  defaultValue={DEFAULTS.mixer!.sub}
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
                  param="noise"
                  value={mixer.noise}
                  defaultValue={DEFAULTS.mixer!.noise}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round(mixer.noise * 100)}%`}
                  onChange={(v) => updateMixer({ noise: v })}
                  parseInputValue={parsePercent(0, 1)}
                  color="#6366f1"
                  tooltip={TOOLTIPS.noise}
                />
                <Knob
                  label="Ring"
                  ariaLabel="Ring modulation"
                  value={mixer.ring ?? 0}
                  defaultValue={DEFAULTS.mixer!.ring ?? 0}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round((mixer.ring ?? 0) * 100)}%`}
                  onChange={(v) => updateMixer({ ring: v })}
                  parseInputValue={parsePercent(0, 1)}
                  disabled={!osc2.enabled}
                  color="#6366f1"
                  tooltip="Ring modulation: the two oscillators multiplied together, for clangs and bells. It needs oscillator 2 switched on"
                />
              </div>
            </div>
            <div className="synth-column" data-tab="osc">
              <h3>UNISON</h3>
              <div className="synth-column-controls">
                <Knob
                  label="Voices"
                  value={unison.voices}
                  defaultValue={DEFAULTS.unison!.voices}
                  min={1}
                  max={7}
                  step={1}
                  displayValue={unison.voices === 1 ? 'Off' : `${unison.voices}`}
                  onChange={(v) => onParameterChange({ unison: { ...unison, voices: Math.round(v) } })}
                  tooltip="Detuned copies of the oscillators stacked on every note - more is thicker"
                />
                <Knob
                  label="Detune"
                  ariaLabel="Unison detune"
                  value={unison.detune}
                  defaultValue={DEFAULTS.unison!.detune}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round(unison.detune * 50)}c`}
                  onChange={(v) => onParameterChange({ unison: { ...unison, detune: v } })}
                  parseInputValue={(input) => { const cents = parseNumber(input); return cents === null ? null : cents / 50; }}
                  disabled={unison.voices === 1}
                  tooltip="How far apart the unison copies are tuned, in cents each way"
                />
                <Knob
                  label="Mix"
                  ariaLabel="Unison mix"
                  value={unison.mix ?? 1}
                  defaultValue={DEFAULTS.unison!.mix ?? 1}
                  min={0}
                  max={1}
                  step={0.01}
                  displayValue={`${Math.round((unison.mix ?? 1) * 100)}%`}
                  onChange={(v) => onParameterChange({ unison: { ...unison, mix: v } })}
                  parseInputValue={parsePercent(0, 1)}
                  disabled={unison.voices < 3 || unison.voices % 2 === 0}
                  tooltip="How loud the copies either side of the middle one are. With 3, 5 or 7 copies the middle one stays in tune and at full level"
                />
              </div>
            </div>
          </>
        )}

        <div className="synth-column" data-tab="osc">
          <div className="synth-section-header">
            <h3>LAYER</h3>
            <label className="synth-toggle" title="Play every note twice: a second layer of the same sound, tuned, filtered, faded in and placed differently. Half as many notes can sound at once">
              <input
                type="checkbox"
                checked={layer.enabled}
                aria-label="Second layer enabled"
                onChange={(e) => updateLayer({ enabled: e.target.checked })}
              />
              <span className="synth-toggle-slider" />
            </label>
          </div>
          <div className="synth-column-controls">
            <Knob
              label="Mix"
              ariaLabel="Layer mix"
              value={layer.mix}
              defaultValue={DEFAULTS.layer!.mix}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(layer.mix * 100)}%`}
              onChange={(v) => updateLayer({ mix: v })}
              parseInputValue={parsePercent(0, 1)}
              disabled={!layer.enabled}
              tooltip="The balance between the two layers: the first alone at 0%, the second alone at 100%"
            />
            <Knob
              label="Detune"
              ariaLabel="Layer detune"
              value={layer.detune}
              defaultValue={DEFAULTS.layer!.detune}
              min={-50}
              max={50}
              step={1}
              displayValue={`${layer.detune > 0 ? '+' : ''}${Math.round(layer.detune)}c`}
              onChange={(v) => updateLayer({ detune: v })}
              parseInputValue={parseNumber}
              disabled={!layer.enabled}
              tooltip="How far the second layer is tuned from the first, in cents"
            />
            <Knob
              label="Bright"
              ariaLabel="Layer brightness"
              value={layer.brightness}
              defaultValue={DEFAULTS.layer!.brightness}
              min={-3}
              max={3}
              step={0.05}
              displayValue={`${layer.brightness > 0 ? '+' : ''}${layer.brightness.toFixed(1)}`}
              onChange={(v) => updateLayer({ brightness: v })}
              parseInputValue={parseNumber}
              disabled={!layer.enabled}
              tooltip="The second layer's filter against the first's, in octaves: brighter above 0, darker below"
            />
            <Knob
              label="Swell"
              ariaLabel="Layer swell"
              value={layer.attack}
              defaultValue={DEFAULTS.layer!.attack}
              min={0}
              max={5}
              step={0.01}
              displayValue={`${layer.attack.toFixed(2)}s`}
              onChange={(v) => updateLayer({ attack: v })}
              parseInputValue={parseNumber}
              disabled={!layer.enabled}
              tooltip="Seconds added to the second layer's attack, so it comes in under the first"
            />
            <Knob
              label="Width"
              ariaLabel="Layer width"
              value={layer.width}
              defaultValue={DEFAULTS.layer!.width}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(layer.width * 100)}%`}
              onChange={(v) => updateLayer({ width: v })}
              parseInputValue={parsePercent(0, 1)}
              disabled={!layer.enabled}
              tooltip="How far apart the two layers are placed: together at 0%, one each side at 100%"
            />
          </div>
        </div>

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
              <select
                className="synth-filter-type-select"
                aria-label="Filter slope"
                value={parameters.filter.model === 'ladder' ? 'ladder' : parameters.filter.model === 'ms20' ? 'ms20' : parameters.filter.slope === 24 ? 24 : 12}
                onChange={(e) => updateFilter(
                  e.target.value === 'ladder' ? { slope: 24, model: 'ladder' }
                    : e.target.value === 'ms20' ? { slope: 12, model: 'ms20' }
                      : { slope: Number(e.target.value), model: 'svf' },
                )}
                title="12 dB per octave is gentler; 24 dB is steeper and darker. Ladder is a 24 dB low-pass whose resonance thins the bass and can ring by itself, as on a Minimoog. MS-20 is a 12 dB low-pass whose resonance distorts harder the further it is pushed. Both are low-passes only"
              >
                <option value={12}>12 dB</option>
                <option value={24}>24 dB</option>
                <option value="ladder">Ladder</option>
                <option value="ms20">MS-20</option>
              </select>
            </div>
            <Knob
              label="High-pass"
              ariaLabel="High-pass cutoff"
              value={parameters.filter.highpass ?? 0}
              defaultValue={DEFAULTS.filter.highpass ?? 0}
              min={0}
              max={2000}
              step={5}
              displayValue={(parameters.filter.highpass ?? 0) < 20 ? 'Off' : `${Math.round(parameters.filter.highpass ?? 0)}Hz`}
              onChange={(v) => updateFilter({ highpass: v < 20 ? 0 : v })}
              parseInputValue={parseCutoff}
              color="#10b981"
              tooltip="Takes out everything under this before the filter. Off at the bottom"
            />
            <Knob
              label="Cutoff"
              param="cutoff"
              value={parameters.filter.frequency}
              defaultValue={DEFAULTS.filter.frequency}
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
              param="resonance"
              value={parameters.filter.q}
              defaultValue={DEFAULTS.filter.q}
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
              param="filterEnv"
              value={parameters.filter.envAmount ?? 0}
              defaultValue={DEFAULTS.filter.envAmount ?? 0}
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
              defaultValue={DEFAULTS.filter.keyTracking ?? 0}
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
              label="Drive"
              param="drive"
              ariaLabel="Filter drive"
              value={parameters.filter.drive ?? 0}
              defaultValue={DEFAULTS.filter.drive ?? 0}
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
              defaultValue={DEFAULTS.filterEnvelope!.attack}
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
              defaultValue={DEFAULTS.filterEnvelope!.decay}
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
              defaultValue={DEFAULTS.filterEnvelope!.sustain}
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
              defaultValue={DEFAULTS.filterEnvelope!.release}
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
              defaultValue={DEFAULTS.velocity!.amp}
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
              defaultValue={DEFAULTS.velocity!.filter}
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
                <option value="vibrato">Vibrato</option>
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
              <div className="synth-waveform-selector">
                <label>SYNC</label>
                <select
                  className="synth-select"
                  aria-label="LFO 1 sync"
                  title="Follow the tempo: one sweep each note value, whatever the tempo"
                  value={lfoSyncNow('lfo1')}
                  onChange={(e) => chooseLfoSync('lfo1', Number(e.target.value))}
                  disabled={!parameters.lfo1.enabled}
                >
                  {lfoSyncChoices('lfo1').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <Knob
                label="Rate"
                param="lfo1Rate"
                value={parameters.lfo1.sync ? (parameters.lfo1.rate || 4) : parameters.lfo1.rate}
                defaultValue={parameters.lfo1.sync ? 4 : DEFAULTS.lfo1.rate}
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
                tooltip={parameters.lfo1.sync ? 'Following the tempo: the knob steps through note values' : 'How fast the LFO sweeps'}
              />
            </div>
            <Knob
              label="Depth"
              param="lfo1Depth"
              value={parameters.lfo1.depth}
              defaultValue={DEFAULTS.lfo1.depth}
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
                <option value="vibrato">Vibrato</option>
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
              <div className="synth-waveform-selector">
                <label>SYNC</label>
                <select
                  className="synth-select"
                  aria-label="LFO 2 sync"
                  title="Follow the tempo: one sweep each note value, whatever the tempo"
                  value={lfoSyncNow('lfo2')}
                  onChange={(e) => chooseLfoSync('lfo2', Number(e.target.value))}
                  disabled={!parameters.lfo2.enabled}
                >
                  {lfoSyncChoices('lfo2').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <Knob
                label="Rate"
                param="lfo2Rate"
                value={parameters.lfo2.sync ? (parameters.lfo2.rate || 4) : parameters.lfo2.rate}
                defaultValue={parameters.lfo2.sync ? 4 : DEFAULTS.lfo2.rate}
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
                tooltip={parameters.lfo2.sync ? 'Following the tempo: the knob steps through note values' : 'How fast the LFO sweeps'}
              />
            </div>
            <Knob
              label="Depth"
              param="lfo2Depth"
              value={parameters.lfo2.depth}
              defaultValue={DEFAULTS.lfo2.depth}
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

        <div className="synth-column synth-routing" data-tab={COLUMN_TABS['ROUTING']}>
          <h3>ROUTING</h3>
          <div className="synth-routes">
            {Array.from({ length: MAX_MOD_ROUTES }, (_, index) => {
              const routes = parameters.modMatrix ?? [];
              const route: ModRoute | undefined = routes[index];
              // A row past the last route is the place the next one goes; the rows after it wait.
              const usable = index <= routes.length;
              const setRoute = (next: ModRoute | null) => onParameterChange({
                modMatrix: next ? [...routes.slice(0, index), next, ...routes.slice(index + 1)] : routes.filter((_, at) => at !== index),
              });
              return (
                <div className="synth-route" key={index} role="group" aria-label={`Route ${index + 1}`}>
                  <select
                    className="synth-select"
                    aria-label={`Route ${index + 1} source`}
                    value={route?.source ?? ''}
                    disabled={!usable}
                    title="What moves. Random is a new value each time LFO 1 comes round. Mod wheel is a controller's wheel (MIDI CC 1), played live and not saved: an export plays it at 0. A wheel tied to a knob under Controller knobs moves that knob instead. Choose the dash to take the route away"
                    onChange={(e) => setRoute(e.target.value ? { source: e.target.value as ModSource, destination: route?.destination ?? 'filter', depth: route?.depth ?? 0.5 } : null)}
                  >
                    <option value="">—</option>
                    {MOD_SOURCES.map(source => <option key={source} value={source}>{MOD_SOURCE_NAMES[source]}</option>)}
                  </select>
                  <span aria-hidden="true">→</span>
                  <select
                    className="synth-select"
                    aria-label={`Route ${index + 1} destination`}
                    value={route?.destination ?? 'filter'}
                    disabled={!route}
                    title="What it moves"
                    onChange={(e) => { if (route) setRoute({ ...route, destination: e.target.value as ModDestination }); }}
                  >
                    {MOD_DESTINATIONS.map(destination => <option key={destination} value={destination}>{MOD_DESTINATION_NAMES[destination]}</option>)}
                  </select>
                  <Knob
                    size="small"
                    label="Amount"
                    ariaLabel={`Route ${index + 1} amount`}
                    value={route?.depth ?? 0}
                    defaultValue={0}
                    min={-1}
                    max={1}
                    step={0.01}
                    displayValue={`${Math.round((route?.depth ?? 0) * 100)}%`}
                    onChange={(v) => { if (route) setRoute({ ...route, depth: v }); }}
                    parseInputValue={(input) => { const percent = parseNumber(input); return percent === null ? null : percent / 100; }}
                    disabled={!route}
                    color="#0891b2"
                    tooltip="How far, and which way: under zero it moves the other way"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['ENV A']}>
          <h3>ENV A</h3>
          <div className="synth-column-controls">
            <Knob
              label="Attack"
              param="attack"
              value={parameters.envelope.attack}
              defaultValue={DEFAULTS.envelope.attack}
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
              param="decay"
              value={parameters.envelope.decay}
              defaultValue={DEFAULTS.envelope.decay}
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
              param="sustain"
              value={parameters.envelope.sustain}
              defaultValue={DEFAULTS.envelope.sustain}
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
              param="release"
              value={parameters.envelope.release}
              defaultValue={DEFAULTS.envelope.release}
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

        <div className="synth-column" data-tab="inserts">
          <h3>INSERT TONE</h3>
          <div className="synth-column-controls">
            <Knob
              label="Drive"
              ariaLabel="Insert drive"
              value={inserts.drive ?? 0}
              defaultValue={0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round((inserts.drive ?? 0) * 100)}%`}
              onChange={(v) => updateInserts({ drive: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="Warms and thickens this lane's sound before anything else. Only this lane hears it"
            />
            <Knob
              label="Tone"
              ariaLabel="Insert tone"
              value={inserts.tone ?? 0}
              defaultValue={0}
              min={-1}
              max={1}
              step={0.01}
              displayValue={(inserts.tone ?? 0) === 0 ? 'Flat' : `${(inserts.tone ?? 0) < 0 ? 'Dark' : 'Thin'} ${Math.round(Math.abs(inserts.tone ?? 0) * 100)}%`}
              onChange={(v) => updateInserts({ tone: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="Left of the middle takes the top off, right of it takes the bottom off. Only this lane hears it"
            />
          </div>
        </div>
        <div className="synth-column" data-tab="inserts">
          <h3>INSERT CHORUS</h3>
          <div className="synth-column-controls">
            <Knob
              label="Mix"
              ariaLabel="Insert chorus mix"
              value={insertChorus.mix}
              defaultValue={0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(insertChorus.mix * 100)}%`}
              onChange={(v) => updateInsertChorus({ mix: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="How much of this lane's own chorus is heard. At 0 there is none"
            />
            <Knob
              label="Depth"
              ariaLabel="Insert chorus depth"
              value={insertChorus.depth}
              defaultValue={0.5}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(insertChorus.depth * 100)}%`}
              onChange={(v) => updateInsertChorus({ depth: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="How far the chorus sways the sound"
            />
            <Knob
              label="Rate"
              ariaLabel="Insert chorus rate"
              value={insertChorus.rate}
              defaultValue={0.6}
              min={0.02}
              max={8}
              step={0.01}
              displayValue={insertChorus.sync && insertChorus.sync !== 'off' ? RATE_SYNC_LABELS[insertChorus.sync] : `${insertChorus.rate.toFixed(2)} Hz`}
              onChange={(v) => updateInsertChorus({ rate: v, sync: 'off' })}
              parseInputValue={parseNumber}
              tooltip="How fast the chorus sways. Turn the knob to set a free speed instead of the tempo"
            />
            <div className="synth-waveform-selector">
              <label>SYNC</label>
              <select
                className="synth-select"
                aria-label="Insert chorus sync"
                title="Sway in time with the tempo: one sway each note value"
                value={insertChorus.sync ?? 'off'}
                onChange={(e) => updateInsertChorus({ sync: e.target.value as RateSync })}
              >
                {RATE_SYNCS.map(value => <option key={value} value={value}>{RATE_SYNC_LABELS[value]}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="synth-column" data-tab="inserts">
          <h3>INSERT DELAY</h3>
          <div className="synth-column-controls">
            <Knob
              label="Mix"
              ariaLabel="Insert delay mix"
              value={insertDelay.mix}
              defaultValue={0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(insertDelay.mix * 100)}%`}
              onChange={(v) => updateInsertDelay({ mix: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="How much of this lane's own echo is heard. At 0 there is none"
            />
            <Knob
              label="Time"
              ariaLabel="Insert delay time"
              value={insertDelay.time}
              defaultValue={0.25}
              min={0.01}
              max={1.5}
              step={0.01}
              displayValue={insertDelay.sync && insertDelay.sync !== 'off' ? RATE_SYNC_LABELS[insertDelay.sync] : `${Math.round(insertDelay.time * 1000)}ms`}
              onChange={(v) => updateInsertDelay({ time: v, sync: 'off' })}
              parseInputValue={parseMilliseconds}
              tooltip="Time between echoes. Turn the knob to set a free time instead of the tempo"
            />
            <Knob
              label="Feedback"
              ariaLabel="Insert delay feedback"
              value={insertDelay.feedback}
              defaultValue={0.3}
              min={0}
              max={0.85}
              step={0.01}
              displayValue={`${Math.round(insertDelay.feedback * 100)}%`}
              onChange={(v) => updateInsertDelay({ feedback: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="How many echoes follow the first"
            />
            <div className="synth-waveform-selector">
              <label>SYNC</label>
              <select
                className="synth-select"
                aria-label="Insert delay sync"
                title="Echo in time with the tempo: one echo each note value"
                value={insertDelay.sync ?? 'off'}
                onChange={(e) => updateInsertDelay({ sync: e.target.value as RateSync })}
              >
                {INSERT_DELAY_SYNCS.map(value => <option key={value} value={value}>{RATE_SYNC_LABELS[value]}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['FX SEND A']}>
          <h3>FX SEND A</h3>
          <div className="synth-column-controls">
            <Knob
              label="Reverb"
              value={parameters.fxSends.reverb}
              defaultValue={DEFAULTS.fxSends.reverb}
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
              defaultValue={DEFAULTS.fxSends.delay}
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
              defaultValue={DEFAULTS.fxSends.drive}
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
              defaultValue={DEFAULTS.fxSends.phaser}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${(parameters.fxSends.phaser * 100).toFixed(0)}%`}
              onChange={(v) => updateFxSends({ phaser: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#3b82f6"
              tooltip={TOOLTIPS.fxSend}
            />
            <Knob
              label="Chorus"
              value={parameters.fxSends.chorus ?? 0}
              defaultValue={DEFAULTS.fxSends.chorus ?? 0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${((parameters.fxSends.chorus ?? 0) * 100).toFixed(0)}%`}
              onChange={(v) => updateFxSends({ chorus: v })}
              parseInputValue={parsePercent(0, 1)}
              color="#14b8a6"
              tooltip={TOOLTIPS.fxSend}
            />
            {(['auxA', 'auxB'] as const).map(aux => (
              <Knob
                key={aux}
                label={`Aux ${aux.slice(3)}`}
                ariaLabel={`Aux ${aux.slice(3)} send`}
                value={parameters.fxSends[aux] ?? 0}
                defaultValue={0}
                min={0}
                max={1}
                step={0.01}
                displayValue={`${Math.round((parameters.fxSends[aux] ?? 0) * 100)}%`}
                onChange={(v) => updateFxSends({ [aux]: v })}
                parseInputValue={parsePercent(0, 1)}
                color="#8b5cf6"
                tooltip={`How much of this lane goes to aux bus ${aux.slice(3)}, an effect set in the effects unit`}
              />
            ))}
          </div>
        </div>

        <div className="synth-column" data-tab="sends">
          <h3>KICK DUCK</h3>
          <div className="synth-column-controls">
            <Knob
              label="Duck"
              value={parameters.duck ?? 0}
              defaultValue={DEFAULTS.duck ?? 0}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round((parameters.duck ?? 0) * 100)}%`}
              onChange={(v) => onParameterChange({ duck: v })}
              parseInputValue={parsePercent(0, 1)}
              tooltip="Pulls this lane down each time the kick hits and lets it swell back, so the kick cuts through"
            />
          </div>
        </div>

        <div className="synth-column" data-tab={COLUMN_TABS['MASTER']}>
          <h3>MASTER</h3>
          <div className="synth-column-controls">
            <Knob
              label="Gain"
              param="level"
              value={parameters.gain}
              defaultValue={DEFAULTS.gain}
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
              defaultValue={DEFAULTS.fxReturn}
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
              param="pan"
              value={parameters.pan}
              defaultValue={DEFAULTS.pan}
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
              defaultValue={DEFAULTS.spread ?? 0}
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
              param="glide"
              value={parameters.portamento.glide}
              defaultValue={DEFAULTS.portamento.glide}
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
