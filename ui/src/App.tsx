import { useEffect, useState } from 'react';
import { useStudio } from './studio/useStudio';
import { decodeShare, sharePayload, shortCode, userName } from './services/shareLink';
import { accountsEnabled, songsApi } from './services/account';
import Rack from './rack/Rack';
import SharedSongPage from './rack/SharedSongPage';
import UserSongsPage from './rack/UserSongsPage';
import KidsPage from './kids/KidsPage';
import { isKidsLink, keepKidsMode } from './services/kids';

// Kids mode is a page of its own. It is chosen before anything opens the projects, so it
// cannot change them; going in or out reloads the page. The page of one person's published
// songs (`#u=name`) is chosen the same way, and does not open the projects either.
export default function App() {
  const [kids] = useState(keepKidsMode);
  const [songsBy] = useState(() => userName(window.location.hash));
  useEffect(() => {
    const onHashChange = () => {
      // In kids mode a changed address is put back, not followed: the hold is the only way out.
      if (kids) keepKidsMode();
      else if (isKidsLink(window.location.hash) || userName(window.location.hash) !== songsBy) window.location.reload();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [kids, songsBy]);
  if (kids) return <KidsPage />;
  return songsBy === null ? <Workstation /> : <UserSongsPage username={songsBy} />;
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
