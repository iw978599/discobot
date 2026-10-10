import { useEffect, useState } from 'react';
import { useStudio } from './studio/useStudio';
import { decodeShare, sharePayload, shortCode } from './services/shareLink';
import { accountsEnabled, songsApi } from './services/account';
import Rack from './rack/Rack';
import SharedSongPage from './rack/SharedSongPage';
import KidsPage from './kids/KidsPage';
import { isKidsLink } from './services/kids';

// Kids mode is a page of its own. It is chosen before anything opens the projects, so it
// cannot change them; going in or out reloads the page.
export default function App() {
  const [kids] = useState(() => isKidsLink(window.location.hash));
  useEffect(() => {
    const onHashChange = () => { if (isKidsLink(window.location.hash) !== kids) window.location.reload(); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [kids]);
  return kids ? <KidsPage /> : <Workstation />;
}

function Workstation() {
  const studio = useStudio();
  // A share link opens a page for that song instead of the visitor's own project.
  const [shared, setShared] = useState<{ file: unknown; author?: string; error?: string } | null>(null);
  useEffect(() => {
    // A short link names a published song, which is fetched because the visitor asked for it.
    const code = shortCode(window.location.hash);
    if (code && accountsEnabled) {
      songsApi.get(code).then(
        song => setShared({ file: song.project, author: song.author }),
        (error: unknown) => setShared({ file: null, error: error instanceof Error ? error.message : undefined }),
      );
      return;
    }
    const payload = sharePayload(window.location.hash);
    if (!payload) return;
    // A link that cannot be decoded still gets the page, which explains what went wrong.
    decodeShare(payload).then(file => setShared({ file }), () => setShared({ file: null }));
  }, []);
  const leave = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setShared(null);
  };

  if (shared && studio.projectId) {
    return (
      <SharedSongPage
        file={shared.file}
        author={shared.author}
        error={shared.error}
        onOpenCopy={() => { void studio.handleImportProject(shared.file).then(opened => { if (opened) leave(); }); }}
        onLeave={leave}
      />
    );
  }
  return <Rack studio={studio} />;
}
