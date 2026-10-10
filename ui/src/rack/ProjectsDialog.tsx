import { useEffect, useState, type FormEvent } from 'react';
import type { Studio } from '../studio/useStudio';
import { AccountError, sharingApi } from '../services/account';
import { projectSync } from '../services/projectSync';
import { useAccountUser, useSyncStatus } from './AccountDialog';
import Dialog from './Dialog';

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Who else may open and save one of the account's projects. Only its owner sees this.
function Sharing({ projectId, name }: { projectId: string; name: string }) {
  const [members, setMembers] = useState<string[] | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setMembers(await sharingApi.members(projectId));
      void projectSync.sync();
    } catch (cause) {
      // An accounts server from before sharing existed does not know the address at all.
      const unknown = cause instanceof AccountError && cause.status === 404 && cause.message === 'Not found.';
      setError(unknown ? 'Sharing is not switched on for this site yet.' : cause instanceof Error ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void run(async () => {}); }, [projectId]);

  return (
    <div className="rack-share" role="group" aria-label={`Share ${name}`}>
      <p>
        People you add can open this project and save changes to it. You take turns: if two of you change it at the same time,
        both versions are kept and nothing is overwritten. Imported samples and guest instruments stay in each person's own browser.
      </p>
      {members?.length === 0 && <p className="rack-empty">Not shared with anyone yet.</p>}
      {members?.map(member => (
        <div key={member} className="rack-list-row" role="group" aria-label={`Shared with ${member}`}>
          <span><strong>{member}</strong></span>
          <button className="rack-btn danger" disabled={busy} onClick={() => { void run(() => sharingApi.unshare(projectId, member)); }}>Remove</button>
        </div>
      ))}
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const wanted = username.trim();
          if (wanted) void run(async () => { await sharingApi.share(projectId, wanted); setUsername(''); });
        }}
      >
        <input aria-label="Username to share with" placeholder="Their username" autoCapitalize="none" spellCheck={false} maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} />
        <button className="rack-btn go" type="submit" disabled={busy || !username.trim()}>Share</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

// Every project in this browser. The open one saves itself as you work; "Copy" keeps a
// version to go back to.
export default function ProjectsDialog({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [protectedStorage, setProtectedStorage] = useState<boolean | null>(null);
  // The project whose sharing is on show, and why one that was shared could not be opened.
  const [sharing, setSharing] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const user = useAccountUser();
  const sync = useSyncStatus();

  useEffect(() => {
    let mounted = true;
    // Ask the browser not to clear this site's data when it is short of space. It may say no.
    const storage = navigator.storage;
    if (!storage?.persist) return;
    void storage.persist().then(granted => { if (mounted) setProtectedStorage(granted); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const commitRename = () => {
    const name = draftName.trim();
    if (renaming && name) void studio.handleRenameProject(renaming, name);
    setRenaming(null);
  };

  return (
    <Dialog title="Projects" closeLabel="Close projects" onClose={onClose}>
      <div className="rack-dialog-actions start">
        <button className="rack-btn go" onClick={() => { void studio.handleNewProject().then(ok => { if (ok) onClose(); }); }}>New Project</button>
      </div>
      {studio.projects.length === 0 && <p className="rack-empty">Loading projects…</p>}
      {studio.projects.map((project) => {
        const open = project.id === studio.projectId;
        const synced = sync.inAccount.includes(project.id);
        const theirs = user ? sync.shared[project.id] : undefined;
        const withOthers = user ? sync.sharedByMe[project.id] : undefined;
        const lastSaved = (by: string | undefined) => (by && by.toLowerCase() !== user?.username.toLowerCase() ? ` · Last saved by ${by}` : '');
        const where = !user ? '' : sync.problems[project.id] ? ` · Not synced: ${sync.problems[project.id]}`
          : theirs ? ` · Shared by ${theirs.owner}${lastSaved(theirs.savedBy)}`
            : withOthers ? ` · In your account · Shared with ${withOthers.people}${lastSaved(withOthers.savedBy)}`
              : synced ? ' · In your account' : ' · This browser only';
        return [
          <div key={project.id} className={`rack-list-row ${open ? 'current' : ''}`} role="group" aria-label={`Project ${project.name}`}>
            {renaming === project.id ? (
              <input
                autoFocus
                aria-label="Project name"
                maxLength={60}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename();
                  if (event.key === 'Escape') { event.stopPropagation(); setRenaming(null); }
                }}
              />
            ) : (
              <span>
                <strong>{project.name}</strong>
                <small>{open ? 'Open now · saves as you work' : `Last changed ${when(project.updatedAt)}`}{where}</small>
              </span>
            )}
            {user && !synced && sync.browserOnly.includes(project.id) && (
              <button className="rack-btn" title="Keep this project in your account too" onClick={() => { void projectSync.addToAccount([project.id]); }}>Add to Account</button>
            )}
            {user && synced && (
              <button className={`rack-btn ${sharing === project.id ? 'on' : ''}`} aria-pressed={sharing === project.id} title="Work on this project with someone else, in turns" onClick={() => setSharing(sharing === project.id ? null : project.id)}>Share</button>
            )}
            {theirs && (
              <button className="rack-btn" title={`Stop working on this with ${theirs.owner}. Your copy stays in this browser`} onClick={() => { void projectSync.leave(project.id); }}>Leave</button>
            )}
            <button className="rack-btn" disabled={open} onClick={() => { void studio.handleOpenProject(project.id).then(ok => { if (ok) onClose(); }); }}>Open</button>
            <button className="rack-btn" onClick={() => { setDraftName(project.name); setRenaming(project.id); }}>Rename</button>
            <button className="rack-btn" title="Keep a copy of this project as it is now" onClick={() => { void studio.handleCopyProject(project.id); }}>Copy</button>
            <button
              className="rack-btn danger"
              onClick={() => {
                const from = theirs ? ` from this browser? ${theirs.owner}'s project is not deleted, and you stop working on it together.` : `${user && synced ? ' from this browser and from your account' : ''}?`;
                if (window.confirm(`Delete the project "${project.name}"${from} This cannot be undone.`)) void studio.handleDeleteProject(project.id);
              }}
            >
              Delete
            </button>
          </div>,
          sharing === project.id && user && synced && <Sharing key={`${project.id}-sharing`} projectId={project.id} name={project.name} />,
        ];
      })}
      {user && sync.offered.length > 0 && (
        <>
          <h3>Shared with you</h3>
          {sync.offered.map(offer => (
            <div key={offer.id} className="rack-list-row" role="group" aria-label={`Shared project ${offer.name}`}>
              <span>
                <strong>{offer.name}</strong>
                <small>From {offer.owner} · Last saved by {offer.savedBy} · {when(offer.updatedAt)}</small>
              </span>
              <button
                className="rack-btn"
                title={`Bring ${offer.owner}'s project into this browser and work on it with them`}
                onClick={() => {
                  setJoinError('');
                  void projectSync.join(offer.owner, offer.id).then(async (arrived) => {
                    if (!arrived) { setJoinError(`“${offer.name}” could not be opened. A project it would replace may already be in this browser.`); return; }
                    if (await studio.handleOpenProject(offer.id)) onClose();
                  });
                }}
              >
                Open
              </button>
            </div>
          ))}
          {joinError && <p role="alert">{joinError}</p>}
        </>
      )}
      <p className="rack-empty">
        {user ? 'Projects in your account are stored there and in this browser. The rest are in this browser only. Share lets someone else with an account work on one of yours with you, in turns.' : 'Projects are stored in this browser on this device.'}
        {protectedStorage === true && ' The browser has agreed not to clear them to free up space.'}
        {protectedStorage === false && ' The browser may clear them if it runs short of space, so export the ones you care about.'}
        {' '}Use Project → Export Project for a backup file.
      </p>
    </Dialog>
  );
}
