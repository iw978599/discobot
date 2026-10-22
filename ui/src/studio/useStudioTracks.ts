// The audio tracks on the timeline (docs/TIMELINE_PLAN.md): changing a track's level, pan, mute,
// solo and sends. Every change is an operation of the store's, applied when its event arrives.
import { useCallback } from 'react';
import { localService } from '../services/localService';
import type { TrackPatch } from '../services/audioTracks';

export function useStudioTracks() {
  const handleTrackChange = useCallback((trackId: string, patch: TrackPatch) => {
    localService.changeTrack(trackId, patch);
  }, []);
  return { handleTrackChange };
}
