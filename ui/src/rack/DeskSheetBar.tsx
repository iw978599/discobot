import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { DESK_TABS, type DeskTab } from '../services/deskFrame';
import { clampSheetHeight, nearestSheetSize, sheetHeight, sheetKeySize, type SheetSize } from '../services/deskSheet';

interface DeskSheetBarProps {
  // What the first tab is called: the selected track.
  trackName: string;
  tab: DeskTab;
  onTab: (tab: DeskTab) => void;
  size: SheetSize;
  // The sheet's height now, while it is being dragged or otherwise at its size's.
  height: number;
  viewport: number;
  onSize: (size: SheetSize) => void;
  // Called with a height while the handle is dragged, and null when it has let go.
  onLive: (height: number | null) => void;
  onClose: () => void;
}

const TAB_NAMES: Record<DeskTab, string> = { track: '', mixer: 'Mixer', effects: 'Effects' };

// The bar over the phone's sheet (docs/DESK_LAYOUT_PLAN.md, stage 5): a handle that drags it between a
// peek, about half and nearly all of the screen, the tabs (the track, the mixer, the effects) and Close.
// The units themselves are the rack's own, hidden or shown by CSS and never taken away.
export default function DeskSheetBar({ trackName, tab, onTab, size, height, viewport, onSize, onLive, onClose }: DeskSheetBarProps) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const dragged = (event: PointerEvent<HTMLDivElement>) => clampSheetHeight((drag.current?.height ?? height) + (drag.current?.y ?? event.clientY) - event.clientY, viewport);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { y: event.clientY, height };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onLive(dragged(event));
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const settled = nearestSheetSize(dragged(event), viewport);
    drag.current = null;
    onLive(null);
    onSize(settled);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = sheetKeySize(event.key, size);
    if (next === null) return;
    event.preventDefault();
    onSize(next);
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = DESK_TABS[(DESK_TABS.indexOf(tab) + step + DESK_TABS.length) % DESK_TABS.length];
    onTab(next);
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLElement>(`[data-tab-id="${next}"]`)?.focus());
  };
  return (
    <div className="desk-sheet-bar">
      <div
        className="desk-dock-handle desk-sheet-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Sheet height"
        aria-valuenow={Math.round(height)}
        aria-valuemin={sheetHeight('peek', viewport)}
        aria-valuemax={sheetHeight('full', viewport)}
        aria-valuetext={size}
        aria-keyshortcuts="ArrowUp ArrowDown Home End"
        tabIndex={0}
        title="Drag to raise or lower the sheet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      />
      <div className="desk-sheet-row">
        <div ref={tabs} className="desk-dock-tabs" role="tablist" aria-label="Sheet" onKeyDown={onTabKey}>
          {DESK_TABS.map(id => (
            <button
              key={id}
              role="tab"
              data-tab-id={id}
              className="desk-dock-tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onTab(id)}
            >
              {id === 'track' ? trackName : TAB_NAMES[id]}
            </button>
          ))}
        </div>
        <button className="rack-btn desk-sheet-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
