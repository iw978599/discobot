import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export function useKnobInteraction(value: number, min: number, max: number, step: number, onChange: (value: number) => void, disabled = false) {
  const drag = useRef<{ id: number; y: number; value: number } | null>(null);
  const normalize = (next: number) => Math.max(min, Math.min(max, Number((Math.round((next - min) / step) * step + min).toFixed(8))));
  useEffect(() => {
    const cancel = () => { drag.current = null; };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, []);
  return {
    normalize,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, y: event.clientY, value };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (disabled || !start || start.id !== event.pointerId) return;
      onChange(normalize(start.value + (start.y - event.clientY) / 150 * (max - min)));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => { drag.current = null; },
    onLostPointerCapture: () => { drag.current = null; },
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
