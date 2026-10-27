// Scenes and the song: opening, adding, renaming, colouring, re-timing and deleting a scene (each
// waiting for the guests' settings first when it leaves the open scene), the song's order, and the
// song as an arrangement to export. Split out of useStudio.tsx.
import { useCallback } from 'react';
import { Scene, Song, SynthParameters } from '../types';
import { sampleKey, soundIn } from '../services/sceneSounds';
import { applySceneMutes, songBars } from '../services/songPlayback';
import { localService } from '../services/localService';
import { timeSignature } from '../services/patternLength';
import { guestLink } from '../services/guests';
import { ExportArrangement } from '../services/wavExport';
import type { StudioCore } from './useStudioCore';

export function useStudioScenes(core: StudioCore) {
  const { setStorageError, signatureOfRef, currentSceneIdRef, currentArrangementRef, synthsRef, soundSamplesRef } = core;
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
  // A scene's own tempo, or none to play it at the song's (roadmap 17).
  const handleSceneTempo = useCallback((sceneId: string, tempo?: number) => sceneChange(() => localService.setSceneTempo(sceneId, tempo), false), [sceneChange]);
  // A scene to another place in the strip (roadmap 20).
  const handleSceneMove = useCallback((sceneId: string, to: number) => sceneChange(() => localService.moveScene(sceneId, to), false), [sceneChange]);
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
    // A lane is handed over with its shared sound; a scene with its own brings it in its bars.
    const arrangement = currentArrangementRef.current();
    const lanes = synthsRef.current;
    return {
      ...arrangement,
      synths: arrangement.synths.map((lane) => {
        const studioLane = lanes.find(entry => entry.id === lane.id);
        const synthParams = studioLane?.shared && studioLane.synthParams ? soundIn(null, lane.id, studioLane as typeof studioLane & { synthParams: SynthParameters }) : lane.synthParams;
        return { ...lane, synthParams, muted: false, solo: false };
      }),
      synthSamples: Object.fromEntries(lanes.flatMap((lane) => {
        const sample = lane.shared ? soundSamplesRef.current[sampleKey(lane.shared.synthParams)] : arrangement.synthSamples?.[lane.id];
        return sample ? [[lane.id, sample]] : [];
      })),
      soundSamples: { ...soundSamplesRef.current },
      bars: applySceneMutes(songBars(stored.song, stored.scenes), arrangement.synths),
    };
  }, []);
  return { handleSceneSelect, handleSceneAdd, handleSceneRename, handleSceneColor, handleSceneTempo, handleSceneMove, handleSceneSignature, handleSceneDelete, handleSongChange, songArrangement };
}
