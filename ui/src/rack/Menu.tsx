import { Fragment, useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  title?: string;
  onSelect: () => void;
  disabled?: boolean;
  // Drawn in the danger colour: for what clears or removes things.
  danger?: boolean;
}

// A panel button that drops a short list of actions, like a function key with a legend. The
// actions are in groups, with a line between them. A row's `title` is its hover hint, and on a
// phone, which has no hover, the stylesheet shows it as a second line under the row.
// `name`, when given, is what the button and its list are called to a screen reader, for a label
// that says less than that on its own (two menus called Presets).
export default function Menu({ label, name, groups }: { label: string; name?: string; groups: MenuItem[][] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="rack-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        className="rack-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name}
        onClick={() => setOpen(value => !value)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="rack-menu-list" role="menu" aria-label={name ?? label}>
          {groups.map((items, group) => (
            <Fragment key={group}>
              {group > 0 && <div className="rack-menu-sep" role="separator" />}
              {items.map(item => (
            <button
              key={item.label}
              role="menuitem"
              aria-label={item.label}
              title={item.title}
              data-hint={item.title}
              className={item.danger ? 'danger' : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                // Focus goes back to the menu button so a dialog opened from here can return it there.
                buttonRef.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
