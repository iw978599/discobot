// Scenes and the song: opening, adding, renaming, colouring, re-timing and deleting a scene (each
// waiting for the guests' settings first when it leaves the open scene), the song's order, and the
// song as an arrangement to export. Split out of useStudio.tsx.
import { useCallback } from 'react';
import { Scene, Song } from '../types';
import { applySceneMutes, songBars } from '../services/songPlayback';
import { localService } from '../services/localService';
import { timeSignature } from '../services/patternLength';
import { guestLink } from '../services/guests';
import { ExportArrangement } from '../services/wavExport';
import type { StudioCore } from './useStudioCore';

export function useStudioScenes(core: StudioCore) {
  const { setStorageError, signatureOfRef, currentSceneIdRef, currentArrangementRef } = core;
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
  return { handleSceneSelect, handleSceneAdd, handleSceneRename, handleSceneColor, handleSceneSignature, handleSceneDelete, handleSongChange, songArrangement };
}
