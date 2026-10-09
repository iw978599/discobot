import { useEffect, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { projectSync } from '../services/projectSync';
import { useAccountUser, useSyncStatus } from './AccountDialog';
import Dialog from './Dialog';

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Every project in this browser. The open one saves itself as you work; "Copy" keeps a
// version to go back to.
export default function ProjectsDialog({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [protectedStorage, setProtectedStorage] = useState<boolean | null>(null);
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
        const where = !user ? '' : sync.problems[project.id] ? ` · Not synced: ${sync.problems[project.id]}` : synced ? ' · In your account' : ' · This browser only';
        return (
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
            <button className="rack-btn" disabled={open} onClick={() => { void studio.handleOpenProject(project.id).then(ok => { if (ok) onClose(); }); }}>Open</button>
            <button className="rack-btn" onClick={() => { setDraftName(project.name); setRenaming(project.id); }}>Rename</button>
            <button className="rack-btn" title="Keep a copy of this project as it is now" onClick={() => { void studio.handleCopyProject(project.id); }}>Copy</button>
            <button
              className="rack-btn danger"
              onClick={() => {
                if (window.confirm(`Delete the project "${project.name}"${user && synced ? ' from this browser and from your account' : ''}? This cannot be undone.`)) void studio.handleDeleteProject(project.id);
              }}
            >
              Delete
            </button>
          </div>
        );
      })}
      <p className="rack-empty">
        {user ? 'Projects in your account are stored there and in this browser. The rest are in this browser only.' : 'Projects are stored in this browser on this device.'}
        {protectedStorage === true && ' The browser has agreed not to clear them to free up space.'}
        {protectedStorage === false && ' The browser may clear them if it runs short of space, so export the ones you care about.'}
        {' '}Use Project → Export Project for a backup file.
      </p>
    </Dialog>
  );
}
