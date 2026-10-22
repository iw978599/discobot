// The audio tracks on the timeline (docs/TIMELINE_PLAN.md): adding and removing tracks, changing
// a track's name, level, pan, mute, solo and sends, and adding, moving, trimming and removing
// clips. Every change is an operation of the store's, applied when its event arrives.
import { useCallback } from 'react';
import { localService } from '../services/localService';
import { saveSample } from '../services/sampleStore';
import { loadRecording } from '../services/clipRecordings';
import { MAX_CLIP_SECONDS, type ClipPatch, type TrackPatch } from '../services/audioTracks';
import type { StudioCore } from './useStudioCore';

export function useStudioTracks(core: StudioCore) {
  const { audioTracksRef, setSampleStoreVersion, setStorageError } = core;
  const handleTrackChange = useCallback((trackId: string, patch: TrackPatch) => {
    localService.changeTrack(trackId, patch);
  }, []);
  const handleAddTrack = useCallback(() => {
    const result = localService.addTrack();
    if (!result.ok) { setStorageError(result.error); return null; }
    return result.value.audioTracks.at(-1)?.id ?? null;
  }, []);
  const handleRemoveTrack = useCallback((trackId: string) => {
    localService.removeTrack(trackId);
  }, []);
  // A recording from a file: kept in this browser as a sample, decoded to learn how long it is,
  // and put on the track at `at` (a tick of the song), whole. With no track named, it goes on the
  // first, and with none at all a track is made for it, in the same undo step. Answers the clip's id.
  const handleAddRecording = useCallback(async (file: File, trackId: string | null, at: number) => {
    let sampleId: string;
    try {
      sampleId = (await saveSample(file)).id;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'The recording could not be kept in this browser.');
      return null;
    }
    setSampleStoreVersion(version => version + 1);
    const recording = await loadRecording(sampleId);
    if (!recording || !recording.channels[0]?.length) {
      setStorageError(`${file.name} could not be read as audio.`);
      return null;
    }
    let target = trackId && audioTracksRef.current.some(track => track.id === trackId) ? trackId : audioTracksRef.current[0]?.id;
    if (!target) {
      const made = localService.addTrack();
      if (!made.ok) { setStorageError(made.error); return null; }
      target = made.value.audioTracks.at(-1)!.id;
    }
    const id = crypto.randomUUID();
    const length = Math.min(MAX_CLIP_SECONDS, recording.channels[0].length / recording.rate);
    const result = localService.addClip(target, { id, sampleId, at: Math.max(0, Math.round(at)), length, name: file.name.replace(/\.[^.]+$/, '') });
    if (!result.ok) { setStorageError(result.error); return null; }
    return id;
  }, []);
  const handleClipChange = useCallback((clipId: string, patch: ClipPatch & { trackId?: string }) => {
    localService.changeClip(clipId, patch);
  }, []);
  const handleClipRemove = useCallback((clipId: string) => {
    localService.removeClip(clipId);
  }, []);
  return { handleTrackChange, handleAddTrack, handleRemoveTrack, handleAddRecording, handleClipChange, handleClipRemove };
}
