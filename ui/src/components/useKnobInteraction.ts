import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useKnobWheel } from './knobWheel';

// How far a finger may wander and still be a tap. A mouse has no such allowance: it turns the
// knob from its first movement, as it always has.
export const TAP_SLOP = 6;
// How long a tap waits for its click before it is acted on without one.
const TAP_WAIT_MS = 300;
// A finger held longer than this was not tapping: it was stopping the page as it scrolled, or
// pressing for a menu. A browser sends no click after those, so nothing else would tell them apart.
export const TAP_HOLD_MS = 500;

// `onTap` is called for a knob that was touched and let go without being turned. Only a finger
// or a pen taps; a mouse click does nothing, as before.
export function useKnobInteraction(value: number, min: number, max: number, step: number, onChange: (value: number) => void, disabled = false, onTap?: () => void) {
  const drag = useRef<{ id: number; x: number; y: number; at: number; value: number; touch: boolean; moved: boolean } | null>(null);
  const tapped = useRef(false);
  const tapTimer = useRef<number | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const stopWaiting = () => {
    if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    tapTimer.current = null;
  };
  const fireTap = () => {
    stopWaiting();
    if (!tapped.current) return;
    tapped.current = false;
    if (!disabled) tapRef.current?.();
  };
  const normalize = (next: number) => Math.max(min, Math.min(max, Number((Math.round((next - min) / step) * step + min).toFixed(8))));
  const wheelRef = useKnobWheel({ value, min, max, step, disabled, normalize, onChange });
  useEffect(() => {
    if (disabled) drag.current = null;
  }, [disabled]);
  useEffect(() => {
    const cancel = () => { drag.current = null; };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      cancel();
      stopWaiting();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, []);
  return {
    normalize,
    ref: wheelRef,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, value, touch: event.pointerType !== 'mouse', moved: false };
      tapped.current = false;
      stopWaiting();
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (disabled || !start || start.id !== event.pointerId) return;
      // A finger is never quite still. Until it has plainly moved it is a tap, and a tap turns nothing.
      if (!start.moved && start.touch) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP) return;
        // The turn is measured from here, or the value would jump by the distance already covered.
        start.moved = true;
        start.y = event.clientY;
        return;
      }
      start.moved = true;
      onChange(normalize(start.value + (start.y - event.clientY) / 150 * (max - min)));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      // Another finger lifting from the same knob ends nothing.
      if (start && start.id === event.pointerId) {
        tapped.current = start.touch && !start.moved && event.timeStamp - start.at < TAP_HOLD_MS;
        if (tapped.current) tapTimer.current = window.setTimeout(fireTap, TAP_WAIT_MS);
        drag.current = null;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) drag.current = null; },
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) drag.current = null; },
    // The tap is acted on here, at the click that ends it, not when the finger lifts: whatever
    // it opens would otherwise be on screen in time to receive that click itself. A tap does not
    // always end in a click (the check on GitHub saw one that did not), so it is also acted on
    // a moment after the finger lifts if none has come.
    onClick: fireTap,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const delta = (event.shiftKey ? 10 : 1) * step;
      const next = event.key === 'Home' ? min : event.key === 'End' ? max
        : ['ArrowUp', 'ArrowRight', 'PageUp'].includes(event.key) ? value + delta * (event.key === 'PageUp' ? 10 : 1)
        : ['ArrowDown', 'ArrowLeft', 'PageDown'].includes(event.key) ? value - delta * (event.key === 'PageDown' ? 10 : 1) : null;
      if (next !== null) {
        event.preventDefault();
        onChange(normalize(next));
      }
    },
  };
}
