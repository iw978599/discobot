import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { localService } from '../services/localService';
import { projectSync } from '../services/projectSync';
import { saveLabel } from '../services/saveState';
import { useAccountUser, useSyncStatus } from './AccountDialog';

// A word beside the project's name that says where its work is. It is a polite live region, and
// its box is always as wide as the longest word so the bar does not move as it changes.
export default function SaveState({ projectId, full = false }: { projectId: string; full?: boolean }) {
  const save = useSyncExternalStore(listener => localService.subscribeSaveState(listener), () => localService.saveState());
  const user = useAccountUser();
  const sync = useSyncStatus();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // Edits written in this page, and how many there were when the last upload began. An upload
  // that began before the latest write may not hold it.
  const writes = useRef(0);
  const uploadedAt = useRef(0);
  useEffect(() => localService.subscribeWrites(() => { writes.current++; bump(); }), []);
  useEffect(() => projectSync.subscribe(() => { if (projectSync.status().state === 'syncing') uploadedAt.current = writes.current; }), []);
  const signedIn = Boolean(user) && sync.signedIn;
  const label = saveLabel({
    save,
    signedIn,
    inAccount: sync.inAccount.includes(projectId) || Boolean(sync.shared[projectId]),
    accountCurrent: sync.state === 'idle' && uploadedAt.current === writes.current && !sync.problems[projectId],
    browserOnly: sync.browserOnly.includes(projectId) || Boolean(sync.problems[projectId]),
  });
  if (full) return <span className="save-state full" role="status">{label.long}</span>;
  return (
    <span className="save-state" role="status" title={label.long}>
      <span aria-hidden="true">{label.short}</span>
      <span className="sr-only">{label.long}</span>
    </span>
  );
}
