// How the song's order is shown: the row of blocks, the playlist, one row for each entry with
// its length and times, or the timeline, the song's bars with the audio tracks under them. The choice is kept per browser, not with the project: it is about how a
// person likes to read the song, and both show and edit the same entries.
export const SONG_VIEWS = ['blocks', 'playlist', 'timeline'] as const;
export type SongView = typeof SONG_VIEWS[number];

const VIEW_KEY = 'discobot_song_view_v1';

export function asSongView(value: unknown): SongView | null {
  return SONG_VIEWS.includes(value as SongView) ? value as SongView : null;
}

export function storedSongView(): SongView {
  try { return asSongView(localStorage.getItem(VIEW_KEY)) ?? 'blocks'; } catch { return 'blocks'; }
}

export function storeSongView(view: SongView) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* the next visit starts on the blocks */ }
}
