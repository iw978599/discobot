// The drums and the shared effects: the kit, steps, settings, mutes and sends, Reset, and the
// starting points offered on an empty project (beats and sample songs). Split out of useStudio.tsx.
import { useCallback, useEffect } from 'react';
import { DrumState, DrumInstrument, DrumSettings, DrumKitId, EffectsLoopState, FxSendLevels } from '../types';
import { localService } from '../services/localService';
import { createBuiltInPresets } from '../services/builtInPresets';
import { STARTERS, projectIsEmpty, starterDrums, starterPattern } from '../services/starters';
import { buildSampleSong } from '../services/sampleSong';
import { SAMPLE_SONGS } from '../services/sampleSongs';
import { sentAutomation } from '../services/automation';
import { normalizeDrumFx, normalizeEffectsLoop } from './studioState';
import type { StudioCore } from './useStudioCore';

// What this part of the studio uses from the rest of it.
export interface StudioDrumsNeeds {
  handleImportProject: (data: unknown) => Promise<boolean>;
}

export function useStudioDrums(core: StudioCore, needs: StudioDrumsNeeds) {
  const { synthsRef, drumStateRef, signatureOfRef, currentSceneIdRef, setStorageError, setPlayMode, setShowStarters, projectOpens, scenesRef, drumFxRef, effectsLoopRef} = core;
  const { handleImportProject } = needs;
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
  return { handleDrumKitChange, handleDrumStepToggle, handleDrumStepVelocity, handleDrumStepDetail, handleDrumSettingsChange, handleDrumMixChange, handleDrumReset, handleStarter, handleCopyPartToScene, handleSampleSong, dismissStarters, handleDrumMasterVolumeChange, handleDrumSwingChange, handleDrumFxChange, handleEffectsLoopChange, handleDrumMuteAll, handleDrumSoloAll };
}
