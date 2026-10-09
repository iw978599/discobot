import { useEffect, useState } from 'react';
import { useStudio } from './studio/useStudio';
import { decodeShare, sharePayload, shortCode } from './services/shareLink';
import { accountsEnabled, songsApi } from './services/account';
import Rack from './rack/Rack';
import SharedSongPage from './rack/SharedSongPage';

export default function App() {
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
