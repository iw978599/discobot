import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { TAP_HOLD_MS, TAP_SLOP } from '../components/useKnobInteraction';

// Putting a list in another order by dragging (roadmap 20). A mouse or a pen picks an item up once
// it has moved further than a tap; a finger must first rest on it for a hold, so that a finger can
// still scroll the list. Where it is let go is the item under the pointer, found by `data-order`
// within the same list. A press that never picks anything up is the click it always was; the
// click that ends a drag is swallowed. Escape puts the item back. With `keys`, Alt and an arrow
// move a focused item one place, for those who do not drag.
export interface DragOrder {
  from: number;
  over: number;
}

interface Press { from: number; pointer: number; x: number; y: number; touch: boolean; moving: boolean; over: number; timer?: ReturnType<typeof setTimeout> }

export function useDragOrder(list: string, onMove: (from: number, to: number) => void, keys = false) {
  const press = useRef<Press | null>(null);
  const swallow = useRef(false);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const [dragging, setDragging] = useState<DragOrder | null>(null);
  // An item moved by the keyboard keeps the focus: the list's new order can take its element out
  // and put it back, which drops the focus to the page.
  const refocus = useRef<{ element: HTMLElement; at: number } | null>(null);
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (!wanted) return;
    if (Date.now() - wanted.at > 1000) { refocus.current = null; return; }
    const active = document.activeElement;
    if (wanted.element.isConnected && (!active || active === document.body)) wanted.element.focus({ preventScroll: true });
  });

  useEffect(() => {
    const end = () => {
      const held = press.current;
      if (held?.timer) clearTimeout(held.timer);
      press.current = null;
      setDragging(null);
      return held;
    };
    const overAt = (x: number, y: number) => {
      const item = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[data-order-list="${list}"]`);
      const index = Number(item?.dataset.order);
      return item && Number.isInteger(index) ? index : undefined;
    };
    const move = (event: globalThis.PointerEvent) => {
      const held = press.current;
      if (!held || event.pointerId !== held.pointer) return;
      if (!held.moving) {
        if (Math.hypot(event.clientX - held.x, event.clientY - held.y) <= TAP_SLOP) return;
        // A finger that moves before its hold is scrolling, not dragging.
        if (held.touch) { end(); return; }
        held.moving = true;
        setDragging({ from: held.from, over: held.over });
      }
      const over = overAt(event.clientX, event.clientY);
      if (over !== undefined && over !== held.over) {
        held.over = over;
        setDragging({ from: held.from, over });
      }
    };
    const up = (event: globalThis.PointerEvent) => {
      if (!press.current || event.pointerId !== press.current.pointer) return;
      const held = end();
      if (!held?.moving) return;
      swallow.current = true;
      setTimeout(() => { swallow.current = false; }, 0);
      if (held.over !== held.from) moveRef.current(held.from, held.over);
    };
    const cancel = (event: globalThis.PointerEvent) => { if (press.current?.pointer === event.pointerId) end(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !press.current?.moving) return;
      event.preventDefault();
      event.stopPropagation();
      end();
    };
    // Once a finger has picked something up, the page must not scroll under it.
    const touchMove = (event: TouchEvent) => { if (press.current?.moving) event.preventDefault(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      end();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('touchmove', touchMove);
    };
  }, [list]);

  const item = (index: number, count: number) => ({
    'data-order-list': list,
    'data-order': index,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || press.current) return;
      const held: Press = { from: index, pointer: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch', moving: false, over: index };
      if (held.touch) held.timer = setTimeout(() => { if (press.current === held) { held.moving = true; setDragging({ from: index, over: index }); } }, TAP_HOLD_MS);
      press.current = held;
    },
    // A held finger may be answered with the browser's own menu before the hold is up.
    onContextMenu(event: MouseEvent<HTMLElement>) { if (press.current?.touch) event.preventDefault(); },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!swallow.current) return;
      swallow.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    ...(keys ? {
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!event.altKey || event.ctrlKey || event.metaKey) return;
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
        if (!step) return;
        event.preventDefault();
        const to = index + step;
        if (to < 0 || to >= count) return;
        refocus.current = { element: event.currentTarget, at: Date.now() };
        moveRef.current(index, to);
      },
    } : {}),
  });

  return { dragging, item };
}

// The classes an item wears while a drag is on: the one picked up, and the place it would go.
export const dragClass = (dragging: DragOrder | null, index: number) =>
  !dragging ? '' : index === dragging.from ? 'drag-from' : index === dragging.over ? 'drag-over' : '';
