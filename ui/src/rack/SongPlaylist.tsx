import { useEffect, useRef, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { MAX_REPEATS, MAX_SONG_ENTRIES, insertSongEntry, moveSongEntry, removeSongEntry, repeatSongEntry, songClock, songRows, type SongOrder } from '../services/songPlayback';

const barsText = (count: number) => `${count} ${count === 1 ? 'bar' : 'bars'}`;
const FOCUS_WAIT_MS = 2000;

// The song as a list read downwards: one row for each entry, in the order they play. It shows
// and edits the same entries as the blocks do, and holds nothing of its own but which scene the
// add buttons add.
export default function SongPlaylist({ studio }: { studio: Studio }) {
  const { scenes, currentSceneId, song, songPosition, songStartEntry } = studio;
  const [chosen, setChosen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const list = useRef<HTMLOListElement>(null);
  // An edit reaches the list a moment after its button is pressed. The button that made it may
  // by then belong to another row, so the edit says where the keyboard should be afterwards.
  const focusNext = useRef<{ row: number; controls: string[]; at: number; from: unknown } | null>(null);
  const rows = songRows(song, studio.sceneLength, studio.globalTempo, studio.sceneSignature);
  const totalBars = rows.reduce((sum, row) => sum + row.bars, 0);
  const totalSeconds = rows.reduce((sum, row) => sum + row.seconds, 0);
  const nameOf = (sceneId: string) => scenes.find(scene => scene.id === sceneId)?.name ?? '?';
  const adding = scenes.find(scene => scene.id === chosen) ?? scenes.find(scene => scene.id === currentSceneId) ?? scenes[0];
  const full = song.entries.length >= MAX_SONG_ENTRIES;

  useEffect(() => {
    const wanted = focusNext.current;
    if (!wanted || wanted.from === song.entries) return;
    focusNext.current = null;
    if (Date.now() - wanted.at > FOCUS_WAIT_MS) return;
    const row = list.current?.querySelector(`[data-row="${wanted.row}"]`);
    for (const control of wanted.controls) {
      const button = row?.querySelector<HTMLButtonElement>(`[data-control="${control}"]`);
      if (button && !button.disabled) { button.focus(); return; }
    }
  }, [song.entries]);

  const change = (order: SongOrder, row: number, controls: string[], message: string) => {
    if (order.entries === song.entries) return;
    focusNext.current = { row, controls, at: Date.now(), from: song.entries };
    studio.handleSongChange({ entries: order.entries });
    if (order.start !== songStartEntry) studio.setSongStartEntry(order.start);
    setSaid(message);
  };
  const move = (from: number, to: number, control: string) => change(
    moveSongEntry(song.entries, songStartEntry, from, to), to, [control, control === 'earlier' ? 'later' : 'earlier'],
    `${nameOf(song.entries[from].sceneId)} is now row ${to + 1} of ${song.entries.length}`,
  );
  const repeat = (index: number, repeats: number, control: string) => change(
    { entries: repeatSongEntry(song.entries, index, repeats), start: songStartEntry }, index, [control, control === 'fewer' ? 'more' : 'fewer'],
    `Row ${index + 1} plays ${repeats} ${repeats === 1 ? 'time' : 'times'}`,
  );
  const remove = (index: number) => change(
    removeSongEntry(song.entries, songStartEntry, index), Math.min(index, song.entries.length - 2), ['remove', 'open'],
    `Row ${index + 1}, ${nameOf(song.entries[index].sceneId)}, removed from the song`,
  );
  const insert = (at: number) => {
    if (adding) change(insertSongEntry(song.entries, songStartEntry, at, adding.id), at, ['open'], `${adding.name} added as row ${at + 1}`);
  };

  return (
    <div className="song-playlist">
      <ol className="song-list" ref={list} aria-label="Song playlist">
        {rows.map((row, index) => {
          const place = index + 1, name = nameOf(row.sceneId);
          const playing = songPosition?.entryIndex === index, start = songStartEntry === index;
          return (
            <li
              key={index}
              className={`song-list-row ${playing ? 'playing' : ''} ${start ? 'start' : ''}`}
              data-row={index}
              data-color={scenes.find(scene => scene.id === row.sceneId)?.color}
              aria-current={playing ? 'true' : undefined}
            >
              <div className="song-list-line" role="group" aria-label={`Song row ${place}: ${name}`}>
                <span className="song-list-place">
                  <span className={`rack-led ${playing ? 'on' : ''}`} />
                  {place}
                </span>
                <button
                  className="rack-btn song-list-name"
                  data-control="open"
                  aria-pressed={start}
                  aria-label={`Open ${name} from row ${place} and start the song here`}
                  title="Start the song from here and open this scene"
                  onClick={() => { studio.setSongStartEntry(index); void studio.handleSceneSelect(row.sceneId); }}
                >
                  <span className="song-list-scene">{name}</span>
                  {start && <span className="song-list-start">Start</span>}
                </button>
                <span className="song-list-repeats">
                  <button className="rack-btn" data-control="fewer" aria-label={`Fewer repeats for row ${place}`} disabled={row.repeats <= 1} onClick={() => repeat(index, row.repeats - 1, 'fewer')}>−</button>
                  <span className="song-list-count" title="How many times this row plays">
                    {playing && songPosition ? `${songPosition.repeat + 1}/${row.repeats}` : `×${row.repeats}`}
                  </span>
                  <button className="rack-btn" data-control="more" aria-label={`More repeats for row ${place}`} disabled={row.repeats >= MAX_REPEATS} onClick={() => repeat(index, row.repeats + 1, 'more')}>+</button>
                </span>
                <span className="song-list-bars">
                  {row.repeats > 1 && <>{barsText(row.passBars)} × {row.repeats} = </>}
                  <b>{barsText(row.bars)}</b>
                </span>
                <span className="song-list-time">
                  at <b>{songClock(row.startSeconds)}</b> for <b>{songClock(row.seconds)}</b>
                </span>
                <span className="song-list-tools">
                  <button className="rack-btn" data-control="earlier" aria-label={`Move row ${place} earlier`} disabled={index === 0} onClick={() => move(index, index - 1, 'earlier')}>▲</button>
                  <button className="rack-btn" data-control="later" aria-label={`Move row ${place} later`} disabled={index === rows.length - 1} onClick={() => move(index, index + 1, 'later')}>▼</button>
                  <button
                    className="rack-btn"
                    data-control="add"
                    aria-label={`Add ${adding?.name ?? 'a scene'} after row ${place}`}
                    title="Add the scene chosen below the list after this row"
                    disabled={!adding || full}
                    onClick={() => insert(index + 1)}
                  >
                    Add after
                  </button>
                  <button className="rack-btn danger" data-control="remove" aria-label={`Remove row ${place} from the song`} disabled={rows.length < 2} onClick={() => remove(index)}>Remove</button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="song-list-foot">
        <label className="scene-color" title="The scene that Add at end and each row's Add after put into the song">
          Scene to add
          <select aria-label="Scene to add to the song" disabled={!adding} value={adding?.id ?? ''} onChange={(event) => setChosen(event.target.value)}>
            {scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
          </select>
        </label>
        <button
          className="rack-btn"
          aria-label={`Add ${adding?.name ?? 'a scene'} at the end of the song`}
          disabled={!adding || full}
          onClick={() => insert(song.entries.length)}
        >
          Add at end
        </button>
        <div className="rack-grow" />
        <span className="song-list-total">
          Whole song <b>{barsText(totalBars)}</b> lasting <b>{songClock(totalSeconds)}</b>
        </span>
        <span className="sr-only" aria-live="polite">{said}</span>
      </div>
    </div>
  );
}
