// Projects and files: new, open, copy, rename, delete and restore a project, save and open project
// files (with their samples), and import a MIDI file. Split out of useStudio.tsx.
import { useCallback } from 'react';
import { Pattern, SequencerStep, DrumInstrument } from '../types';
import { localService } from '../services/localService';
import { projectSync } from '../services/projectSync';
import { MAX_EMBEDDED_TOTAL_BYTES, MAX_PROJECT_FILE_BYTES, adoptSamples, embedSamples } from '../services/projectSamples';
import { barSteps, clampLengths, relayBars } from '../services/patternLength';
import { sentAutomation } from '../services/automation';
import { downloadFile } from '../services/wavExport';
import { LANE_IDS } from '../services/lanes';
import { importMidiFile, readFileAsArrayBuffer } from '../utils/midiImport';
import { cloneDrumState, parseUserPresets } from './studioState';
import type { StudioCore } from './useStudioCore';

// What this part of the studio uses from the rest of it.
export interface StudioProjectsNeeds {
  ensureSynthExists: (synthId: number) => Promise<boolean>;
}

export function useStudioProjects(core: StudioCore, needs: StudioProjectsNeeds) {
  const { synthAudio, drumAudio, synthPresets, setStorageError, transportRef, setSongPosition, projectIdRef, setSynthPresets, setSampleStoreVersion, midiImportFileRef, setMidiImportAssignments, setMidiImportData, midiImportData, midiImportAssignments, signatureOfRef, currentSceneIdRef, synthsRef, setSynths, drumStateRef} = core;
  const { ensureSynthExists } = needs;
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
  return { handleExportProject, handleNewProject, handleOpenProject, handleCopyProject, handleRestoreVersion, handleCopyVersion, handleRenameProject, handleDeleteProject, handleImportProject, handleImportProjectFile, handleMidiImportClick, handleMidiImportFile, handleMidiImportApplyAll };
}
