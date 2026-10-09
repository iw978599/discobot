import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createNamedSynthPresets } from '../components/SynthControls';
import { useSynthAudio } from '../hooks/useSynthAudio';
import { useDrumAudio } from '../hooks/useDrumAudio';
import { MidiMode, MidiMessage, useMidiInput } from '../hooks/useMidiInput';
import { Pattern, SequencerStep, SynthParameters, DrumState, DrumInstrument, DrumSettings, DrumKitDefinition, DrumKitId, EffectsLoopState, FxSendLevels, Scene, Song, SynthModelId, SynthModelParams } from '../types';
import { SongPosition, entryStartBar, sceneAtBar, sceneDrumState, songBars } from '../services/songPlayback';
import { createDefaultSynthParameters } from '@discobot/engine';
import { localRequest, localService } from '../services/localService';
import { projectSync, startProjectSync } from '../services/projectSync';
import { loadDrumSample } from '../services/drumSamples';
import { exportPreset, importPreset, type ImportedPreset } from '../services/presetImport';
import { BAR_CHOICES, DRUM_STEPS_PER_BAR, clampLengths, drumBars, laneBars, resizeBars, sceneAsBars, sceneBars } from '../services/patternLength';
import { DRUM_INSTRUMENTS } from '../services/drumKits';
import type { DrumSample } from '../../../engine/src/drums/DrumCore';
import { guestCapture, guestLink, guestOrigin, guestUrl, trustOrigin, wallAtContextTime, wallNow, type Guest } from '../services/guests';
import { downloadArrangementWav } from '../services/wavExport';
import type { ProjectInfo } from '../services/projectLibrary';
import { sanitizeSynthParams } from '../services/projectSanitization';
import { expandStep, expandStepNotes, stepNotes, withStepNotes } from '../services/noteScheduling';
import { BrowserTransport, TransportTick } from '../services/browserTransport';
import { downloadFile, ExportArrangement } from '../services/wavExport';
import { expandDrumStep } from '../services/drumScheduling';
import { useComputerKeyboard } from '../hooks/useComputerKeyboard';
import { getAudioContext, setMasterVolume, setMasterMuted, setEffectsTempo } from '../hooks/browserAudio';
import { downloadMidiFile } from '../utils/midiExport';
import { importMidiFile, readFileAsArrayBuffer, MidiImportResult } from '../utils/midiImport';
import { DEFAULT_SYNTH_MODEL_ID, createDefaultSynthModelParams, mapSynthModelToEngineParams, normalizeSynthModelId, normalizeSynthModelParams } from '../synthModels';

const DEFAULT_PARAMS: SynthParameters = createDefaultSynthParameters();

const DEFAULT_DRUM_FX: { sends: FxSendLevels; returnLevel: number } = {
  sends: { reverb: 0.35, delay: 0.15, drive: 0.2, phaser: 0.1, chorus: 0 },
  returnLevel: 0.7,
};

const DEFAULT_EFFECTS_LOOP: EffectsLoopState = {
  enabled: true,
  returns: { synth: 0.85, drums: 0.7 },
  drive: { enabled: true, amount: 0.18, tone: 0.65 },
  phaser: { enabled: false, rate: 0.45, depth: 0.45, feedback: 0.25, mix: 0.25 },
  delay: { enabled: true, time: 0.22, feedback: 0.35, mix: 0.3 },
  reverb: { enabled: true, decay: 2.1, mix: 0.38 },
};

const DEFAULT_DRUM_KIT_ID: DrumKitId = 'clean-analog';
const SYNTH_PRESETS_STORAGE_KEY = 'discobot_synth_presets_v1';
const MAX_HISTORY = 80;
// MIDI keys pressed within this long of each other are one chord.
const CHORD_WINDOW_MS = 60;

interface SynthPreset {
  id: string;
  name: string;
  params: SynthParameters;
  modelId: SynthModelId;
  modelParams: SynthModelParams;
  builtIn?: boolean;
}

interface PatternSnapshot {
  pattern: Pattern;
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  drumState: DrumState;
  tempo: number;
  drumMasterVolume: number;
  drumSwing: number;
  drumKitId: DrumKitId;
  drumFx: typeof DEFAULT_DRUM_FX;
  effectsLoop: EffectsLoopState;
  muted?: boolean;
  solo?: boolean;
  octaveShift?: number;
}

interface HistoryEntry {
  synthId: number;
  // the scene that was being edited, so undo can go back to it first
  sceneId: string;
  snapshot: PatternSnapshot;
}

export type PlayMode = 'pattern' | 'song';

// One chronological stack for the whole project: every snapshot also carries the shared
// drum, tempo and effects state, so per-lane stacks would undo each other's edits.
interface ProjectHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

interface SynthState {
  id: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  keyboardMode: 'keyboard' | 'piano-roll';
  stepRecordPointer: number;
  octaveShift: number;
  muted: boolean;
  solo: boolean;
  forceReleaseSignal: boolean;
}

function createDefaultDrumState(): DrumState {
  return {
    kick: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    snare: { steps: new Array(16).fill(false), settings: { volume: 0.68, tone: 0.46, extra: 0.68, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    openHH: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    closedHH: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    ride: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    crash: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    snare2: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
    clap: { steps: new Array(16).fill(false), settings: { volume: 0.5, tone: 0.5, extra: 0.5, tune: 0, humanize: 0.35 }, muted: false, solo: false },
  };
}

function clonePattern(pattern: Pattern): Pattern {
  return {
    ...pattern,
    steps: pattern.steps.map((step) => ({ ...step })),
  };
}

function cloneDrumState(state: DrumState): DrumState {
  return Object.fromEntries(
    (Object.keys(state) as DrumInstrument[]).map((instrument) => [
      instrument,
      {
        ...state[instrument],
        settings: { ...state[instrument].settings },
        steps: [...state[instrument].steps],
        stepVelocities: state[instrument].stepVelocities ? [...state[instrument].stepVelocities!] : undefined,
        stepProbabilities: state[instrument].stepProbabilities ? [...state[instrument].stepProbabilities!] : undefined,
        stepRatchets: state[instrument].stepRatchets ? [...state[instrument].stepRatchets!] : undefined,
      },
    ])
  ) as DrumState;
}

function cloneSynthParams(params: SynthParameters | null): SynthParameters | null {
  return params ? structuredClone(params) : null;
}

function cloneSynthModelParams(params: SynthModelParams | null | undefined): SynthModelParams {
  const normalized = normalizeSynthModelParams(params);
  return {
    macro1: normalized.macro1,
    macro2: normalized.macro2,
    macro3: normalized.macro3,
    macro4: normalized.macro4,
  };
}

function createBuiltInPresets(): SynthPreset[] {
  return [
    {
      id: 'builtin-pad',
      name: 'Pad',
      builtIn: true,
      modelId: DEFAULT_SYNTH_MODEL_ID,
      modelParams: createDefaultSynthModelParams(),
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'sawtooth', detune: -4, pulseWidth: 0.5 },
        oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 11, level: 0.8 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 1400, q: 1.8, envAmount: 0.2, keyTracking: 0.4 },
        filterEnvelope: { attack: 0.6, decay: 1.2, sustain: 0.6, release: 1.2 },
        spread: 0.5,
        envelope: { attack: 0.35, decay: 0.7, sustain: 0.78, release: 1.2 },
        fxReturn: 0.9,
        fxSends: { reverb: 0.55, delay: 0.26, drive: 0.05, phaser: 0.24 },
        lfo1: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.3 },
        lfo2: { enabled: true, target: 'pitch', waveform: 'sine', rate: 4.2, depth: 0.12 },
      },
    },
    {
      id: 'builtin-bass',
      name: 'Bass',
      builtIn: true,
      modelId: 'minimoog-model-d',
      modelParams: { macro1: 0.72, macro2: 0.64, macro3: 0.35, macro4: 0.45 },
      params: {
        ...DEFAULT_PARAMS,
        voiceMode: 'mono',
        oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
        mixer: { sub: 0.55, noise: 0 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 260, q: 2.5, envAmount: 0.45, keyTracking: 0.3, drive: 0.3 },
        filterEnvelope: { attack: 0.002, decay: 0.16, sustain: 0.1, release: 0.15 },
        velocity: { amp: 1, filter: 0.4 },
        envelope: { attack: 0.005, decay: 0.11, sustain: 0.48, release: 0.18 },
        fxReturn: 0.55,
        fxSends: { reverb: 0.08, delay: 0.06, drive: 0.28, phaser: 0.05 },
        lfo1: { enabled: true, target: 'filter', waveform: 'square', rate: 1.5, depth: 0.15 },
        lfo2: { enabled: false, target: 'filter', waveform: 'sine', rate: 0.5, depth: 0.1 },
      },
    },
    {
      id: 'builtin-lead',
      name: 'Lead',
      builtIn: true,
      modelId: 'prophet-5',
      modelParams: { macro1: 0.63, macro2: 0.55, macro3: 0.58, macro4: 0.44 },
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
        oscillator2: { enabled: true, type: 'square', semitones: 0, detune: 8, level: 0.7 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 2400, q: 1.9, envAmount: 0.3, keyTracking: 0.6 },
        filterEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.3 },
        envelope: { attack: 0.012, decay: 0.22, sustain: 0.62, release: 0.28 },
        fxReturn: 0.72,
        fxSends: { reverb: 0.2, delay: 0.34, drive: 0.2, phaser: 0.12 },
        lfo1: { enabled: true, target: 'pitch', waveform: 'sawtooth', rate: 5.5, depth: 0.22 },
        lfo2: { enabled: true, target: 'filter', waveform: 'triangle', rate: 0.6, depth: 0.18 },
      },
    },
    {
      id: 'builtin-pluck',
      name: 'Pluck',
      builtIn: true,
      modelId: 'dx7',
      modelParams: { macro1: 0.52, macro2: 0.68, macro3: 0.74, macro4: 0.86 },
      params: {
        ...DEFAULT_PARAMS,
        oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 500, q: 3, envAmount: 0.7, keyTracking: 0.5 },
        filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
        velocity: { amp: 1, filter: 0.3 },
        envelope: { attack: 0.002, decay: 0.19, sustain: 0.2, release: 0.12 },
        fxReturn: 0.62,
        fxSends: { reverb: 0.18, delay: 0.22, drive: 0.1, phaser: 0.07 },
        lfo1: { enabled: true, target: 'filter', waveform: 'square', rate: 8, depth: 0.25 },
        lfo2: { enabled: false, target: 'pitch', waveform: 'sine', rate: 3, depth: 0.1 },
      },
    },
    {
      id: 'builtin-grand-piano',
      name: 'Electric Piano',
      builtIn: true,
      modelId: 'dx7',
      modelParams: { macro1: 0.95, macro2: 0.2, macro3: 0.45, macro4: 0.5 },
      params: {
        ...DEFAULT_PARAMS,
        engine: 'fm',
        fm: { algorithm: 1, ratio: 14, index: 0.22, decay: 0.35, feedback: 0 },
        oscillator: { type: 'sine', detune: 0, pulseWidth: 0.5 },
        filter: { ...DEFAULT_PARAMS.filter, frequency: 9000, q: 0.7, keyTracking: 0.5 },
        velocity: { amp: 1, filter: 0.35 },
        envelope: { attack: 0.004, decay: 0.42, sustain: 0.22, release: 1.45 },
        fxReturn: 0.82,
        fxSends: { reverb: 0.34, delay: 0.06, drive: 0.02, phaser: 0.02 },
        lfo1: { enabled: false, target: 'pitch', waveform: 'triangle', rate: 4.8, depth: 0.02 },
        lfo2: { enabled: false, target: 'filter', waveform: 'sine', rate: 1, depth: 0.05 },
      },
    },
  ];
}

// User presets from browser storage or a project file; anything malformed is dropped.
function parseUserPresets(value: unknown): SynthPreset[] {
  if (!Array.isArray(value)) return [];
  const parsed = value as Array<{
    id: string;
    name: string;
    params: SynthParameters;
    modelId?: SynthModelId;
    modelParams?: SynthModelParams;
  }>;
  return parsed
    .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && entry.params)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      // Presets saved before a parameter existed take its default instead of inheriting the lane's value.
      params: sanitizeSynthParams(entry.params, DEFAULT_PARAMS),
      modelId: normalizeSynthModelId(entry.modelId),
      modelParams: cloneSynthModelParams(entry.modelParams),
    }));
}

function loadUserPresets(): SynthPreset[] {
  try {
    const raw = localStorage.getItem(SYNTH_PRESETS_STORAGE_KEY);
    return raw ? parseUserPresets(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function normalizeFxSends(sends: Partial<FxSendLevels> | undefined): FxSendLevels {
  return {
    reverb: Math.max(0, Math.min(1, sends?.reverb ?? DEFAULT_DRUM_FX.sends.reverb)),
    delay: Math.max(0, Math.min(1, sends?.delay ?? DEFAULT_DRUM_FX.sends.delay)),
    drive: Math.max(0, Math.min(1, sends?.drive ?? DEFAULT_DRUM_FX.sends.drive)),
    phaser: Math.max(0, Math.min(1, sends?.phaser ?? DEFAULT_DRUM_FX.sends.phaser)),
    chorus: Math.max(0, Math.min(1, sends?.chorus ?? 0)),
  };
}

function normalizeSynthParams(params: SynthParameters | null): SynthParameters | null {
  if (!params) return null;
  const allowedArpModes: SynthParameters['arpeggiator']['mode'][] = ['up', 'down', 'updown', 'downup', 'random', 'converge', 'diverge'];
  const allowedArpRates: SynthParameters['arpeggiator']['rate'][] = ['1/4', '1/8', '1/16', '1/32'];
  const mode = allowedArpModes.includes(params.arpeggiator?.mode as SynthParameters['arpeggiator']['mode'])
    ? params.arpeggiator.mode
    : DEFAULT_PARAMS.arpeggiator.mode;
  const rate = allowedArpRates.includes(params.arpeggiator?.rate as SynthParameters['arpeggiator']['rate'])
    ? params.arpeggiator.rate
    : DEFAULT_PARAMS.arpeggiator.rate;
  return {
    ...params,
    fxReturn: Math.max(0, Math.min(1, params.fxReturn ?? DEFAULT_PARAMS.fxReturn)),
    arpeggiator: {
      enabled: params.arpeggiator?.enabled ?? DEFAULT_PARAMS.arpeggiator.enabled,
      mode,
      rate,
      gate: Math.max(0.1, Math.min(1, params.arpeggiator?.gate ?? DEFAULT_PARAMS.arpeggiator.gate)),
    },
    fxSends: normalizeFxSends(params.fxSends),
  };
}

function normalizeDrumFx(fx: { sends?: Partial<FxSendLevels>; returnLevel?: number } | undefined) {
  return {
    sends: normalizeFxSends(fx?.sends),
    returnLevel: Math.max(0, Math.min(1, fx?.returnLevel ?? DEFAULT_DRUM_FX.returnLevel)),
  };
}

function normalizeEffectsLoop(loop: Partial<EffectsLoopState> | undefined): EffectsLoopState {
  return {
    enabled: loop?.enabled ?? DEFAULT_EFFECTS_LOOP.enabled,
    returns: {
      synth: Math.max(0, Math.min(1, loop?.returns?.synth ?? DEFAULT_EFFECTS_LOOP.returns.synth)),
      drums: Math.max(0, Math.min(1, loop?.returns?.drums ?? DEFAULT_EFFECTS_LOOP.returns.drums)),
    },
    drive: {
      enabled: loop?.drive?.enabled ?? DEFAULT_EFFECTS_LOOP.drive.enabled,
      amount: Math.max(0, Math.min(1, loop?.drive?.amount ?? DEFAULT_EFFECTS_LOOP.drive.amount)),
      tone: Math.max(0, Math.min(1, loop?.drive?.tone ?? DEFAULT_EFFECTS_LOOP.drive.tone)),
    },
    phaser: {
      enabled: loop?.phaser?.enabled ?? DEFAULT_EFFECTS_LOOP.phaser.enabled,
      rate: Math.max(0.05, Math.min(8, loop?.phaser?.rate ?? DEFAULT_EFFECTS_LOOP.phaser.rate)),
      depth: Math.max(0, Math.min(1, loop?.phaser?.depth ?? DEFAULT_EFFECTS_LOOP.phaser.depth)),
      feedback: Math.max(0, Math.min(0.95, loop?.phaser?.feedback ?? DEFAULT_EFFECTS_LOOP.phaser.feedback)),
      mix: Math.max(0, Math.min(1, loop?.phaser?.mix ?? DEFAULT_EFFECTS_LOOP.phaser.mix)),
    },
    delay: {
      enabled: loop?.delay?.enabled ?? DEFAULT_EFFECTS_LOOP.delay.enabled,
      time: Math.max(0.01, Math.min(1.5, loop?.delay?.time ?? DEFAULT_EFFECTS_LOOP.delay.time)),
      feedback: Math.max(0, Math.min(0.95, loop?.delay?.feedback ?? DEFAULT_EFFECTS_LOOP.delay.feedback)),
      mix: Math.max(0, Math.min(1, loop?.delay?.mix ?? DEFAULT_EFFECTS_LOOP.delay.mix)),
      // Always present here, so turning sync off reaches the store instead of being merged away.
      sync: loop?.delay?.sync ?? 'off',
    },
    reverb: {
      enabled: loop?.reverb?.enabled ?? DEFAULT_EFFECTS_LOOP.reverb.enabled,
      decay: Math.max(0.2, Math.min(8, loop?.reverb?.decay ?? DEFAULT_EFFECTS_LOOP.reverb.decay)),
      mix: Math.max(0, Math.min(1, loop?.reverb?.mix ?? DEFAULT_EFFECTS_LOOP.reverb.mix)),
      // Always present here, like the delay's sync, so setting them back to zero reaches the store.
      preDelay: loop?.reverb?.preDelay ?? 0,
      damping: loop?.reverb?.damping ?? 0,
    },
    // Checked and clamped by the store; passed through as they are.
    ...(loop?.chorus ? { chorus: { ...loop.chorus } } : {}),
    ...(loop?.eq ? { eq: { ...loop.eq } } : {}),
  };
}

function midiNoteToName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = notes[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export function useStudio() {
  const synthAudio = useSynthAudio();
  const drumAudio = useDrumAudio();
  const [synths, setSynths] = useState<SynthState[]>([]);
  const [selectedSynthId, setSelectedSynthId] = useState(1);
  const [drumState, setDrumState] = useState<DrumState>(createDefaultDrumState);
  const [drumKits, setDrumKits] = useState<DrumKitDefinition[]>([]);
  const [drumKitsLoading, setDrumKitsLoading] = useState(false);
  const [drumKitsError, setDrumKitsError] = useState<string | null>(null);
  const [selectedDrumKitId, setSelectedDrumKitId] = useState<DrumKitId>(DEFAULT_DRUM_KIT_ID);
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const [drumSwing, setDrumSwing] = useState(0);
  const [drumCurrentStep, setDrumCurrentStep] = useState(0);
  const [drumFx, setDrumFx] = useState(DEFAULT_DRUM_FX);
  const [effectsLoop, setEffectsLoop] = useState(DEFAULT_EFFECTS_LOOP);
  const [browserMuted, setBrowserMuted] = useState(false);
  const [browserVolume, setBrowserVolume] = useState(1.0);
  const [globalTempo, setGlobalTempo] = useState(120);
  const [storageError, setStorageError] = useState<string | null>(null);
  // Decoded samples for the drum lanes that use one, and the lanes whose sample is not on this device.
  const drumSamplesRef = useRef<Partial<Record<DrumInstrument, DrumSample>>>({});
  const [missingDrumSamples, setMissingDrumSamples] = useState<DrumInstrument[]>([]);
  // What an imported preset was, and what did not carry over, shown once after importing.
  const [presetImportReport, setPresetImportReport] = useState<Pick<ImportedPreset, 'name' | 'source' | 'notes'> | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  // Set while an export is playing the arrangement through to record its guests: how long it will take.
  const [guestRecording, setGuestRecording] = useState<number | null>(null);
  const guestsRef = useRef<Guest[]>([]);
  guestsRef.current = guests;
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [currentSceneId, setCurrentSceneId] = useState('');
  const [song, setSong] = useState<Song>({ entries: [], loop: false });
  const [playMode, setPlayMode] = useState<PlayMode>('pattern');
  // the block of the song that Play starts from
  const [songStartEntry, setSongStartEntry] = useState(0);
  const [songPosition, setSongPosition] = useState<SongPosition | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [midiMode, setMidiMode] = useState<MidiMode>('live');
  const [midiChannel, setMidiChannel] = useState(1);
  const [midiTargetSynthId, setMidiTargetSynthId] = useState<number | null>(1);
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [synthPresets, setSynthPresets] = useState<SynthPreset[]>(() => [
    ...createBuiltInPresets(),
    ...createNamedSynthPresets(DEFAULT_PARAMS),
    ...loadUserPresets(),
  ]);
  const synthPresetsRef = useRef(synthPresets);
  synthPresetsRef.current = synthPresets;
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;

  const synthsRef = useRef(synths);
  synthsRef.current = synths;
  const midiModeRef = useRef(midiMode);
  midiModeRef.current = midiMode;
  const midiChannelRef = useRef(midiChannel);
  midiChannelRef.current = midiChannel;
  const midiTargetSynthIdRef = useRef(midiTargetSynthId);
  midiTargetSynthIdRef.current = midiTargetSynthId;
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;
  const selectedDrumKitIdRef = useRef(selectedDrumKitId);
  selectedDrumKitIdRef.current = selectedDrumKitId;
  const drumFxRef = useRef(drumFx);
  drumFxRef.current = drumFx;
  const effectsLoopRef = useRef(effectsLoop);
  effectsLoopRef.current = effectsLoop;
  const historyRef = useRef<ProjectHistory>({ undo: [], redo: [] });
  const historyThrottleRef = useRef<Record<string, number>>({});
  const isRestoringRef = useRef(false);
  const midiHeldRef = useRef(new Map<string, number>());
  const midiChordRef = useRef<{ synthId: number; stepIndex: number; at: number } | null>(null);
  const globalTempoRef = useRef(globalTempo);
  globalTempoRef.current = globalTempo;
  const drumSwingRef = useRef(drumSwing);
  drumSwingRef.current = drumSwing;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const currentSceneIdRef = useRef(currentSceneId);
  currentSceneIdRef.current = currentSceneId;
  const songRef = useRef(song);
  songRef.current = song;
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const songStartEntryRef = useRef(songStartEntry);
  songStartEntryRef.current = songStartEntry;
  const currentArrangementRef = useRef<() => ExportArrangement>(() => { throw new Error('not ready'); });
  const songStartBarRef = useRef(0);
  const songEndingRef = useRef(false);
  const stopPlaybackRef = useRef<() => void>(() => {});
  const handleGlobalPlayStopRef = useRef<() => Promise<void>>(async () => {});
  const transportRef = useRef<BrowserTransport | null>(null);
  const liveSceneRef = useRef<() => Scene>(() => ({ id: '', name: '', lanes: {}, drums: createDefaultDrumState() }));
  const sceneLengthRef = useRef<(sceneId: string) => number>(() => 1);
  const scheduleTickRef = useRef<(tick: TransportTick) => void>(() => {});
  const initializedSynthLanesRef = useRef(false);

  useEffect(() => {
    if (synths.length === 0) return;
    if (midiTargetSynthId !== null && synths.some((s) => s.id === midiTargetSynthId)) return;
    setMidiTargetSynthId(synths[0].id);
  }, [synths, midiTargetSynthId]);

  useEffect(() => {
    setMasterVolume(browserVolume);
  }, [browserVolume, synthAudio, drumAudio]);

  useEffect(() => { setMasterMuted(browserMuted); }, [browserMuted]);
  useEffect(() => {
    drumAudio.setVolume(drumMasterVolume);
    drumAudio.setKit(selectedDrumKitId);
    drumAudio.setFxSends(drumFx.sends, drumFx.returnLevel);
    drumAudio.setEffectsLoop(effectsLoop);
  }, [drumAudio, drumMasterVolume, selectedDrumKitId, drumFx, effectsLoop]);

  useEffect(() => {
    if (synths.length === 0 || initializedSynthLanesRef.current) return;
    initializedSynthLanesRef.current = true;
    for (const id of [2, 3]) {
      if (!synths.some(s => s.id === id)) {
        void ensureSynthExists(id);
      }
    }
  }, [synths]);

  useEffect(() => {
    if (synths.length > 0 && !synths.some(s => s.id === selectedSynthId)) {
      setSelectedSynthId(synths[0].id);
    }
  }, [synths, selectedSynthId]);

  useEffect(() => {
    return () => {
      synthAudio.dispose();
      drumAudio.dispose();
      transportRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    function resumeAudioContexts() {
      if (synthAudio) synthAudio.tryResume();
      if (drumAudio) drumAudio.tryResume();
    }
    window.addEventListener('click', resumeAudioContexts);
    window.addEventListener('keydown', resumeAudioContexts);
    return () => {
      window.removeEventListener('click', resumeAudioContexts);
      window.removeEventListener('keydown', resumeAudioContexts);
    };
  }, [synthAudio, drumAudio]);

  const getSnapshot = useCallback((synthId: number, patternId: string): PatternSnapshot | null => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId && entry.pattern?.id === patternId);
    if (!synth?.pattern) return null;
    return {
      pattern: clonePattern(synth.pattern),
      synthParams: cloneSynthParams(synth.synthParams),
      synthModelId: synth.synthModelId,
      synthModelParams: cloneSynthModelParams(synth.synthModelParams),
      drumState: cloneDrumState(drumStateRef.current),
      tempo: globalTempo,
      drumMasterVolume,
      drumSwing,
      drumKitId: selectedDrumKitIdRef.current,
      drumFx: structuredClone(drumFxRef.current),
      effectsLoop: structuredClone(effectsLoopRef.current),
      muted: synth.muted,
      solo: synth.solo,
      octaveShift: synth.octaveShift ?? 0,
    };
  }, [globalTempo, drumMasterVolume, drumSwing]);

  const pushHistorySnapshot = useCallback((synthId: number, patternId: string) => {
    if (isRestoringRef.current) return;
    const snapshot = getSnapshot(synthId, patternId);
    if (!snapshot) return;
    const history = historyRef.current;
    history.undo.push({ synthId, sceneId: currentSceneIdRef.current, snapshot });
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
    history.redo = [];
  }, [getSnapshot]);

  const pushHistorySnapshotThrottled = useCallback(
    (synthId: number, patternId: string, keySuffix: string, minIntervalMs = 250) => {
      const now = performance.now();
      const key = `${synthId}:${patternId}:${keySuffix}`;
      const lastTs = historyThrottleRef.current[key] ?? 0;
      historyThrottleRef.current[key] = now;
      // Compare against the last change, not the last snapshot, so one continuous drag is one undo step.
      if (now - lastTs < minIntervalMs) return;
      pushHistorySnapshot(synthId, patternId);
    },
    [pushHistorySnapshot]
  );

  const applySnapshot = useCallback(async (synthId: number, snapshot: PatternSnapshot) => {
    setDrumMasterVolume(snapshot.drumMasterVolume);
    setDrumSwing(snapshot.drumSwing);
    setSelectedDrumKitId(snapshot.drumKitId);
    setDrumFx(snapshot.drumFx);
    setEffectsLoop(snapshot.effectsLoop);
    await Promise.all([
      localRequest('/drum/master-volume', { method: 'POST', body: JSON.stringify({ volume: snapshot.drumMasterVolume }) }),
      localRequest('/drum/swing', { method: 'POST', body: JSON.stringify({ swing: snapshot.drumSwing }) }),
      localRequest('/drum/kit', { method: 'POST', body: JSON.stringify({ kitId: snapshot.drumKitId, applyDefaults: false }) }),
      localRequest('/drum/fx', { method: 'POST', body: JSON.stringify(snapshot.drumFx) }),
      localRequest('/effects-loop', { method: 'POST', body: JSON.stringify(snapshot.effectsLoop) }),
    ]);
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId
        ? {
          ...entry,
          pattern: clonePattern(snapshot.pattern),
          synthParams: cloneSynthParams(snapshot.synthParams),
          synthModelId: snapshot.synthModelId,
          synthModelParams: cloneSynthModelParams(snapshot.synthModelParams),
          selectedStep: null,
          muted: snapshot.muted ?? entry.muted,
          solo: snapshot.solo ?? entry.solo,
          octaveShift: snapshot.octaveShift ?? entry.octaveShift,
        }
        : entry
    )));
    setDrumState(cloneDrumState(snapshot.drumState));
    setGlobalTempo(snapshot.tempo);
    await Promise.all([
      localRequest(`/synth/${synthId}/patterns/${snapshot.pattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot.pattern),
      }),
      localRequest(`/synth/${synthId}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot.synthParams || DEFAULT_PARAMS),
      }),
      localRequest(`/synth/${synthId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: snapshot.synthModelId,
          modelParams: snapshot.synthModelParams,
        }),
      }),
      localRequest('/drum/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: snapshot.drumState }),
      }),
      localRequest('/tempo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempo: snapshot.tempo }),
      }),
      localRequest(`/synth/${synthId}/mix`, {
        method: 'POST',
        body: JSON.stringify({ muted: snapshot.muted ?? false, solo: snapshot.solo ?? false }),
      }),
      localRequest(`/synth/${synthId}/preferences`, {
        method: 'POST',
        body: JSON.stringify({ octaveShift: snapshot.octaveShift ?? 0 }),
      }),
    ]);
  }, []);

  const stepHistory = useCallback(async (direction: 'undo' | 'redo') => {
    if (isRestoringRef.current) return;
    const history = historyRef.current;
    const from = direction === 'undo' ? history.undo : history.redo;
    const to = direction === 'undo' ? history.redo : history.undo;
    let entry = from.pop();
    // Entries for a lane or scene that has since been removed can no longer be applied.
    const usable = (candidate: HistoryEntry) => synthsRef.current.some((synth) => synth.id === candidate.synthId)
      && scenesRef.current.some((scene) => scene.id === candidate.sceneId);
    while (entry && !usable(entry)) entry = from.pop();
    if (!entry) return;
    // The edit was made in another scene: go back to it, then undo there.
    if (entry.sceneId !== currentSceneIdRef.current) {
      await localRequest('/scenes/select', { method: 'POST', body: JSON.stringify({ sceneId: entry.sceneId }) });
    }
    const currentPattern = synthsRef.current.find((synth) => synth.id === entry!.synthId)?.pattern;
    const current = currentPattern ? getSnapshot(entry.synthId, currentPattern.id) : null;
    if (current) to.push({ synthId: entry.synthId, sceneId: entry.sceneId, snapshot: current });
    isRestoringRef.current = true;
    try {
      await applySnapshot(entry.synthId, entry.snapshot);
    } finally {
      isRestoringRef.current = false;
    }
  }, [getSnapshot, applySnapshot]);

  const handleUndo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const handleRedo = useCallback(() => stepHistory('redo'), [stepHistory]);

  const [midiImportData, setMidiImportData] = useState<MidiImportResult | null>(null);
  const midiImportOpen = midiImportData !== null;
  useEffect(() => {
    if (!helpOpen && !midiImportOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHelpOpen(false);
      setMidiImportData(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, midiImportOpen]);

  useEffect(() => {
    const presetsToPersist = synthPresets
      .filter((preset) => !preset.builtIn)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        params: preset.params,
        modelId: preset.modelId,
        modelParams: preset.modelParams,
      }));
    try {
      localStorage.setItem(SYNTH_PRESETS_STORAGE_KEY, JSON.stringify(presetsToPersist));
    } catch {
      setStorageError('Unable to persist synth presets in browser storage.');
    }
  }, [synthPresets]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (helpOpen || midiImportOpen) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        void handleRedo();
        return;
      }
      if (key === 'z') {
        event.preventDefault();
        void handleUndo();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        void handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, midiImportOpen, handleUndo, handleRedo]);

  const triggerSynthNote = useCallback((synthParams: SynthParameters, note: string, windowSeconds: number, velocity: number = 1, synthId = 1, scheduledTime?: number, slide = false) => {
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    for (const scheduled of expandStep(note, synthParams, windowSeconds, globalTempoRef.current, slide)) {
      // Only later pulses need a start time; an unscheduled first pulse plays immediately.
      const time = scheduledTime !== undefined ? scheduledTime + scheduled.offset
        : scheduled.offset > 0 ? getAudioContext().currentTime + scheduled.offset : undefined;
      void synthAudio.playNote(scheduled.note, synthParams, scheduled.duration, normalizedVelocity,
        browserMutedRef.current, effectsLoopRef.current, globalTempoRef.current, synthId, time);
    }
  }, [synthAudio]);

  // One step of a pattern: its whole chord, for its whole length.
  const triggerStep = useCallback((synthParams: SynthParameters, step: SequencerStep, windowSeconds: number, synthId: number, scheduledTime: number) => {
    const velocity = Math.max(0, Math.min(1, step.velocity));
    for (const scheduled of expandStepNotes(step, synthParams, windowSeconds, globalTempoRef.current)) {
      void synthAudio.playNote(scheduled.note, synthParams, scheduled.duration, velocity,
        browserMutedRef.current, effectsLoopRef.current, globalTempoRef.current, synthId, scheduledTime + scheduled.offset);
    }
  }, [synthAudio]);

  useEffect(() => { setEffectsTempo(globalTempo); }, [globalTempo]);

  // The open scene as it stands now: its stored copy can be behind the live lanes.
  const liveScene = (): Scene => {
    const lanes = synthsRef.current.filter(synth => synth.pattern);
    return {
      id: currentSceneIdRef.current, name: scenesRef.current.find(scene => scene.id === currentSceneIdRef.current)?.name ?? 'Scene',
      lanes: Object.fromEntries(lanes.map(synth => [synth.id, synth.pattern!.steps])),
      laneBars: Object.fromEntries(lanes.map(synth => [synth.id, laneBars(synth.pattern!.steps.length, synth.pattern!.bars)])),
      drums: drumStateRef.current,
    };
  };
  liveSceneRef.current = liveScene;
  // How many bars one pass through a scene lasts.
  const sceneLength = (sceneId: string) => {
    if (sceneId === currentSceneIdRef.current) return sceneBars(liveScene());
    const stored = scenesRef.current.find(scene => scene.id === sceneId);
    return stored ? sceneBars(stored) : 1;
  };
  sceneLengthRef.current = sceneLength;

  scheduleTickRef.current = ({ step, bar, time, duration }) => {
    // Where in its pattern each lane is. In song mode that is counted from the start of the
    // scene's pass; otherwise the bars just keep counting and lanes of different lengths drift.
    let passBar = bar;
    // In song mode the bar number picks the scene. A scene other than the one open for
    // editing is played from its stored copy; the open one is played from the live pattern.
    let scene: Scene | null = null;
    if (playModeRef.current === 'song') {
      const position = sceneAtBar(songRef.current, songStartBarRef.current + bar, sceneLength);
      if (!position) {
        if (!songEndingRef.current) {
          songEndingRef.current = true;
          // Stop on the bar line this tick belongs to, not now: ticks are scheduled a little ahead.
          setTimeout(() => stopPlaybackRef.current(), Math.max(0, (time - getAudioContext().currentTime) * 1000));
        }
        return;
      }
      passBar = position.bar;
      if (step === 0) {
        setSongPosition(position);
        // Open the playing scene in the editor. This updates the live pattern at once.
        if (position.sceneId !== currentSceneIdRef.current) {
          void localRequest('/scenes/select', { method: 'POST', body: JSON.stringify({ sceneId: position.sceneId }) });
        }
      }
      if (position.sceneId !== currentSceneIdRef.current) {
        scene = scenesRef.current.find(entry => entry.id === position.sceneId) ?? null;
      }
    }
    const lanes = synthsRef.current;
    const hasSolo = lanes.some(s => s.solo);
    for (const synth of lanes) {
      if (!synth.isPlaying || !synth.pattern || !synth.synthParams) continue;
      const steps = scene ? scene.lanes[synth.id] ?? [] : synth.pattern.steps;
      if (steps.length === 0) continue;
      const bars = laneBars(steps.length, scene ? scene.laneBars?.[synth.id] : synth.pattern.bars);
      const perBar = steps.length / bars;
      const divisor = perBar === 32 ? 1 : 2;
      if (step % divisor !== 0) continue;
      const index = (passBar % bars) * perBar + Math.floor(step / divisor) % perBar;
      const note = steps[index];
      if (!synth.muted && (!hasSolo || synth.solo) && note?.active && note.note) {
        triggerStep(synth.synthParams, note, duration * divisor, synth.id, time);
      }
      setSynths(prev => prev.map(s => s.id === synth.id ? { ...s, currentStep: index } : s));
    }
    if (step % 2 !== 0) return;
    const state = scene ? sceneDrumState(scene, drumStateRef.current) : drumStateRef.current;
    const stepInBar = Math.floor(step / 2);
    const drumStep = (passBar % drumBars(state)) * DRUM_STEPS_PER_BAR + stepInBar;
    setDrumCurrentStep(drumStep);
    const drumSolo = (Object.keys(state) as DrumInstrument[]).some(i => state[i].solo);
    const swingOffset = stepInBar % 2 ? drumSwingRef.current * duration * 2 : 0;
    for (const instrument of Object.keys(state) as DrumInstrument[]) {
      const track = state[instrument];
      if (track.muted || (drumSolo && !track.solo)) continue;
      const velocity = track.stepVelocities?.[drumStep] ?? 1;
      for (const offset of expandDrumStep(track, drumStep)) {
        const hitTime = time + swingOffset + offset * duration * 2;
        void drumAudio.playDrumHit(instrument, track.settings, velocity, hitTime);
        if (instrument !== 'kick') continue;
        for (const synth of lanes) {
          const amount = synth.synthParams?.duck ?? 0;
          if (amount > 0) synthAudio.duck(synth.id, hitTime, amount);
        }
      }
    }
  };

  const transportPlaying = synths.some(s => s.isPlaying);
  useEffect(() => {
    if (transportPlaying) {
      transportRef.current ??= new BrowserTransport(
        () => getAudioContext().currentTime,
        () => globalTempoRef.current,
        tick => scheduleTickRef.current(tick),
      );
      const transport = transportRef.current, context = getAudioContext();
      // Guests are told where the beats fall on the computer's clock, which they share with this page.
      transport.onTempo = (bpm, time, beat) => guestLink.announce({ playing: true, bpm, anchorWall: wallAtContextTime(context, time), anchorBeat: beat });
      // With guests connected the first beat is placed far enough ahead for all of them to make it.
      transport.start(guestLink.startLead() || undefined);
      guestLink.announce({ playing: true, bpm: globalTempoRef.current, anchorWall: wallAtContextTime(context, transport.startTime), anchorBeat: 0 });
    } else {
      if (guestLink.transport().playing) guestLink.announce({ playing: false });
      transportRef.current?.stop();
      setDrumCurrentStep(0);
      synthAudio.stopAllNotes();
      drumAudio.stopAllNotes();
    }
  }, [transportPlaying]);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'guestsChanged': {
        setGuests(message.data.guests ?? []);
        break;
      }
      case 'init': {
        setGuests(message.data.guests ?? []);
        if (message.data.restored) initializedSynthLanesRef.current = true;
        if (message.data.synths) {
          setSynths(message.data.synths.map((s: any) => ({
            id: s.synthId,
            pattern: s.pattern,
            patterns: s.patterns || [],
            synthParams: normalizeSynthParams(s.synthParams),
            synthModelId: normalizeSynthModelId(s.synthModelId),
            synthModelParams: normalizeSynthModelParams(s.synthModelParams),
            isPlaying: s.isPlaying || false,
            currentStep: 0,
            selectedStep: null,
            keyboardMode: s.keyboardMode || 'keyboard',
            stepRecordPointer: 0,
            octaveShift: s.octaveShift || 0,
            muted: Boolean(s.muted),
            solo: Boolean(s.solo),
            forceReleaseSignal: false,
          })));
        } else if (message.data.synthParameters) {
          setSynths([{
            id: 1,
            pattern: message.data.patterns?.[0] || null,
            patterns: message.data.patterns || [],
            synthParams: normalizeSynthParams(message.data.synthParameters),
            synthModelId: DEFAULT_SYNTH_MODEL_ID,
            synthModelParams: createDefaultSynthModelParams(),
            isPlaying: false,
            currentStep: 0,
            selectedStep: null,
            keyboardMode: 'keyboard',
            stepRecordPointer: 0,
            octaveShift: 0,
            muted: false,
            solo: false,
            forceReleaseSignal: false,
          }]);
        }
        if (message.data.drumState) setDrumState(message.data.drumState);
        if (Array.isArray(message.data.drumKits)) setDrumKits(message.data.drumKits);
        if (message.data.selectedDrumKitId) setSelectedDrumKitId(message.data.selectedDrumKitId as DrumKitId);
        if (message.data.drumFx) setDrumFx(normalizeDrumFx(message.data.drumFx));
        if (message.data.effectsLoop) setEffectsLoop(normalizeEffectsLoop(message.data.effectsLoop));
        if (message.data.tempo) setGlobalTempo(message.data.tempo);
        if (typeof message.data.drumMasterVolume === 'number') setDrumMasterVolume(message.data.drumMasterVolume);
        if (typeof message.data.drumSwing === 'number') setDrumSwing(message.data.drumSwing);
        if (typeof message.data.projectId === 'string') {
          setProjectId(message.data.projectId);
          setProjectName(message.data.name);
        }
        if (Array.isArray(message.data.scenes)) {
          setScenes(message.data.scenes);
          setCurrentSceneId(message.data.currentSceneId);
          setSong(message.data.song);
          setSongStartEntry(0);
        }
        break;
      }
      case 'sceneChanged': {
        const { scenes: nextScenes, song: nextSong, currentSceneId: nextSceneId, synths: lanePatterns, drumState: nextDrums } = message.data;
        // Each guest takes on the settings the scene holds for it.
        if (message.data.guests) setGuests(message.data.guests);
        const switched = nextSceneId !== currentSceneIdRef.current;
        const nextLanes = synthsRef.current.map(s => {
          const pattern = lanePatterns.find((lane: { synthId: number }) => lane.synthId === s.id)?.pattern;
          return pattern ? { ...s, pattern, selectedStep: switched ? null : s.selectedStep } : s;
        });
        // The scheduler and undo read these refs before React has rendered again.
        synthsRef.current = nextLanes;
        drumStateRef.current = nextDrums;
        scenesRef.current = nextScenes;
        currentSceneIdRef.current = nextSceneId;
        songRef.current = nextSong;
        setSynths(prev => prev.map(s => {
          const pattern = lanePatterns.find((lane: { synthId: number }) => lane.synthId === s.id)?.pattern;
          return pattern ? { ...s, pattern, selectedStep: switched ? null : s.selectedStep } : s;
        }));
        setDrumState(nextDrums);
        setScenes(nextScenes);
        setCurrentSceneId(nextSceneId);
        setSong(nextSong);
        setSongStartEntry(entry => Math.min(entry, nextSong.entries.length - 1));
        break;
      }
      case 'synthUpdate': {
        const { synthId, parameters } = message.data;
        synthAudio.updateParameters(parameters, globalTempoRef.current, effectsLoopRef.current, synthId);
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, synthParams: normalizeSynthParams(parameters) } : s
        ));
        break;
      }
      case 'patternCreated': {
        const { synthId, pattern } = message.data;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, patterns: [...s.patterns, pattern] } : s
        ));
        break;
      }
      case 'patternUpdated': {
        const { synthId, pattern } = message.data;
        setSynths(prev => prev.map(s => {
          if (s.id !== synthId) return s;
          const patterns = s.patterns.map(p => p.id === pattern.id ? pattern : p);
          const currentPattern = s.pattern?.id === pattern.id ? pattern : s.pattern;
          return { ...s, patterns, pattern: currentPattern };
        }));
        break;
      }
      case 'synthCreated': {
        const { synthId, pattern, synthParams, synthModelId, synthModelParams } = message.data;
        setSynths(prev => {
          if (prev.some(s => s.id === synthId)) return prev;
          return [...prev, {
            id: synthId,
            pattern,
            patterns: pattern ? [pattern] : [],
            synthParams: normalizeSynthParams(synthParams),
            synthModelId: normalizeSynthModelId(synthModelId),
            synthModelParams: normalizeSynthModelParams(synthModelParams),
            isPlaying: Boolean(message.data.isPlaying),
            currentStep: 0,
            selectedStep: null,
            keyboardMode: 'keyboard',
            stepRecordPointer: 0,
            octaveShift: 0,
            muted: Boolean(message.data.muted),
            solo: Boolean(message.data.solo),
            forceReleaseSignal: false,
          }];
        });
        break;
      }
      case 'synthModelUpdate': {
        const { synthId, modelId, modelParams } = message.data;
        setSynths((prev) => prev.map((s) => (
          s.id === synthId
            ? {
              ...s,
              synthModelId: normalizeSynthModelId(modelId),
              synthModelParams: normalizeSynthModelParams(modelParams),
            }
            : s
        )));
        break;
      }
      case 'synthMix': {
        const { synthId, muted, solo } = message.data;
        const nextLanes = synthsRef.current.map(s => s.id === synthId ? { ...s, muted: Boolean(muted), solo: Boolean(solo) } : s);
        const hasSolo = nextLanes.some(s => s.solo);
        nextLanes.forEach(s => { if (s.muted || (hasSolo && !s.solo)) synthAudio.stopSynth(s.id); });
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, muted: Boolean(muted), solo: Boolean(solo) } : s
        ));
        break;
      }
      case 'synthRemoved': {
        const { synthId } = message.data;
        synthsRef.current = synthsRef.current.filter(s => s.id !== synthId);
        setSynths(prev => prev.filter(s => s.id !== synthId));
        break;
      }
      case 'sequencerPlay': {
        const { synthId } = message.data;
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: true } : s
        ));
        break;
      }
      case 'sequencerStop': {
        const { synthId } = message.data;
        synthsRef.current = synthsRef.current.map(s =>
          s.id === synthId ? { ...s, isPlaying: false } : s
        );
        synthAudio.stopSynth(synthId);
        setSynths(prev => prev.map(s =>
          s.id === synthId ? { ...s, isPlaying: false, currentStep: 0, forceReleaseSignal: !s.forceReleaseSignal } : s
        ));
        break;
      }
      case 'tempoChange': {
        const { tempo } = message.data;
        setGlobalTempo(tempo);
        break;
      }
      case 'drumStep': {
        const { instrument: di, step: ds, active: da } = message.data;
        setDrumState(prev => {
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
      case 'drumStepVelocity': {
        const { instrument: dvi, step: dvs, velocity: dvv } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          const inst = dvi as DrumInstrument;
          next[inst] = {
            ...next[inst],
            stepVelocities: [...(next[inst].stepVelocities || new Array(next[inst].steps.length).fill(1))],
          };
          next[inst].stepVelocities![dvs as number] = dvv as number;
          return next;
        });
        break;
      }
      case 'drumSettings': {
        const { instrument: dsi, settings: dss } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          const inst = dsi as DrumInstrument;
          next[inst] = { ...next[inst], settings: { ...next[inst].settings, ...dss } };
          return next;
        });
        break;
      }
      case 'drumMix': {
        const { instrument, muted, solo } = message.data;
        setDrumState(prev => {
          const next = { ...prev };
          const inst = instrument as DrumInstrument;
          next[inst] = {
            ...next[inst],
            muted: Boolean(muted),
            solo: Boolean(solo),
          };
          return next;
        });
        break;
      }
      case 'drumReset': {
        setDrumState(createDefaultDrumState());
        break;
      }
      case 'drumFullState': {
        if (message.data.drumState) setDrumState(message.data.drumState);
        break;
      }
      case 'drumSwing': {
        if (typeof message.data.swing === 'number') setDrumSwing(message.data.swing);
        break;
      }
      case 'drumKitChanged': {
        if (message.data.selectedDrumKitId) {
          setSelectedDrumKitId(message.data.selectedDrumKitId as DrumKitId);
        }
        if (message.data.drumState) {
          setDrumState(message.data.drumState as DrumState);
        }
        break;
      }
      case 'drumFxUpdate': {
        if (message.data.drumFx) setDrumFx(normalizeDrumFx(message.data.drumFx));
        break;
      }
      case 'effectsLoopUpdate': {
        if (message.data.effectsLoop) setEffectsLoop(normalizeEffectsLoop(message.data.effectsLoop));
        break;
      }
      case 'projectsChanged': {
        setProjects(message.data.projects);
        setProjectId(message.data.projectId);
        setProjectName(message.data.name);
        break;
      }
      case 'externalChange': {
        setChangedElsewhere(true);
        break;
      }
      case 'storageError': {
        setStorageError(message.data.message);
        break;
      }
    }
  }, [synthAudio, drumAudio, triggerSynthNote, globalTempo]);

  const messageHandlerRef = useRef(handleMessage);
  messageHandlerRef.current = handleMessage;
  useEffect(() => {
    localService.initialize({
      synthParams: DEFAULT_PARAMS, drumState: createDefaultDrumState(),
      effectsLoop: DEFAULT_EFFECTS_LOOP, drumFx: DEFAULT_DRUM_FX,
    });
    const unsubscribe = localService.subscribe(message => messageHandlerRef.current(message));
    void localService.openLibrary().then(startProjectSync);
    return unsubscribe;
  }, []);


  const handleRemoveSynth = useCallback(async (synthId: number) => {
    if (synthId === 1) return;
    synthsRef.current = synthsRef.current.map(s => s.id === synthId ? { ...s, isPlaying: false } : s);
    synthAudio.stopSynth(synthId);
    try {
      await localRequest(`/synth/${synthId}`, { method: 'DELETE' });
      setSynths(prev => prev.filter(s => s.id !== synthId));
    } catch (error) {
      console.error('Failed to remove synth:', error);
    }
  }, [synthAudio]);

  const ensureSynthExists = useCallback(async (synthId: number): Promise<boolean> => {
    if (synthsRef.current.some(s => s.id === synthId)) return true;
    if (synthId < 2 || synthId > 3) return false;
    try {
      const res = await localRequest('/synth/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const created: SynthState = {
        id: synthId, pattern: data.pattern, patterns: data.patterns || [],
        synthParams: normalizeSynthParams(data.synthParams),
        synthModelId: normalizeSynthModelId(data.synthModelId),
        synthModelParams: normalizeSynthModelParams(data.synthModelParams),
        isPlaying: Boolean(data.isPlaying), currentStep: 0, selectedStep: null,
        keyboardMode: data.keyboardMode || 'keyboard', stepRecordPointer: 0,
        octaveShift: data.octaveShift || 0, muted: Boolean(data.muted),
        solo: Boolean(data.solo), forceReleaseSignal: false,
      };
      if (!synthsRef.current.some(s => s.id === synthId)) synthsRef.current = [...synthsRef.current, created];
      setSynths(prev => prev.some(s => s.id === synthId) ? prev : [...prev, created]);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleOctaveShift = useCallback((synthId: number, direction: 'up' | 'down') => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth) return;
    const shift = Math.max(-2, Math.min(2, synth.octaveShift + (direction === 'up' ? 1 : -1)));
    void localRequest(`/synth/${synthId}/preferences`, { method: 'POST', body: JSON.stringify({ octaveShift: shift }) });
    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const newShift = direction === 'up'
        ? Math.min(s.octaveShift + 1, 2)
        : Math.max(s.octaveShift - 1, -2);
      return { ...s, octaveShift: newShift };
    }));
  }, []);

  const handleTempoChange = useCallback(async (bpm: number) => {
    const firstSynth = synthsRef.current[0];
    if (firstSynth?.pattern) pushHistorySnapshot(firstSynth.id, firstSynth.pattern.id);
    setGlobalTempo(bpm);
    setSynths(prev => prev.map(s =>
      s.pattern ? { ...s, pattern: { ...s.pattern, tempo: bpm } } : s
    ));

    await localRequest('/tempo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: bpm }),
    });
  }, [pushHistorySnapshot]);

  const handleGlobalPlayStop = useCallback(async () => {
    const currentSynths = synthsRef.current;
    const isAnyPlaying = currentSynths.some(s => s.isPlaying);
    const playableSynths = currentSynths.filter(s => s.pattern);

    if (!isAnyPlaying) {
      songEndingRef.current = false;
      songStartBarRef.current = playModeRef.current === 'song' ? entryStartBar(songRef.current, songStartEntryRef.current, sceneLengthRef.current) : 0;
      const readiness = await Promise.all([
        synthAudio.ensureAudioReady(),
        drumAudio.ensureAudioReady(),
      ]);
      if (readiness.some(ready => !ready)) {
        setStorageError('Audio could not start. Allow audio playback and press Play again.');
        return;
      }
      const playResponses = await Promise.all(playableSynths.map(async (s) => {
        const response = await localRequest('/sequencer/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthId: s.id, patternId: s.pattern!.id }),
        });
        return { synthId: s.id, ok: response.ok };
      }));

      const startedSynthIds = playResponses.filter((entry) => entry.ok).map((entry) => entry.synthId);
      if (startedSynthIds.length > 0) {
        setSynths(prev => prev.map(s => (
          startedSynthIds.includes(s.id)
            ? { ...s, isPlaying: true, currentStep: 0 }
            : s
        )));
      }
      return;
    }

    const playingSynthIds = currentSynths.filter(s => s.isPlaying).map((s) => s.id);
    await Promise.all(currentSynths.filter(s => s.isPlaying).map(s =>
      localRequest('/sequencer/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synthId: s.id }),
      })
    ));
    if (playingSynthIds.length > 0) {
      setSynths(prev => prev.map(s => (
        playingSynthIds.includes(s.id)
          ? { ...s, isPlaying: false, currentStep: 0, forceReleaseSignal: !s.forceReleaseSignal }
          : s
      )));
    }
    transportRef.current?.stop();
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
    setSongPosition(null);
  }, [synthAudio, drumAudio]);
  handleGlobalPlayStopRef.current = handleGlobalPlayStop;
  stopPlaybackRef.current = () => {
    if (synthsRef.current.some(s => s.isPlaying)) void handleGlobalPlayStop();
  };

  const sceneRequest = useCallback(async (path: string, body: unknown) => {
    // Leaving the open scene records it, so first collect what each guest is set to right now.
    // Guests are only asked every few seconds otherwise, and a change made just before switching
    // would be recorded late, in the scene being switched to.
    if (path !== '/song' && path !== '/scenes/rename') await guestLink.captureAll();
    const response = await localRequest(path, { method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) setStorageError((await response.json().catch(() => null))?.error ?? 'That scene change could not be made.');
    return response.ok;
  }, []);
  const handleSceneSelect = useCallback((sceneId: string) => sceneRequest('/scenes/select', { sceneId }), [sceneRequest]);
  // A new scene starts as a copy of the one being edited, or empty.
  const handleSceneAdd = useCallback((empty: boolean) => sceneRequest('/scenes/create', { empty }), [sceneRequest]);
  const handleSceneRename = useCallback((sceneId: string, name: string) => sceneRequest('/scenes/rename', { sceneId, name }), [sceneRequest]);
  const handleSceneDelete = useCallback((sceneId: string) => sceneRequest('/scenes/delete', { sceneId }), [sceneRequest]);
  const handleSongChange = useCallback((next: Partial<Song>) => {
    setSong(prev => ({ ...prev, ...next }));
    void sceneRequest('/song', next);
  }, [sceneRequest]);

  // The song as one scene per bar, with every scene as it stands now, for export.
  const songArrangement = useCallback(async (): Promise<ExportArrangement & { bars: Scene[] }> => {
    const stored = await (await localRequest('/scenes')).json() as { scenes: Scene[]; song: Song };
    return { ...currentArrangementRef.current(), bars: songBars(stored.song, stored.scenes) };
  }, []);

  // Another tab saved the project. Either take that version (a reload reads it) or keep this one.
  const loadOtherTabVersion = useCallback(() => { window.location.reload(); }, []);
  const keepThisTabVersion = useCallback(() => {
    if (localService.resumeSaving()) setChangedElsewhere(false);
  }, []);

  const handleStepChange = useCallback(async (synthId: number, stepIndex: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    const pattern = synth?.pattern;
    if (!synth || !pattern) return;

    const sameSelectedStep = synth.selectedStep === stepIndex;
    const step = pattern.steps[stepIndex];

    if (sameSelectedStep && step?.note) {
      pushHistorySnapshot(synthId, pattern.id);
      const updatedPattern = {
        ...pattern,
        steps: pattern.steps.map((s, i) => (
          i === stepIndex ? withStepNotes(s, []) : s
        )),
      };

      setSynths(prev => prev.map(s => (
        s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: null } : s
      )));

      await localRequest(`/synth/${synthId}/patterns/${pattern.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPattern),
      });
      return;
    }

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      return { ...s, selectedStep: s.selectedStep === stepIndex ? null : stepIndex };
    }));
  }, [pushHistorySnapshot]);

  // Moves the selection without the toggle and clear behaviour a click on a step has.
  const handleStepSelect = useCallback((synthId: number, stepIndex: number) => {
    setSynths(prev => prev.map(s => (s.id === synthId ? { ...s, selectedStep: stepIndex } : s)));
  }, []);

  const handleKeyboardModeChange = useCallback((synthId: number, mode: 'keyboard' | 'piano-roll') => {
    void localRequest(`/synth/${synthId}/preferences`, { method: 'POST', body: JSON.stringify({ keyboardMode: mode }) });
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, keyboardMode: mode } : s
    )));
  }, []);

  // Adds a note to a step's chord or takes it out.
  const handlePianoRollNoteAssign = useCallback(async (synthId: number, stepIndex: number, note: string, on: boolean, offset = 0) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    pushHistorySnapshot(synthId, synth.pattern.id);

    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => {
        if (idx !== stepIndex) return step;
        const current = stepNotes(step);
        // A late start is chosen when the step gets its first note; later notes join it there.
        const base = on && current.length === 0 && offset > 0 ? { ...step, offset } : step;
        return withStepNotes(base, on ? [...current, note] : current.filter(entry => entry !== note));
      }),
    };

    // Two cells painted in one frame must both land, so the next call has to see this one.
    synthsRef.current = synthsRef.current.map(s => (s.id === synthId ? { ...s, pattern: updatedPattern } : s));
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: stepIndex } : s
    )));

    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  }, [pushHistorySnapshot]);

  const handleClearPatternNotes = useCallback(async (synthId: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    pushHistorySnapshot(synthId, synth.pattern.id);
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step) => withStepNotes(step, [])),
    };
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, pattern: updatedPattern, selectedStep: null } : s
    )));
    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  }, [pushHistorySnapshot]);

  // Writes a note to a step. `add` joins it to the chord already there instead of replacing it.
  const upsertStepNote = useCallback(async (synthId: number, stepIndex: number, note: string, velocity: number, add = false) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    pushHistorySnapshot(synthId, synth.pattern.id);

    const boundedVelocity = Math.max(0, Math.min(1, velocity));
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => (
        idx === stepIndex ? withStepNotes({ ...step, velocity: boundedVelocity }, add ? [...stepNotes(step), note] : [note]) : step
      )),
    };
    synthsRef.current = synthsRef.current.map(s => (s.id === synthId ? { ...s, pattern: updatedPattern } : s));

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextPointer = (stepIndex + 1) % updatedPattern.steps.length;
      return { ...s, pattern: updatedPattern, selectedStep: stepIndex, stepRecordPointer: nextPointer };
    }));

    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPattern),
    });
  }, [pushHistorySnapshot]);

  const handleNotePlay = useCallback(async (synthId: number, note: string) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.synthParams) return;
    if (synth.muted || (synthsRef.current.some(s => s.solo) && !synth.solo)) return;

    await synthAudio.ensureAudioReady();
    if (synth.synthParams.arpeggiator.enabled) {
      triggerSynthNote(synth.synthParams, note, 60 / globalTempo, 1, synthId);
    } else {
      await synthAudio.playNote(note, synth.synthParams, undefined, 1, browserMutedRef.current, effectsLoopRef.current, globalTempo, synthId);
    }

    // Starting audio can take a moment the first time; use the pattern as it is now, not as it
    // was when the key went down, or a quick second note would undo the first.
    const step = synth.selectedStep;
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (step === null || !pattern) return;
    pushHistorySnapshot(synthId, pattern.id);

    const updated = {
      ...pattern,
      steps: pattern.steps.map((s, i) => i === step ? { ...s, note, active: true } : s),
    };

    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, pattern: updated } : s
    ));

    await localRequest(`/synth/${synthId}/patterns/${pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
  }, [synthAudio, triggerSynthNote, globalTempo, pushHistorySnapshot]);

  const handleNoteRelease = useCallback(async (synthId: number, note: string) => {
    const synthParams = synthsRef.current.find(s => s.id === synthId)?.synthParams;
    if (!synthParams) return;
    synthAudio.stopNote(note, synthParams, synthId);
  }, [synthAudio]);

  const keyboardSynth = synths.find(s => s.id === selectedSynthId);
  const computerKeyNotes = useComputerKeyboard({
    target: keyboardSynth
      ? { synthId: keyboardSynth.id, octaveShift: keyboardSynth.octaveShift, hold: Boolean(keyboardSynth.synthParams?.hold) }
      : null,
    resetKey: keyboardSynth
      ? `${keyboardSynth.id}:${keyboardSynth.octaveShift}:${keyboardSynth.forceReleaseSignal}:${Boolean(keyboardSynth.synthParams?.hold)}`
      : '',
    onNoteDown: (synthId, note) => { void handleNotePlay(synthId, note); },
    onNoteUp: (synthId, note) => { void handleNoteRelease(synthId, note); },
    onOctave: handleOctaveShift,
  });

  const handleMidiMessage = useCallback((message: MidiMessage) => {
    if (message.type === 'controlChange') return;
    const noteName = midiNoteToName(message.note);
    const heldKey = `${message.channel}:${message.note}`;

    if (message.type === 'noteOff') {
      // Release on the lane that took the note-on, even if the channel or target changed since.
      const heldSynthId = midiHeldRef.current.get(heldKey);
      if (heldSynthId === undefined) return;
      midiHeldRef.current.delete(heldKey);
      void handleNoteRelease(heldSynthId, noteName);
      return;
    }
    if (message.channel !== midiChannelRef.current) return;

    const synthSnapshot = synthsRef.current;
    const targetSynth = synthSnapshot.find(s => s.id === midiTargetSynthIdRef.current) ?? synthSnapshot[0];
    if (!targetSynth) return;
    if (targetSynth.muted || (synthSnapshot.some(s => s.solo) && !targetSynth.solo)) return;

    const velocity = message.velocity / 127;
    const mode = midiModeRef.current;

    if (mode === 'live') {
      if (targetSynth.synthParams?.arpeggiator.enabled) {
        triggerSynthNote(targetSynth.synthParams, noteName, 60 / globalTempo, velocity, targetSynth.id);
      } else if (targetSynth.synthParams) {
        midiHeldRef.current.set(heldKey, targetSynth.id);
        void synthAudio.playNote(noteName, targetSynth.synthParams, undefined, velocity, browserMutedRef.current, effectsLoopRef.current, globalTempo, targetSynth.id);
      }
      return;
    }

    const pattern = targetSynth.pattern;
    if (!pattern || pattern.steps.length === 0) return;

    if (mode === 'record' && !targetSynth.isPlaying) return;
    // Keys pressed together are a chord: they go on the step the first of them landed on.
    const now = performance.now(), chord = midiChordRef.current;
    const joins = chord !== null && chord.synthId === targetSynth.id && now - chord.at < CHORD_WINDOW_MS;
    const stepIndex = joins ? chord.stepIndex
      : (mode === 'record' ? targetSynth.currentStep : targetSynth.stepRecordPointer) % pattern.steps.length;
    midiChordRef.current = { synthId: targetSynth.id, stepIndex, at: now };
    void upsertStepNote(targetSynth.id, stepIndex, noteName, velocity, joins);
  }, [handleNoteRelease, upsertStepNote, triggerSynthNote, globalTempo, synthAudio]);

  const midiState = useMidiInput({ onMessage: handleMidiMessage });

  const handleParameterChange = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (synth?.pattern) pushHistorySnapshotThrottled(synthId, synth.pattern.id, `synth-params-${synthId}`);
    await localRequest(`/synth/${synthId}/parameters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleSynthModelChange = useCallback(async (
    synthId: number,
    modelId: SynthModelId,
    modelParams?: Partial<SynthModelParams>
  ) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth) return;
    if (synth.pattern) pushHistorySnapshot(synthId, synth.pattern.id);
    const normalizedModelId = normalizeSynthModelId(modelId);
    const normalizedModelParams = normalizeSynthModelParams({
      ...synth.synthModelParams,
      ...modelParams,
    });
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId
        ? {
          ...entry,
          synthModelId: normalizedModelId,
          synthModelParams: normalizedModelParams,
        }
        : entry
    )));
    await localRequest(`/synth/${synthId}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: normalizedModelId,
        modelParams: normalizedModelParams,
      }),
    });
    const mapped = mapSynthModelToEngineParams(normalizedModelId, normalizedModelParams);
    if (Object.keys(mapped).length > 0) {
      await localRequest(`/synth/${synthId}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapped),
      });
    }
  }, [pushHistorySnapshot]);

  const handleStepCountChange = useCallback(async (synthId: number, stepCount: 16 | 32) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const bars = laneBars(synth.pattern.steps.length, synth.pattern.bars), perBar = synth.pattern.steps.length / bars;
    if (perBar === stepCount) return;
    pushHistorySnapshot(synthId, synth.pattern.id);

    // Each bar keeps its steps from the start of the bar; a finer grid adds empty steps after them.
    const nextSteps = clampLengths(Array.from({ length: stepCount * bars }, (_, i) => {
      const inBar = i % stepCount, source = inBar < perBar ? synth.pattern!.steps[Math.floor(i / stepCount) * perBar + inBar] : undefined;
      return source ? { ...source } : { active: false, velocity: 0.7 as const };
    }));
    const nextPattern = { ...synth.pattern, steps: nextSteps };
    stepCount = nextSteps.length as 16 | 32;

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextSelectedStep = s.selectedStep !== null && s.selectedStep >= stepCount ? null : s.selectedStep;
      return {
        ...s,
        pattern: nextPattern,
        selectedStep: nextSelectedStep,
        currentStep: s.currentStep % stepCount,
      };
    }));

    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPattern),
    });
  }, [pushHistorySnapshot]);

  const handleStepVelocityChange = useCallback(async (synthId: number, stepIndex: number, velocity: number) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    pushHistorySnapshotThrottled(synthId, synth.pattern.id, `step-velocity-${stepIndex}`);
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (
        index === stepIndex ? { ...step, velocity: normalizedVelocity } : step
      )),
    };
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId ? { ...entry, pattern: nextPattern } : entry
    )));
    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPattern),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleStepSlideChange = useCallback(async (synthId: number, stepIndex: number, slide: boolean) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    pushHistorySnapshot(synthId, synth.pattern.id);
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (index === stepIndex ? { ...step, slide } : step)),
    };
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId ? { ...entry, pattern: nextPattern } : entry
    )));
    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      body: JSON.stringify(nextPattern),
    });
  }, [pushHistorySnapshot]);

  const handleStepLengthChange = useCallback(async (synthId: number, stepIndex: number, length: number) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    pushHistorySnapshot(synthId, synth.pattern.id);
    const bounded = Math.max(1, Math.min(synth.pattern.steps.length - stepIndex, Math.round(length)));
    if (bounded === (synth.pattern.steps[stepIndex].length ?? 1)) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => {
        if (index !== stepIndex) return step;
        const { length: _length, ...rest } = step;
        return bounded > 1 ? { ...rest, length: bounded } : rest;
      }),
    };
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId ? { ...entry, pattern: nextPattern } : entry
    )));
    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      body: JSON.stringify(nextPattern),
    });
  }, [pushHistorySnapshot]);

  // Chance and repeats for one step.
  const handleStepDetailChange = useCallback(async (synthId: number, stepIndex: number, detail: { probability?: number; ratchet?: number; offset?: number }) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    pushHistorySnapshot(synthId, synth.pattern.id);
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => {
        if (index !== stepIndex) return step;
        const { probability, ratchet, offset, ...rest } = { ...step, ...detail };
        return {
          ...rest,
          ...(offset !== undefined && offset > 0 ? { offset: Math.min(0.95, offset) } : {}),
          ...(probability !== undefined && probability < 1 ? { probability: Math.max(0, probability) } : {}),
          ...(ratchet !== undefined && ratchet > 1 ? { ratchet: Math.min(4, Math.round(ratchet)) } : {}),
        };
      }),
    };
    setSynths((prev) => prev.map((entry) => (
      entry.id === synthId ? { ...entry, pattern: nextPattern } : entry
    )));
    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, {
      method: 'PUT',
      body: JSON.stringify(nextPattern),
    });
  }, [pushHistorySnapshot]);

  // How many bars a lane's pattern lasts. A longer one starts as the old one repeated.
  const handleLaneBarsChange = useCallback(async (synthId: number, bars: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern || !BAR_CHOICES.some(choice => choice === bars)) return;
    const current = laneBars(synth.pattern.steps.length, synth.pattern.bars);
    if (current === bars) return;
    pushHistorySnapshot(synthId, synth.pattern.id);
    const perBar = synth.pattern.steps.length / current;
    const steps = clampLengths(resizeBars(synth.pattern.steps, perBar, bars, () => ({ active: false, velocity: 0.7 })));
    const { bars: _bars, ...rest } = synth.pattern;
    const nextPattern: Pattern = { ...rest, steps, ...(bars > 1 ? { bars } : {}) };
    setSynths(prev => prev.map(s => (s.id === synthId
      ? { ...s, pattern: nextPattern, selectedStep: s.selectedStep !== null && s.selectedStep >= steps.length ? null : s.selectedStep, currentStep: s.currentStep % steps.length }
      : s)));
    // The store drops a bar count that is not sent, so one bar is sent as 1.
    await localRequest(`/synth/${synthId}/patterns/${synth.pattern.id}`, { method: 'PUT', body: JSON.stringify({ ...nextPattern, bars }) });
  }, [pushHistorySnapshot]);

  const handleDrumBarsChange = useCallback(async (bars: number) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    await localRequest('/drum/bars', { method: 'POST', body: JSON.stringify({ bars }) });
  }, [pushHistorySnapshot]);

  const handleSynthMixChange = useCallback(async (synthId: number, mix: { muted?: boolean; solo?: boolean }) => {
    setSynths(prev => prev.map(s =>
      s.id === synthId ? { ...s, ...mix } : s
    ));
    await localRequest(`/synth/${synthId}/mix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mix),
    });
  }, []);

  const handleSaveSynthPreset = useCallback((synthId: number, name: string) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.synthParams) return;
    const presetName = name.trim();
    if (!presetName) return;
    const userPreset: SynthPreset = {
      id: `user-${Date.now()}`,
      name: presetName,
      params: cloneSynthParams(synth.synthParams) || cloneSynthParams(DEFAULT_PARAMS)!,
      modelId: synth.synthModelId,
      modelParams: cloneSynthModelParams(synth.synthModelParams),
    };
    setSynthPresets((prev) => [...prev, userPreset]);
  }, []);

  const handleLoadSynthPreset = useCallback(async (synthId: number, presetId: string) => {
    const preset = synthPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    await handleSynthModelChange(synthId, preset.modelId, preset.modelParams);
    await handleParameterChange(synthId, cloneSynthParams(preset.params) || DEFAULT_PARAMS);
  }, [synthPresets, handleParameterChange, handleSynthModelChange]);

  // Reads a preset made in Discobot or in another synth, keeps it with the user's presets and
  // puts it on the lane. Other synths' presets are translated; the report says what was lost.
  const handleImportSynthPreset = useCallback(async (synthId: number, file: File) => {
    let contents: unknown;
    try {
      if (file.size > 2_000_000) throw new Error('too large');
      contents = JSON.parse(await file.text());
    } catch {
      setStorageError('That file could not be read as a preset. Preset files are JSON.');
      return;
    }
    const result = importPreset(contents, DEFAULT_PARAMS, file.name.replace(/(\.preset)?(\.websynth)?\.json$/i, ''));
    if (!result.ok) { setStorageError(result.error); return; }
    const { preset } = result;
    const taken = new Set(synthPresetsRef.current.map(entry => entry.name.toLowerCase()));
    let name = preset.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${preset.name.slice(0, 56)} ${n}`;
    const stored: SynthPreset = { id: `user-${Date.now()}`, name, params: preset.params, modelId: normalizeSynthModelId(undefined), modelParams: cloneSynthModelParams(undefined) };
    setSynthPresets(prev => [...prev, stored]);
    await handleSynthModelChange(synthId, stored.modelId, stored.modelParams);
    await handleParameterChange(synthId, cloneSynthParams(stored.params) || DEFAULT_PARAMS);
    setPresetImportReport({ name, source: preset.source, notes: preset.notes });
  }, [handleParameterChange, handleSynthModelChange]);

  // The lane's sound as a file another Discobot can import.
  const handleExportSynthPreset = useCallback((synthId: number, name: string) => {
    const synth = synthsRef.current.find(entry => entry.id === synthId);
    if (!synth?.synthParams) return;
    const title = name.trim() || `Synth ${synthId}`;
    downloadFile(JSON.stringify(exportPreset(title, synth.synthParams), null, 2), 'application/json', `${title.replace(/[^\w -]+/g, '').trim() || 'preset'}.discobot-preset.json`);
  }, []);

  const handleDeleteSynthPreset = useCallback((presetId: string) => {
    setSynthPresets((prev) => prev.filter((preset) => preset.id !== presetId || preset.builtIn));
  }, []);

  const handleExportMidi = useCallback(() => {
    const synthLanes = synthsRef.current
      .filter((entry) => entry.pattern)
      .map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!), muted: entry.muted, solo: entry.solo }));
    downloadMidiFile(
      {
        tempo: globalTempo,
        synthLanes,
        drumState: cloneDrumState(drumStateRef.current),
        drumSwing,
        drumMasterVolume,
        ...(sceneBars(liveSceneRef.current()) > 1 ? {
          bars: sceneAsBars(liveSceneRef.current()).map(scene => ({ name: scene.name, lanes: scene.lanes, drumState: sceneDrumState(scene, drumStateRef.current) })),
        } : {}),
      },
      `discobot-${Date.now()}.mid`
    );
  }, [globalTempo, drumSwing, drumMasterVolume]);

  const currentArrangement = useCallback((): ExportArrangement => ({
    tempo: globalTempoRef.current, synths: synthsRef.current, drumState: drumStateRef.current,
    drumKitId: selectedDrumKitIdRef.current, drumMasterVolume, drumSwing,
    drumFx: drumFxRef.current, effectsLoop: effectsLoopRef.current, drumSamples: { ...drumSamplesRef.current },
    // A scene longer than one bar is rendered a bar at a time, each lane looping at its own length.
    ...(sceneBars(liveSceneRef.current()) > 1 ? { bars: sceneAsBars(liveSceneRef.current()) } : {}),
  }), [drumMasterVolume, drumSwing]);
  currentArrangementRef.current = currentArrangement;

  const handleExportSongMidi = useCallback(async () => {
    const { bars } = await songArrangement();
    const kit = cloneDrumState(drumStateRef.current);
    downloadMidiFile(
      {
        tempo: globalTempoRef.current, drumSwing, drumMasterVolume, drumState: kit,
        synthLanes: synthsRef.current.filter((entry) => entry.pattern).map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!), muted: entry.muted, solo: entry.solo })),
        bars: bars.map(scene => ({ name: scene.name, lanes: scene.lanes, drumState: sceneDrumState(scene, kit) })),
      },
      `discobot-song-${Date.now()}.mid`
    );
  }, [songArrangement, drumSwing, drumMasterVolume]);

  // Adds another creator's instrument by its address. Typing it in is the user's say-so to load that site.
  const handleAddGuest = useCallback(async (url: string): Promise<string | null> => {
    // Recorded first: the unit appears as soon as the store accepts the guest, and must not ask again.
    const address = guestUrl(url, window.location.origin);
    if (address) trustOrigin(guestOrigin(address));
    const response = await localRequest('/guests', { method: 'POST', body: JSON.stringify({ url }) });
    if (!response.ok) return (await response.json().catch(() => null) as { error?: string } | null)?.error ?? 'The guest instrument could not be added.';
    return null;
  }, []);
  const handleRemoveGuest = useCallback(async (id: string) => { await localRequest(`/guests/${id}`, { method: 'DELETE' }); }, []);
  const handleGuestChange = useCallback(async (id: string, patch: Partial<Pick<Guest, 'name' | 'volume' | 'muted' | 'state'>>) => {
    await localRequest(`/guests/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  }, []);

  // Which sample each drum lane uses, as one string, so the effect below only runs when that changes.
  const drumSampleKey = DRUM_INSTRUMENTS.map(instrument => drumState[instrument]?.sampleId ?? '').join('|');
  useEffect(() => {
    let current = true;
    void Promise.all(DRUM_INSTRUMENTS.map(async (instrument) => {
      const id = drumStateRef.current[instrument]?.sampleId;
      return [instrument, id ? await loadDrumSample(id) : null, Boolean(id)] as const;
    })).then((loaded) => {
      if (!current) return;
      const next: Partial<Record<DrumInstrument, DrumSample>> = {};
      for (const [instrument, sample] of loaded) {
        if (sample) next[instrument] = sample;
        if (sample !== (drumSamplesRef.current[instrument] ?? null)) drumAudio.setSample(instrument, sample);
      }
      drumSamplesRef.current = next;
      setMissingDrumSamples(loaded.filter(([, sample, wanted]) => wanted && !sample).map(([instrument]) => instrument));
    });
    return () => { current = false; };
  }, [drumSampleKey, drumAudio]);

  const handleDrumSampleChange = useCallback(async (instrument: DrumInstrument, sampleId: string | null) => {
    await localRequest('/drum/sample', { method: 'POST', body: JSON.stringify({ instrument, sampleId }) });
  }, []);

  // Download WAV and Song WAV. With guests in the project the arrangement is first played through
  // once, in real time, so their sound can be recorded; then the export is rendered as usual.
  const handleExportWav = useCallback(async (wholeSong: boolean) => {
    let arrangement: ExportArrangement = wholeSong ? await songArrangement() : currentArrangementRef.current();
    const audible = guestsRef.current.filter(guest => !guest.muted && guest.volume > 0);
    if (audible.length > 0 && !guestCapture.active()) {
      const seconds = (arrangement.bars?.length ?? 1) * 240 / globalTempoRef.current;
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const mode = playModeRef.current, startEntry = songStartEntryRef.current;
      try {
        if (synthsRef.current.some(synth => synth.isPlaying)) { await handleGlobalPlayStopRef.current(); await sleep(150); }
        setGuestRecording(seconds);
        // Play exactly what is being exported: the song from its start, or the open scene.
        playModeRef.current = wholeSong ? 'song' : 'pattern';
        songStartEntryRef.current = 0;
        setPlayMode(playModeRef.current);
        setSongStartEntry(0);
        await handleGlobalPlayStopRef.current();
        // The transport announces where its first beat falls; recording is lined up against that.
        for (let waited = 0; waited < 4000 && !guestLink.transport().playing; waited += 20) await sleep(20);
        const transport = guestLink.transport();
        if (!transport.playing) throw new Error('Playback did not start, so the guest instruments could not be recorded.');
        guestCapture.start(transport.anchorWall, seconds + 2);
        await sleep(Math.max(0, transport.anchorWall - wallNow()) + seconds * 1000);
        if (synthsRef.current.some(synth => synth.isPlaying)) await handleGlobalPlayStopRef.current();
        // A moment for the last of the guests' audio to arrive.
        await sleep(600);
        const takes = guestCapture.stop();
        arrangement = { ...arrangement, guestTakes: audible.flatMap(guest => { const take = takes.get(guest.id); return take ? [{ ...take, gain: guest.volume }] : []; }) };
      } finally {
        guestCapture.stop();
        setGuestRecording(null);
        setPlayMode(mode);
        setSongStartEntry(startEntry);
      }
    }
    await downloadArrangementWav(arrangement);
  }, [songArrangement]);

  const reportExportError = useCallback((error: unknown) => {
    setStorageError(`Audio export failed: ${error instanceof Error ? error.message : error}`);
  }, []);

  const handleExportProject = useCallback(() => {
    const file = {
      ...localService.exportProject(),
      synthPresets: synthPresets.filter(preset => !preset.builtIn).map(({ id, name, params, modelId, modelParams }) => ({ id, name, params, modelId, modelParams })),
    };
    downloadFile(JSON.stringify(file), 'application/json', `discobot-project-${new Date().toISOString().slice(0, 10)}.json`);
  }, [synthPresets]);

  // Before the open project is swapped for another: stop sound, and forget undo steps that belong to it.
  const leaveProject = useCallback(() => {
    transportRef.current?.stop();
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
    historyRef.current = { undo: [], redo: [] };
    setSongPosition(null);
  }, [synthAudio, drumAudio]);
  const projectAction = useCallback(async (action: () => Promise<{ ok: true; repaired?: boolean } | { ok: false; error: string }>) => {
    const result = await action();
    if (!result.ok) setStorageError(result.error);
    else if (result.repaired) setStorageError('The project was opened, but some damaged values in it were repaired.');
    return result.ok;
  }, []);
  const handleNewProject = useCallback((name?: string) => { leaveProject(); return projectAction(() => localService.newProject(name)); }, [leaveProject, projectAction]);
  const handleOpenProject = useCallback((id: string) => { leaveProject(); return projectAction(() => localService.openProject(id)); }, [leaveProject, projectAction]);
  const handleCopyProject = useCallback((id: string, name?: string) => projectAction(() => localService.copyProject(id, name)), [projectAction]);
  const handleRestoreVersion = useCallback((versionId: string) => { leaveProject(); return projectAction(() => localService.restoreVersion(versionId)); }, [leaveProject, projectAction]);
  const handleCopyVersion = useCallback((versionId: string) => projectAction(() => localService.copyVersion(versionId)), [projectAction]);
  const handleRenameProject = useCallback((id: string, name: string) => projectAction(() => localService.renameProject(id, name)), [projectAction]);
  const handleDeleteProject = useCallback((id: string) => {
    if (id === projectIdRef.current) leaveProject();
    return projectAction(() => localService.deleteProject(id)).then((ok) => {
      // Deleting a synced project deletes it from the account too; sync has to be told, it never guesses.
      if (ok) void projectSync.noteDeleted(id);
      return ok;
    });
  }, [leaveProject, projectAction]);

  // A project from a file or a share link becomes a new project in the library and is opened.
  const handleImportProject = useCallback(async (data: unknown): Promise<boolean> => {
    leaveProject();
    const result = await localService.importProject(data);
    if (!result.ok) {
      setStorageError(result.error);
      return false;
    }
    const importedPresets = parseUserPresets((data as { synthPresets?: unknown } | null)?.synthPresets);
    if (importedPresets.length > 0) {
      const importedIds = new Set(importedPresets.map(preset => preset.id));
      setSynthPresets(prev => [...prev.filter(preset => preset.builtIn || !importedIds.has(preset.id)), ...importedPresets]);
    }
    setStorageError(result.repaired ? 'The project was opened, but some damaged values in it were repaired.' : null);
    return true;
  }, [leaveProject]);

  const projectImportFileRef = useRef<HTMLInputElement>(null);
  const handleImportProjectFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setStorageError('That file is too large to be a Discobot project.');
      return;
    }
    let parsed: { format?: unknown; synthPresets?: unknown } | null = null;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      // reported below
    }
    if (parsed?.format !== 'discobot-project') {
      setStorageError('That file is not a Discobot project file.');
      return;
    }
    await handleImportProject(parsed);
  }, [handleImportProject]);

  const midiImportFileRef = useRef<HTMLInputElement>(null);
  const [midiImportAssignments, setMidiImportAssignments] = useState<Record<number, number | null | 'drums'>>({});

  const handleMidiImportClick = useCallback(() => {
    midiImportFileRef.current?.click();
  }, []);

  const handleMidiImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const result = importMidiFile(buffer);
      if (result.tracks.length === 0) {
        alert('No note tracks found in MIDI file.');
        return;
      }
      const autoAssign: Record<number, number | null | 'drums'> = {};
      const synthIds = [1, 2, 3];
      let synthIdx = 0;
      result.tracks.forEach((track, i) => {
        autoAssign[i] = track.drums ? 'drums' : synthIds[synthIdx++] ?? null;
      });
      setMidiImportAssignments(autoAssign);
      setMidiImportData(result);
    } catch (err) {
      alert(`Failed to import MIDI: ${err instanceof Error ? err.message : err}`);
    }
    e.target.value = '';
  }, []);

  const handleMidiImportApplyAll = useCallback(async () => {
    if (!midiImportData) return;
    const tempo = midiImportData.detectedTempo;
    const importedDrums = midiImportData.tracks.filter((track, i) => track.drums && midiImportAssignments[i] === 'drums');
    let snapshotTaken = false;

    for (const [i, track] of midiImportData.tracks.entries()) {
      const synthId = midiImportAssignments[i];
      if (typeof synthId !== 'number' || !track.pattern) continue;
      if (!await ensureSynthExists(synthId)) continue;
      const current = synthsRef.current.find(s => s.id === synthId)?.pattern;
      if (!current) continue;
      pushHistorySnapshot(synthId, current.id);
      snapshotTaken = true;
      // Replace the lane's steps in place so repeated imports do not pile up stored patterns.
      const pattern = { ...current, steps: track.pattern.steps, tempo };
      setSynths(prev => prev.map(s =>
        s.id === synthId ? { ...s, pattern, selectedStep: null } : s
      ));
      await localRequest(`/synth/${synthId}/patterns/${pattern.id}`, {
        method: 'PUT',
        body: JSON.stringify(pattern),
      });
    }

    const firstSynth = synthsRef.current[0];
    if (!snapshotTaken && firstSynth?.pattern) pushHistorySnapshot(firstSynth.id, firstSynth.pattern.id);
    if (importedDrums.length > 0) {
      const next = cloneDrumState(drumStateRef.current);
      for (const instrument of Object.keys(next) as DrumInstrument[]) {
        const lanes = importedDrums.map(track => track.drums![instrument]);
        next[instrument].steps = next[instrument].steps.map((_, step) => lanes.some(lane => lane.steps[step]));
        next[instrument].stepVelocities = next[instrument].steps.map((_, step) => (
          lanes.find(lane => lane.steps[step])?.stepVelocities[step] ?? 1
        ));
      }
      setDrumState(next);
      await localRequest('/drum/state', {
        method: 'PUT',
        body: JSON.stringify({ state: next }),
      });
    }

    setGlobalTempo(tempo);
    await localRequest('/tempo', {
      method: 'POST',
      body: JSON.stringify({ tempo }),
    });
    setMidiImportData(null);
    setMidiImportAssignments({});
  }, [midiImportData, midiImportAssignments, ensureSynthExists, pushHistorySnapshot]);

  useEffect(() => {
    const fetchDrumKits = async () => {
      setDrumKitsLoading(true);
      setDrumKitsError(null);
      try {
        const res = await localRequest('/drum/kits');
        if (!res.ok) {
          setDrumKitsError('Unable to load drum kits.');
          return;
        }
        const data = await res.json();
        if (Array.isArray(data.kits)) {
          setDrumKits(data.kits);
          const hasSelected = data.kits.some((kit: DrumKitDefinition) => kit.id === selectedDrumKitIdRef.current);
          if (!hasSelected && data.defaultKitId) {
            setSelectedDrumKitId(data.defaultKitId as DrumKitId);
          }
        }
      } catch {
        setDrumKitsError('Unable to load drum kits.');
      } finally {
        setDrumKitsLoading(false);
      }
    };
    void fetchDrumKits();
  }, []);

  const handleDrumKitChange = useCallback(async (kitId: DrumKitId, applyDefaults: boolean): Promise<DrumState | undefined> => {
    setSelectedDrumKitId(kitId);
    try {
      const res = await localRequest('/drum/kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kitId, applyDefaults }),
      });
      if (!res.ok) return undefined;
      const data = await res.json();
      if (data.selectedDrumKitId) setSelectedDrumKitId(data.selectedDrumKitId as DrumKitId);
      if (data.drumState) {
        setDrumState(data.drumState);
        return data.drumState as DrumState;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }, []);

  const handleDrumStepToggle = useCallback((instrument: DrumInstrument, step: number, active: boolean) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], steps: [...next[instrument].steps] };
      next[instrument].steps[step] = active;
      return next;
    });
    localRequest('/drum/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, step, active }),
    });
  }, [pushHistorySnapshot]);

  const handleDrumStepVelocity = useCallback((instrument: DrumInstrument, step: number, velocity: number) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    setDrumState(prev => {
      const next = { ...prev };
      const track = next[instrument];
      next[instrument] = { ...track, stepVelocities: [...(track.stepVelocities || new Array(track.steps.length).fill(1))] };
      next[instrument].stepVelocities![step] = velocity;
      return next;
    });
    localRequest('/drum/step-velocity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, step, velocity }),
    });
  }, [pushHistorySnapshot]);

  const handleDrumStepDetail = useCallback((instrument: DrumInstrument, step: number, detail: { probability?: number; ratchet?: number }) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, `drum-step-detail-${instrument}-${step}`, 300);
    setDrumState(prev => {
      const track = prev[instrument];
      const next = { ...track };
      if (detail.probability !== undefined) {
        next.stepProbabilities = [...(track.stepProbabilities || new Array(track.steps.length).fill(1))];
        next.stepProbabilities[step] = detail.probability;
      }
      if (detail.ratchet !== undefined) {
        next.stepRatchets = [...(track.stepRatchets || new Array(track.steps.length).fill(1))];
        next.stepRatchets[step] = detail.ratchet;
      }
      return { ...prev, [instrument]: next };
    });
    localRequest('/drum/step-detail', {
      method: 'POST',
      body: JSON.stringify({ instrument, step, ...detail }),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleDrumSettingsChange = useCallback((instrument: DrumInstrument, settings: Partial<DrumSettings>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) {
      pushHistorySnapshotThrottled(synth.id, synth.pattern.id, `drum-settings-${instrument}`, 300);
    }
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], settings: { ...next[instrument].settings, ...settings } };
      return next;
    });
    localRequest('/drum/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, settings }),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleDrumMixChange = useCallback((instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    setDrumState(prev => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], ...mix };
      return next;
    });
    localRequest('/drum/mix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, ...mix }),
    });
  }, [pushHistorySnapshot]);

  const handleDrumReset = useCallback(() => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    setDrumState(createDefaultDrumState());
    localRequest('/drum/reset', { method: 'POST' });
  }, [pushHistorySnapshot]);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'drum-master-volume', 300);
    setDrumMasterVolume(volume);
    localRequest('/drum/master-volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    });
    }, [pushHistorySnapshotThrottled]);

  const handleDrumSwingChange = useCallback((swing: number) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'drum-swing', 300);
    setDrumSwing(swing);
    localRequest('/drum/swing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swing }),
    });
  }, [pushHistorySnapshotThrottled]);

  const handleDrumFxChange = useCallback((next: Partial<{ sends: Partial<FxSendLevels>; returnLevel: number }>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'drum-fx', 300);
    const previous = drumFxRef.current;
    const updated = normalizeDrumFx({
      sends: { ...previous.sends, ...(next.sends || {}) },
      returnLevel: next.returnLevel ?? previous.returnLevel,
    });
    setDrumFx(updated);
    void (async () => {
      try {
        const res = await localRequest('/drum/fx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (!res.ok) {
          setDrumFx(previous);
          return;
        }
        const data = await res.json();
        if (data.drumFx) {
          setDrumFx(normalizeDrumFx(data.drumFx));
        }
      } catch {
        setDrumFx(previous);
      }
    })();
  }, [pushHistorySnapshotThrottled]);

  const handleEffectsLoopChange = useCallback((next: Partial<EffectsLoopState>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshotThrottled(synth.id, synth.pattern.id, 'effects-loop', 300);
    const previous = effectsLoopRef.current;
    const updated = normalizeEffectsLoop({
      ...previous,
      ...next,
    });
    setEffectsLoop(updated);
    void (async () => {
      try {
        const res = await localRequest('/effects-loop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (!res.ok) {
          setEffectsLoop(previous);
          return;
        }
        const data = await res.json();
        if (data.effectsLoop) {
          setEffectsLoop(normalizeEffectsLoop(data.effectsLoop));
        }
      } catch {
        setEffectsLoop(previous);
      }
    })();
  }, [pushHistorySnapshotThrottled]);

  const handleDrumMuteAll = useCallback((muted: boolean) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    const nextState = Object.fromEntries(
      (Object.keys(drumStateRef.current) as DrumInstrument[]).map(inst => [
        inst,
        { ...drumStateRef.current[inst], muted },
      ])
    ) as DrumState;
    setDrumState(nextState);
    localRequest('/drum/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: nextState }),
    });
  }, [pushHistorySnapshot]);

  const handleDrumSoloAll = useCallback(() => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) pushHistorySnapshot(synth.id, synth.pattern.id);
    const nextState = Object.fromEntries(
      (Object.keys(drumStateRef.current) as DrumInstrument[]).map(inst => [
        inst,
        { ...drumStateRef.current[inst], solo: false },
      ])
    ) as DrumState;
    setDrumState(nextState);
    localRequest('/drum/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: nextState }),
    });
  }, [pushHistorySnapshot]);

  const handleReset = useCallback(async () => {
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
    transportRef.current?.stop();
    const currentSynths = synthsRef.current;
    for (const synth of currentSynths) {
      await localRequest(`/synth/${synth.id}/parameters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
      });
      await localRequest(`/synth/${synth.id}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: DEFAULT_SYNTH_MODEL_ID,
          modelParams: createDefaultSynthModelParams(),
        }),
      });
      await localRequest(`/synth/${synth.id}/mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: false, solo: false }),
      });
      if (synth.pattern) {
        const cleared = {
          ...synth.pattern,
          steps: synth.pattern.steps.map(s => ({ ...s, active: false, note: undefined })),
        };
        await localRequest(`/synth/${synth.id}/patterns/${synth.pattern.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleared),
        });
      }
      if (synth.isPlaying) {
        await localRequest('/sequencer/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synthId: synth.id }),
        });
      }
    }
    setSynths(prev => prev.map(s => ({
      ...s,
      pattern: s.pattern ? {
        ...s.pattern,
        steps: s.pattern.steps.map(st => ({ ...st, active: false, note: undefined })),
      } : null,
      synthParams: DEFAULT_PARAMS,
      synthModelId: DEFAULT_SYNTH_MODEL_ID,
      synthModelParams: createDefaultSynthModelParams(),
      isPlaying: false,
      currentStep: 0,
      selectedStep: null,
      stepRecordPointer: 0,
      muted: false,
      solo: false,
      forceReleaseSignal: !s.forceReleaseSignal,
    })));
    setDrumFx(DEFAULT_DRUM_FX);
    void localRequest('/drum/fx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_DRUM_FX),
    });
    setEffectsLoop(DEFAULT_EFFECTS_LOOP);
    void localRequest('/effects-loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_EFFECTS_LOOP),
    });
    handleDrumReset();
    historyRef.current = { undo: [], redo: [] };
    // Back to a single empty scene, taken from the lanes and drums that were just cleared.
    await localRequest('/scenes/replace', { method: 'POST', body: JSON.stringify({}) });
  }, [handleDrumReset, synthAudio, drumAudio]);

  const memoizedDrumState = useMemo(() => drumState, [drumState]);

  const isAnyPlaying = synths.some(s => s.isPlaying);

  return {
    synths, selectedSynthId, setSelectedSynthId, drumState: memoizedDrumState, drumKits, drumKitsLoading, drumKitsError,
    selectedDrumKitId, drumMasterVolume, drumSwing, drumCurrentStep, drumFx, effectsLoop, browserMuted, setBrowserMuted,
    browserVolume, setBrowserVolume, globalTempo, storageError, setStorageError, changedElsewhere, loadOtherTabVersion, keepThisTabVersion, helpOpen, setHelpOpen, midiMode, setMidiMode,
    midiChannel, setMidiChannel, midiTargetSynthId, setMidiTargetSynthId, projectId, projectName, projects, synthPresets, drumAudio,
    handleUndo, handleRedo, midiImportData, setMidiImportData, midiImportAssignments, setMidiImportAssignments,
    handleMidiImportClick, handleMidiImportFile, handleMidiImportApplyAll, midiImportFileRef, handleRemoveSynth,
    ensureSynthExists, handleOctaveShift, handleTempoChange, handleGlobalPlayStop, handleStepChange, handleStepSelect, handleKeyboardModeChange,
    handlePianoRollNoteAssign, handleClearPatternNotes, handleNotePlay, handleNoteRelease, computerKeyNotes, midiState,
    handleParameterChange, handleSynthModelChange, handleStepCountChange, handleStepVelocityChange, handleStepSlideChange, handleStepLengthChange, handleStepDetailChange, guests, handleAddGuest, handleRemoveGuest, handleGuestChange, guestRecording, handleExportWav, missingDrumSamples, handleDrumSampleChange, handleLaneBarsChange, handleDrumBarsChange, sceneLength,
    handleSynthMixChange, handleSaveSynthPreset, handleLoadSynthPreset, handleDeleteSynthPreset,
    handleExportMidi, currentArrangement, reportExportError, handleExportProject, projectImportFileRef, handleImportProjectFile, handleImportProject,
    handleNewProject, handleOpenProject, handleCopyProject, handleRenameProject, handleDeleteProject, handleRestoreVersion, handleCopyVersion, handleImportSynthPreset, handleExportSynthPreset, presetImportReport, setPresetImportReport, handleDrumKitChange, handleDrumStepToggle, handleDrumStepVelocity, handleDrumStepDetail,
    handleDrumSettingsChange, handleDrumMixChange, handleDrumReset, handleDrumMasterVolumeChange, handleDrumSwingChange,
    handleDrumFxChange, handleEffectsLoopChange, handleDrumMuteAll, handleDrumSoloAll, handleReset,
    scenes, currentSceneId, song, playMode, setPlayMode, songStartEntry, setSongStartEntry, songPosition,
    handleSceneSelect, handleSceneAdd, handleSceneRename, handleSceneDelete, handleSongChange, songArrangement, handleExportSongMidi,
    isAnyPlaying,
  };
}

export type Studio = ReturnType<typeof useStudio>;
