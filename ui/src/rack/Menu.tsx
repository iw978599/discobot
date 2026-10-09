import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  title?: string;
  onSelect: () => void;
}

// A panel button that drops a short list of actions, like a function key with a legend.
export default function Menu({ label, items }: { label: string; items: MenuItem[] }) {
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
        onClick={() => setOpen(value => !value)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="rack-menu-list" role="menu" aria-label={label}>
          {items.map(item => (
            <button
              key={item.label}
              role="menuitem"
              title={item.title}
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
        </div>
      )}
    </div>
  );
}
