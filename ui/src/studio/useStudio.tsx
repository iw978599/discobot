import { useCallback, useRef, useEffect, useMemo } from 'react';
import { useMidiInput } from '../hooks/useMidiInput';
import { midiOut } from '../services/midiOutput';
import { SequencerStep, SynthParameters, DrumState, DrumInstrument, DrumKitId, EffectsLoopState, Scene, TimeSignature } from '../types';
import { audibleLanes } from '../services/songPlayback';
import { localService } from '../services/localService';
import { startProjectSync } from '../services/projectSync';
import { startLiveSessions } from '../services/liveSession';
import { tidyGuestFiles } from '../services/guestFiles';
import { swingGridOf } from '../services/grooves';
import { trackPlayer } from '../hooks/trackAudio';
import { loadRecordings } from '../services/clipRecordings';
import { useStudioTracks } from './useStudioTracks';
import { laneBars, sceneBars, storedSignature, timeSignature } from '../services/patternLength';
import { loadStoredPresets, presetStore } from '../services/presetStore';
import { expandStepNotes, withStepNotes } from '../services/noteScheduling';
import { defaultPads, storePads } from '../services/midiDrums';
import { asQuantize } from '../services/recordTiming';
import { LANE_PARAMS, fromUnit, lanePatch, parseTarget } from '../services/paramTargets';
import { sentAutomation } from '../services/automation';
import { storeMidiTies, withoutTie } from '../services/midiTies';
import { storeMetronome, type MetronomeSettings } from '../services/metronome';
import { LiveArp, type LiveArpLane } from '../services/liveArp';
import { auxBuses } from '../services/auxSettings';
import { isLaneId, laneOrderOf } from '../services/lanes';
import { noteNameToMidi } from '../utils/midiExport';
import { DEFAULT_SYNTH_MODEL_ID, createDefaultSynthModelParams, getSynthModelDefinition, normalizeSynthModelId, normalizeSynthModelParams } from '../synthModels';
import { guestInputs, inputSources } from '../services/guestInput';
import { DEFAULT_PARAMS, DEFAULT_DRUM_FX, DEFAULT_EFFECTS_LOOP, createDefaultDrumState, parseUserPresets, normalizeSynthParams, normalizeDrumFx, normalizeEffectsLoop, midiTime } from './studioState';
import { useStudioCore } from './useStudioCore';
import type { AudioEngine } from '../hooks/browserAudio';
import { useStudioGuests } from './useStudioGuests';
import { useStudioScenes } from './useStudioScenes';
import { useStudioTransport } from './useStudioTransport';
import { useStudioLanes } from './useStudioLanes';
import { useStudioNotes } from './useStudioNotes';
import { useStudioDrums } from './useStudioDrums';
import { useStudioProjects } from './useStudioProjects';
import { useStudioExport } from './useStudioExport';
import type { SceneInfo, SynthState } from './studioState';
export type { PlayMode } from './studioState';

// `engine` is the one that plays everything: the app's, unless another is given (a test's, say).
export function useStudio(engine?: AudioEngine) {
  const core = useStudioCore(engine);
  const {
    engine: audio,
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
    missingDrumSamples,
    sampleStoreVersion,
    presetImportReport,
    setPresetImportReport,
    guests,
    audioTracks,
    setAudioTracks,
    setGuests,
    guestRecording,
    exportStatus,
    metronome,
    setMetronome,
    metronomeRef,
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
    signatureOfRef,
    transportRef,
    liveSceneRef,
    sceneLengthRef,
    initializedSynthLanesRef,
    midiImportData,
    setMidiImportData,
    presetsLoadedRef,
    liveArpRef,
    projectImportFileRef,
    midiImportFileRef,
    midiImportAssignments,
    setMidiImportAssignments,
    showStarters,
    synthAudio,
    drumAudio,
  } = core;
  selectedSynthIdRef.current = selectedSynthId;
  metronomeRef.current = metronome;
  const handleMetronomeChange = useCallback((patch: Partial<MetronomeSettings>) => {
    setMetronome((current) => {
      const next = { ...current, ...patch };
      storeMetronome(next);
      return next;
    });
  }, []);
  guestsRef.current = guests;
  midiTiesRef.current = midiTies;
  midiLearnRef.current = midiLearn;
  midiPadsRef.current = midiPads;
  midiPadLearnRef.current = midiPadLearn;
  midiDestinationsRef.current = midiDestinations;
  const handleMidiLearn = useCallback((target: string | null) => { setMidiPadLearn(null); setMidiLearn(target); }, []);
  const handleMidiPadLearn = useCallback((drum: DrumInstrument | null) => { setMidiLearn(null); setMidiPadLearn(drum); }, []);
  const handleMidiPadsReset = useCallback(() => { const next = defaultPads(); storePads(next); setMidiPadLearn(null); setMidiPads(next); }, []);
  const handleMidiTieRemove = useCallback((target: string) => {
    setMidiTies(current => { const next = withoutTie(current, target); storeMidiTies(next); return next; });
  }, []);
  recordingRef.current = recording;
  quantizeRef.current = quantize;
  const setQuantize = useCallback((value: number) => setQuantizeValue(asQuantize(value)), []);
  autoRecordingRef.current = autoRecording;
  const setAutoRecording = useCallback((on: boolean) => {
    if (!on) endAutoPassesRef.current(true);
    setAutoRecordingValue(on);
  }, []);
  midiDrumChannelRef.current = midiDrumChannel;
  useEffect(() => { midiOut.configure({ notes: midiOutNotes, clock: midiOutClock, played: midiOutPlayed, channels: midiOutChannels }); }, [midiOutNotes, midiOutClock, midiOutPlayed, midiOutChannels]);
  // Following a clock ends with its tempo: the project's own is heard again.
  midiFollowClockRef.current = midiFollowClock;
  useEffect(() => {
    if (midiFollowClock) return;
    externalTempoRef.current = null;
    setExternalTempo(null);
  }, [midiFollowClock]);
  synthPresetsRef.current = synthPresets;
  browserMutedRef.current = browserMuted;
  synthsRef.current = synths;
  midiModeRef.current = midiMode;
  midiChannelRef.current = midiChannel;
  midiTargetSynthIdRef.current = midiTargetSynthId;
  drumStateRef.current = drumState;
  selectedDrumKitIdRef.current = selectedDrumKitId;
  drumFxRef.current = drumFx;
  effectsLoopRef.current = effectsLoop;
  globalTempoRef.current = globalTempo;
  drumSwingRef.current = drumSwing;
  drumSwingGridRef.current = drumSwingGrid;
  audioTracksRef.current = audioTracks;
  projectIdRef.current = projectId;
  scenesRef.current = scenes;
  currentSceneIdRef.current = currentSceneId;
  songRef.current = song;
  playModeRef.current = playMode;
  songStartEntryRef.current = songStartEntry;

  useEffect(() => {
    if (synths.length === 0) return;
    if (midiTargetSynthId !== null && synths.some((s) => s.id === midiTargetSynthId)) return;
    setMidiTargetSynthId(synths[0].id);
  }, [synths, midiTargetSynthId]);

  useEffect(() => {
    audio.setMasterVolume(browserVolume);
  }, [browserVolume, synthAudio, drumAudio]);

  // The audio tracks' channels follow the project, and their recordings are decoded ahead of the
  // scheduler, which cannot wait for one. A recording that arrives later (a project file) is
  // decoded when the samples change.
  useEffect(() => {
    trackPlayer.sync(audioTracks);
    void loadRecordings(audioTracks.flatMap(track => track.clips.map(clip => clip.sampleId)));
  }, [audioTracks, sampleStoreVersion]);

  useEffect(() => { audio.setMasterMuted(browserMuted); }, [browserMuted]);

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
  liveArpRef.current ??= new LiveArp(() => audio.getContext().currentTime);
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
      // Lane 1 goes out on MIDI channel 1, and so on, unless another channel is chosen for it.
      if (midiOut.active) {
        const start = scheduledTime + scheduled.offset, midi = noteNameToMidi(scheduled.note);
        if (midi !== null) midiOut.note(midiOut.channelOf(synthId), midi, velocity, midiTime(start), midiTime(start + scheduled.duration));
      }
    }
  }, [synthAudio]);

  useEffect(() => { audio.setEffectsTempo(globalTempo); }, [globalTempo]);

  // A scene's time signature. The open scene's is read from its slot in `scenes` like any
  // other's: it is the one thing about the open scene the live lanes cannot say.
  const signatureOf = (sceneId: string) => scenesRef.current.find(scene => scene.id === sceneId)?.signature;
  signatureOfRef.current = signatureOf;
  // The open scene as it stands now: its stored copy can be behind the live lanes.
  const liveScene = (): Scene => {
    const lanes = synthsRef.current.filter(synth => synth.pattern);
    const signature = storedSignature(signatureOf(currentSceneIdRef.current));
    const stored = scenesRef.current.find(scene => scene.id === currentSceneIdRef.current);
    return {
      id: currentSceneIdRef.current, name: stored?.name ?? 'Scene',
      ...(signature ? { signature } : {}),
      ...(stored?.tempo !== undefined ? { tempo: stored.tempo } : {}),
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
  // Each scene's length in bars and its time signature, as values: a tracked unit may read them
  // while rendering, which it may not do with the functions above. The same object until one of
  // them changes, so a unit that reads it renders only then.
  const sceneInfoText = JSON.stringify(scenes.map(scene => [scene.id, sceneLength(scene.id), signatureOf(scene.id) ?? null, scene.tempo ?? null]));
  const sceneInfo = useMemo(() => Object.fromEntries((JSON.parse(sceneInfoText) as Array<[string, number, TimeSignature | null, number | null]>)
    .map(([id, bars, signature, tempo]) => [id, { bars, signature: signature ?? undefined, ...(tempo !== null ? { tempo } : {}) }])) as Record<string, SceneInfo>, [sceneInfoText]);

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'audioTracksChanged': {
        setAudioTracks(message.data.audioTracks ?? []);
        break;
      }
      case 'guestsChanged': {
        setGuests(message.data.guests ?? []);
        break;
      }
      case 'init': {
        autoPassRef.current.clear();
        localService.holdUndo('auto', false);
        setGuests(message.data.guests ?? []);
        setLaneOrder(laneOrderOf(message.data.laneOrder));
        setAudioTracks(message.data.audioTracks ?? []);
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
        setDrumSwingGrid(swingGridOf(message.data.drumSwingGrid));
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
        setLaneOrder(laneOrderOf(data.laneOrder));
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
        setAudioTracks(data.audioTracks ?? []);
        setDrumState(data.drumState);
        setSelectedDrumKitId(data.selectedDrumKitId as DrumKitId);
        setDrumFx(normalizeDrumFx(data.drumFx));
        setEffectsLoop(loop);
        setGlobalTempo(data.tempo);
        setDrumMasterVolume(data.drumMasterVolume);
        setDrumSwing(data.drumSwing);
        setDrumSwingGrid(swingGridOf(data.drumSwingGrid));
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
      case 'laneOrder': {
        setLaneOrder(laneOrderOf(message.data.order));
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
        setDrumSwingGrid(swingGridOf(message.data.grid));
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
    void localService.openLibrary().then(() => {
      startProjectSync();
      startLiveSessions();
      // Guests' recordings that no project here uses any more are cleared away, out of the way of start-up.
      setTimeout(() => { void tidyGuestFiles(visit => localService.visitStoredProjects(visit)).catch(() => {}); }, 30_000);
    });
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
  const { handleSceneSelect, handleSceneAdd, handleSceneRename, handleSceneColor, handleSceneTempo, handleSceneMove, handleSceneSignature, handleSceneDelete, handleSongChange, songArrangement } = useStudioScenes(core);

  // Another tab saved the project. Either take that version (a reload reads it) or keep this one.
  const loadOtherTabVersion = useCallback(() => { window.location.reload(); }, []);
  const keepThisTabVersion = useCallback(() => {
    if (localService.resumeSaving()) setChangedElsewhere(false);
  }, []);
  const { recordedStep, endRecordedHolds, handleNotePlay, handleNoteRelease, computerKeyNotes, handleMidiDestinationChange, handleMidiMessage } = useStudioNotes(core, { arpLane, handleOctaveShift });
  const { handleGlobalPlayStop } = useStudioTransport(core, { sceneLength, signatureOf, triggerStep, endRecordedHolds });

  const midiState = useMidiInput({ onMessage: handleMidiMessage });
  const { handleStepChange, handleStepSelect, handleKeyboardModeChange, handlePianoRollNoteAssign, handleClearPatternNotes, handleTransposeLane, handleRandomizeLane, handleParameterChange, handleAutomationDraw, handleAutomationClear, handleSynthModelChange, handleStepCountChange, handleStepVelocityChange, handleStepSlideChange, handleStepLengthChange, handleStepDetailChange, handleLaneBarsChange, handleDrumBarsChange, handleCopyDrumBar, handleCopyLaneBar, handleSynthMixChange, handleSynthSwingChange, handleSynthRename, handleLaneMove, handleLaneStep, handleSaveSynthPreset, handleLoadSynthPreset, handleImportSynthPreset, handleExportSynthPreset, handleDeleteSynthPreset } = useStudioLanes(core, { recordedStep });

  const { handleExportMidi, currentArrangement, handleExportSongMidi, handleExportWav, dismissExportStatus, reportExportError } = useStudioExport(core, { songArrangement });
  // What a picture of the sound reads (roadmap 21): a lane's, or the whole mix's.
  const soundAnalyser = useCallback((source: number | 'master') => (source === 'master' ? audio.analyser() : synthAudio.analyser(source)), [audio, synthAudio]);
  const { handleAddGuest, handleRemoveGuest, handleGuestChange, handleDrumSampleChange } = useStudioGuests(core);
  const { handleTrackChange, handleAddTrack, handleRemoveTrack, handleAddRecording, handleRecordSession, handleClipChange, handleClipRemove } = useStudioTracks(core);

  const { handleExportProject, handleNewProject, handleOpenProject, handleCopyProject, handleRestoreVersion, handleCopyVersion, handleRenameProject, handleDeleteProject, handleImportProject, handleImportProjectFile, handleMidiImportClick, handleMidiImportFile, handleMidiImportApplyAll } = useStudioProjects(core, { ensureSynthExists });

  useEffect(() => {
    const data = localService.getDrumKits();
    setDrumKits(data.kits);
    const hasSelected = data.kits.some((kit) => kit.id === selectedDrumKitIdRef.current);
    if (!hasSelected) setSelectedDrumKitId(data.defaultKitId);
  }, []);
  const { handleDrumKitChange, handleDrumStepToggle, handleDrumStepVelocity, handleDrumStepDetail, handleDrumSettingsChange, handleDrumMixChange, handleDrumReset, handleStarter, handleCopyPartToScene, handleSampleSong, dismissStarters, handleDrumMasterVolumeChange, handleDrumSwingChange, handleSwingTemplate, handleDrumFxChange, handleEffectsLoopChange, handleDrumMuteAll, handleDrumSoloAll } = useStudioDrums(core, { handleImportProject });

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
    selectedDrumKitId, drumMasterVolume, drumSwing, drumSwingGrid, drumFx, effectsLoop, browserMuted, setBrowserMuted,
    browserVolume, setBrowserVolume, globalTempo, storageError, setStorageError, changedElsewhere, loadOtherTabVersion, keepThisTabVersion, helpOpen, setHelpOpen, midiMode, setMidiMode,
    recording, setRecording, autoRecording, setAutoRecording, handleAutomationDraw, handleAutomationClear, quantize, setQuantize, midiChannel, setMidiChannel, midiDrumChannel, setMidiDrumChannel, midiOutNotes, setMidiOutNotes, midiOutClock, setMidiOutClock, midiOutPlayed, setMidiOutPlayed, midiOutChannels, setMidiOutChannels, midiFollowClock, setMidiFollowClock, externalTempo, midiTargetSynthId, setMidiTargetSynthId, projectId, projectName, projects, synthPresets, drumAudio,
    handleUndo, handleRedo, midiImportData, setMidiImportData, midiImportAssignments, setMidiImportAssignments,
    handleMidiImportClick, handleMidiImportFile, handleMidiImportApplyAll, midiImportFileRef, handleRemoveSynth,
    ensureSynthExists, handleOctaveShift, handleTempoChange, handleGlobalPlayStop, handleStepChange, handleStepSelect, handleKeyboardModeChange,
    handlePianoRollNoteAssign, handleClearPatternNotes, handleCopyLaneBar, handleCopyDrumBar, handleTransposeLane, handleRandomizeLane, handleNotePlay, handleNoteRelease, computerKeyNotes, midiState,
    handleParameterChange, handleSynthModelChange, handleStepCountChange, handleStepVelocityChange, handleStepSlideChange, handleStepLengthChange, handleStepDetailChange, guests, audioTracks, handleTrackChange, handleAddTrack, handleRemoveTrack, handleAddRecording, handleRecordSession, handleClipChange, handleClipRemove, handleAddGuest, handleRemoveGuest, handleGuestChange, guestRecording, handleExportWav, exportStatus, dismissExportStatus, soundAnalyser, missingDrumSamples, sampleStoreVersion, handleDrumSampleChange, handleLaneBarsChange, handleDrumBarsChange, sceneLength,
    handleSynthMixChange, handleSynthSwingChange, handleSynthRename, handleLaneMove, handleLaneStep, laneOrder, handleSaveSynthPreset, handleLoadSynthPreset, handleDeleteSynthPreset,
    handleExportMidi, currentArrangement, reportExportError, handleExportProject, projectImportFileRef, handleImportProjectFile, handleImportProject,
    handleNewProject, handleOpenProject, handleCopyProject, handleRenameProject, handleDeleteProject, handleRestoreVersion, handleCopyVersion, handleImportSynthPreset, handleExportSynthPreset, presetImportReport, setPresetImportReport, handleDrumKitChange, handleDrumStepToggle, handleDrumStepVelocity, handleDrumStepDetail,
    handleDrumSettingsChange, handleDrumMixChange, handleDrumReset, handleDrumMasterVolumeChange, handleDrumSwingChange, handleSwingTemplate,
    handleDrumFxChange, handleEffectsLoopChange, handleDrumMuteAll, handleDrumSoloAll, handleReset,
    scenes, currentSceneId, song, playMode, setPlayMode, songStartEntry, setSongStartEntry, songPosition,
    handleSceneSelect, handleSceneAdd, handleSceneRename, handleSceneColor, handleSceneTempo, handleSceneMove, handleSceneSignature, handleSceneDelete, handleSongChange, songArrangement, handleExportSongMidi,
    // The open scene's time signature, and any scene's by its id.
    signature: timeSignature(scenes.find(scene => scene.id === currentSceneId)?.signature), sceneSignature, sceneInfo,
    isAnyPlaying,
  };
}

export type Studio = ReturnType<typeof useStudio>;
