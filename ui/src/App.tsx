import { useEffect, useState } from 'react';
import { useStudio } from './studio/useStudio';
import { decodeShare, sharePayload } from './services/shareLink';
import Rack from './rack/Rack';
import SharedSongPage from './rack/SharedSongPage';

export default function App() {
  const studio = useStudio();
  // A share link opens a page for that song instead of the visitor's own project.
  const [shared, setShared] = useState<{ file: unknown } | null>(null);
  useEffect(() => {
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
        onOpenCopy={() => { void studio.handleImportProject(shared.file).then(opened => { if (opened) leave(); }); }}
        onLeave={leave}
      />
    );
  }
  return <Rack studio={studio} />;
}
