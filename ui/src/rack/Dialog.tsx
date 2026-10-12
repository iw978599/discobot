import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  // A short panel docked to the bottom edge, where a thumb is, instead of the whole screen.
  sheet?: boolean;
  // What takes focus when it opens, as a selector. The first button, unless told otherwise.
  initialFocus?: string;
  // A short question laid over whatever is open, a panel even on a phone.
  small?: boolean;
}

// The dialogs that are open, the newest last. Only that one answers the keyboard, so Escape in a
// question asked from inside a dialog closes the question and not the dialog under it.
const open: symbol[] = [];

// One modal for the whole app: traps Tab, closes on Escape or a click outside, and puts
// focus back where it came from.
export default function Dialog({ title, closeLabel, onClose, children, sheet = false, initialFocus = 'button', small = false }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const self = Symbol('dialog');
    open.push(self);
    dialogRef.current?.querySelector<HTMLElement>(initialFocus)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (open[open.length - 1] !== self) return;
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
      open.splice(open.indexOf(self), 1);
      previous?.focus();
    };
  }, []);

  return (
    <div className={sheet ? 'rack-dialog-overlay sheet' : small ? 'rack-dialog-overlay small' : 'rack-dialog-overlay'} onClick={(event) => { event.stopPropagation(); onClose(); }} role="presentation">
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
