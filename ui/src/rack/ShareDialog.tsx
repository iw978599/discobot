import { useEffect, useState } from 'react';
import { localService } from '../services/localService';
import { accountsEnabled, songsApi } from '../services/account';
import { MAX_SHARE_LENGTH, encodeShare, shareUrl, shortUrl, slimProject } from '../services/shareLink';
import { useAccountUser } from './AccountDialog';
import Dialog from './Dialog';

function LinkRow({ label, link, onProblem }: { label: string; link: string; onProblem: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rack-list-row">
      <input aria-label={label} readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
      <button
        className="rack-btn go"
        onClick={() => {
          void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => onProblem('The link could not be copied. Select it and copy it by hand.'));
        }}
      >
        {copied ? 'Copied' : 'Copy Link'}
      </button>
    </div>
  );
}

// Two ways to share the open project. Signed in, it can be published: the song is stored on
// the account server and the link is short. Without an account the whole song travels inside
// a long link and nothing is stored anywhere.
export default function ShareDialog({ onClose }: { onClose: () => void }) {
  const user = useAccountUser();
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState('');
  // undefined while looking; null when this project is not published.
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState('');

  useEffect(() => {
    let mounted = true;
    encodeShare(localService.exportProject())
      .then(payload => {
        if (!mounted) return;
        const url = shareUrl(payload, window.location.href);
        if (url.length > MAX_SHARE_LENGTH) setProblem('This project is too large to fit in a link. Use Project → Export Project and send the file instead.');
        else setLink(url);
      })
      .catch(() => { if (mounted) setProblem('This browser cannot make share links. Use Project → Export Project and send the file instead.'); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!user) { setCode(undefined); return; }
    let mounted = true;
    const projectId = localService.exportProject().project.projectId;
    songsApi.mine()
      .then(list => { if (mounted) setCode(list.find(song => song.projectId === projectId)?.code ?? null); })
      .catch(() => { if (mounted) setCode(null); });
    return () => { mounted = false; };
  }, [user]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem('');
    try { await work(); } catch (cause) { setProblem(cause instanceof Error ? cause.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  };
  const publish = () => act(async () => {
    const file = localService.exportProject();
    setCode(await songsApi.publish(file.project.projectId, file.project.name, slimProject(file)));
    setPublished(code ? 'The published song now matches this project.' : 'Published.');
  });
  const unpublish = () => act(async () => {
    if (code) await songsApi.unpublish(code);
    setCode(null);
    setPublished('Unpublished. The short link no longer opens anything.');
  });

  return (
    <Dialog title="Share this song" closeLabel="Close sharing" onClose={onClose}>
      {problem && <p role="alert">{problem}</p>}

      {accountsEnabled && (
        <>
          <h3>Short link</h3>
          {!user && <p className="rack-empty">Sign in to publish this song and get a short link. Opening one does not need an account.</p>}
          {user && code === undefined && <p className="rack-empty">Checking…</p>}
          {user && code === null && (
            <>
              <p>Publishing stores a copy of this song on Discobot's server under your username, <strong>{user.username}</strong>. Anyone with the link can play it and keep a copy.</p>
              <div className="rack-dialog-actions start">
                <button className="rack-btn go" disabled={busy} onClick={() => { void publish(); }}>{busy ? 'Publishing…' : 'Publish and Get a Short Link'}</button>
              </div>
            </>
          )}
          {user && code && (
            <>
              <LinkRow label="Short link" link={shortUrl(code, window.location.href)} onProblem={setProblem} />
              <p className="rack-empty">The link plays the song as it was when you last published it. Later edits are not included until you update it.</p>
              <div className="rack-dialog-actions start account-actions">
                <button className="rack-btn" disabled={busy} title="Replace the published song with this project as it is now. The link stays the same" onClick={() => { void publish(); }}>Update Published Song</button>
                <button className="rack-btn danger" disabled={busy} title="Remove the song from the server. The link stops working" onClick={() => { void unpublish(); }}>Unpublish</button>
              </div>
            </>
          )}
          {published && <p role="status">{published}</p>}
          <h3>Link with the song inside it</h3>
        </>
      )}

      {!problem && !link && <p className="rack-empty">Making the link…</p>}
      {link && (
        <>
          {!accountsEnabled && <p>Anyone who opens this link gets a page that plays the song, and can keep their own copy to edit.</p>}
          <LinkRow label="Share link" link={link} onProblem={setProblem} />
          <p className="rack-empty">
            The whole song is inside the link itself ({link.length.toLocaleString()} characters); nothing is uploaded or stored anywhere.
            The link is a snapshot, so later edits are not included, and it cannot be taken back once sent. Imported samples are not part of it.
          </p>
        </>
      )}
    </Dialog>
  );
}
