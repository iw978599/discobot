import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNarrow } from '../hooks/useNarrow';

export interface NestedMenuItem {
  id: string;
  label: string;
  // Drawn after the label and left out of the row's spoken name.
  mark?: string;
  title?: string;
}

export interface NestedMenuGroup {
  label: string;
  items: NestedMenuItem[];
}

// How long a pointer rests on a group before its list opens, so one that only crosses a row on
// its way to the open list does not swap that list for another.
const HOVER_MS = 150;
// The room two lists side by side need to the right of the button; with less, they open leftwards.
const ROOM = 420;

// A panel button that picks one thing out of groups: Menu's sibling, for a choice too long for one
// list. The button shows what was last picked. Its list holds the groups, and a group's own list
// opens beside it; on a narrow screen, where a menu is a sheet along the bottom, the group's list
// takes the sheet over under a Back row. Rows are reached with the arrow keys, not Tab, so Tab
// leaves the menu, which closes behind it. `top` are choices that belong to no group, listed above
// the groups and chosen from the first list.
export default function NestedMenu({ label, text, mark, title, top = [], groups, onSelect }: {
  // What the menu chooses. The button's spoken name is this and then `text`.
  label: string;
  text: string;
  mark?: string;
  title?: string;
  top?: NestedMenuItem[];
  groups: NestedMenuGroup[];
  onSelect: (id: string) => void;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const afterRender = useRef<(() => void) | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const groupRef = useRef(group);
  groupRef.current = group;

  // Focus can only move to a row once it has been drawn.
  useEffect(() => {
    const run = afterRender.current;
    afterRender.current = null;
    run?.();
  });
  const then = (run: () => void) => {
    afterRender.current = run;
    setTick(value => value + 1);
  };

  const rows = (level: 0 | 1) => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(`[role="menuitem"][data-level="${level}"]`) ?? []);
  const close = (refocus: boolean) => {
    window.clearTimeout(hoverTimer.current);
    setOpen(false);
    setGroup(null);
    if (refocus) buttonRef.current?.focus();
  };
  const show = (last = false) => {
    const box = buttonRef.current?.getBoundingClientRect();
    setFlip(Boolean(box && box.left + ROOM > window.innerWidth));
    setGroup(null);
    setOpen(true);
    then(() => {
      const list = rows(0);
      list[last ? list.length - 1 : 0]?.focus();
    });
  };
  const openGroup = (name: string) => {
    window.clearTimeout(hoverTimer.current);
    setGroup(name);
    then(() => {
      const list = rows(1);
      // On a narrow screen the first row is Back; the keyboard lands on the first thing to choose.
      (list.find(row => row.dataset.back === undefined) ?? list[0])?.focus();
    });
  };
  const back = () => {
    const name = groupRef.current;
    setGroup(null);
    then(() => {
      const list = rows(0);
      (list.find(row => row.dataset.group === name) ?? list[0])?.focus();
    });
  };
  const actions = useRef({ close, back });
  actions.current = { close, back };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) actions.current.close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (groupRef.current !== null) actions.current.back();
      else actions.current.close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const target = event.target as HTMLButtonElement;
    if (target === buttonRef.current) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      show(event.key === 'ArrowUp');
      return;
    }
    if (target.getAttribute('role') !== 'menuitem') return;
    const level = target.dataset.level === '1' ? 1 : 0;
    const list = rows(level);
    const move = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(list.indexOf(target) + 1);
    else if (event.key === 'ArrowUp') move(list.indexOf(target) - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'ArrowRight' && target.dataset.group !== undefined) {
      event.preventDefault();
      openGroup(target.dataset.group);
    } else if (event.key === 'ArrowLeft' && level === 1) {
      event.preventDefault();
      back();
    }
  };

  const current = groups.find(entry => entry.label === group) ?? null;
  const drilled = narrow && current !== null;
  const choices = (items: NestedMenuItem[], level: 0 | 1) => items.map(item => (
    <button
      key={item.id}
      role="menuitem"
      tabIndex={-1}
      data-level={level}
      data-item={item.id}
      aria-label={item.label}
      title={item.title}
      onClick={() => {
        close(true);
        onSelect(item.id);
      }}
    >
      {item.label}{item.mark && <span aria-hidden="true">{item.mark}</span>}
    </button>
  ));

  return (
    <div
      className={`rack-menu nested${flip && !narrow ? ' flip' : ''}`}
      ref={rootRef}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Focus that has gone to something else on the page (Tab) closes the menu. A row that was
        // taken away while it had the focus reports nothing here, and must not.
        if (open && event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) close(false);
      }}
    >
      <button
        ref={buttonRef}
        className="rack-btn rack-menu-pick"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        title={title}
        onClick={() => (open ? close(false) : show())}
      >
        <span>{text}{mark && <span aria-hidden="true">{mark}</span>}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && !drilled && (
        <div className="rack-menu-list" role="menu" aria-label={label}>
          {choices(top, 0)}
          {groups.map(entry => (
            <div className="rack-menu-group" role="none" key={entry.label}>
              <button
                role="menuitem"
                tabIndex={-1}
                data-level={0}
                data-group={entry.label}
                aria-label={entry.label}
                aria-haspopup="menu"
                aria-expanded={entry === current}
                onClick={() => openGroup(entry.label)}
                onPointerEnter={(event) => {
                  if (narrow || event.pointerType !== 'mouse') return;
                  window.clearTimeout(hoverTimer.current);
                  hoverTimer.current = window.setTimeout(() => setGroup(entry.label), HOVER_MS);
                }}
                onPointerLeave={() => window.clearTimeout(hoverTimer.current)}
              >
                <span>{entry.label}</span>
                <span aria-hidden="true">▸</span>
              </button>
              {entry === current && (
                <div className="rack-menu-list" role="menu" aria-label={entry.label}>
                  {choices(entry.items, 1)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {open && drilled && current && (
        <div className="rack-menu-list" role="menu" aria-label={current.label}>
          <button role="menuitem" tabIndex={-1} data-level={1} data-back="" aria-label="Back" onClick={back}>
            <span aria-hidden="true">‹ </span>Back
          </button>
          <div className="rack-menu-head" role="presentation">{current.label}</div>
          {choices(current.items, 1)}
        </div>
      )}
    </div>
  );
}
