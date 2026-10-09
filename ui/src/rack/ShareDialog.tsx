import { useEffect, useState } from 'react';
import { localService } from '../services/localService';
import { MAX_SHARE_LENGTH, encodeShare, shareUrl } from '../services/shareLink';
import Dialog from './Dialog';

// Makes a link that carries the open project. There is no server: the song is in the link.
export default function ShareDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState(false);

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

  return (
    <Dialog title="Share this song" closeLabel="Close sharing" onClose={onClose}>
      {problem && <p role="alert">{problem}</p>}
      {!problem && !link && <p className="rack-empty">Making the link…</p>}
      {link && (
        <>
          <p>Anyone who opens this link gets a page that plays the song, and can keep their own copy to edit.</p>
          <div className="rack-list-row">
            <input aria-label="Share link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
            <button
              className="rack-btn go"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setProblem('The link could not be copied. Select it and copy it by hand.'));
              }}
            >
              {copied ? 'Copied' : 'Copy Link'}
            </button>
          </div>
          <p className="rack-empty">
            The whole song is inside the link itself ({link.length.toLocaleString()} characters); nothing is uploaded or stored anywhere.
            The link is a snapshot, so later edits are not included, and it cannot be taken back once sent. Imported samples are not part of it.
          </p>
        </>
      )}
    </Dialog>
  );
}
