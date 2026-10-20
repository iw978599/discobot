import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSynthAudio } from '../hooks/useSynthAudio';
import { useDrumAudio } from '../hooks/useDrumAudio';
import { MidiMode, MidiMessage, MidiSource, useMidiInput } from '../hooks/useMidiInput';
import { MIDI_DRUM_CHANNEL, midiOut } from '../services/midiOutput';
import { Pattern, SequencerStep, SynthParameters, DrumState, DrumInstrument, DrumSettings, DrumKitDefinition, DrumKitId, EffectsLoopState, FxSendLevels, Scene, Song, SynthModelId, SynthModelParams, TimeSignature } from '../types';
import { SongPosition, applySceneMutes, audibleLanes, entryStartTick, guestBarGains, sceneAtTick, sceneDrumState, songBars } from '../services/songPlayback';
import { createDefaultSynthParameters } from '@discobot/engine';
import { localService } from '../services/localService';
import type { GuestPatch } from '../services/projectOps';
import { projectSync, startProjectSync } from '../services/projectSync';
import { startLiveSessions } from '../services/liveSession';
import { loadDrumSample } from '../services/drumSamples';
import { loadCymbals, loadLaneSample } from '../services/builtInWaves';
import { MAX_EMBEDDED_TOTAL_BYTES, MAX_PROJECT_FILE_BYTES, adoptSamples, embedSamples } from '../services/projectSamples';
import { exportPreset, importPreset, type ImportedPreset } from '../services/presetImport';
import { BAR_CHOICES, barSteps, barTargets, barTicks, clampLengths, copyBar, drumBars, laneBars, relayBars, resizeBars, sceneAsBars, sceneBars, stepsPerBar, storedSignature, timeSignature } from '../services/patternLength';
import { DRUM_INSTRUMENTS, DRUM_SETTINGS_DEFAULT } from '../services/drumKits';
import { DRUM_FX_DEFAULT, EFFECTS_DEFAULT } from '../services/effectSettings';
import type { DrumSample } from '../../../engine/src/drums/DrumCore';
import { guestCapture, guestLink, guestOrigin, guestUrl, trustOrigin, wallAtContextTime, wallNow, type Guest } from '../services/guests';
import { playhead } from '../services/playhead';
import { loadStoredPresets, presetStore } from '../services/presetStore';
import { downloadArrangementWav, downloadStemsZip } from '../services/wavExport';
import type { ProjectInfo } from '../services/projectLibrary';
import { sanitizeSynthParams } from '../services/projectSanitization';
import type { PresetKind } from '../services/presetKinds';
import { createBuiltInPresets } from '../services/builtInPresets';
import { expandStepNotes, stepNotes, withStepLength, withStepNotes } from '../services/noteScheduling';
import { transposeSteps } from '../services/transpose';
import { randomLine, type RandomChoice } from '../services/randomize';
import { STARTERS, projectIsEmpty, starterDrums, starterPattern } from '../services/starters';
import { buildSampleSong } from '../services/sampleSong';
import { SAMPLE_SONGS } from '../services/sampleSongs';
import { DEFAULT_DRUM_CHANNEL, defaultPads, drumForNote, storePads, storedPads, withPad, type PadMap } from '../services/midiDrums';
import { destinationFor, destinationLane, storeMidiDestinations, storedMidiDestinations, withDestination, type MidiDestination, type MidiDestinations } from '../services/midiDevices';
import { DEFAULT_QUANTIZE, asQuantize, recordPosition } from '../services/recordTiming';
import { LANE_PARAMS, fromUnit, lanePatch, parseTarget } from '../services/paramTargets';
import { canAutomate, copyAutomationBar, resizeAutomationBars, resizeAutomationEachBar, sentAutomation, splitAutomated, stepSends, stepVoiceParams, stepsThrough, withAutomationValues, withoutAutomation } from '../services/automation';
import { storeMidiTies, storedMidiTies, tieFor, withTie, withoutTie, type MidiTie } from '../services/midiTies';
import { CLICK_LEVEL, clickAt, clickLevel, countInBars, countInBeats, countInSeconds, storeMetronome, storedMetronome, type MetronomeSettings } from '../services/metronome';
import { BrowserTransport, TransportTick } from '../services/browserTransport';
import { arrangementWholes, downloadFile, ExportArrangement, loopPass } from '../services/wavExport';
import { expandDrumStep, swingLate } from '../services/drumScheduling';
import { LiveArp, type LiveArpLane } from '../services/liveArp';
import { auxBuses } from '../services/auxSettings';
import { LANE_IDS, isLaneId } from '../services/lanes';
import { useComputerKeyboard } from '../hooks/useComputerKeyboard';
import { getAudioContext, scheduleClick, setMasterVolume, setMasterMuted, setEffectsTempo } from '../hooks/browserAudio';
import { DRUM_NOTE_MAP, downloadMidiFile, noteNameToMidi } from '../utils/midiExport';
import { importMidiFile, readFileAsArrayBuffer, MidiImportResult } from '../utils/midiImport';
import { DEFAULT_SYNTH_MODEL_ID, createDefaultSynthModelParams, enterSynthModel, getSynthModelDefinition, mapSynthModelToEngineParams, normalizeSynthModelId, normalizeSynthModelParams } from '../synthModels';
import { guestInputs, inputSources, leaveOutHanded } from '../services/guestInput';

const DEFAULT_PARAMS: SynthParameters = createDefaultSynthParameters();

const DEFAULT_DRUM_FX = DRUM_FX_DEFAULT;
const DEFAULT_EFFECTS_LOOP = EFFECTS_DEFAULT;

const DEFAULT_DRUM_KIT_ID: DrumKitId = 'clean-analog';
// How far ahead of its sound a step light may be lit. The scheduler always works this far ahead.
const STEP_LIGHT_AHEAD = 0.1;
// MIDI keys pressed within this long of each other are one chord.
const CHORD_WINDOW_MS = 60;

interface SynthPreset {
  id: string;
  name: string;
  // What the preset is for. Built-in presets all have one; a person's own do not.
  kind?: PresetKind;
  params: SynthParameters;
  modelId: SynthModelId;
  modelParams: SynthModelParams;
  builtIn?: boolean;
}

export type PlayMode = 'pattern' | 'song';

interface SynthState {
  id: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  isPlaying: boolean;
  selectedStep: number | null;
  keyboardMode: 'keyboard' | 'piano-roll';
  stepRecordPointer: number;
  octaveShift: number;
  muted: boolean;
  solo: boolean;
  swing?: boolean;
  name?: string;
  preset?: string;
  forceReleaseSignal: boolean;
}

function createDefaultDrumState(): DrumState {
  return Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [
    instrument, { steps: new Array(16).fill(false), settings: { ...DRUM_SETTINGS_DEFAULT[instrument] }, muted: false, solo: false },
  ])) as unknown as DrumState;
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

function normalizeFxSends(sends: Partial<FxSendLevels> | undefined): FxSendLevels {
  return {
    reverb: Math.max(0, Math.min(1, sends?.reverb ?? DEFAULT_DRUM_FX.sends.reverb)),
    delay: Math.max(0, Math.min(1, sends?.delay ?? DEFAULT_DRUM_FX.sends.delay)),
    drive: Math.max(0, Math.min(1, sends?.drive ?? DEFAULT_DRUM_FX.sends.drive)),
    phaser: Math.max(0, Math.min(1, sends?.phaser ?? DEFAULT_DRUM_FX.sends.phaser)),
    chorus: Math.max(0, Math.min(1, sends?.chorus ?? 0)),
    // Always present here, so a send brought back to nothing reaches the store, which keeps no key for it.
    auxA: Math.max(0, Math.min(1, sends?.auxA ?? 0)),
    auxB: Math.max(0, Math.min(1, sends?.auxB ?? 0)),
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
      // Always present here, so choosing Auto reaches the store instead of being merged away.
      octaves: params.arpeggiator?.octaves ?? 0,
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
      // Always present, so going back to Classic reaches the store, which keeps Classic as nothing.
      kind: (loop?.drive?.kind ?? 'classic') as EffectsLoopState['drive']['kind'],
    },
    phaser: {
      enabled: loop?.phaser?.enabled ?? DEFAULT_EFFECTS_LOOP.phaser.enabled,
      rate: Math.max(0.05, Math.min(8, loop?.phaser?.rate ?? DEFAULT_EFFECTS_LOOP.phaser.rate)),
      depth: Math.max(0, Math.min(1, loop?.phaser?.depth ?? DEFAULT_EFFECTS_LOOP.phaser.depth)),
      feedback: Math.max(0, Math.min(0.95, loop?.phaser?.feedback ?? DEFAULT_EFFECTS_LOOP.phaser.feedback)),
      mix: Math.max(0, Math.min(1, loop?.phaser?.mix ?? DEFAULT_EFFECTS_LOOP.phaser.mix)),
      // Always present here, like the delay's, so turning sync off reaches the store.
      sync: loop?.phaser?.sync ?? 'off',
    },
    delay: {
      enabled: loop?.delay?.enabled ?? DEFAULT_EFFECTS_LOOP.delay.enabled,
      time: Math.max(0.01, Math.min(1.5, loop?.delay?.time ?? DEFAULT_EFFECTS_LOOP.delay.time)),
      feedback: Math.max(0, Math.min(0.95, loop?.delay?.feedback ?? DEFAULT_EFFECTS_LOOP.delay.feedback)),
      mix: Math.max(0, Math.min(1, loop?.delay?.mix ?? DEFAULT_EFFECTS_LOOP.delay.mix)),
      // Always present here, so turning sync off reaches the store instead of being merged away.
      sync: loop?.delay?.sync ?? 'off',
      // The same for the colour and the wow: a 0 is sent, and the store keeps it as nothing.
      color: Math.max(0, Math.min(1, loop?.delay?.color ?? 0)),
      wow: Math.max(0, Math.min(1, loop?.delay?.wow ?? 0)),
    },
    reverb: {
      enabled: loop?.reverb?.enabled ?? DEFAULT_EFFECTS_LOOP.reverb.enabled,
      decay: Math.max(0.2, Math.min(8, loop?.reverb?.decay ?? DEFAULT_EFFECTS_LOOP.reverb.decay)),
      mix: Math.max(0, Math.min(1, loop?.reverb?.mix ?? DEFAULT_EFFECTS_LOOP.reverb.mix)),
      // Always present here, like the delay's sync, so setting them back to zero reaches the store.
      preDelay: loop?.reverb?.preDelay ?? 0,
      damping: loop?.reverb?.damping ?? 0,
      kind: loop?.reverb?.kind ?? 'room',
    },
    // Checked and clamped by the store; passed through as they are.
    ...(loop?.chorus ? { chorus: { ...loop.chorus } } : {}),
    ...(loop?.aux ? { aux: loop.aux.map(bus => ({ ...bus })) } : {}),
    ...(loop?.eq ? { eq: { ...loop.eq } } : {}),
  };
}

// A time on the audio clock as a Web MIDI time stamp, which counts from when the page loaded.
// It is where the sound leaves the speakers, so hardware plays with them and not ahead.
// The audio clock moves in small jumps, so the gap between the two clocks is averaged over
// many readings; otherwise MIDI clock pulses would wobble by a few milliseconds.
let midiClockGap: number | null = null;
function midiTime(audioTime: number): number {
  const context = getAudioContext();
  const stamp = context.getOutputTimestamp?.();
  const gap = stamp?.contextTime && stamp.performanceTime
    ? stamp.performanceTime - stamp.contextTime * 1000
    : performance.now() - (context.currentTime - (context.outputLatency || 0)) * 1000;
  midiClockGap = midiClockGap === null ? gap : midiClockGap + (gap - midiClockGap) * 0.02;
  return midiClockGap + audioTime * 1000;
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
  const selectedSynthIdRef = useRef(selectedSynthId);
  selectedSynthIdRef.current = selectedSynthId;
  const [drumState, setDrumState] = useState<DrumState>(createDefaultDrumState);
  const [drumKits, setDrumKits] = useState<DrumKitDefinition[]>([]);
  const [selectedDrumKitId, setSelectedDrumKitId] = useState<DrumKitId>(DEFAULT_DRUM_KIT_ID);
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const [drumSwing, setDrumSwing] = useState(0);
  const [drumFx, setDrumFx] = useState(DEFAULT_DRUM_FX);
  const [effectsLoop, setEffectsLoop] = useState(DEFAULT_EFFECTS_LOOP);
  const [browserMuted, setBrowserMuted] = useState(false);
  const [browserVolume, setBrowserVolume] = useState(1.0);
  const [globalTempo, setGlobalTempo] = useState(120);
  const [storageError, setStorageError] = useState<string | null>(null);
  // Decoded samples for the drum lanes that use one, and the lanes whose sample is not on this device.
  const drumSamplesRef = useRef<Partial<Record<DrumInstrument, DrumSample>>>({});
  const [missingDrumSamples, setMissingDrumSamples] = useState<DrumInstrument[]>([]);
  // The app's cymbal recordings, for the worklet and for export. Empty until they have been fetched.
  const cymbalsRef = useRef<Awaited<ReturnType<typeof loadCymbals>>>({});
  // The decoded recording each synth lane's sample engine plays, by lane id.
  const synthSamplesRef = useRef<Record<number, DrumSample>>({});
  // Goes up when samples arrive from a project file, so a lane whose sample was missing looks again.
  const [sampleStoreVersion, setSampleStoreVersion] = useState(0);
  // What an imported preset was, and what did not carry over, shown once after importing.
  const [presetImportReport, setPresetImportReport] = useState<Pick<ImportedPreset, 'name' | 'source' | 'notes'> | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  // Set while an export is playing the arrangement through to record its guests: how long it will take.
  const [guestRecording, setGuestRecording] = useState<number | null>(null);
  // An audio export in progress, or just finished. handleExportWav refuses a second while one is working.
  const [exportStatus, setExportStatus] = useState<{ phase: 'working' | 'done'; what: string; part?: string } | null>(null);
  const exportingRef = useRef(false);
  // The metronome is this browser's, not the project's. The scheduler reads the ref.
  const [metronome, setMetronome] = useState<MetronomeSettings>(storedMetronome);
  const metronomeRef = useRef(metronome);
  metronomeRef.current = metronome;
  // The count-in of the run that is playing: how many ticks it lasts, and whose bar it counts.
  const countInRef = useRef<{ ticks: number; signature: unknown }>({ ticks: 0, signature: undefined });
  // In scene mode, where the bars are counted from: a bar's length changes when another scene is
  // opened or this one's time signature is changed, and a new bar starts there.
  const barAnchorRef = useRef({ tick: 0, bar: 0, perBar: 0 });
  const handleMetronomeChange = useCallback((patch: Partial<MetronomeSettings>) => {
    setMetronome((current) => {
      const next = { ...current, ...patch };
      storeMetronome(next);
      return next;
    });
  }, []);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // A controller's knobs tied to parameters, kept for this browser, and the parameter waiting for
  // a knob to be turned (Learn). The MIDI handler reads the refs.
  const [midiTies, setMidiTies] = useState<MidiTie[]>(storedMidiTies);
  const midiTiesRef = useRef(midiTies);
  midiTiesRef.current = midiTies;
  const [midiLearn, setMidiLearn] = useState<string | null>(null);
  const midiLearnRef = useRef(midiLearn);
  midiLearnRef.current = midiLearn;
  const applyParamTargetRef = useRef<(target: string, unit: number) => void>(() => {});
  // The note each drum's pad sends and where each device's notes go, both kept for this browser
  // like the ties, and the drum waiting for a pad to be hit. One Learn waits at a time, a knob's
  // or a pad's: asking for either calls the other off.
  const [midiPads, setMidiPads] = useState<PadMap>(storedPads);
  const midiPadsRef = useRef(midiPads);
  midiPadsRef.current = midiPads;
  const [midiPadLearn, setMidiPadLearn] = useState<DrumInstrument | null>(null);
  const midiPadLearnRef = useRef(midiPadLearn);
  midiPadLearnRef.current = midiPadLearn;
  const [midiDestinations, setMidiDestinations] = useState<MidiDestinations>(storedMidiDestinations);
  const midiDestinationsRef = useRef(midiDestinations);
  midiDestinationsRef.current = midiDestinations;
  const handleMidiLearn = useCallback((target: string | null) => { setMidiPadLearn(null); setMidiLearn(target); }, []);
  const handleMidiPadLearn = useCallback((drum: DrumInstrument | null) => { setMidiLearn(null); setMidiPadLearn(drum); }, []);
  const handleMidiPadsReset = useCallback(() => { const next = defaultPads(); storePads(next); setMidiPadLearn(null); setMidiPads(next); }, []);
  const handleMidiTieRemove = useCallback((target: string) => {
    setMidiTies(current => { const next = withoutTie(current, target); storeMidiTies(next); return next; });
  }, []);
  // Recording from the on-screen and computer keyboards, and how firmly a recorded note is moved
  // onto the nearest step. Both are for the session, like the MIDI settings.
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const [quantize, setQuantizeValue] = useState(DEFAULT_QUANTIZE);
  const quantizeRef = useRef(quantize);
  quantizeRef.current = quantize;
  const setQuantize = useCallback((value: number) => setQuantizeValue(asQuantize(value)), []);
  // Auto: while the song plays, a knob turned on a lane is written into its pattern as automation
  // and the lane's own sound is left as it is. For the session, like Rec.
  const [autoRecording, setAutoRecordingValue] = useState(false);
  const autoRecordingRef = useRef(autoRecording);
  autoRecordingRef.current = autoRecording;
  // The pass being recorded on each lane, from the first knob turned to Stop or Auto being switched
  // off: for each parameter turned, the value its knob is at (`held`, which the scheduler plays in
  // place of what the pattern holds), and the step and the transport tick it was last written at.
  const autoPassRef = useRef(new Map<number, { patternId: string; held: Record<string, number>; step: Record<string, number>; tick: Record<string, number> }>());
  const endAutoPassesRef = useRef<(write: boolean) => void>(() => {});
  const setAutoRecording = useCallback((on: boolean) => {
    if (!on) endAutoPassesRef.current(true);
    setAutoRecordingValue(on);
  }, []);
  const [midiChannel, setMidiChannel] = useState(1);
  // The channel pads are listened to on, for the drums. A keyboard on one channel and pads on
  // another play a lane and the drums at once. 0 is none.
  const [midiDrumChannel, setMidiDrumChannel] = useState(DEFAULT_DRUM_CHANNEL);
  const midiDrumChannelRef = useRef(midiDrumChannel);
  midiDrumChannelRef.current = midiDrumChannel;
  // What the sequencer sends to the chosen MIDI output. Kept for the session only.
  const [midiOutNotes, setMidiOutNotes] = useState(true);
  const [midiOutClock, setMidiOutClock] = useState(false);
  useEffect(() => { midiOut.configure({ notes: midiOutNotes, clock: midiOutClock }); }, [midiOutNotes, midiOutClock]);
  const [midiTargetSynthId, setMidiTargetSynthId] = useState<number | null>(1);
  const [projectId, setProjectId] = useState('');
  // Goes up each time a project is put on the rack: the page loading, a project opened or restored.
  const [projectOpens, setProjectOpens] = useState(0);
  const [projectName, setProjectName] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [synthPresets, setSynthPresets] = useState<SynthPreset[]>(() => [
    ...createBuiltInPresets(),
  ]);
  const synthPresetsRef = useRef(synthPresets);
  synthPresetsRef.current = synthPresets;
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;

  // Assigned here, and moved on by the handlers of the store's pattern events (and of the scene,
  // lane and transport events), so that the scheduler and a handler making a second edit before
  // React has rendered see the first.
  const synthsRef = useRef(synths);
  synthsRef.current = synths;
  const midiModeRef = useRef(midiMode);
  midiModeRef.current = midiMode;
  const midiChannelRef = useRef(midiChannel);
  midiChannelRef.current = midiChannel;
  const midiTargetSynthIdRef = useRef(midiTargetSynthId);
  midiTargetSynthIdRef.current = midiTargetSynthId;
  // Assigned here, and again by the handlers of the store's drum events, so that the scheduler
  // and a handler making a second edit before React has rendered see the first.
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;
  const selectedDrumKitIdRef = useRef(selectedDrumKitId);
  selectedDrumKitIdRef.current = selectedDrumKitId;
  const drumFxRef = useRef(drumFx);
  drumFxRef.current = drumFx;
  const effectsLoopRef = useRef(effectsLoop);
  effectsLoopRef.current = effectsLoop;
  // Notes a lane is holding for a MIDI device, by device, channel and note.
  const midiHeldRef = useRef(new Map<string, { synthId: number; note: string; device: string }>());
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
  const songStartTickRef = useRef(0);
  const signatureOfRef = useRef<(sceneId: string) => TimeSignature | undefined>(() => undefined);
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

  // The voices a guest may be handed (services/guestInput): each lane by its model's name, the kit
  // and each drum. A guest whose voice has gone is told by its own unit.
  const inputKey = synths.map(synth => `${synth.id}:${synth.synthModelId}`).join(',');
  useEffect(() => {
    guestInputs.setSources(inputSources(synthsRef.current.map(synth => ({ id: synth.id, model: getSynthModelDefinition(synth.synthModelId).name }))));
  }, [inputKey]);
  // Each voice goes where the guests have it: to a guest's tap, or to the mix.
  useEffect(() => {
    const route = () => {
      for (const source of guestInputs.sources()) {
        const tap = (guestInputs.tapFor(source.id) ?? null) as AudioNode | null;
        if (source.kind === 'synth') synthAudio.handOver(Number(source.id.slice('synth:'.length)), tap);
        else if (source.kind === 'drums') drumAudio.handOver('drums', tap);
        else drumAudio.handOver(source.id.slice('drum:'.length) as DrumInstrument, tap);
      }
    };
    route();
    return guestInputs.subscribe(route);
  }, [synthAudio, drumAudio]);
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

  // A change to the lanes that the next line must be able to read: the ref is moved on with the
  // state. The change is made to each, not worked out from the ref and set, so that nothing
  // another handler has asked of the state since the last render is lost.
  const commitLanes = useCallback((change: (lane: SynthState) => SynthState) => {
    synthsRef.current = synthsRef.current.map(change);
    setSynths(prev => prev.map(change));
  }, []);

  // A pattern the store has kept, put on its lane.
  const commitPattern = useCallback((synthId: number, change: (lane: SynthState) => SynthState) => {
    commitLanes(s => (s.id === synthId ? change(s) : s));
  }, [commitLanes]);


  const handleUndo = useCallback(() => { localService.undo(); }, []);
  const handleRedo = useCallback(() => { localService.redo(); }, []);

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

  // The user's own presets are read once the page is up. Until they have been, nothing is
  // written back: the first render has none, and saving that would replace what is stored.
  const presetsLoadedRef = useRef(false);
  useEffect(() => {
    let current = true;
    void loadStoredPresets().then((stored) => {
      if (!current) return;
      const loaded = parseUserPresets(stored), ids = new Set(loaded.map(preset => preset.id));
      presetsLoadedRef.current = true;
      // One saved in the moment before this finished is kept, after the stored ones.
      setSynthPresets(prev => [...prev.filter(preset => preset.builtIn), ...loaded, ...prev.filter(preset => !preset.builtIn && !ids.has(preset.id))]);
    }).catch(() => { if (current) setStorageError('Your saved synth presets could not be read from browser storage, so presets saved now will not be kept.'); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!presetsLoadedRef.current) return;
    const presetsToPersist = synthPresets
      .filter((preset) => !preset.builtIn)
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        params: preset.params,
        modelId: preset.modelId,
        modelParams: preset.modelParams,
      }));
    presetStore.save(presetsToPersist).catch(() => setStorageError('Unable to persist synth presets in browser storage.'));
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

  // Keys held under a lane's arpeggiator: it runs while they are down, read from the lane each beat.
  const liveArpRef = useRef<LiveArp | null>(null);
  liveArpRef.current ??= new LiveArp(() => getAudioContext().currentTime);
  useEffect(() => () => liveArpRef.current?.stop(), []);
  const arpLane = (synthId: number): LiveArpLane => ({
    beat: () => 60 / Math.max(20, globalTempoRef.current),
    pulses: (notes, beat) => {
      const params = synthsRef.current.find(s => s.id === synthId)?.synthParams;
      if (!params?.arpeggiator.enabled) return [];
      return expandStepNotes(withStepNotes({ active: true, velocity: 1 }, notes), params, beat, globalTempoRef.current);
    },
    play: (note, time, duration, velocity) => {
      const lanes = synthsRef.current, synth = lanes.find(s => s.id === synthId);
      if (!synth?.synthParams || synth.muted || (lanes.some(s => s.solo) && !synth.solo)) return;
      void synthAudio.playNote(note, synth.synthParams, duration, velocity, browserMutedRef.current, effectsLoopRef.current, globalTempoRef.current, synthId, time);
    },
  });

  // One step of a pattern: its whole chord, for its whole length.
  const triggerStep = useCallback((synthParams: SynthParameters, step: SequencerStep, windowSeconds: number, synthId: number, scheduledTime: number) => {
    const velocity = Math.max(0, Math.min(1, step.velocity));
    for (const scheduled of expandStepNotes(step, synthParams, windowSeconds, globalTempoRef.current)) {
      void synthAudio.playNote(scheduled.note, synthParams, scheduled.duration, velocity,
        browserMutedRef.current, effectsLoopRef.current, globalTempoRef.current, synthId, scheduledTime + scheduled.offset);
      // Lane 1 goes out on MIDI channel 1, and so on.
      if (midiOut.active) {
        const start = scheduledTime + scheduled.offset, midi = noteNameToMidi(scheduled.note);
        if (midi !== null) midiOut.note(synthId, midi, velocity, midiTime(start), midiTime(start + scheduled.duration));
      }
    }
  }, [synthAudio]);

  useEffect(() => { setEffectsTempo(globalTempo); }, [globalTempo]);

  // A scene's time signature. The open scene's is read from its slot in `scenes` like any
  // other's: it is the one thing about the open scene the live lanes cannot say.
  const signatureOf = (sceneId: string) => scenesRef.current.find(scene => scene.id === sceneId)?.signature;
  signatureOfRef.current = signatureOf;
  // The open scene as it stands now: its stored copy can be behind the live lanes.
  const liveScene = (): Scene => {
    const lanes = synthsRef.current.filter(synth => synth.pattern);
    const signature = storedSignature(signatureOf(currentSceneIdRef.current));
    return {
      id: currentSceneIdRef.current, name: scenesRef.current.find(scene => scene.id === currentSceneIdRef.current)?.name ?? 'Scene',
      ...(signature ? { signature } : {}),
      lanes: Object.fromEntries(lanes.map(synth => [synth.id, synth.pattern!.steps])),
      laneBars: Object.fromEntries(lanes.map(synth => [synth.id, laneBars(synth.pattern!.steps.length, synth.pattern!.bars, signature)])),
      ...(lanes.some(synth => synth.pattern!.automation) ? { laneAutomation: Object.fromEntries(lanes.filter(synth => synth.pattern!.automation).map(synth => [synth.id, synth.pattern!.automation!])) } : {}),
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
  const sceneSignature = useCallback((sceneId: string) => signatureOfRef.current(sceneId), []);

  // Lights a step when it is heard. The scheduler is a moment ahead of the sound, and further ahead
  // while a voice is handed to a guest; a light that early would be seen to lead the beat.
  const handedByBarRef = useRef<string[][]>([]);
  const showStep = (lane: number | 'drums', step: number, time: number) => {
    const ahead = time - getAudioContext().currentTime;
    if (ahead <= STEP_LIGHT_AHEAD) { playhead.set(lane, step); return; }
    setTimeout(() => { if (transportRef.current?.running) playhead.set(lane, step); }, (ahead - STEP_LIGHT_AHEAD) * 1000);
  };

  scheduleTickRef.current = ({ tick: counted, time, duration }) => {
    // The count-in: its bars are clicked and nothing else happens in them. Everything after counts
    // from where the count-in ends.
    const countIn = countInRef.current;
    if (counted < countIn.ticks) {
      const kind = clickAt(counted % barTicks(countIn.signature), countIn.signature);
      if (kind) scheduleClick(time, kind === 'bar', clickLevel(metronomeRef.current) / CLICK_LEVEL);
      return;
    }
    const tick = counted - countIn.ticks;
    if (midiOut.active) midiOut.tick(midiTime(time), duration * 1000, tick === 0);
    // The transport only counts ticks. How long a bar is comes from the time signature of the
    // scene that is playing, so which bar this is and where in it (`step`, in ticks) are worked
    // out here. `passBar` is where in its pattern each lane is: in song mode that is counted from
    // the start of the scene's pass; otherwise the bars just keep counting and lanes of different
    // lengths drift.
    let passBar = 0, step = 0;
    let signature: TimeSignature | undefined;
    // In song mode the tick picks the scene. A scene other than the one open for
    // editing is played from its stored copy; the open one is played from the live pattern.
    let scene: Scene | null = null;
    if (playModeRef.current === 'song') {
      const position = sceneAtTick(songRef.current, songStartTickRef.current + tick, sceneLength, signatureOf);
      if (!position) {
        if (!songEndingRef.current) {
          songEndingRef.current = true;
          // Stop on the bar line this tick belongs to, not now: ticks are scheduled a little ahead.
          setTimeout(() => stopPlaybackRef.current(), Math.max(0, (time - getAudioContext().currentTime) * 1000));
        }
        return;
      }
      passBar = position.bar;
      step = position.tick;
      signature = signatureOf(position.sceneId);
      if (step === 0) {
        setSongPosition(position);
        // Open the playing scene in the editor. This updates the live pattern at once: selectScene
        // is synchronous, and the sceneChanged handler has written the refs before it returns.
        if (position.sceneId !== currentSceneIdRef.current) {
          localService.selectScene(position.sceneId);
        }
      }
      if (position.sceneId !== currentSceneIdRef.current) {
        scene = scenesRef.current.find(entry => entry.id === position.sceneId) ?? null;
      }
    } else {
      signature = signatureOf(currentSceneIdRef.current);
      const perBar = barTicks(signature), anchor = barAnchorRef.current;
      // A bar of another length starts a new bar here, on a whole step of the bar before.
      if (anchor.perBar !== perBar && (anchor.perBar === 0 || (tick - anchor.tick) % 2 === 0)) {
        barAnchorRef.current = { tick, bar: anchor.perBar ? anchor.bar + Math.ceil((tick - anchor.tick) / anchor.perBar) : 0, perBar };
      }
      const from = barAnchorRef.current;
      passBar = from.bar + Math.floor((tick - from.tick) / from.perBar);
      step = (tick - from.tick) % from.perBar;
    }
    // An export's play-through notes which voices are with a guest in each bar, to leave them out of its render.
    if (exportingRef.current && step === 0) handedByBarRef.current.push(guestInputs.all().map(entry => entry.source));
    if (metronomeRef.current.click && !exportingRef.current) {
      const kind = clickAt(step, signature);
      if (kind) scheduleClick(time, kind === 'bar', clickLevel(metronomeRef.current) / CLICK_LEVEL);
    }
    const ticksPerBar = barTicks(signature);
    const lanes = synthsRef.current;
    // A scene played from its stored copy brings its own mutes; the open one's are on the lanes.
    const heard = audibleLanes(scene, lanes);
    for (const synth of lanes) {
      if (!synth.isPlaying || !synth.pattern || !synth.synthParams) continue;
      const steps = scene ? scene.lanes[synth.id] ?? [] : synth.pattern.steps;
      if (steps.length === 0) continue;
      const bars = laneBars(steps.length, scene ? scene.laneBars?.[synth.id] : synth.pattern.bars, signature);
      const perBar = steps.length / bars;
      // A lane of finer steps has one to a tick; any other uses every second tick.
      const divisor = perBar === ticksPerBar ? 1 : 2;
      if (step % divisor !== 0) continue;
      const index = (passBar % bars) * perBar + Math.floor(step / divisor) % perBar;
      const note = steps[index];
      // The step's automation, sent to sound when the step does. The lane's own sound is not
      // changed: this goes to the voice and nowhere else. A scene played from its stored copy
      // brings its own. A knob being recorded plays where it is, whatever the pattern holds.
      // A lane handed to a guest is played early by its lead (services/guestInput), so the guest has it in time.
      const early = guestInputs.leadSeconds(`synth:${synth.id}`);
      const automation = scene ? scene.laneAutomation?.[synth.id] : synth.pattern.automation, held = scene ? undefined : autoPassRef.current.get(synth.id)?.held;
      synthAudio.automate(synth.id, synth.synthParams, globalTempoRef.current,
        stepVoiceParams(synth.synthParams, automation, index, globalTempoRef.current, held), time - early, stepSends(synth.synthParams, automation, index, held));
      // A lane that swings plays every second sixteenth late by the drums' swing. Its automation stays on the step.
      const late = synth.swing ? swingLate(step * duration, duration * 2, drumSwingRef.current) : 0;
      if (heard.has(synth.id) && note?.active && note.note) {
        triggerStep(synth.synthParams, note, duration * divisor, synth.id, time + late - early);
      }
      // The step lights read this themselves. Setting state here would render the whole rack on every step.
      showStep(synth.id, index, time + late);
    }
    if (step % 2 !== 0) return;
    const state = scene ? sceneDrumState(scene, drumStateRef.current) : drumStateRef.current;
    const stepInBar = Math.floor(step / 2);
    const drumStep = (passBar % drumBars(state, signature)) * barSteps(signature) + stepInBar;
    showStep('drums', drumStep, time);
    const drumSolo = (Object.keys(state) as DrumInstrument[]).some(i => state[i].solo);
    const swingOffset = stepInBar % 2 ? drumSwingRef.current * duration * 2 : 0;
    for (const instrument of Object.keys(state) as DrumInstrument[]) {
      const track = state[instrument];
      if (track.muted || (drumSolo && !track.solo)) continue;
      const velocity = track.stepVelocities?.[drumStep] ?? 1;
      for (const offset of expandDrumStep(track, drumStep)) {
        const hitTime = time + swingOffset + offset * duration * 2;
        const early = guestInputs.leadSeconds('drums') || guestInputs.leadSeconds(`drum:${instrument}`);
        void drumAudio.playDrumHit(instrument, track.settings, velocity, hitTime - early);
        if (midiOut.active) midiOut.note(MIDI_DRUM_CHANNEL, DRUM_NOTE_MAP[instrument], velocity, midiTime(hitTime), midiTime(hitTime + 0.06));
        if (instrument !== 'kick') continue;
        for (const synth of lanes) {
          const amount = synth.synthParams?.duck ?? 0;
          if (amount > 0) synthAudio.duck(synth.id, hitTime - guestInputs.leadSeconds(`synth:${synth.id}`), amount);
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
        () => guestInputs.reachSeconds(),
      );
      const transport = transportRef.current, context = getAudioContext();
      // Guests are told where the beats fall on the computer's clock, which they share with this page.
      // A count-in is for a person about to play, never for an export that is recording the guests.
      const countIn = metronomeRef.current.countIn && !exportingRef.current ? countInBars(metronomeRef.current) : 0;
      // The count-in is a bar of the scene that plays first.
      const firstScene = playModeRef.current === 'song' ? songRef.current.entries[songStartEntryRef.current]?.sceneId : undefined;
      const counted = signatureOfRef.current(firstScene ?? currentSceneIdRef.current);
      countInRef.current = { ticks: countIn * barTicks(counted), signature: counted };
      barAnchorRef.current = { tick: 0, bar: 0, perBar: 0 };
      // Nothing is playing during the count-in, so no step is lit: the playhead is put before the first.
      if (countIn > 0) for (const lane of ['drums' as const, ...synthsRef.current.map(synth => synth.id)]) playhead.set(lane, -1);
      // Guests count their beats from where the music starts, which is after the count-in.
      transport.onTempo = (bpm, time, beat) => {
        if (beat >= countInBeats(countIn, counted)) guestLink.announce({ playing: true, bpm, anchorWall: wallAtContextTime(context, time), anchorBeat: beat - countInBeats(countIn, counted) });
      };
      // With guests connected the first beat is placed far enough ahead for all of them to make it.
      transport.start(guestLink.startLead() || undefined);
      guestLink.announce({
        playing: true, bpm: globalTempoRef.current, anchorBeat: 0,
        anchorWall: wallAtContextTime(context, transport.startTime + countInSeconds(countIn, globalTempoRef.current, counted)),
      });
    } else {
      if (guestLink.transport().playing) guestLink.announce({ playing: false });
      transportRef.current?.stop();
      midiOut.stop();
      midiClockGap = null;
      playhead.reset();
      synthAudio.stopAllNotes();
      // Every lane is back at its own sound: automation only plays.
      synthAudio.endAutomation();
      autoPassRef.current.clear();
      localService.holdUndo('auto', false);
      // A key still held (or latched) when the transport stops keeps the length it was given.
      endRecordedHolds();
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
        autoPassRef.current.clear();
        localService.holdUndo('auto', false);
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
            selectedStep: null,
            keyboardMode: s.keyboardMode || 'keyboard',
            stepRecordPointer: 0,
            octaveShift: s.octaveShift || 0,
            muted: Boolean(s.muted),
            solo: Boolean(s.solo), swing: s.swing === true, name: s.name, preset: s.preset,
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
        setProjectOpens(count => count + 1);
        if (Array.isArray(message.data.scenes)) {
          setScenes(message.data.scenes);
          setCurrentSceneId(message.data.currentSceneId);
          setSong(message.data.song);
          setSongStartEntry(0);
        }
        break;
      }
      case 'restored': {
        // Undo or redo put the project back. It is the same project, so nothing that opening one
        // decides (the starting points) is decided again. The refs the scheduler and the next
        // edit read are moved on at once, as a scene change moves them, and each lane's sound is
        // sent to the audio as `synthUpdate` sends it.
        const data = message.data;
        autoPassRef.current.clear();
        localService.holdUndo('auto', false);
        const previous = synthsRef.current, loop = normalizeEffectsLoop(data.effectsLoop);
        const nextLanes: SynthState[] = data.synths.map((s: any) => {
          const was = previous.find(lane => lane.id === s.synthId);
          return {
            id: s.synthId,
            pattern: s.pattern,
            patterns: s.patterns || [],
            synthParams: normalizeSynthParams(s.synthParams),
            synthModelId: normalizeSynthModelId(s.synthModelId),
            synthModelParams: normalizeSynthModelParams(s.synthModelParams),
            isPlaying: was?.isPlaying ?? false,
            selectedStep: null,
            keyboardMode: s.keyboardMode || 'keyboard',
            stepRecordPointer: was?.stepRecordPointer ?? 0,
            octaveShift: s.octaveShift || 0,
            muted: Boolean(s.muted),
            solo: Boolean(s.solo), swing: s.swing === true, name: s.name, preset: s.preset,
            forceReleaseSignal: was?.forceReleaseSignal ?? false,
          };
        });
        const heard = audibleLanes(null, nextLanes);
        previous.forEach(lane => { if (!heard.has(lane.id)) synthAudio.stopSynth(lane.id); });
        nextLanes.forEach(lane => { if (lane.synthParams) synthAudio.updateParameters(lane.synthParams, data.tempo, loop, lane.id); });
        synthsRef.current = nextLanes;
        drumStateRef.current = data.drumState;
        scenesRef.current = data.scenes;
        currentSceneIdRef.current = data.currentSceneId;
        songRef.current = data.song;
        setSynths(nextLanes);
        setGuests(data.guests ?? []);
        setDrumState(data.drumState);
        setSelectedDrumKitId(data.selectedDrumKitId as DrumKitId);
        setDrumFx(normalizeDrumFx(data.drumFx));
        setEffectsLoop(loop);
        setGlobalTempo(data.tempo);
        setDrumMasterVolume(data.drumMasterVolume);
        setDrumSwing(data.drumSwing);
        setScenes(data.scenes);
        setCurrentSceneId(data.currentSceneId);
        setSong(data.song);
        setSongStartEntry(entry => Math.min(entry, data.song.entries.length - 1));
        break;
      }
      case 'sceneChanged': {
        const { scenes: nextScenes, song: nextSong, currentSceneId: nextSceneId, synths: lanePatterns, drumState: nextDrums } = message.data;
        // Each guest takes on the settings the scene holds for it.
        if (message.data.guests) setGuests(message.data.guests);
        const switched = nextSceneId !== currentSceneIdRef.current;
        // A pass being recorded belongs to the scene it was started in.
        if (switched) autoPassRef.current.clear();
        localService.holdUndo('auto', false);
        // A scene brings its lanes' mutes and solos with it.
        const withScene = (s: SynthState): SynthState => {
          const lane = lanePatterns.find((entry: { synthId: number }) => entry.synthId === s.id);
          // A step that is no longer there (the scene's bars were made shorter) is not selected.
          const kept = switched || (s.selectedStep !== null && s.selectedStep >= (lane?.pattern?.steps.length ?? 0)) ? null : s.selectedStep;
          return lane?.pattern ? { ...s, pattern: lane.pattern, muted: Boolean(lane.muted), solo: Boolean(lane.solo), selectedStep: kept } : s;
        };
        const nextLanes = synthsRef.current.map(withScene);
        const stillHeard = audibleLanes(null, nextLanes);
        nextLanes.forEach(s => { if (!stillHeard.has(s.id)) synthAudio.stopSynth(s.id); });
        // The scheduler and undo read these refs before React has rendered again.
        synthsRef.current = nextLanes;
        drumStateRef.current = nextDrums;
        drumStateRef.current = nextDrums;
        scenesRef.current = nextScenes;
        currentSceneIdRef.current = nextSceneId;
        songRef.current = nextSong;
        setSynths(prev => prev.map(withScene));
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
      // The one place a pattern edit is applied. The store has made the pattern it was sent the
      // lane's open one, as checked and kept, and the next edit is built on it.
      case 'patternCreated': {
        const { synthId, pattern } = message.data;
        commitPattern(synthId, s => ({ ...s, patterns: [...s.patterns, pattern], pattern }));
        break;
      }
      case 'patternUpdated': {
        const { synthId, pattern } = message.data;
        commitPattern(synthId, s => ({ ...s, patterns: s.patterns.map(p => (p.id === pattern.id ? pattern : p)), pattern }));
        break;
      }
      case 'synthCreated': {
        const { synthId, pattern, synthParams, synthModelId, synthModelParams } = message.data;
        const created: SynthState = {
          id: synthId,
          pattern,
          patterns: pattern ? [pattern] : [],
          synthParams: normalizeSynthParams(synthParams),
          synthModelId: normalizeSynthModelId(synthModelId),
          synthModelParams: normalizeSynthModelParams(synthModelParams),
          isPlaying: Boolean(message.data.isPlaying),
          selectedStep: null,
          keyboardMode: 'keyboard',
          stepRecordPointer: 0,
          octaveShift: 0,
          muted: Boolean(message.data.muted),
          solo: Boolean(message.data.solo), swing: message.data.swing === true, name: message.data.name, preset: message.data.preset,
          forceReleaseSignal: false,
        };
        // A lane made by someone else in a live session has no handler here to write the ref.
        if (!synthsRef.current.some(s => s.id === synthId)) synthsRef.current = [...synthsRef.current, created];
        setSynths(prev => (prev.some(s => s.id === synthId) ? prev : [...prev, created]));
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
              // The store forgets the preset when the model changes; so does the screen.
              ...(normalizeSynthModelId(modelId) !== s.synthModelId ? { preset: undefined } : {}),
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
      case 'synthPreset': {
        const { synthId, preset } = message.data;
        synthsRef.current = synthsRef.current.map(s => s.id === synthId ? { ...s, preset: preset || undefined } : s);
        setSynths(prev => prev.map(s => s.id === synthId ? { ...s, preset: preset || undefined } : s));
        break;
      }
      case 'synthName': {
        const { synthId, name } = message.data;
        synthsRef.current = synthsRef.current.map(s => s.id === synthId ? { ...s, name: name || undefined } : s);
        setSynths(prev => prev.map(s => s.id === synthId ? { ...s, name: name || undefined } : s));
        break;
      }
      case 'synthSwing': {
        const { synthId, swing } = message.data;
        // The scheduler reads the ref; it is moved here so the next step already swings.
        synthsRef.current = synthsRef.current.map(s => s.id === synthId ? { ...s, swing: Boolean(swing) } : s);
        setSynths(prev => prev.map(s => s.id === synthId ? { ...s, swing: Boolean(swing) } : s));
        break;
      }
      case 'synthRemoved': {
        const { synthId } = message.data;
        synthAudio.stopSynth(synthId);
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
          s.id === synthId ? { ...s, isPlaying: false, forceReleaseSignal: !s.forceReleaseSignal } : s
        ));
        break;
      }
      case 'tempoChange': {
        const { tempo } = message.data;
        setGlobalTempo(tempo);
        break;
      }
      case 'drumFullState': {
        if (message.data.drumState) {
          // The one place a drum edit is applied. The scheduler and the next handler read the ref before React has rendered again.
          drumStateRef.current = message.data.drumState;
          setDrumState(message.data.drumState);
        }
        break;
      }
      case 'drumMasterVolume': {
        if (typeof message.data.volume === 'number') setDrumMasterVolume(message.data.volume);
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
          drumStateRef.current = message.data.drumState as DrumState;
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
  }, [synthAudio, drumAudio, globalTempo, commitPattern]);

  const messageHandlerRef = useRef(handleMessage);
  messageHandlerRef.current = handleMessage;
  useEffect(() => {
    localService.initialize({
      synthParams: DEFAULT_PARAMS, drumState: createDefaultDrumState(),
      effectsLoop: DEFAULT_EFFECTS_LOOP, drumFx: DEFAULT_DRUM_FX,
    });
    const unsubscribe = localService.subscribe(message => messageHandlerRef.current(message));
    void localService.openLibrary().then(() => { startProjectSync(); startLiveSessions(); });
    return unsubscribe;
  }, []);


  const handleRemoveSynth = useCallback(async (synthId: number) => {
    if (synthId === 1) return;
    synthsRef.current = synthsRef.current.map(s => s.id === synthId ? { ...s, isPlaying: false } : s);
    synthAudio.stopSynth(synthId);
    try {
      // The synthRemoved event takes the lane out of the ref and the state.
      localService.removeLane(synthId);
    } catch (error) {
      console.error('Failed to remove synth:', error);
    }
  }, [synthAudio]);

  const ensureSynthExists = useCallback(async (synthId: number): Promise<boolean> => {
    if (synthsRef.current.some(s => s.id === synthId)) return true;
    if (!isLaneId(synthId) || synthId < 2) return false;
    try {
      const res = localService.createLane(synthId);
      if (!res.ok) return false;
      const data = res.value;
      // The synthCreated event adds the lane to the state; the ref is written here.
      const created: SynthState = {
        id: synthId, pattern: data.pattern, patterns: data.patterns || [],
        synthParams: normalizeSynthParams(data.synthParams),
        synthModelId: normalizeSynthModelId(data.synthModelId),
        synthModelParams: normalizeSynthModelParams(data.synthModelParams),
        isPlaying: Boolean(data.isPlaying), selectedStep: null,
        keyboardMode: data.keyboardMode || 'keyboard', stepRecordPointer: 0,
        octaveShift: data.octaveShift || 0, muted: Boolean(data.muted),
        solo: Boolean(data.solo), swing: data.swing === true, name: data.name, preset: data.preset, forceReleaseSignal: false,
      };
      if (!synthsRef.current.some(s => s.id === synthId)) synthsRef.current = [...synthsRef.current, created];
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleOctaveShift = useCallback((synthId: number, direction: 'up' | 'down') => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth) return;
    const shift = Math.max(-2, Math.min(2, synth.octaveShift + (direction === 'up' ? 1 : -1)));
    localService.setSynthPrefs(synthId, { octaveShift: shift });
    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const newShift = direction === 'up'
        ? Math.min(s.octaveShift + 1, 2)
        : Math.max(s.octaveShift - 1, -2);
      return { ...s, octaveShift: newShift };
    }));
  }, []);

  const handleTempoChange = useCallback(async (bpm: number) => {
    // The tempoChange event sets the tempo; nothing sends the lanes their patterns' copy of it.
    setSynths(prev => prev.map(s =>
      s.pattern ? { ...s, pattern: { ...s.pattern, tempo: bpm } } : s
    ));
    localService.setTempo(bpm);
  }, []);

  const handleGlobalPlayStop = useCallback(async () => {
    const currentSynths = synthsRef.current;
    const isAnyPlaying = currentSynths.some(s => s.isPlaying);
    const playableSynths = currentSynths.filter(s => s.pattern);

    if (!isAnyPlaying) {
      songEndingRef.current = false;
      songStartTickRef.current = playModeRef.current === 'song' ? entryStartTick(songRef.current, songStartEntryRef.current, sceneLengthRef.current, signatureOfRef.current) : 0;
      const readiness = await Promise.all([
        synthAudio.ensureAudioReady(),
        drumAudio.ensureAudioReady(),
      ]);
      if (readiness.some(ready => !ready)) {
        setStorageError('Audio could not start. Allow audio playback and press Play again.');
        return;
      }
      // The sequencerPlay event marks each lane as playing.
      const playResults = localService.applyAll(playableSynths.map(s => ({ type: 'transport.play' as const, synthId: s.id, patternId: s.pattern!.id })));
      for (const [index, s] of playableSynths.entries()) if (playResults[index].ok) playhead.set(s.id, 0);
      return;
    }

    // A knob held where it was put is written up to here before the transport stops counting.
    endAutoPassesRef.current(true);
    const playingSynthIds = currentSynths.filter(s => s.isPlaying).map((s) => s.id);
    localService.applyAll(currentSynths.filter(s => s.isPlaying).map(s => ({ type: 'transport.stop' as const, synthId: s.id })));
    // The sequencerStop event has already turned each lane's release signal over once, and this
    // turns it over again, so the lane ends as it began. Kept as it was.
    if (playingSynthIds.length > 0) {
      setSynths(prev => prev.map(s => (
        playingSynthIds.includes(s.id)
          ? { ...s, isPlaying: false, forceReleaseSignal: !s.forceReleaseSignal }
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

  const sceneChange = useCallback(async (change: () => { ok: boolean; error?: string }, leavesScene = true) => {
    // Leaving the open scene records it, so first collect what each guest is set to right now.
    // Guests are only asked every few seconds otherwise, and a change made just before switching
    // would be recorded late, in the scene being switched to.
    if (leavesScene) await guestLink.captureAll();
    const result = change();
    if (!result.ok) setStorageError(result.error ?? 'That scene change could not be made.');
    return result.ok;
  }, []);
  const handleSceneSelect = useCallback((sceneId: string) => sceneChange(() => localService.selectScene(sceneId)), [sceneChange]);
  // A new scene starts as a copy of the one being edited, or empty.
  const handleSceneAdd = useCallback((empty: boolean) => sceneChange(() => localService.createScene({ empty })), [sceneChange]);
  const handleSceneRename = useCallback((sceneId: string, name: string) => sceneChange(() => localService.renameScene(sceneId, name), false), [sceneChange]);
  const handleSceneColor = useCallback((sceneId: string, color: string) => sceneChange(() => localService.setSceneColor(sceneId, color || undefined), false), [sceneChange]);
  // The open scene's time signature. Every lane and the drum grid change length with it, so the
  // undo entry keeps all of them: one undo brings back the steps a shorter bar cut off.
  const handleSceneSignature = useCallback((signature: string) => {
    if (timeSignature(signature) === timeSignature(signatureOfRef.current(currentSceneIdRef.current))) return;
    const result = localService.setSceneSignature(signature);
    if (!result.ok) setStorageError(result.error);
  }, []);
  const handleSceneDelete = useCallback((sceneId: string) => sceneChange(() => localService.deleteScene(sceneId)), [sceneChange]);
  // The sceneChanged event sets the song, as the store kept it.
  const handleSongChange = useCallback((next: Partial<Song>) => {
    void sceneChange(() => localService.setSong(next), false);
  }, [sceneChange]);

  // The song as one scene per bar, with every scene as it stands now, for export.
  const songArrangement = useCallback(async (): Promise<ExportArrangement & { bars: Scene[] }> => {
    const stored = localService.getScenes();
    // Each scene has its own mutes and solos, so they are applied bar by bar here and the
    // lanes are handed to the exporter unmuted.
    const arrangement = currentArrangementRef.current();
    return {
      ...arrangement, synths: arrangement.synths.map(lane => ({ ...lane, muted: false, solo: false })),
      bars: applySceneMutes(songBars(stored.song, stored.scenes), arrangement.synths),
    };
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
      const updatedPattern = {
        ...pattern,
        steps: pattern.steps.map((s, i) => (
          i === stepIndex ? withStepNotes(s, []) : s
        )),
      };

      setSynths(prev => prev.map(s => (
        s.id === synthId ? { ...s, selectedStep: null } : s
      )));
      localService.writePattern(synthId, pattern.id, updatedPattern);
      return;
    }

    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      return { ...s, selectedStep: s.selectedStep === stepIndex ? null : stepIndex };
    }));
  }, []);

  // Moves the selection without the toggle and clear behaviour a click on a step has.
  const handleStepSelect = useCallback((synthId: number, stepIndex: number) => {
    setSynths(prev => prev.map(s => (s.id === synthId ? { ...s, selectedStep: stepIndex } : s)));
  }, []);

  const handleKeyboardModeChange = useCallback((synthId: number, mode: 'keyboard' | 'piano-roll') => {
    localService.setSynthPrefs(synthId, { keyboardMode: mode });
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, keyboardMode: mode } : s
    )));
  }, []);

  // Adds a note to a step's chord or takes it out.
  // One note, or the several notes of a chord put in with one press: they are one edit and one undo.
  const handlePianoRollNoteAssign = useCallback(async (synthId: number, stepIndex: number, note: string | string[], on: boolean, offset = 0) => {
    const changed = Array.isArray(note) ? note : [note];
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => {
        if (idx !== stepIndex) return step;
        const current = stepNotes(step);
        // A late start is chosen when the step gets its first note; later notes join it there.
        const base = on && current.length === 0 && offset > 0 ? { ...step, offset } : step;
        return withStepNotes(base, on ? [...current, ...changed] : current.filter(entry => !changed.includes(entry)));
      }),
    };

    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, selectedStep: stepIndex } : s
    )));
    // Two cells painted in one frame must both land: the patternUpdated event has moved
    // synthsRef on by the time this returns, so the next call sees this one. Its undo entry
    // holds this one too, so each cell is undone by itself.
    localService.writePattern(synthId, synth.pattern.id, updatedPattern);
  }, []);

  const handleClearPatternNotes = useCallback(async (synthId: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step) => withStepNotes(step, [])),
      // Clearing a pattern clears its automation with its notes.
      automation: sentAutomation(undefined),
    };
    setSynths(prev => prev.map(s => (
      s.id === synthId ? { ...s, selectedStep: null } : s
    )));
    localService.writePattern(synthId, synth.pattern.id, updatedPattern);
  }, []);

  // Moves every note of a lane's pattern, in the open scene, by so many semitones. Nothing moves
  // if any note could not, and then nothing is written and no undo step is made.
  const handleTransposeLane = useCallback((synthId: number, semitones: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const steps = transposeSteps(synth.pattern.steps, semitones);
    if (!steps) return;
    localService.writePattern(synthId, synth.pattern.id, { ...synth.pattern, steps });
  }, []);

  // Replaces a lane's notes, in the open scene, with a new random line in a key and scale. The
  // line starts in the lowest octave the lane's piano roll shows.
  const handleRandomizeLane = useCallback((synthId: number, choice: RandomChoice) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    localService.writePattern(synthId, synth.pattern.id, randomLine(synth.pattern, choice, 3 + synth.octaveShift, Math.random, signatureOfRef.current(currentSceneIdRef.current)));
  }, []);

  // Writes a note to a step. `add` joins it to the chord already there instead of replacing it.
  const upsertStepNote = useCallback(async (synthId: number, stepIndex: number, note: string, velocity: number, add = false, offset?: number, select = true) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;

    const boundedVelocity = Math.max(0, Math.min(1, velocity));
    const updatedPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, idx) => (
        idx === stepIndex
          // A recorded note brings how late it was played; a note joining a chord starts where the chord does.
          ? withStepNotes({ ...step, velocity: boundedVelocity, ...(offset !== undefined && !add ? { offset } : {}) }, add ? [...stepNotes(step), note] : [note])
          : step
      )),
    };

    // A note put on a chosen step selects it and moves the step pointer on. A recorded note does
    // neither: left selected, its step would take the next key played and lose what was recorded.
    if (select) setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextPointer = (stepIndex + 1) % updatedPattern.steps.length;
      return { ...s, selectedStep: stepIndex, stepRecordPointer: nextPointer };
    }));
    // The next note's undo entry holds this one, as with a painted cell.
    localService.writePattern(synthId, synth.pattern.id, updatedPattern);
  }, []);

  // Where a note played now on this lane is recorded: the step the player is hearing, moved
  // towards the nearest step by the quantize strength. Null when the transport is not running, or
  // is still counting in.
  const recordedStep = useCallback((synthId: number, strength = quantizeRef.current): { step: number; offset: number } | null => {
    const transport = transportRef.current;
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (!transport?.running || !pattern || pattern.steps.length === 0 || playhead.get(synthId) < 0) return null;
    const context = getAudioContext();
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    const perBar = stepsPerBar(pattern.steps.length, pattern.bars, signature);
    return recordPosition({
      // What is heard now left the clock a moment ago.
      heardTicks: transport.ticksAt(context.currentTime - (context.outputLatency || 0)),
      scheduledTicks: transport.scheduledTicks, playheadStep: playhead.get(synthId),
      ticksPerStep: barTicks(signature) / perBar, steps: pattern.steps.length, strength,
    });
  }, []);

  // Where the player is on the transport's clock, in ticks, and how many ticks a step of a lane is.
  const heardTicks = (): number | null => {
    const transport = transportRef.current;
    if (!transport) return null;
    const context = getAudioContext();
    return transport.ticksAt(context.currentTime - (context.outputLatency || 0));
  };
  const ticksPerStepOf = (synthId: number): number | null => {
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (!pattern || pattern.steps.length === 0) return null;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    return barTicks(signature) / stepsPerBar(pattern.steps.length, pattern.bars, signature);
  };
  // Recorded keys still down, by lane and note: where each went down, so that letting it go can give
  // its note the length it was held. While any key of a lane is down its edits are one undo step,
  // so a chord or a run of overlapping notes is undone with its lengths.
  const recordHeldRef = useRef(new Map<string, { synthId: number; note: string; step: number; ticks: number }>());
  const endRecordedHold = (synthId: number, note: string, write: boolean) => {
    const key = `${synthId}
${note}`, held = recordHeldRef.current.get(key);
    if (!held) return;
    recordHeldRef.current.delete(key);
    const now = heardTicks(), each = ticksPerStepOf(synthId), synth = synthsRef.current.find(s => s.id === synthId);
    const pattern = synth?.pattern, step = pattern?.steps[held.step];
    if (write && now !== null && each && pattern && step && stepNotes(step).includes(note)) {
      const length = Math.min(pattern.steps.length - held.step, Math.max(1, Math.round((now - held.ticks) / each)));
      if (length !== (step.length ?? 1)) {
        localService.writePattern(synthId, pattern.id, { ...pattern, steps: pattern.steps.map((entry, index) => (index === held.step ? withStepLength(entry, length, note) : entry)) });
      }
    }
    if (![...recordHeldRef.current.values()].some(entry => entry.synthId === synthId)) localService.holdUndo(`record:${synthId}`, false);
  };
  const endRecordedHolds = () => { for (const held of [...recordHeldRef.current.values()]) endRecordedHold(held.synthId, held.note, true); };

  // A note recorded from the keys: one played with another, within a moment, joins its chord.
  const recordNote = useCallback((synthId: number, note: string, velocity: number): boolean => {
    const now = performance.now(), chord = midiChordRef.current;
    const joins = chord !== null && chord.synthId === synthId && now - chord.at < CHORD_WINDOW_MS;
    const at = joins ? { step: chord.stepIndex, offset: 0 } : recordedStep(synthId);
    if (!at) return false;
    const ticks = heardTicks();
    if (ticks !== null) {
      localService.holdUndo(`record:${synthId}`, true);
      recordHeldRef.current.set(`${synthId}
${note}`, { synthId, note, step: at.step, ticks });
    }
    midiChordRef.current = { synthId, stepIndex: at.step, at: now };
    void upsertStepNote(synthId, at.step, note, velocity, joins, at.offset, false);
    return true;
  }, [recordedStep, upsertStepNote]);

  const handleNotePlay = useCallback(async (synthId: number, note: string) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.synthParams) return;
    if (synth.muted || (synthsRef.current.some(s => s.solo) && !synth.solo)) return;
    // Recording: the note goes where it was played in the bar, not on the selected step. It is
    // taken before the sound starts, so starting audio cannot make it late.
    const recorded = recordingRef.current && synth.isPlaying && recordNote(synthId, note, 1);

    await synthAudio.ensureAudioReady();
    if (synth.synthParams.arpeggiator.enabled) {
      liveArpRef.current!.press(synthId, note, 1, arpLane(synthId));
    } else {
      await synthAudio.playNote(note, synth.synthParams, undefined, 1, browserMutedRef.current, effectsLoopRef.current, globalTempo, synthId);
    }

    // Starting audio can take a moment the first time; use the pattern as it is now, not as it
    // was when the key went down, or a quick second note would undo the first.
    const step = synth.selectedStep;
    const pattern = synthsRef.current.find(s => s.id === synthId)?.pattern;
    if (recorded || step === null || !pattern) return;

    const updated = {
      ...pattern,
      steps: pattern.steps.map((s, i) => i === step ? { ...s, note, active: true } : s),
    };

    localService.writePattern(synthId, pattern.id, updated);
  }, [synthAudio, globalTempo, recordNote]);

  const handleNoteRelease = useCallback(async (synthId: number, note: string) => {
    const synthParams = synthsRef.current.find(s => s.id === synthId)?.synthParams;
    if (!synthParams) return;
    endRecordedHold(synthId, note, true);
    liveArpRef.current!.release(synthId, note);
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

  // A device is given somewhere else to go. What a lane holds for it is let go first: the keys'
  // note-offs would otherwise arrive for a lane that no longer hears the device.
  // The lane a device's bend and wheel last reached, by the device's name: let go when the device
  // goes or is sent elsewhere. They are live gestures: nothing here is saved, undone or recorded.
  const liveLanesRef = useRef(new Map<string, number>());
  const releaseLiveGestures = useCallback((device: string) => {
    const synthId = liveLanesRef.current.get(device);
    if (synthId === undefined) return;
    liveLanesRef.current.delete(device);
    synthAudio.setLive(synthId, { bend: 0, wheel: 0 });
  }, [synthAudio]);
  const handleMidiDestinationChange = useCallback((device: string, place: MidiDestination) => {
    releaseLiveGestures(device);
    midiHeldRef.current.forEach((held, key) => {
      if (held.device !== device) return;
      midiHeldRef.current.delete(key);
      void handleNoteRelease(held.synthId, held.note);
    });
    const next = withDestination(midiDestinationsRef.current, device, place);
    midiDestinationsRef.current = next;
    storeMidiDestinations(next);
    setMidiDestinations(next);
  }, [handleNoteRelease, releaseLiveGestures]);

  const handleMidiMessage = useCallback((message: MidiMessage, source: MidiSource) => {
    if (message.type === 'noteOff') {
      // Release on the lane that took the note-on, even if the channel, the target or the device's
      // place changed since. A pad's note-off means nothing: no lane holds it.
      const heldKey = `${source.id}\n${message.channel}:${message.note}`;
      const held = midiHeldRef.current.get(heldKey);
      if (!held) return;
      midiHeldRef.current.delete(heldKey);
      void handleNoteRelease(held.synthId, held.note);
      return;
    }
    if (message.type === 'deviceGone') { releaseLiveGestures(source.name); return; }
    const place = destinationFor(midiDestinationsRef.current, source.name);
    if (place === 'off') return;
    // The lane a device's notes would go to, for its pitch bend and mod wheel; the drums and a lane the project lacks have none.
    const liveLane = (): number | null => {
      if (place === 'drums') return null;
      if (place === 'default') {
        if (message.channel !== midiChannelRef.current) return null;
        return (synthsRef.current.find(s => s.id === midiTargetSynthIdRef.current) ?? synthsRef.current[0])?.id ?? null;
      }
      return synthsRef.current.find(s => s.id === (place === 'open' ? selectedSynthIdRef.current : destinationLane(place)))?.id ?? null;
    };
    const gesture = (live: { bend?: number; wheel?: number }) => {
      const synthId = liveLane();
      if (synthId === null) return;
      const before = liveLanesRef.current.get(source.name);
      if (before !== undefined && before !== synthId) synthAudio.setLive(before, { bend: 0, wheel: 0 });
      liveLanesRef.current.set(source.name, synthId);
      synthAudio.setLive(synthId, live);
    };
    if (message.type === 'pitchBend') { gesture({ bend: message.value }); return; }
    if (message.type === 'controlChange') {
      // A knob on the controller. While a parameter is waiting to be learned, the first knob turned
      // is tied to it; otherwise a knob that is tied moves its parameter.
      const waiting = midiLearnRef.current;
      if (waiting) {
        setMidiTies(current => { const next = withTie(current, { channel: message.channel, controller: message.controller, target: waiting }); storeMidiTies(next); return next; });
        setMidiLearn(null);
        return;
      }
      const tie = tieFor(midiTiesRef.current, message.channel, message.controller);
      if (tie) applyParamTargetRef.current(tie.target, message.value / 127);
      else if (message.controller === 1) gesture({ wheel: message.value / 127 });
      return;
    }
    // While a drum is waiting to be learned, the first note played is its pad's from then on.
    const waitingPad = midiPadLearnRef.current;
    if (waitingPad) {
      const next = withPad(midiPadsRef.current, waitingPad, message.note);
      midiPadsRef.current = next;
      midiPadLearnRef.current = null;
      storePads(next);
      setMidiPads(next);
      setMidiPadLearn(null);
      return;
    }
    // A pad is a note on the drum channel, or any note from a device sent to the drums: it plays
    // its drum, and while recording it is written on the step being played. A note that is no drum
    // here does nothing. If the keyboard's channel is the drum channel too, the lane keeps it, as
    // it always had it.
    if (place === 'drums' || (place === 'default' && message.channel === midiDrumChannelRef.current && message.channel !== midiChannelRef.current)) {
      const instrument = drumForNote(message.note, midiPadsRef.current);
      const drums = drumStateRef.current;
      if (!instrument || !drums[instrument]) return;
      const velocity = Math.max(0.05, message.velocity / 127);
      const silenced = drums[instrument].muted || (Object.values(drums).some(track => track.solo) && !drums[instrument].solo);
      if (!silenced) void drumAudio.playDrumHit(instrument, drums[instrument].settings, velocity);
      const transport = transportRef.current;
      if (midiModeRef.current === 'record' && transport?.running && playhead.get('drums') >= 0) {
        // On the step the player is hearing, as a recorded note is: the scheduler is ahead of that.
        const context = getAudioContext();
        const { step } = recordPosition({
          heardTicks: transport.ticksAt(context.currentTime - (context.outputLatency || 0)), scheduledTicks: transport.scheduledTicks,
          playheadStep: playhead.get('drums'), ticksPerStep: 2, steps: drums[instrument].steps.length, strength: 1,
        });
        localService.applyAll([
          { type: 'drum.step', instrument, step, active: true },
          { type: 'drum.stepVelocity', instrument, step, velocity },
        ]);
      }
      return;
    }
    const noteName = midiNoteToName(message.note);
    // A device with a lane of its own plays it on every channel. A lane the project does not have
    // plays nothing.
    if (place === 'default' && message.channel !== midiChannelRef.current) return;

    const synthSnapshot = synthsRef.current;
    const targetSynth = place === 'default'
      ? synthSnapshot.find(s => s.id === midiTargetSynthIdRef.current) ?? synthSnapshot[0]
      : synthSnapshot.find(s => s.id === (place === 'open' ? selectedSynthIdRef.current : destinationLane(place)));
    if (!targetSynth) return;
    if (targetSynth.muted || (synthSnapshot.some(s => s.solo) && !targetSynth.solo)) return;

    const velocity = message.velocity / 127;
    const mode = midiModeRef.current;

    if (mode === 'live') {
      if (!targetSynth.synthParams) return;
      // Held under the device's key whether or not it is arpeggiated, so its note-off finds the lane.
      midiHeldRef.current.set(`${source.id}\n${message.channel}:${message.note}`, { synthId: targetSynth.id, note: noteName, device: source.name });
      if (targetSynth.synthParams.arpeggiator.enabled) {
        liveArpRef.current!.press(targetSynth.id, noteName, velocity, arpLane(targetSynth.id));
      } else {
        void synthAudio.playNote(noteName, targetSynth.synthParams, undefined, velocity, browserMutedRef.current, effectsLoopRef.current, globalTempo, targetSynth.id);
      }
      return;
    }

    const pattern = targetSynth.pattern;
    if (!pattern || pattern.steps.length === 0) return;

    if (mode === 'record') {
      // Written where it was played in the bar, moved to the nearest step by the quantize strength.
      if (targetSynth.isPlaying) recordNote(targetSynth.id, noteName, velocity);
      return;
    }
    // Keys pressed together are a chord: they go on the step the first of them landed on.
    const now = performance.now(), chord = midiChordRef.current;
    const joins = chord !== null && chord.synthId === targetSynth.id && now - chord.at < CHORD_WINDOW_MS;
    const stepIndex = joins ? chord.stepIndex : targetSynth.stepRecordPointer % pattern.steps.length;
    midiChordRef.current = { synthId: targetSynth.id, stepIndex, at: now };
    void upsertStepNote(targetSynth.id, stepIndex, noteName, velocity, joins);
  }, [handleNoteRelease, releaseLiveGestures, upsertStepNote, globalTempo, synthAudio, recordNote, drumAudio]);

  const midiState = useMidiInput({ onMessage: handleMidiMessage });

  // One parameter of a lane's pass written from the step it was last written at up to `step`:
  // the steps passed since then keep the value the knob was left at, and `step` takes `value`.
  const writePass = (lane: SynthState, pass: NonNullable<ReturnType<typeof autoPassRef.current.get>>, automation: Pattern['automation'], key: string, step: number, value: number) => {
    const pattern = lane.pattern!, length = pattern.steps.length, last = pass.step[key], now = transportRef.current?.scheduledTicks ?? 0;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    const patternTicks = length * barTicks(signature) / stepsPerBar(length, pattern.bars, signature);
    const passed = last === undefined ? [] : stepsThrough(last, step, length, now - pass.tick[key] >= patternTicks).filter(entry => entry !== step);
    const filled = passed.length > 0 ? withAutomationValues(automation, key, passed, pass.held[key], length) : automation;
    Object.assign(pass, { held: { ...pass.held, [key]: value }, step: { ...pass.step, [key]: step }, tick: { ...pass.tick, [key]: now } });
    return withAutomationValues(filled, key, [step], value, length);
  };

  // Ends every pass being recorded. With `write`, each knob that was turned is first written at
  // where it was left, up to the step being heard.
  endAutoPassesRef.current = (write) => {
    for (const [synthId, pass] of autoPassRef.current) {
      const lane = synthsRef.current.find(entry => entry.id === synthId), at = write ? recordedStep(synthId, 0) : null;
      if (!lane?.pattern || lane.pattern.id !== pass.patternId || !at) continue;
      const automation = Object.keys(pass.held).reduce((next, key) => writePass(lane, pass, next, key, at.step, pass.held[key]), lane.pattern.automation);
      localService.writePattern(synthId, lane.pattern.id, { automation: sentAutomation(automation) });
    }
    autoPassRef.current.clear();
    localService.holdUndo('auto', false);
  };

  // With Auto on and the lane playing, the automatable parameters a knob moves are written into
  // the pattern at the step being heard, and the lane's own sound keeps the value it had. What is
  // left of the change (anything that cannot be automated) is answered, to be made as it always
  // was; null when nothing is left. The whole pass is one undo step: the entry is made before its
  // first write. Nothing is recorded while the transport counts in.
  const recordAutomation = useCallback((synth: SynthState | undefined, patch: Partial<SynthParameters>): Partial<SynthParameters> | null => {
    if (!autoRecordingRef.current || !synth?.isPlaying || !synth.pattern || !synth.synthParams) return patch;
    const at = recordedStep(synth.id, 0);
    if (!at) return patch;
    const pattern = synth.pattern;
    const { moved, rest } = splitAutomated(patch, synth.synthParams, key => canAutomate(pattern.automation, key));
    if (Object.keys(moved).length === 0) return rest as Partial<SynthParameters> | null;
    let pass = autoPassRef.current.get(synth.id);
    if (!pass || pass.patternId !== pattern.id) {
      // The pass is one undo step, held open until the passes end.
      localService.holdUndo('auto', true);
      pass = { patternId: pattern.id, held: {}, step: {}, tick: {} };
      autoPassRef.current.set(synth.id, pass);
    }
    const recording = pass;
    const automation = Object.entries(moved).reduce((next, [key, value]) => writePass(synth, recording, next, key, at.step, value), pattern.automation);
    localService.writePattern(synth.id, pattern.id, { automation: sentAutomation(automation) });
    // Heard at once, not when the pattern next comes round to this step.
    synthAudio.automate(synth.id, synth.synthParams, globalTempoRef.current, stepVoiceParams(synth.synthParams, automation, at.step, globalTempoRef.current, recording.held),
      undefined, stepSends(synth.synthParams, automation, at.step, recording.held));
    return rest as Partial<SynthParameters> | null;
  }, [recordedStep, synthAudio]);

  // A change to a lane's own sound.
  const changeSound = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    localService.setSynthParams(synthId, params);
  }, []);

  // What a knob calls, on screen or on a controller: recorded as automation where Auto says so,
  // and otherwise a change to the sound. A preset is always the sound, and calls `changeSound`.
  const handleParameterChange = useCallback(async (synthId: number, params: Partial<SynthParameters>) => {
    const kept = recordAutomation(synthsRef.current.find((entry) => entry.id === synthId), params);
    if (kept) await changeSound(synthId, kept);
  }, [changeSound, recordAutomation]);

  // One parameter's automation drawn on some steps of a lane's pattern, or rubbed out of them
  // with null. Steps drawn one after another without a pause are one undo step, as a knob's turn is.
  const handleAutomationDraw = useCallback((synthId: number, key: string, steps: number[], value: number | null) => {
    const synth = synthsRef.current.find(entry => entry.id === synthId);
    if (!synth?.pattern) return;
    const automation = withAutomationValues(synth.pattern.automation, key, steps, value, synth.pattern.steps.length);
    if (automation === synth.pattern.automation) return;
    localService.undoAs(`automation:${synthId}:${key}`);
    localService.writePattern(synthId, synth.pattern.id, { automation: sentAutomation(automation) });
  }, []);

  const handleAutomationClear = useCallback((synthId: number, key: string) => {
    const synth = synthsRef.current.find(entry => entry.id === synthId);
    if (!synth?.pattern?.automation?.[key]) return;
    localService.writePattern(synthId, synth.pattern.id, { automation: sentAutomation(withoutAutomation(synth.pattern.automation, key)) });
  }, []);

  const handleSynthModelChange = useCallback(async (
    synthId: number,
    modelId: SynthModelId,
    modelParams?: Partial<SynthModelParams>
  ) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth) return;
    const normalizedModelId = normalizeSynthModelId(modelId);
    const normalizedModelParams = normalizeSynthModelParams({
      ...synth.synthModelParams,
      ...modelParams,
    });
    localService.setSynthModel(synthId, { modelId: normalizedModelId, modelParams: normalizedModelParams });
    // The macros' parameters went a turn later when these were requests, after React had rendered
    // the model for a click. A preset load pushes its second undo entry after this returns, and
    // that entry holds what was rendered then: the new model with the sound from before it.
    await Promise.resolve();
    // A lane moving to another model also has put back what the model it leaves may have set.
    const mapped = normalizedModelId !== synth.synthModelId
      ? enterSynthModel(normalizedModelId, normalizedModelParams, synth.synthModelId)
      : mapSynthModelToEngineParams(normalizedModelId, normalizedModelParams);
    if (Object.keys(mapped).length > 0) localService.setSynthParams(synthId, mapped);
  }, []);

  // How many steps a bar of the lane has: the bar's sixteenths, or twice that for finer steps.
  const handleStepCountChange = useCallback(async (synthId: number, stepCount: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    if (stepCount !== barSteps(signature) && stepCount !== barSteps(signature) * 2) return;
    const bars = laneBars(synth.pattern.steps.length, synth.pattern.bars, signature), perBar = synth.pattern.steps.length / bars;
    if (perBar === stepCount) return;

    // Each bar keeps its steps from the start of the bar; a finer grid adds empty steps after them.
    const nextSteps = clampLengths(Array.from({ length: stepCount * bars }, (_, i) => {
      const inBar = i % stepCount, source = inBar < perBar ? synth.pattern!.steps[Math.floor(i / stepCount) * perBar + inBar] : undefined;
      return source ? { ...source } : { active: false, velocity: 0.7 as const };
    }));
    const nextPattern = { ...synth.pattern, steps: nextSteps, automation: sentAutomation(resizeAutomationEachBar(synth.pattern.automation, perBar, stepCount)) };
    stepCount = nextSteps.length;

    playhead.set(synthId, playhead.get(synthId) % stepCount);
    setSynths(prev => prev.map(s => {
      if (s.id !== synthId) return s;
      const nextSelectedStep = s.selectedStep !== null && s.selectedStep >= stepCount ? null : s.selectedStep;
      return {
        ...s,
        selectedStep: nextSelectedStep,
      };
    }));
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);

  const handleStepVelocityChange = useCallback(async (synthId: number, stepIndex: number, velocity: number) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const normalizedVelocity = Math.max(0, Math.min(1, velocity));
    localService.undoAs(`step-velocity:${synthId}:${stepIndex}`);
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (
        index === stepIndex ? { ...step, velocity: normalizedVelocity } : step
      )),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);

  const handleStepSlideChange = useCallback(async (synthId: number, stepIndex: number, slide: boolean) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (index === stepIndex ? { ...step, slide } : step)),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);

  // How long a step's notes last: all of them, or with `note` given, that one note of its chord.
  const handleStepLengthChange = useCallback(async (synthId: number, stepIndex: number, length: number, note?: string) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    const current = synth?.pattern?.steps[stepIndex];
    if (!synth?.pattern || !current) return;
    const bounded = Math.max(1, Math.min(synth.pattern.steps.length - stepIndex, Math.round(length)));
    const changed = withStepLength(current, bounded, note);
    if ((changed.length ?? 1) === (current.length ?? 1) && JSON.stringify(changed.lengths ?? null) === JSON.stringify(current.lengths ?? null)) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => (index === stepIndex ? changed : step)),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);

  // Chance and repeats for one step.
  const handleStepDetailChange = useCallback(async (synthId: number, stepIndex: number, detail: { probability?: number; ratchet?: number; offset?: number; strum?: number }) => {
    const synth = synthsRef.current.find((entry) => entry.id === synthId);
    if (!synth?.pattern || !synth.pattern.steps[stepIndex]) return;
    const nextPattern = {
      ...synth.pattern,
      steps: synth.pattern.steps.map((step, index) => {
        if (index !== stepIndex) return step;
        const { probability, ratchet, offset, strum, ...rest } = { ...step, ...detail };
        return {
          ...rest,
          ...(strum !== undefined && strum > 0 ? { strum: Math.min(0.5, strum) } : {}),
          ...(offset !== undefined && offset > 0 ? { offset: Math.min(0.95, offset) } : {}),
          ...(probability !== undefined && probability < 1 ? { probability: Math.max(0, probability) } : {}),
          ...(ratchet !== undefined && ratchet > 1 ? { ratchet: Math.min(4, Math.round(ratchet)) } : {}),
        };
      }),
    };
    localService.writePattern(synthId, synth.pattern.id, nextPattern);
  }, []);

  // How many bars a lane's pattern lasts. A longer one starts as the old one repeated.
  const handleLaneBarsChange = useCallback(async (synthId: number, bars: number) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern || !BAR_CHOICES.some(choice => choice === bars)) return;
    const current = laneBars(synth.pattern.steps.length, synth.pattern.bars, signatureOfRef.current(currentSceneIdRef.current));
    if (current === bars) return;
    const perBar = synth.pattern.steps.length / current;
    const steps = clampLengths(resizeBars(synth.pattern.steps, perBar, bars, () => ({ active: false, velocity: 0.7 })));
    const { bars: _bars, ...rest } = synth.pattern;
    const nextPattern: Pattern = { ...rest, steps, ...(bars > 1 ? { bars } : {}), automation: sentAutomation(resizeAutomationBars(rest.automation, perBar, bars)) };
    playhead.set(synthId, playhead.get(synthId) % steps.length);
    setSynths(prev => prev.map(s => (s.id === synthId
      ? { ...s, selectedStep: s.selectedStep !== null && s.selectedStep >= steps.length ? null : s.selectedStep }
      : s)));
    // The store keeps the bar count it has when none is sent, so one bar is sent as 1.
    localService.writePattern(synthId, synth.pattern.id, { ...nextPattern, bars });
  }, []);

  const handleDrumBarsChange = useCallback(async (bars: number) => {
    localService.setDrumBars(bars);
  }, []);

  // Lays one bar of the drum grid over others, as one undo step.
  const handleCopyDrumBar = useCallback((from: number, to: number[]) => {
    if (!barTargets(drumBars(drumStateRef.current, signatureOfRef.current(currentSceneIdRef.current)), from, to)) return;
    localService.copyDrumBar(from, to);
  }, []);

  // Lays one bar of a lane's pattern over others, as one undo step. A note that was held past the
  // end of its bar is held as long in its new place, and stopped at the end of the pattern.
  const handleCopyLaneBar = useCallback((synthId: number, from: number, to: number[]) => {
    const synth = synthsRef.current.find(s => s.id === synthId);
    if (!synth?.pattern) return;
    const { steps } = synth.pattern;
    const signature = signatureOfRef.current(currentSceneIdRef.current);
    const targets = barTargets(laneBars(steps.length, synth.pattern.bars, signature), from, to);
    if (!targets) return;
    const perBar = stepsPerBar(steps.length, synth.pattern.bars, signature);
    localService.writePattern(synthId, synth.pattern.id, { ...synth.pattern, steps: clampLengths(copyBar(steps, perBar, from, targets)), automation: sentAutomation(copyAutomationBar(synth.pattern.automation, perBar, from, targets)) });
  }, []);

  const handleSynthMixChange = useCallback(async (synthId: number, mix: { muted?: boolean; solo?: boolean }) => {
    localService.setSynthMix(synthId, mix);
  }, []);

  const handleSynthSwingChange = useCallback((synthId: number, swing: boolean) => {
    localService.setSynthSwing(synthId, swing);
  }, []);

  // An empty name gives the lane back its number.
  const handleSynthRename = useCallback((synthId: number, name: string) => {
    localService.setSynthName(synthId, name);
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
    await changeSound(synthId, cloneSynthParams(preset.params) || DEFAULT_PARAMS);
    // After the model, which forgets the last preset's name when it changes.
    localService.setSynthPreset(synthId, preset.name);
  }, [synthPresets, changeSound, handleSynthModelChange]);

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
    await changeSound(synthId, cloneSynthParams(stored.params) || DEFAULT_PARAMS);
    setPresetImportReport({ name, source: preset.source, notes: preset.notes });
  }, [changeSound, handleSynthModelChange]);

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
      .map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!), muted: entry.muted, solo: entry.solo, swing: entry.swing }));
    downloadMidiFile(
      {
        tempo: globalTempo,
        synthLanes,
        drumState: cloneDrumState(drumStateRef.current),
        drumSwing,
        drumMasterVolume,
        signature: liveSceneRef.current().signature,
        ...(sceneBars(liveSceneRef.current()) > 1 ? {
          bars: sceneAsBars(liveSceneRef.current()).map(scene => ({ name: scene.name, signature: scene.signature, lanes: scene.lanes, drumState: sceneDrumState(scene, drumStateRef.current) })),
        } : {}),
      },
      `discobot-${Date.now()}.mid`
    );
  }, [globalTempo, drumSwing, drumMasterVolume]);

  const currentArrangement = useCallback((): ExportArrangement => ({
    tempo: globalTempoRef.current, synths: synthsRef.current, drumState: drumStateRef.current,
    drumKitId: selectedDrumKitIdRef.current, drumMasterVolume, drumSwing,
    drumFx: drumFxRef.current, effectsLoop: effectsLoopRef.current, drumSamples: { ...drumSamplesRef.current },
    synthSamples: { ...synthSamplesRef.current }, drumCymbals: cymbalsRef.current,
    ...(liveSceneRef.current().signature ? { signature: liveSceneRef.current().signature } : {}),
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
        synthLanes: synthsRef.current.filter((entry) => entry.pattern).map((entry) => ({ id: entry.id, pattern: clonePattern(entry.pattern!), muted: false, solo: false, swing: entry.swing })),
        bars: bars.map(scene => ({ name: scene.name, signature: scene.signature, lanes: scene.lanes, drumState: sceneDrumState(scene, kit) })),
      },
      `discobot-song-${Date.now()}.mid`
    );
  }, [songArrangement, drumSwing, drumMasterVolume]);

  // Adds another creator's instrument by its address. Typing it in is the user's say-so to load that site.
  const handleAddGuest = useCallback(async (url: string): Promise<string | null> => {
    // Recorded first: the unit appears as soon as the store accepts the guest, and must not ask again.
    const address = guestUrl(url, window.location.origin);
    if (address) trustOrigin(guestOrigin(address));
    const result = localService.addGuest(url);
    return result.ok ? null : result.error;
  }, []);
  const handleRemoveGuest = useCallback(async (id: string) => { localService.removeGuest(id); }, []);
  const handleGuestChange = useCallback(async (id: string, patch: GuestPatch) => { localService.changeGuest(id, patch); }, []);

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
  }, [drumSampleKey, drumAudio, sampleStoreVersion]);

  // The cymbals come with the app. Until they arrive the cymbal lane plays its synthesized voice.
  useEffect(() => {
    let current = true;
    void loadCymbals().then((cymbals) => {
      if (!current) return;
      cymbalsRef.current = cymbals;
      drumAudio.setCymbals(cymbals);
    });
    return () => { current = false; };
  }, [drumAudio]);

  // The same for the synth lanes: which recording each one's sample engine plays.
  const synthSampleKey = synths.map(entry => `${entry.id}:${entry.synthParams?.sample?.wave ?? ''}:${entry.synthParams?.sample?.id ?? ''}`).join('|');
  useEffect(() => {
    let current = true;
    void Promise.all(synthsRef.current.map(async (entry) => {
      return [entry.id, await loadLaneSample(entry.synthParams)] as const;
    })).then((loaded) => {
      if (!current) return;
      const next: Record<number, DrumSample> = {};
      for (const [laneId, sample] of loaded) {
        if (sample) next[laneId] = sample;
        if (sample !== (synthSamplesRef.current[laneId] ?? null)) synthAudio.setSample(laneId, sample);
      }
      // A lane that has gone gives its recording back, so a lane added later under its number starts with none.
      for (const laneId of Object.keys(synthSamplesRef.current).map(Number)) {
        if (!loaded.some(([present]) => present === laneId)) synthAudio.setSample(laneId, null);
      }
      synthSamplesRef.current = next;
    });
    return () => { current = false; };
  }, [synthSampleKey, synthAudio, sampleStoreVersion]);

  const handleDrumSampleChange = useCallback(async (instrument: DrumInstrument, sampleId: string | null) => {
    localService.setDrumSample(instrument, sampleId ?? undefined);
  }, []);

  // Every audio export. With guests in the project the arrangement is first played through in
  // real time so their sound can be recorded; then the export is rendered as usual. A loop is
  // played through twice and the second pass kept: by then what rings on from the end of the
  // pattern is sounding over its start, which is what makes the loop seamless.
  const exportWav = useCallback(async (kind: boolean | 'pattern' | 'song' | 'loop' | 'stems', onPart: (part: string) => void) => {
    const wholeSong = kind === true || kind === 'song', loop = kind === 'loop';
    let arrangement: ExportArrangement = wholeSong ? await songArrangement() : currentArrangementRef.current();
    // A song gives each guest its scene's own level and mute bar by bar, so a guest is recorded
    // if any scene of the song plays it, whatever the open scene says.
    const songGains = wholeSong && arrangement.bars ? new Map(guestsRef.current.map(guest => [guest.id, guestBarGains(arrangement.bars!, guest)])) : null;
    const audible = guestsRef.current.filter(guest => songGains ? songGains.get(guest.id)!.some(gain => gain > 0) : !guest.muted && guest.volume > 0);
    // A voice with a guest is heard through the guest, in the take, and left out of the render.
    // Without a play-through it is with a guest that is silent, as it is when playing.
    handedByBarRef.current = [guestInputs.all().map(entry => entry.source)];
    if (audible.length > 0 && !guestCapture.active()) {
      // How long what is exported lasts: its bars, each as long as its scene's time signature makes it.
      const wholes = arrangementWholes(arrangement);
      const passFrames = loopPass(globalTempoRef.current, 44100, wholes).frames;
      const seconds = (loop ? 2 : 1) * wholes * 240 / globalTempoRef.current;
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const mode = playModeRef.current, startEntry = songStartEntryRef.current;
      try {
        if (synthsRef.current.some(synth => synth.isPlaying)) { await handleGlobalPlayStopRef.current(); await sleep(150); }
        setGuestRecording(seconds);
        // Each bar the play-through schedules says which voices are with a guest, from the first.
        handedByBarRef.current = [];
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
        arrangement = {
          ...arrangement,
          guestTakes: audible.flatMap(guest => {
            const take = takes.get(guest.id);
            if (!take) return [];
            const [left, right] = [take.left, take.right].map(channel => (loop ? channel.slice(passFrames, passFrames * 2) : channel));
            return [{ left, right, gain: guest.volume, ...(songGains ? { gains: songGains.get(guest.id) } : {}), name: guest.name, ...(guest.sends ? { sends: guest.sends } : {}) }];
          }),
        };
      } finally {
        guestCapture.stop();
        setGuestRecording(null);
        setPlayMode(mode);
        setSongStartEntry(startEntry);
      }
    }
    arrangement = leaveOutHanded(arrangement, handedByBarRef.current);
    if (kind === 'stems') await downloadStemsZip(arrangement, (done, total) => onPart(`file ${done + 1} of ${total}`));
    else await downloadArrangementWav(arrangement, loop ? { loop: true } : {});
  }, [songArrangement]);

  const handleExportWav = useCallback(async (kind: boolean | 'pattern' | 'song' | 'loop' | 'stems') => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    const what = kind === true || kind === 'song' ? 'Song WAV' : kind === 'loop' ? 'Loop WAV' : kind === 'stems' ? 'Stems' : 'Scene WAV';
    setExportStatus({ phase: 'working', what });
    // A moment for the message to be painted before the render takes the page's thread.
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      await exportWav(kind, part => setExportStatus({ phase: 'working', what, part }));
      setExportStatus({ phase: 'done', what });
      doneTimerRef.current = setTimeout(() => setExportStatus(null), 12000);
    } catch (error) {
      setExportStatus(null);
      throw error;
    } finally {
      exportingRef.current = false;
    }
  }, [exportWav]);
  const dismissExportStatus = useCallback(() => setExportStatus(null), []);

  const reportExportError = useCallback((error: unknown) => {
    setStorageError(`Audio export failed: ${error instanceof Error ? error.message : error}`);
  }, []);

  // The one place a project gains its samples' audio: a file saved to disk.
  const handleExportProject = useCallback(async () => {
    const file = {
      ...localService.exportProject(),
      synthPresets: synthPresets.filter(preset => !preset.builtIn).map(({ id, name, params, modelId, modelParams }) => ({ id, name, params, modelId, modelParams })),
    };
    const plain = JSON.stringify(file);
    // What base64 audio still fits under the size an import accepts, as bytes of audio.
    const room = Math.floor((MAX_PROJECT_FILE_BYTES - new Blob([plain]).size - 65536) * 3 / 4);
    const audio = await embedSamples(file.project, undefined, Math.max(0, Math.min(MAX_EMBEDDED_TOTAL_BYTES, room))).catch(() => null);
    downloadFile(audio?.samples.length ? JSON.stringify({ ...file, samples: audio.samples }) : plain, 'application/json', `discobot-project-${new Date().toISOString().slice(0, 10)}.json`);
    if (!audio) setStorageError('The project file was saved without its samples: sample storage could not be read.');
    else if (audio.skipped.length > 0) setStorageError(`The project file was saved without ${audio.skipped.join(', ')}: too large to put in a project file. Shorter samples are included.`);
  }, [synthPresets]);

  // Before the open project is swapped for another: stop sound, and forget undo steps that belong to it.
  const leaveProject = useCallback(() => {
    transportRef.current?.stop();
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
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
    if (file.size > MAX_PROJECT_FILE_BYTES) {
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
    // Only a file brings audio, and only one that will open: a link or a published song never does.
    const adopted = localService.readProjectFile(parsed).ok ? await adoptSamples(parsed) : { file: parsed, added: 0, dropped: 0 };
    const opened = await handleImportProject(adopted.file);
    if (adopted.added > 0) setSampleStoreVersion(version => version + 1);
    if (opened && adopted.dropped > 0) {
      setStorageError(`The project was opened, but ${adopted.dropped === 1 ? 'one of its samples' : `${adopted.dropped} of its samples`} could not be read from the file. Those lanes play their built-in sound.`);
    }
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
      const synthIds = LANE_IDS;
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

  // An import waits for lanes to be made between its edits, and is still one undo step.
  const handleMidiImportApplyAll = useCallback(async () => {
    if (!midiImportData) return;
    localService.holdUndo('midi-import', true);
    try { await importMidi(); } finally { localService.holdUndo('midi-import', false); }
  }, [midiImportData, midiImportAssignments, ensureSynthExists]);

  const importMidi = async () => {
    if (!midiImportData) return;
    const tempo = midiImportData.detectedTempo;
    const importedDrums = midiImportData.tracks.filter((track, i) => track.drums && midiImportAssignments[i] === 'drums');
    // A MIDI file is read as 4/4. In a scene of another time signature its steps are laid from the
    // start along that scene's bars, as many as hold them, and what is past the eighth is left out.
    const bar = barSteps(signatureOfRef.current(currentSceneIdRef.current)), plain = bar === barSteps();
    const blankStep = (): SequencerStep => ({ active: false, velocity: 0.7 });

    for (const [i, track] of midiImportData.tracks.entries()) {
      const synthId = midiImportAssignments[i];
      if (typeof synthId !== 'number' || !track.pattern) continue;
      if (!await ensureSynthExists(synthId)) continue;
      const current = synthsRef.current.find(s => s.id === synthId)?.pattern;
      if (!current) continue;
      // Replace the lane's steps in place so repeated imports do not pile up stored patterns.
      const { bars: _bars, ...rest } = current;
      const fine = track.pattern.steps.length / (track.pattern.bars ?? 1) > barSteps() ? 2 : 1;
      const laid = plain ? { items: track.pattern.steps, bars: track.pattern.bars ?? 1 } : relayBars(track.pattern.steps, bar * fine, blankStep);
      // The store keeps the bar count it has when none is sent, so one bar is sent as 1.
      // The lane's automation belonged to the notes that are being replaced, and goes with them.
      const pattern: Pattern = { ...rest, steps: plain ? laid.items : clampLengths(laid.items), tempo, bars: laid.bars, automation: sentAutomation(undefined) };
      setSynths(prev => prev.map(s =>
        s.id === synthId ? { ...s, selectedStep: null } : s
      ));
      localService.writePattern(synthId, pattern.id, pattern);
    }

    if (importedDrums.length > 0) {
      const next = cloneDrumState(drumStateRef.current);
      for (const instrument of Object.keys(next) as DrumInstrument[]) {
        const lanes = importedDrums.map(track => track.drums![instrument]);
        // The grid takes the file's length. Chance and repeats belonged to the steps being replaced.
        const steps = lanes[0].steps.map((_, step) => lanes.some(lane => lane.steps[step]));
        const velocities = steps.map((_, step) => lanes.find(lane => lane.steps[step])?.stepVelocities[step] ?? 1);
        next[instrument].steps = plain ? steps : relayBars(steps, bar, () => false).items;
        next[instrument].stepVelocities = plain ? velocities : relayBars(velocities, bar, () => 1).items;
        delete next[instrument].stepProbabilities;
        delete next[instrument].stepRatchets;
      }
      localService.setDrumState(next);
    }

    localService.setTempo(tempo);
    setMidiImportData(null);
    setMidiImportAssignments({});
  };

  useEffect(() => {
    const data = localService.getDrumKits();
    setDrumKits(data.kits);
    const hasSelected = data.kits.some((kit) => kit.id === selectedDrumKitIdRef.current);
    if (!hasSelected) setSelectedDrumKitId(data.defaultKitId);
  }, []);

  // The kit and the drums are applied by the drumKitChanged event. The answer is handed back
  // for the caller to audition: its own copy of the drums is from before the change.
  const handleDrumKitChange = useCallback(async (kitId: DrumKitId, applyDefaults: boolean): Promise<DrumState | undefined> => {
    const result = localService.setDrumKit(kitId, applyDefaults);
    return result.ok ? result.value.drumState : undefined;
  }, []);

  const handleDrumStepToggle = useCallback((instrument: DrumInstrument, step: number, active: boolean) => {
    localService.setDrumStep(instrument, step, active);
  }, []);

  const handleDrumStepVelocity = useCallback((instrument: DrumInstrument, step: number, velocity: number) => {
    localService.setDrumStepVelocity(instrument, step, velocity);
  }, []);

  const handleDrumStepDetail = useCallback((instrument: DrumInstrument, step: number, detail: { probability?: number; ratchet?: number }) => {
    localService.setDrumStepDetail(instrument, step, detail);
  }, []);

  const handleDrumSettingsChange = useCallback((instrument: DrumInstrument, settings: Partial<DrumSettings>) => {
    const synth = synthsRef.current[0];
    if (synth?.pattern) {
    }
    localService.setDrumSettings(instrument, settings);
  }, []);

  const handleDrumMixChange = useCallback((instrument: DrumInstrument, mix: { muted?: boolean; solo?: boolean }) => {
    localService.setDrumMix(instrument, mix);
  }, []);

  const handleDrumReset = useCallback(() => {
    localService.resetDrums();
  }, []);

  // Fills an empty project with a starting point: its tempo, a bar of drums and a bass line on
  // the first lane. It is one edit, so one undo takes all of it back.
  const handleStarter = useCallback((starterId: string) => {
    const starter = STARTERS.find(entry => entry.id === starterId);
    const synth = synthsRef.current[0];
    if (!starter || !synth?.pattern) return;
    localService.applyAll([
      { type: 'tempo.set', tempo: starter.tempo },
      { type: 'drum.state', state: starterDrums(starter, drumStateRef.current, signatureOfRef.current(currentSceneIdRef.current)) },
      { type: 'pattern.write', synthId: synth.id, patternId: synth.pattern.id, patch: { steps: starterPattern(starter, synth.pattern, signatureOfRef.current(currentSceneIdRef.current)).steps, automation: sentAutomation(undefined) } },
    ]);
  }, []);

  // One part of the open scene into another scene. It is not an edit to the open scene, so it is not
  // in the undo history; the control that calls this asks first when it would replace something.
  const handleCopyPartToScene = useCallback((toSceneId: string, part: { synthId?: number; drum?: DrumInstrument }) => {
    const result = localService.copyPartToScene(toSceneId, part);
    if (!result.ok) setStorageError(result.error ?? 'That could not be copied.');
  }, []);

  // The sample song is a project of its own, opened as a file is: nothing here is changed.
  // One of the sample songs, by its id, opened as a new project of its own.
  const handleSampleSong = useCallback(async (id: string) => {
    const song = SAMPLE_SONGS.find(entry => entry.id === id);
    const file = song && buildSampleSong(localService.exportProject(), createBuiltInPresets(), song);
    if (!file) { setStorageError('The sample song could not be made.'); return; }
    if (await handleImportProject(file)) setPlayMode('song');
  }, [handleImportProject]);

  // The offer is decided when a project is opened and found empty, and it leaves only by its own
  // Hide button. It must not go away because a note was put in: that would move the whole rack
  // under the pointer that had just put it in.
  const [showStarters, setShowStarters] = useState(false);
  useEffect(() => {
    setShowStarters(projectOpens > 0 && projectIsEmpty(synthsRef.current.map(synth => synth.pattern), drumStateRef.current, scenesRef.current.length));
  }, [projectOpens]);
  const dismissStarters = useCallback(() => setShowStarters(false), []);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    localService.setDrumMasterVolume(volume);
    }, []);

  const handleDrumSwingChange = useCallback((swing: number) => {
    localService.setDrumSwing(swing);
  }, []);

  const handleDrumFxChange = useCallback((next: Partial<{ sends: Partial<FxSendLevels>; returnLevel: number }>) => {
    const previous = drumFxRef.current;
    const updated = normalizeDrumFx({
      sends: { ...previous.sends, ...(next.sends || {}) },
      returnLevel: next.returnLevel ?? previous.returnLevel,
    });
    localService.setDrumFx(updated);
  }, []);

  const handleEffectsLoopChange = useCallback((next: Partial<EffectsLoopState>) => {
    const previous = effectsLoopRef.current;
    const updated = normalizeEffectsLoop({
      ...previous,
      ...next,
    });
    localService.setEffectsLoop(updated);
  }, []);

  const handleDrumMuteAll = useCallback((muted: boolean) => {
    const nextState = Object.fromEntries(
      (Object.keys(drumStateRef.current) as DrumInstrument[]).map(inst => [
        inst,
        { ...drumStateRef.current[inst], muted },
      ])
    ) as DrumState;
    localService.setDrumState(nextState);
  }, []);

  const handleDrumSoloAll = useCallback(() => {
    const nextState = Object.fromEntries(
      (Object.keys(drumStateRef.current) as DrumInstrument[]).map(inst => [
        inst,
        { ...drumStateRef.current[inst], solo: false },
      ])
    ) as DrumState;
    localService.setDrumState(nextState);
  }, []);

  // Everything back to a new project's, as one undo step.
  const handleReset = useCallback(async () => {
    localService.holdUndo('reset', true);
    try { reset(); } finally { localService.holdUndo('reset', false); }
  }, [handleDrumReset, synthAudio, drumAudio]);

  const reset = () => {
    synthAudio.stopAllNotes();
    drumAudio.stopAllNotes();
    transportRef.current?.stop();
    const currentSynths = synthsRef.current;
    for (const synth of currentSynths) {
      localService.setSynthParams(synth.id, DEFAULT_PARAMS);
      localService.setSynthModel(synth.id, { modelId: DEFAULT_SYNTH_MODEL_ID, modelParams: createDefaultSynthModelParams() });
      localService.setSynthMix(synth.id, { muted: false, solo: false });
      if (synth.pattern) {
        const cleared = {
          ...synth.pattern,
          steps: synth.pattern.steps.map(s => ({ ...s, active: false, note: undefined })),
          automation: sentAutomation(undefined),
        };
        localService.writePattern(synth.id, synth.pattern.id, cleared);
      }
      if (synth.isPlaying) {
        localService.stopLane(synth.id);
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
      selectedStep: null,
      stepRecordPointer: 0,
      muted: false,
      solo: false,
      forceReleaseSignal: !s.forceReleaseSignal,
    })));
    localService.setDrumFx(DEFAULT_DRUM_FX);
    localService.setEffectsLoop(DEFAULT_EFFECTS_LOOP);
    handleDrumReset();
    // Back to a single empty scene, taken from the lanes and drums that were just cleared.
    localService.replaceScenes();
  };

  const memoizedDrumState = useMemo(() => drumState, [drumState]);

  const isAnyPlaying = synths.some(s => s.isPlaying);

  // Sets a parameter by its name (services/paramTargets) from a position along a knob's travel.
  // It goes through the same handlers the knobs on screen call, so undo, saving and the sound
  // treat a controller's knob and the screen's alike.
  applyParamTargetRef.current = (target, unit) => {
    const parsed = parseTarget(target);
    if (!parsed) return;
    const value = fromUnit(parsed.range, unit);
    if (parsed.kind === 'tempo') void handleTempoChange(value);
    else if (parsed.kind === 'drumsMaster') handleDrumMasterVolumeChange(value);
    else if (parsed.kind === 'drumsSwing') handleDrumSwingChange(value);
    else if (parsed.kind === 'drum') handleDrumSettingsChange(parsed.instrument, { [parsed.key]: value });
    else if (parsed.kind === 'fx' && (parsed.effect === 'auxA' || parsed.effect === 'auxB')) {
      // The buses are a list, A then B; each is changed whole, as its own knobs do.
      const slot = parsed.effect === 'auxA' ? 0 : 1;
      handleEffectsLoopChange({ aux: auxBuses(effectsLoopRef.current.aux).map((bus, index) => (index === slot ? { ...bus, [parsed.field]: value } : bus)) });
    } else if (parsed.kind === 'fx') {
      const loop = effectsLoopRef.current as unknown as Record<string, Record<string, unknown>>;
      handleEffectsLoopChange({ [parsed.effect]: { ...loop[parsed.effect], [parsed.field]: value } } as Partial<EffectsLoopState>);
    } else if (parsed.kind === 'lane') {
      const synthId = parsed.lane === 'open' ? selectedSynthIdRef.current : parsed.lane;
      const synth = synthsRef.current.find(entry => entry.id === synthId);
      if (!synth) return;
      const macro = LANE_PARAMS[parsed.key].macro;
      if (macro) void handleSynthModelChange(synth.id, synth.synthModelId, { [macro]: value });
      else { const patch = lanePatch(parsed.key, value); if (patch) void handleParameterChange(synth.id, patch as Partial<SynthParameters>); }
    }
  };

  return {
    midiTies, midiLearn, handleMidiLearn, handleMidiTieRemove,
    midiPads, midiPadLearn, handleMidiPadLearn, handleMidiPadsReset, midiDestinations, handleMidiDestinationChange,
    handleCopyPartToScene, handleStarter, handleSampleSong, dismissStarters, showStarters, metronome, handleMetronomeChange,
    synths, selectedSynthId, setSelectedSynthId, drumState: memoizedDrumState, drumKits,
    selectedDrumKitId, drumMasterVolume, drumSwing, drumFx, effectsLoop, browserMuted, setBrowserMuted,
    browserVolume, setBrowserVolume, globalTempo, storageError, setStorageError, changedElsewhere, loadOtherTabVersion, keepThisTabVersion, helpOpen, setHelpOpen, midiMode, setMidiMode,
    recording, setRecording, autoRecording, setAutoRecording, handleAutomationDraw, handleAutomationClear, quantize, setQuantize, midiChannel, setMidiChannel, midiDrumChannel, setMidiDrumChannel, midiOutNotes, setMidiOutNotes, midiOutClock, setMidiOutClock, midiTargetSynthId, setMidiTargetSynthId, projectId, projectName, projects, synthPresets, drumAudio,
    handleUndo, handleRedo, midiImportData, setMidiImportData, midiImportAssignments, setMidiImportAssignments,
    handleMidiImportClick, handleMidiImportFile, handleMidiImportApplyAll, midiImportFileRef, handleRemoveSynth,
    ensureSynthExists, handleOctaveShift, handleTempoChange, handleGlobalPlayStop, handleStepChange, handleStepSelect, handleKeyboardModeChange,
    handlePianoRollNoteAssign, handleClearPatternNotes, handleCopyLaneBar, handleCopyDrumBar, handleTransposeLane, handleRandomizeLane, handleNotePlay, handleNoteRelease, computerKeyNotes, midiState,
    handleParameterChange, handleSynthModelChange, handleStepCountChange, handleStepVelocityChange, handleStepSlideChange, handleStepLengthChange, handleStepDetailChange, guests, handleAddGuest, handleRemoveGuest, handleGuestChange, guestRecording, handleExportWav, exportStatus, dismissExportStatus, missingDrumSamples, sampleStoreVersion, handleDrumSampleChange, handleLaneBarsChange, handleDrumBarsChange, sceneLength,
    handleSynthMixChange, handleSynthSwingChange, handleSynthRename, handleSaveSynthPreset, handleLoadSynthPreset, handleDeleteSynthPreset,
    handleExportMidi, currentArrangement, reportExportError, handleExportProject, projectImportFileRef, handleImportProjectFile, handleImportProject,
    handleNewProject, handleOpenProject, handleCopyProject, handleRenameProject, handleDeleteProject, handleRestoreVersion, handleCopyVersion, handleImportSynthPreset, handleExportSynthPreset, presetImportReport, setPresetImportReport, handleDrumKitChange, handleDrumStepToggle, handleDrumStepVelocity, handleDrumStepDetail,
    handleDrumSettingsChange, handleDrumMixChange, handleDrumReset, handleDrumMasterVolumeChange, handleDrumSwingChange,
    handleDrumFxChange, handleEffectsLoopChange, handleDrumMuteAll, handleDrumSoloAll, handleReset,
    scenes, currentSceneId, song, playMode, setPlayMode, songStartEntry, setSongStartEntry, songPosition,
    handleSceneSelect, handleSceneAdd, handleSceneRename, handleSceneColor, handleSceneSignature, handleSceneDelete, handleSongChange, songArrangement, handleExportSongMidi,
    // The open scene's time signature, and any scene's by its id.
    signature: timeSignature(scenes.find(scene => scene.id === currentSceneId)?.signature), sceneSignature,
    isAnyPlaying,
  };
}

export type Studio = ReturnType<typeof useStudio>;
