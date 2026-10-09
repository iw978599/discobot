import { useEffect, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { MAX_VERSIONS, localService } from '../services/localService';
import type { VersionInfo, VersionReason } from '../services/projectLibrary';
import Dialog from './Dialog';

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const REASONS: Record<VersionReason, string> = {
  opened: 'As it was when opened',
  auto: 'Kept while editing',
  'before-sync': 'Before a newer version arrived from your account',
  'before-restore': 'Before an earlier version was restored',
};

// Earlier states of the open project. They are kept automatically; nothing here needs saving.
export default function VersionsDialog({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [notice, setNotice] = useState('');
  const load = () => localService.listVersions().then(setVersions).catch(() => setVersions([]));
  useEffect(() => { void load(); }, [studio.projectId]);

  return (
    <Dialog title="Version history" closeLabel="Close version history" onClose={onClose}>
      <p>Earlier versions of <strong>{studio.projectName}</strong>, kept automatically in this browser.</p>
      {notice && <p role="status">{notice}</p>}
      {versions === null && <p className="rack-empty">Loading…</p>}
      {versions?.length === 0 && <p className="rack-empty">No earlier versions yet. One is kept when a project is opened and every few minutes while it is edited.</p>}
      {versions?.map(version => (
        <div key={version.id} className="rack-list-row" role="group" aria-label={`Version from ${when(version.at)}`}>
          <span>
            <strong>{when(version.at)}</strong>
            <small>{REASONS[version.reason] ?? 'Kept automatically'}</small>
          </span>
          <button
            className="rack-btn"
            title="Put the project back to this version. The project as it is now is kept as a version first"
            onClick={() => { void studio.handleRestoreVersion(version.id).then(async (ok) => { if (ok) { setNotice(`Restored the version from ${when(version.at)}. The project as it was is at the top of this list.`); await load(); } }); }}
          >
            Restore
          </button>
          <button
            className="rack-btn"
            title="Add this version to your projects as a separate project, leaving this one alone"
            onClick={() => { void studio.handleCopyVersion(version.id).then((ok) => { if (ok) setNotice('Saved as a separate project. Find it under Project → All Projects.'); }); }}
          >
            Save as a Copy
          </button>
        </div>
      ))}
      <p className="rack-empty">
        Up to {MAX_VERSIONS} versions are kept for each project, the oldest making way for new ones. They are stored in this browser only and are
        removed if the project is deleted.
      </p>
    </Dialog>
  );
}
