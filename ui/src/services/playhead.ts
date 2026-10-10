// Where each lane's playhead is: the step it last played. The scheduler writes this many times
// a second, so it is kept out of React state, where every change would render the whole rack.
// Components read it through the hooks in `hooks/usePlayhead.ts`.

export type PlayheadLane = number | 'drums';

const steps = new Map<PlayheadLane, number>();
const listeners = new Map<PlayheadLane, Set<() => void>>();

export const playhead = {
  get: (lane: PlayheadLane) => steps.get(lane) ?? 0,
  set(lane: PlayheadLane, step: number) {
    if (playhead.get(lane) === step) return;
    steps.set(lane, step);
    listeners.get(lane)?.forEach(listener => listener());
  },
  // Every lane back to its first step, as when playback stops.
  reset() {
    for (const lane of [...steps.keys()]) playhead.set(lane, 0);
  },
  subscribe(lane: PlayheadLane, listener: () => void) {
    let set = listeners.get(lane);
    if (!set) { set = new Set(); listeners.set(lane, set); }
    set.add(listener);
    return () => { set.delete(listener); };
  },
};
