import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { DESK_TABS, DOCK_MIN, DOCK_STEP, clampDockHeight, dockKeyHeight, dockMax, type DeskTab } from '../services/deskFrame';

interface DeskDockBarProps {
  // What the first tab is called: the selected track.
  trackName: string;
  tab: DeskTab;
  onTab: (tab: DeskTab) => void;
  height: number;
  viewport: number;
  // Called as the handle moves; `done` once a drag has let go or a key was pressed, to keep the height.
  onHeight: (height: number, done: boolean) => void;
}

const TAB_NAMES: Record<DeskTab, string> = { track: '', mixer: 'Mixer', effects: 'Effects' };

// The strip above the dock (docs/DESK_LAYOUT_PLAN.md, stage 2): a handle to drag it taller or shorter,
// and its tabs. The dock shows exactly one unit of the rack, chosen here and by the track list; the
// other units are hidden by CSS (rack.css), never taken away. The handle is a separator that can be
// focused, moved with the arrow keys, and set to its least or most with Home and End.
export default function DeskDockBar({ trackName, tab, onTab, height, viewport, onHeight }: DeskDockBarProps) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const max = dockMax(viewport);
  const dragged = (event: PointerEvent<HTMLDivElement>) => clampDockHeight((drag.current?.height ?? height) + (drag.current?.y ?? event.clientY) - event.clientY, viewport);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { y: event.clientY, height };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onHeight(dragged(event), false);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onHeight(dragged(event), true);
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = dockKeyHeight(event.key, height, viewport);
    if (next === null) return;
    event.preventDefault();
    onHeight(next, true);
  };
  // The tabs are one stop; the arrows move between them, as a tab list does.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = DESK_TABS[(DESK_TABS.indexOf(tab) + step + DESK_TABS.length) % DESK_TABS.length];
    onTab(next);
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLElement>(`[data-tab-id="${next}"]`)?.focus());
  };
  return (
    <div className="desk-dock-bar">
      <div
        className="desk-dock-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Dock height"
        aria-valuenow={Math.round(height)}
        aria-valuemin={DOCK_MIN}
        aria-valuemax={max}
        aria-keyshortcuts="ArrowUp ArrowDown Home End"
        tabIndex={0}
        title={`Drag to make the dock taller or shorter, or press the arrow keys (${DOCK_STEP} pixels a press)`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      />
      <div ref={tabs} className="desk-dock-tabs" role="tablist" aria-label="Dock" onKeyDown={onTabKey}>
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
    </div>
  );
}
