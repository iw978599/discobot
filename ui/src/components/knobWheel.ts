import { useCallback, useEffect, useRef } from 'react';

// The wheel turns a knob only once the pointer has rested on it this long. Until then a wheel
// event is the page's own, so scrolling past a knob never turns it.
export const WHEEL_REST_MS = 350;
// And only if the page was not being wheel-scrolled just before: a scroll that carries the
// knob under a resting pointer carries on scrolling. A knob that is already turning keeps
// the wheel for as long as the events come this close together.
export const WHEEL_GAP_MS = 350;
// One notch of a mouse wheel moves a knob by this share of its range, but never by less than a step.
export const WHEEL_NOTCH_SHARE = 0.02;

// How many notches an event is, up positive. A mouse notch is one; a trackpad sends many small
// events that add up to the same, and no single event counts for more than one notch, so a
// flick cannot send a value flying.
export function wheelNotches(event: { deltaX: number; deltaY: number; deltaMode: number }): number {
  // Shift turns the wheel sideways in some browsers, so the turn is in deltaX then.
  const raw = event.deltaY !== 0 ? event.deltaY : event.deltaX;
  const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
  return Math.max(-1, Math.min(1, -raw / unit));
}

// How far one notch moves the value. With Shift it is one step, as an arrow key moves it.
export function notchSize(min: number, max: number, step: number, fine: boolean): number {
  return fine ? step : Math.max(step, (max - min) * WHEEL_NOTCH_SHARE);
}

// The page's wheel events, so a knob can tell a scroll under way from a deliberate turn. `prev` is
// the one before the event being handled, since this listener runs first.
let pageWheel = { prev: -Infinity, last: -Infinity };
let listening = false;
function listenToPageWheel() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('wheel', event => { pageWheel = { prev: pageWheel.last, last: event.timeStamp }; }, { capture: true, passive: true });
}

export interface WheelKnob {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  normalize: (value: number) => number;
  onChange: (value: number) => void;
}

// Returns a ref callback for the knob's element. The listener is native because React's wheel
// handler is passive and could not stop the page scrolling. `data-wheel="ready"` is on the element
// while the wheel will turn it.
export function useKnobWheel(knob: WheelKnob) {
  const latest = useRef(knob);
  latest.current = knob;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback((element: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!element) return;
    listenToPageWheel();
    let ready = false;
    let timer: number | null = null;
    // The last event this knob took, the value it sent then (the props may not have caught up), the
    // values this run has had (a value from outside it, typed or from a key, ends the run) and what
    // is left of a turn smaller than a step.
    const run = { at: -Infinity, sent: 0, left: 0, seen: new Set<number>() };
    const stopTimer = () => { if (timer !== null) window.clearTimeout(timer); timer = null; };
    const rest = () => {
      stopTimer();
      timer = window.setTimeout(() => { ready = true; element.dataset.wheel = 'ready'; }, WHEEL_REST_MS);
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      ready = false;
      delete element.dataset.wheel;
      rest();
    };
    const onMove = (event: PointerEvent) => { if (event.pointerType === 'mouse' && !ready && event.buttons === 0) rest(); };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      stopTimer();
      ready = false;
      delete element.dataset.wheel;
    };
    const onWheel = (event: WheelEvent) => {
      const state = latest.current;
      // Ctrl and the wheel is the browser's zoom.
      if (state.disabled || event.ctrlKey || !ready) return;
      const running = event.timeStamp - run.at < WHEEL_GAP_MS && run.seen.has(state.value);
      if (!running && event.timeStamp - pageWheel.prev < WHEEL_GAP_MS) return;
      event.preventDefault();
      const notches = wheelNotches(event);
      if (!running) run.seen = new Set([state.value]);
      if (!running || (run.left !== 0 && Math.sign(run.left) !== Math.sign(notches))) run.left = 0;
      run.at = event.timeStamp;
      run.left += notches * notchSize(state.min, state.max, state.step, event.shiftKey);
      const steps = Math.trunc(run.left / state.step + Math.sign(run.left) * 1e-9);
      if (steps === 0) return;
      run.left -= steps * state.step;
      const base = running ? run.sent : state.value;
      const next = state.normalize(base + steps * state.step);
      run.sent = next;
      run.seen.add(next);
      if (next !== base) state.onChange(next);
    };
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('wheel', onWheel, { passive: false });
    cleanup.current = () => {
      stopTimer();
      delete element.dataset.wheel;
      element.removeEventListener('pointerenter', onEnter);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('wheel', onWheel);
    };
  }, []);
}
