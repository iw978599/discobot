import { useCallback, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';
import { playhead, type PlayheadLane } from '../services/playhead';

// The part of a lane's position a component shows, such as which bar is playing. The component
// renders again only when that part changes, not on every step. `select` must return a plain value.
export function usePlayhead<T extends number | string | boolean>(lane: PlayheadLane, select: (step: number) => T): T {
  const subscribe = useCallback((listener: () => void) => playhead.subscribe(lane, listener), [lane]);
  return useSyncExternalStore(subscribe, () => select(playhead.get(lane)));
}

// Lights the step being played, without rendering anything: inside `root`, the elements matching
// `selector` whose `data-step` is the lane's playhead get `className`, and the rest lose it.
// The class belongs to this hook, so it must not also be in the elements' `className`. It is put
// back after every render of the component, because a render may have replaced the elements.
export function usePlayheadMark(root: RefObject<HTMLElement | null>, lane: PlayheadLane, playing: boolean, selector: string, className: string) {
  useLayoutEffect(() => {
    const mark = () => {
      const step = playing ? String(playhead.get(lane)) : null;
      root.current?.querySelectorAll<HTMLElement>(selector).forEach(element => element.classList.toggle(className, element.dataset.step === step));
    };
    mark();
    return playhead.subscribe(lane, mark);
  });
}
