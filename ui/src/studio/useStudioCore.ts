// The studio's state and refs, made in one place and handed out as one object (`StudioCore`), so
// the hooks each concern of the studio lives in can be given what they read. Split out of useStudio.tsx.
import { useState, useRef } from 'react';
import { audioEngine, type AudioEngine } from '../hooks/browserAudio';
import { useSynthAudio } from '../hooks/useSynthAudio';
import { useDrumAudio } from '../hooks/useDrumAudio';
import { MidiMode } from '../hooks/useMidiInput';
import { DrumState, DrumInstrument, DrumKitDefinition, DrumKitId, Scene, Song, TimeSignature } from '../types';
import { SongPosition } from '../services/songPlayback';
import { loadCymbals } from '../services/builtInWaves';
import { type ImportedPreset } from '../services/presetImport';
import type { DrumSample } from '../../../engine/src/drums/DrumCore';
import { type Guest } from '../services/guests';
import type { ProjectInfo } from '../services/projectLibrary';
import { createBuiltInPresets } from '../services/builtInPresets';
import { DEFAULT_DRUM_CHANNEL, storedPads, type PadMap } from '../services/midiDrums';
import { storedMidiDestinations, type MidiDestinations } from '../services/midiDevices';
import { DEFAULT_QUANTIZE } from '../services/recordTiming';
import { storedMidiTies, type MidiTie } from '../services/midiTies';
import { storedMetronome, type MetronomeSettings } from '../services/metronome';
import { BrowserTransport, TransportTick } from '../services/browserTransport';
import { ExportArrangement } from '../services/wavExport';
import { LiveArp } from '../services/liveArp';
import { MidiImportResult } from '../utils/midiImport';
import { DEFAULT_DRUM_FX, DEFAULT_EFFECTS_LOOP, DEFAULT_DRUM_KIT_ID, createDefaultDrumState } from './studioState';
import type { SynthPreset, PlayMode, SynthState, ExportStatus } from './studioState';
import type { SwingGrid } from '../services/grooves';
import type { AudioTrack } from '../services/audioTracks';
import type { MidiOutChannels } from '../services/midiOutput';
export type { PlayMode } from './studioState';

// `engine` is the one that plays everything: the app's, unless another is given (a test's, say).
export function useStudioCore(engine: AudioEngine = audioEngine) {
  // The audio of the lanes and of the drums.
  const synthAudio = useSynthAudio(engine);
  const drumAudio = useDrumAudio(engine);
  const [synths, setSynths] = useState<SynthState[]>([]);
  const [selectedSynthId, setSelectedSynthId] = useState(1);
  const selectedSynthIdRef = useRef(selectedSynthId);
  const [drumState, setDrumState] = useState<DrumState>(createDefaultDrumState);
  const [drumKits, setDrumKits] = useState<DrumKitDefinition[]>([]);
  const [selectedDrumKitId, setSelectedDrumKitId] = useState<DrumKitId>(DEFAULT_DRUM_KIT_ID);
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const [drumSwing, setDrumSwing] = useState(0);
  // Which steps the swing moves (services/grooves.ts): sixteenths unless the project says eighths.
  const [drumSwingGrid, setDrumSwingGrid] = useState<SwingGrid>(16);
  // The order the lanes are shown in, when the project has one (roadmap 20).
  const [laneOrder, setLaneOrder] = useState<number[] | undefined>(undefined);
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
  // Audio tracks on the timeline (services/audioTracks.ts), as the store holds them.
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  // Set while an export is playing the arrangement through to record its guests: how long it will take.
  const [guestRecording, setGuestRecording] = useState<number | null>(null);
  // An audio export in progress, or just finished. handleExportWav refuses a second while one is working.
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const exportingRef = useRef(false);
  // The metronome is this browser's, not the project's. The scheduler reads the ref.
  const [metronome, setMetronome] = useState<MetronomeSettings>(storedMetronome);
  const metronomeRef = useRef(metronome);
  // The count-in of the run that is playing: how many ticks it lasts, and whose bar it counts.
  const countInRef = useRef<{ ticks: number; signature: unknown }>({ ticks: 0, signature: undefined });
  // In scene mode, where the bars are counted from: a bar's length changes when another scene is
  // opened or this one's time signature is changed, and a new bar starts there.
  const barAnchorRef = useRef({ tick: 0, bar: 0, perBar: 0 });
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guestsRef = useRef<Guest[]>([]);
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
  const [midiLearn, setMidiLearn] = useState<string | null>(null);
  const midiLearnRef = useRef(midiLearn);
  const applyParamTargetRef = useRef<(target: string, unit: number) => void>(() => {});
  // The note each drum's pad sends and where each device's notes go, both kept for this browser
  // like the ties, and the drum waiting for a pad to be hit. One Learn waits at a time, a knob's
  // or a pad's: asking for either calls the other off.
  const [midiPads, setMidiPads] = useState<PadMap>(storedPads);
  const midiPadsRef = useRef(midiPads);
  const [midiPadLearn, setMidiPadLearn] = useState<DrumInstrument | null>(null);
  const midiPadLearnRef = useRef(midiPadLearn);
  const [midiDestinations, setMidiDestinations] = useState<MidiDestinations>(storedMidiDestinations);
  const midiDestinationsRef = useRef(midiDestinations);
  // Recording from the on-screen and computer keyboards, and how firmly a recorded note is moved
  // onto the nearest step. Both are for the session, like the MIDI settings.
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(recording);
  const [quantize, setQuantizeValue] = useState(DEFAULT_QUANTIZE);
  const quantizeRef = useRef(quantize);
  // Auto: while the song plays, a knob turned on a lane is written into its pattern as automation
  // and the lane's own sound is left as it is. For the session, like Rec.
  const [autoRecording, setAutoRecordingValue] = useState(false);
  const autoRecordingRef = useRef(autoRecording);
  // The pass being recorded on each lane, from the first knob turned to Stop or Auto being switched
  // off: for each parameter turned, the value its knob is at (`held`, which the scheduler plays in
  // place of what the pattern holds), and the step and the transport tick it was last written at.
  const autoPassRef = useRef(new Map<number, { patternId: string; held: Record<string, number>; step: Record<string, number>; tick: Record<string, number> }>());
  const endAutoPassesRef = useRef<(write: boolean) => void>(() => {});
  const [midiChannel, setMidiChannel] = useState(1);
  // The channel pads are listened to on, for the drums. A keyboard on one channel and pads on
  // another play a lane and the drums at once. 0 is none.
  const [midiDrumChannel, setMidiDrumChannel] = useState(DEFAULT_DRUM_CHANNEL);
  const midiDrumChannelRef = useRef(midiDrumChannel);
  // What the sequencer sends to the chosen MIDI output. Kept for the session only.
  const [midiOutNotes, setMidiOutNotes] = useState(true);
  const [midiOutClock, setMidiOutClock] = useState(false);
  // Sending notes played by hand to the MIDI output, and the channel each part goes out on (session settings).
  const [midiOutPlayed, setMidiOutPlayed] = useState(false);
  const [midiOutChannels, setMidiOutChannels] = useState<MidiOutChannels>({});
  // Following another device's MIDI clock: its start and stop, and its tempo, which is held here
  // and never put in the project.
  const [midiFollowClock, setMidiFollowClock] = useState(false);
  const [externalTempo, setExternalTempo] = useState<number | null>(null);
  const midiFollowClockRef = useRef(false);
  const externalTempoRef = useRef<number | null>(null);
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
  const browserMutedRef = useRef(browserMuted);
  // Assigned here, and moved on by the handlers of the store's pattern events (and of the scene,
  // lane and transport events), so that the scheduler and a handler making a second edit before
  // React has rendered see the first.
  const synthsRef = useRef(synths);
  const midiModeRef = useRef(midiMode);
  const midiChannelRef = useRef(midiChannel);
  const midiTargetSynthIdRef = useRef(midiTargetSynthId);
  // Assigned here, and again by the handlers of the store's drum events, so that the scheduler
  // and a handler making a second edit before React has rendered see the first.
  const drumStateRef = useRef(drumState);
  const selectedDrumKitIdRef = useRef(selectedDrumKitId);
  const drumFxRef = useRef(drumFx);
  const effectsLoopRef = useRef(effectsLoop);
  // Notes a lane is holding for a MIDI device, by device, channel and note.
  const midiHeldRef = useRef(new Map<string, { synthId: number; note: string; device: string }>());
  const midiChordRef = useRef<{ synthId: number; stepIndex: number; at: number } | null>(null);
  const globalTempoRef = useRef(globalTempo);
  const drumSwingRef = useRef(drumSwing);
  const drumSwingGridRef = useRef(drumSwingGrid);
  const audioTracksRef = useRef(audioTracks);
  const projectIdRef = useRef(projectId);
  const scenesRef = useRef(scenes);
  const currentSceneIdRef = useRef(currentSceneId);
  const songRef = useRef(song);
  const playModeRef = useRef(playMode);
  const songStartEntryRef = useRef(songStartEntry);
  const currentArrangementRef = useRef<() => ExportArrangement>(() => { throw new Error('not ready'); });
  const songStartTickRef = useRef(0);
  const signatureOfRef = useRef<(sceneId: string) => TimeSignature | undefined>(() => undefined);
  const songEndingRef = useRef(false);
  const stopPlaybackRef = useRef<() => void>(() => {});
  const handleGlobalPlayStopRef = useRef<() => Promise<void>>(async () => {});
  // A live session's music (liveSession.ts): where the first tick of a start someone else chose
  // falls on this computer's clock, with their count-in; and when this browser's Play was pressed,
  // so the start it makes is told to the others.
  const liveStartRef = useRef<{ wall: number; countIn: number } | null>(null);
  const announceRef = useRef(0);
  const transportRef = useRef<BrowserTransport | null>(null);
  const liveSceneRef = useRef<() => Scene>(() => ({ id: '', name: '', lanes: {}, drums: createDefaultDrumState() }));
  const sceneLengthRef = useRef<(sceneId: string) => number>(() => 1);
  const scheduleTickRef = useRef<(tick: TransportTick) => void>(() => {});
  const initializedSynthLanesRef = useRef(false);
  const [midiImportData, setMidiImportData] = useState<MidiImportResult | null>(null);
  // The user's own presets are read once the page is up. Until they have been, nothing is
  // written back: the first render has none, and saving that would replace what is stored.
  const presetsLoadedRef = useRef(false);
  // Keys held under a lane's arpeggiator: it runs while they are down, read from the lane each beat.
  const liveArpRef = useRef<LiveArp | null>(null);
  // Lights a step when it is heard. The scheduler is a moment ahead of the sound, and further ahead
  // while a voice is handed to a guest; a light that early would be seen to lead the beat.
  const handedByBarRef = useRef<string[][]>([]);
  // Recorded keys still down, by lane and note: where each went down, so that letting it go can give
  // its note the length it was held. While any key of a lane is down its edits are one undo step,
  // so a chord or a run of overlapping notes is undone with its lengths.
  const recordHeldRef = useRef(new Map<string, { synthId: number; note: string; step: number; ticks: number }>());
  // A device is given somewhere else to go. What a lane holds for it is let go first: the keys'
  // note-offs would otherwise arrive for a lane that no longer hears the device.
  // The lane a device's bend and wheel last reached, by the device's name: let go when the device
  // goes or is sent elsewhere. They are live gestures: nothing here is saved, undone or recorded.
  const liveLanesRef = useRef(new Map<string, number>());
  const projectImportFileRef = useRef<HTMLInputElement>(null);
  const midiImportFileRef = useRef<HTMLInputElement>(null);
  const [midiImportAssignments, setMidiImportAssignments] = useState<Record<number, number | null | 'drums'>>({});
  // The offer is decided when a project is opened and found empty, and it leaves only by its own
  // Hide button. It must not go away because a note was put in: that would move the whole rack
  // under the pointer that had just put it in.
  const [showStarters, setShowStarters] = useState(false);
  return {
    engine,
    synthAudio,
    drumAudio,
    synths,
    setSynths,
    selectedSynthId,
    setSelectedSynthId,
    selectedSynthIdRef,
    drumState,
    setDrumState,
    drumKits,
    setDrumKits,
    selectedDrumKitId,
    setSelectedDrumKitId,
    drumMasterVolume,
    setDrumMasterVolume,
    drumSwing,
    setDrumSwing,
    drumSwingGrid,
    setDrumSwingGrid,
    laneOrder,
    setLaneOrder,
    drumFx,
    setDrumFx,
    effectsLoop,
    setEffectsLoop,
    browserMuted,
    setBrowserMuted,
    browserVolume,
    setBrowserVolume,
    globalTempo,
    setGlobalTempo,
    storageError,
    setStorageError,
    drumSamplesRef,
    missingDrumSamples,
    setMissingDrumSamples,
    cymbalsRef,
    synthSamplesRef,
    sampleStoreVersion,
    setSampleStoreVersion,
    presetImportReport,
    setPresetImportReport,
    guests,
    audioTracks,
    setAudioTracks,
    setGuests,
    guestRecording,
    setGuestRecording,
    exportStatus,
    setExportStatus,
    exportingRef,
    metronome,
    setMetronome,
    metronomeRef,
    countInRef,
    barAnchorRef,
    doneTimerRef,
    guestsRef,
    changedElsewhere,
    setChangedElsewhere,
    scenes,
    setScenes,
    currentSceneId,
    setCurrentSceneId,
    song,
    setSong,
    playMode,
    setPlayMode,
    songStartEntry,
    setSongStartEntry,
    songPosition,
    setSongPosition,
    helpOpen,
    setHelpOpen,
    midiMode,
    setMidiMode,
    midiTies,
    setMidiTies,
    midiTiesRef,
    midiLearn,
    setMidiLearn,
    midiLearnRef,
    applyParamTargetRef,
    midiPads,
    setMidiPads,
    midiPadsRef,
    midiPadLearn,
    setMidiPadLearn,
    midiPadLearnRef,
    midiDestinations,
    setMidiDestinations,
    midiDestinationsRef,
    recording,
    setRecording,
    recordingRef,
    quantize,
    setQuantizeValue,
    quantizeRef,
    autoRecording,
    setAutoRecordingValue,
    autoRecordingRef,
    autoPassRef,
    endAutoPassesRef,
    midiChannel,
    setMidiChannel,
    midiDrumChannel,
    setMidiDrumChannel,
    midiDrumChannelRef,
    midiOutNotes,
    setMidiOutNotes,
    midiOutPlayed,
    setMidiOutPlayed,
    midiOutChannels,
    setMidiOutChannels,
    midiFollowClock,
    setMidiFollowClock,
    externalTempo,
    setExternalTempo,
    midiFollowClockRef,
    externalTempoRef,
    midiOutClock,
    setMidiOutClock,
    midiTargetSynthId,
    setMidiTargetSynthId,
    projectId,
    setProjectId,
    projectOpens,
    setProjectOpens,
    projectName,
    setProjectName,
    projects,
    setProjects,
    synthPresets,
    setSynthPresets,
    synthPresetsRef,
    browserMutedRef,
    synthsRef,
    midiModeRef,
    midiChannelRef,
    midiTargetSynthIdRef,
    drumStateRef,
    selectedDrumKitIdRef,
    drumFxRef,
    effectsLoopRef,
    midiHeldRef,
    midiChordRef,
    globalTempoRef,
    drumSwingRef,
    drumSwingGridRef,
    audioTracksRef,
    projectIdRef,
    scenesRef,
    currentSceneIdRef,
    songRef,
    playModeRef,
    songStartEntryRef,
    currentArrangementRef,
    songStartTickRef,
    signatureOfRef,
    songEndingRef,
    stopPlaybackRef,
    handleGlobalPlayStopRef,
    liveStartRef,
    announceRef,
    transportRef,
    liveSceneRef,
    sceneLengthRef,
    scheduleTickRef,
    initializedSynthLanesRef,
    midiImportData,
    setMidiImportData,
    presetsLoadedRef,
    liveArpRef,
    handedByBarRef,
    recordHeldRef,
    liveLanesRef,
    projectImportFileRef,
    midiImportFileRef,
    midiImportAssignments,
    setMidiImportAssignments,
    showStarters,
    setShowStarters,
  };
}

export type StudioCore = ReturnType<typeof useStudioCore>;
