// The audio tracks on the timeline (docs/TIMELINE_PLAN.md): adding and removing tracks, changing
// a track's name, level, pan, mute, solo and sends, and adding, moving, trimming and removing
// clips; and recording the session onto a track (roadmap V24). Every change is an operation of the
// store's, applied when its event arrives.
import { useCallback, useRef } from 'react';
import { localService } from '../services/localService';
import { saveSample } from '../services/sampleStore';
import { loadRecording } from '../services/clipRecordings';
import { sessionRecorder } from '../services/sessionRecorder';
import { MAX_CLIP_SECONDS, type ClipPatch, type TrackPatch } from '../services/audioTracks';
import type { StudioCore } from './useStudioCore';

export function useStudioTracks(core: StudioCore) {
  const { audioTracksRef, setSampleStoreVersion, setStorageError, engine, transportRef, playModeRef, songStartTickRef, countInRef, synthsRef } = core;
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
  // and put whole at `at` (a tick of the song) on the track named, or the first, or a track made
  // for it (named `newTrack`, or the next "Audio N"), in one undo step. Answers the clip's id.
  const place = async (file: File, to: { trackId?: string | null; newTrack?: string }, at: number) => {
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
    let target = to.newTrack ? undefined : to.trackId && audioTracksRef.current.some(track => track.id === to.trackId) ? to.trackId : audioTracksRef.current[0]?.id;
    if (!target) {
      const made = localService.addTrack(to.newTrack);
      if (!made.ok) { setStorageError(made.error); return null; }
      target = made.value.audioTracks.at(-1)!.id;
    }
    const id = crypto.randomUUID();
    const length = Math.min(MAX_CLIP_SECONDS, recording.channels[0].length / recording.rate);
    const result = localService.addClip(target, { id, sampleId, at: Math.max(0, Math.round(at)), length, name: file.name.replace(/\.[^.]+$/, '') });
    if (!result.ok) { setStorageError(result.error); return null; }
    return id;
  };
  const handleAddRecording = useCallback((file: File, trackId: string | null, at: number) => place(file, { trackId }, at), []);

  // Recording the session: what this browser hears, from the press of Record to the press of Stop,
  // put on a new track called Session. It is placed where the song was when recording began, if the
  // song was playing in song mode; otherwise at the song's start, to be moved like any clip.
  const sessionAt = useRef(0);
  const stopSession = async () => {
    const file = await sessionRecorder.stop();
    if (!file) { setStorageError('Nothing was recorded.'); return null; }
    return place(file, { newTrack: 'Session' }, sessionAt.current);
  };
  const handleRecordSession = useCallback(async () => {
    if (sessionRecorder.get().recording) return stopSession();
    const context = engine.getContext();
    if (context.state !== 'running') await context.resume().catch(() => {});
    const transport = transportRef.current, playing = synthsRef.current.some(synth => synth.isPlaying);
    sessionAt.current = playing && transport?.running && playModeRef.current === 'song'
      ? songStartTickRef.current + Math.max(0, transport.ticksAt(context.currentTime) - countInRef.current.ticks)
      : 0;
    const started = sessionRecorder.start(engine.recordingStream(), () => { void stopSession(); });
    if (!started) setStorageError('This browser cannot record its own sound.');
    return null;
  }, []);

  const handleClipChange = useCallback((clipId: string, patch: ClipPatch & { trackId?: string }) => {
    localService.changeClip(clipId, patch);
  }, []);
  const handleClipRemove = useCallback((clipId: string) => {
    localService.removeClip(clipId);
  }, []);
  return { handleTrackChange, handleAddTrack, handleRemoveTrack, handleAddRecording, handleRecordSession, handleClipChange, handleClipRemove };
}
