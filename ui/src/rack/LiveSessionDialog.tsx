import { useState, useSyncExternalStore } from 'react';
import type { Studio } from '../studio/useStudio';
import { currentUser } from '../services/account';
import { localService } from '../services/localService';
import { projectSync } from '../services/projectSync';
import { liveStatus, liveSummary, liveUnavailableReason, retryLiveSession, subscribeLive } from '../services/liveSession';
import { useAccountUser, useSyncStatus } from './AccountDialog';
import { Sharing } from './ProjectsDialog';
import Dialog from './Dialog';

export default function LiveSessionDialog({ studio, onClose, onSignIn }: { studio: Studio; onClose: () => void; onSignIn: () => void }) {
  const user = useAccountUser();
  const sync = useSyncStatus();
  const summary = useSyncExternalStore(subscribeLive, liveSummary);
  const people = useSyncExternalStore(subscribeLive, () => liveStatus().others.map(member => member.user).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = studio.projectId;
  const shared = sync.shared[id];
  const connectedProject = !!(shared || sync.sharedByMe[id]);
  const inAccount = sync.inAccount.includes(id);
  const unavailable = liveUnavailableReason();

  const prepare = async () => {
    const check = () => {
      if (!user || currentUser()?.username !== user.username) throw new Error('Sign in again before sharing this project.');
      if (localService.openProjectId() !== id) throw new Error('The open project changed during sync. Review the kept versions, then open Start Live Session again.');
      if (localService.savingPaused) throw new Error('Choose which tab’s version to keep before starting a live session.');
      if (!localService.flush() || localService.saveState() === 'failed') throw new Error('The project could not be saved in this browser. Free space or allow storage, then try again.');
    };
    check();
    await projectSync.sync();
    check();
    if (projectSync.status().state === 'error') throw new Error(projectSync.status().error);
    if (!projectSync.status().inAccount.includes(id) && !projectSync.status().shared[id]) {
      await projectSync.addToAccount([id]);
      check();
    }
    const status = projectSync.status();
    if (status.state === 'error' || status.problems[id]) throw new Error(status.problems[id] || status.error);
    if (!status.inAccount.includes(id) && !status.shared[id]) throw new Error('The project is not in your account yet. Try syncing again.');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try { await prepare(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sync this project. Try again.'); } finally { setBusy(false); }
  };

  return (
    <Dialog title="Start Live Session" closeLabel="Close live session setup" onClose={onClose}>
      <p><strong>{studio.projectName}</strong> — edit the project and play notes and drum pads together, each through your own browser.</p>
      {unavailable ? <p>{unavailable}</p> : (
        <>
          {!user && <p>Everyone needs an account and must sign in. Sign in to continue setting up this project; your browser’s edits stay here.</p>}
          <button className={`rack-btn ${user ? '' : 'go'}`} onClick={onSignIn}>{user ? 'Account' : 'Sign In'}</button>
          {user && <>
          {connectedProject ? (
            <>
              <p role="status">{summary}{people ? ` ${people}` : ''}</p>
              {liveStatus().state === 'closed' && <button className="rack-btn" onClick={retryLiveSession}>Retry Connection</button>}
            </>
          ) : <p role="status">Add a collaborator below to start the live connection automatically.</p>}
          {shared ? <p>Shared by <strong>{shared.owner}</strong>. Only the owner can add or remove collaborators.</p> : inAccount ? (
            <Sharing key={user.username} projectId={id} name={studio.projectName} beforeShare={prepare} />
          ) : (
            <>
              <p>First save this project to your account so collaborators can open it. This uploads the project, not its sample audio. If it changed elsewhere, sync keeps both versions.</p>
              <button className="rack-btn go" disabled={busy || sync.state === 'syncing' || studio.changedElsewhere} onClick={() => { void save(); }}>
                {busy || sync.state === 'syncing' ? 'Saving and syncing…' : 'Add to Account and Continue'}
              </button>
            </>
          )}
          {studio.changedElsewhere && <p role="alert">Another tab changed this project. Close this dialog and choose which version to keep in the rack’s message.</p>}
          {sync.keptBoth.length > 0 && <p role="alert">Sync kept both versions of {sync.keptBoth.map(name => `“${name}”`).join(', ')}. Your edits are in “… (this browser’s version)”. This setup is for <strong>{studio.projectName}</strong>; review the versions in All Projects before inviting anyone.</p>}
          {(error || sync.error || sync.problems[id]) && <p role="alert">{error || sync.problems[id] || sync.error}</p>}
          {(sync.error || sync.problems[id]) && <button className="rack-btn" disabled={busy || sync.state === 'syncing'} onClick={() => { void save(); }}>Sync Again</button>}
          <h3>How collaborators join</h3>
          <p>Ask them to sign in on this site, then choose <strong>Project → All Projects</strong>. Under <strong>Shared with you</strong>, find <strong>{studio.projectName}</strong> and press <strong>Open</strong>. If it is not listed yet, use <strong>Sync Now</strong> in their Account dialog. If already opened before, open it from their Projects list.</p>
          <p>Keep this project open. Shared projects join automatically; reopening this setup shows the same session. Press Play to enable sound and listen along. Closing this dialog does not end sharing. {shared ? 'Ask the owner to change project access.' : 'Remove a person’s access above to stop sharing with them.'}</p>
          <p className="rack-empty">Share Link is separate: it is for listening or keeping a copy, not joining a live session. A live session needs this site’s live server; a connection failure does not mean the invitation failed.</p>
          </>}
        </>
      )}
    </Dialog>
  );
}
