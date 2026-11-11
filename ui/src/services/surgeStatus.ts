import { useSyncExternalStore } from 'react';
import type { LanesWorkletEvent } from '@discobot/engine';

// What the lanes processor last said about each lane's Surge engine (docs/SURGE_XT_PLAN.md, stage
// 2), outside React like the playhead: the lane's Surge panel shows it. A new patch clears it.
export type SurgeState = 'loading' | 'ready' | 'shed' | 'muted' | 'refused' | 'failed';

const states = new Map<number, SurgeState>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach(listener => listener());

export const surgeStatus = {
  set(lane: number, state: SurgeState) { if (states.get(lane) !== state) { states.set(lane, state); tell(); } },
  get: (lane: number): SurgeState | undefined => states.get(lane),
  // An event from the processor. Lane 0 is all of them: Surge's module could not be made.
  heard(event: LanesWorkletEvent, lanes: number[]) {
    if (event.type === 'surgeReady') lanes.forEach(lane => states.get(lane) === 'loading' && states.set(lane, 'ready'));
    else if (event.type === 'surgeShed') event.lanes.forEach(lane => states.set(lane, 'shed'));
    else if (event.lane === 0) lanes.forEach(lane => states.set(lane, 'failed'));
    else states.set(event.lane, event.type === 'surgeMuted' ? 'muted' : event.type === 'surgeRefused' ? 'refused' : 'failed');
    tell();
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export const useSurgeStatus = (lane: number): SurgeState | undefined =>
  useSyncExternalStore(surgeStatus.subscribe, () => surgeStatus.get(lane));
