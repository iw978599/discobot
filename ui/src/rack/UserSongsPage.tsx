import { useEffect, useState } from 'react';
import { AccountError, accountsEnabled, songsApi, type UserSongs } from '../services/account';
import { SHORT_PREFIX } from '../services/shareLink';
import './rack.css';

const day = (time: number) => new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' });

const UNAVAILABLE = 'Pages of published songs are not available here yet.';
const UNREACHABLE = 'The song server could not be reached. Check your connection and try again.';

type Found = { state: 'looking' } | { state: 'listed'; list: UserSongs } | { state: 'failed'; problem: string; retry: boolean };

// The page one person's link opens: the songs they have published, each leading to its own
// page. It is only reached by its link; there is no list of people and nothing to search.
// `username` is empty when the link names something that could not be a username.
export default function UserSongsPage({ username }: { username: string }) {
  const [found, setFound] = useState<Found>({ state: 'looking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!username) { setFound({ state: 'listed', list: { author: '', songs: [] } }); return; }
    if (!accountsEnabled) { setFound({ state: 'failed', problem: UNAVAILABLE, retry: false }); return; }
    let mounted = true;
    setFound({ state: 'looking' });
    songsApi.by(username).then(
      list => { if (mounted) setFound({ state: 'listed', list }); },
      (error: unknown) => {
        if (!mounted) return;
        const status = error instanceof AccountError ? error.status : -1;
        // A server from before this page existed answers 404: the site can be ahead of it.
        if (status === 404) setFound({ state: 'failed', problem: UNAVAILABLE, retry: false });
        else if (status === 0) setFound({ state: 'failed', problem: UNREACHABLE, retry: true });
        else setFound({ state: 'failed', problem: error instanceof Error && status > 0 ? error.message : 'The songs could not be read. Try again.', retry: true });
      },
    );
    return () => { mounted = false; };
  }, [username, attempt]);

  const leave = () => { window.location.assign(window.location.pathname + window.location.search); };
  const list = found.state === 'listed' ? found.list : null;

  return (
    <div className="rack-page shared-page">
      <main className="rack-unit shared-card" aria-label="Published songs">
        <span className="shared-eyebrow">Songs published from Discobot</span>
        <h1>{list?.author || username || 'Nobody by that name'}</h1>
        {found.state === 'looking' && <p className="rack-empty" role="status">Looking for songs…</p>}
        {found.state === 'failed' && <p role="alert">{found.problem}</p>}
        {list && list.songs.length === 0 && (
          <p role="status">
            {username
              ? 'There are no published songs under this name. Either nobody has published under it, or the songs have been unpublished.'
              : 'This link does not hold a username, so there are no songs to show.'}
          </p>
        )}
        {list && list.songs.length > 0 && (
          <ul className="shared-songs" aria-label={`Songs by ${list.author}`}>
            {list.songs.map(song => (
              <li key={song.code}>
                <a className="rack-list-row" href={`${SHORT_PREFIX}${song.code}`}>
                  <span>
                    <strong>{song.title}</strong>
                    {song.updatedAt > 0 && <small>Updated {day(song.updatedAt)}</small>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="shared-actions">
          {found.state === 'failed' && found.retry && <button className="rack-btn go" onClick={() => setAttempt(attempt + 1)}>Try Again</button>}
          <button className="rack-btn" onClick={leave}>Go to Discobot</button>
        </div>
        {list && list.songs.length > 0 && (
          <p className="rack-hint">
            These are the songs {list.author} has chosen to publish. Each is played by your own browser, and nothing is saved here unless you ask for a copy.
          </p>
        )}
      </main>
    </div>
  );
}
