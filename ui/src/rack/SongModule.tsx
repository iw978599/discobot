import { useState } from 'react';
import type { Studio } from '../studio/useStudio';
import type { Song } from '../types';
import { MAX_REPEATS, MAX_SONG_ENTRIES, songLengthBars } from '../services/songPlayback';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

// Scenes are one-bar sections of the whole arrangement; the song is the order they play in.
// Everything below this module in the rack shows, and edits, the selected scene.
export default function SongModule({ studio }: { studio: Studio }) {
  const { scenes, currentSceneId, song, playMode, songPosition, songStartEntry } = studio;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const current = scenes.find(scene => scene.id === currentSceneId);
  const nameOf = (sceneId: string) => scenes.find(scene => scene.id === sceneId)?.name ?? '?';
  const bars = songLengthBars(song);
  const setEntries = (entries: Song['entries']) => studio.handleSongChange({ entries });

  const commitRename = () => {
    const name = draftName.trim();
    if (renaming && name) void studio.handleSceneRename(renaming, name);
    setRenaming(null);
  };

  return (
    <section className="rack-unit song-module" aria-label="Song module">
      <div className="rack-row">
        <div className="rack-plate static">
          <b>Scenes</b>
          <span>One bar each</span>
        </div>
        <div className="scene-strip" role="group" aria-label="Scenes">
          {scenes.map(scene => (renaming === scene.id ? (
            <input
              key={scene.id}
              autoFocus
              className="scene-name-input"
              aria-label="Scene name"
              maxLength={40}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button
              key={scene.id}
              className={`scene-chip ${scene.id === currentSceneId ? 'on' : ''}`}
              aria-label={`Scene: ${scene.name}`}
              aria-pressed={scene.id === currentSceneId}
              title={scene.id === currentSceneId ? 'This scene is open in the rack below' : 'Open this scene for editing'}
              onClick={() => { void studio.handleSceneSelect(scene.id); }}
            >
              {scene.name}
            </button>
          )))}
        </div>
        <div className="rack-grow" />
        <button className="rack-btn" onClick={() => { void studio.handleSceneAdd(false); }} title="Add a scene that starts as a copy of this one">+ Copy</button>
        <button className="rack-btn" onClick={() => { void studio.handleSceneAdd(true); }} title="Add a scene with no notes or drum hits">+ Empty</button>
        <button
          className="rack-btn"
          disabled={!current}
          onClick={() => { if (current) { setDraftName(current.name); setRenaming(current.id); } }}
          title="Rename the open scene"
        >
          Rename
        </button>
        <button
          className="rack-btn danger"
          disabled={!current || scenes.length < 2}
          onClick={() => {
            if (current && window.confirm(`Delete the scene "${current.name}"? Its notes and drum hits are lost and it is removed from the song.`)) {
              void studio.handleSceneDelete(current.id);
            }
          }}
          title={scenes.length < 2 ? 'A project needs at least one scene' : 'Delete the open scene'}
        >
          Delete
        </button>
      </div>

      <div className="rack-row song-row">
        <div className="rack-plate static">
          <b>Song</b>
          <span>{bars} {bars === 1 ? 'bar' : 'bars'} · {clock(bars * 240 / studio.globalTempo)}</span>
        </div>
        <div className="rack-ms mode-toggle" role="group" aria-label="Play mode">
          <button
            className={playMode === 'pattern' ? 'on' : ''}
            aria-pressed={playMode === 'pattern'}
            onClick={() => studio.setPlayMode('pattern')}
            title="Play loops the open scene"
          >
            Scene
          </button>
          <button
            className={playMode === 'song' ? 'on' : ''}
            aria-pressed={playMode === 'song'}
            onClick={() => studio.setPlayMode('song')}
            title="Play follows the song from the marked block"
          >
            Song
          </button>
        </div>
        <div className="song-chain" role="group" aria-label="Song order">
          {song.entries.map((entry, index) => {
            const playing = songPosition?.entryIndex === index;
            const move = (to: number) => {
              const next = [...song.entries];
              next.splice(to, 0, ...next.splice(index, 1));
              setEntries(next);
              studio.setSongStartEntry(to);
            };
            return (
              <div
                key={`${entry.sceneId}-${index}`}
                className={`song-block ${playing ? 'playing' : ''} ${songStartEntry === index ? 'start' : ''}`}
                role="group"
                aria-label={`Song block ${index + 1}: ${nameOf(entry.sceneId)}`}
              >
                <button
                  className="song-block-name"
                  aria-pressed={songStartEntry === index}
                  title="Start the song from here and open this scene"
                  onClick={() => { studio.setSongStartEntry(index); void studio.handleSceneSelect(entry.sceneId); }}
                >
                  {nameOf(entry.sceneId)}
                  <span className="song-block-count">
                    {playing && songPosition ? `${songPosition.repeat + 1}/${entry.repeats}` : `×${entry.repeats}`}
                  </span>
                </button>
                <span className="song-block-tools">
                  <button aria-label={`Fewer repeats for block ${index + 1}`} disabled={entry.repeats <= 1} onClick={() => setEntries(song.entries.map((item, i) => (i === index ? { ...item, repeats: item.repeats - 1 } : item)))}>−</button>
                  <button aria-label={`More repeats for block ${index + 1}`} disabled={entry.repeats >= MAX_REPEATS} onClick={() => setEntries(song.entries.map((item, i) => (i === index ? { ...item, repeats: item.repeats + 1 } : item)))}>+</button>
                  <button aria-label={`Move block ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index - 1)}>◀</button>
                  <button aria-label={`Move block ${index + 1} later`} disabled={index === song.entries.length - 1} onClick={() => move(index + 1)}>▶</button>
                  <button aria-label={`Remove block ${index + 1} from the song`} disabled={song.entries.length < 2} onClick={() => setEntries(song.entries.filter((_, i) => i !== index))}>✕</button>
                </span>
              </div>
            );
          })}
          <button
            className="rack-btn"
            disabled={!current || song.entries.length >= MAX_SONG_ENTRIES}
            onClick={() => { if (current) setEntries([...song.entries, { sceneId: current.id, repeats: 1 }]); }}
            title="Add the open scene to the end of the song"
          >
            + Add {current?.name ?? 'scene'}
          </button>
        </div>
        <label className="song-loop" title="When the song reaches the end, start it again">
          <input type="checkbox" aria-label="Loop the song" checked={song.loop} onChange={(event) => studio.handleSongChange({ loop: event.target.checked })} />
          Loop
        </label>
      </div>
    </section>
  );
}
