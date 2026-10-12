import type { ReactNode } from 'react';
import Dialog from './Dialog';

interface ConfirmDialogProps {
  title: string;
  // The button that goes ahead, named for what it does: "Delete", "Remove".
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

// The app's own "are you sure" for something that cannot be taken back. It is not the browser's
// pop-up, which a browser can be told to stop showing and then answers no without asking. Focus
// starts on Cancel, so Enter never deletes by accident.
export default function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }: ConfirmDialogProps) {
  return (
    <Dialog title={title} closeLabel="Close" onClose={onCancel} initialFocus=".confirm-cancel" small>
      <p>{children}</p>
      <div className="rack-dialog-actions confirm-actions">
        <button className="rack-btn confirm-cancel" onClick={onCancel}>Cancel</button>
        <button className="rack-btn danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
