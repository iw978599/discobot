import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

// One modal for the whole app: traps Tab, closes on Escape or a click outside, and puts
// focus back where it came from.
export default function Dialog({ title, closeLabel, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]',
      ) || []);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="rack-dialog-overlay" onClick={onClose} role="presentation">
      <div ref={dialogRef} className="rack-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="rack-dialog-header">
          <h2>{title}</h2>
          <button className="rack-btn" aria-label={closeLabel} onClick={onClose}>✕</button>
        </div>
        <div className="rack-dialog-body">{children}</div>
      </div>
    </div>
  );
}
