import type { DrumInstrument, DrumState, SequencerStep } from '../types';
import { stepNotes } from './noteScheduling';

// What the lamps on a narrow screen's bar of units show: whether a unit is muted, and whether
// the step its playhead is on is one it sounds. Chance is left out: a step that may play counts.
export interface ActivityLane {
  id: number;
  // what the lane is called, where it has been named
  name?: string;
  muted?: boolean;
  solo?: boolean;
  isPlaying?: boolean;
  pattern?: { steps: SequencerStep[] } | null;
}

// A lane is heard when it is not muted and no other lane has been soloed over it.
export function laneHeard(lanes: ActivityLane[], id: number): boolean {
  const lane = lanes.find(entry => entry.id === id);
  if (!lane || lane.muted) return false;
  return Boolean(lane.solo) || !lanes.some(entry => entry.solo);
}

export function laneSounds(lanes: ActivityLane[], id: number, step: number): boolean {
  const lane = lanes.find(entry => entry.id === id);
  if (!lane?.isPlaying || !laneHeard(lanes, id)) return false;
  return stepNotes(lane.pattern?.steps[step]).length > 0;
}

const tracks = (state: DrumState) => (Object.keys(state) as DrumInstrument[]).map(instrument => state[instrument]);

// The drums are muted as a unit when every one of them is, which is what Mute All does.
export function drumsMuted(state: DrumState): boolean {
  return tracks(state).every(track => track.muted);
}

export function drumsSound(state: DrumState, step: number): boolean {
  const all = tracks(state), solo = all.some(track => track.solo);
  return all.some(track => Boolean(track.steps[step]) && !track.muted && (!solo || track.solo));
}
