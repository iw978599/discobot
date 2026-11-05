import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Studio } from '../studio/useStudio';
import { sceneLengthIn, sceneSignatureIn, sceneTempoIn } from '../studio/studioState';
import { guestOrigin } from '../services/guests';
import { drumsMuted } from '../services/unitActivity';
import { laneName, shownLanes } from '../services/lanes';
import { laneTrack, type DeskTrack } from '../services/deskFrame';
import { songSecondsAt, songTickAt } from '../services/clipTiming';
import { barMarks, clipEndTick, drumsPlaying, guestPlaying, lanesPlaying, liveSceneOf, songLayout, type DeskView, type EntryLayout } from '../services/deskSong';
import type { AudioClip } from '../services/audioTracks';
import type { Scene } from '../types';

const BEAT = 8, STEP = 2;

// The Patterns / Song switch, in the corner of the ruler in both views.
export function DeskViewSwitch({ view, onView }: { view: DeskView; onView: (view: DeskView) => void }) {
  return (
    <span className="desk-ruler-head">
      <span className="desk-view-switch" role="radiogroup" aria-label="Desk view">
        {(['patterns', 'song'] as const).map(choice => (
          <button key={choice} role="radio" aria-checked={view === choice} className={view === choice ? 'on' : ''} onClick={() => onView(choice)}>
            {choice === 'patterns' ? 'Patterns' : 'Song'}
          </button>
        ))}
      </span>
    </span>
  );
}

interface DeskSongProps {
  studio: Studio;
  track: DeskTrack;
  view: DeskView;
  onView: (view: DeskView) => void;
  onShow: (track: DeskTrack) => void;
}

const percent = (value: number, total: number) => `${(100 * value) / total}%`;

// The Song view of the desk (docs/DESK_LAYOUT_PLAN.md, stage 4): the song's bars along the top, the
// entries as a strip in their scene colours, and for every track a block where it plays in each entry,
// a summary and not the steps. Pressing a block or an entry opens that scene and returns to the
// patterns. The audio tracks are under the lanes with their clips at their ticks; a clip is picked
// here and moved or taken out with the keys as in the song unit's Timeline, whose view keeps the
// trimming, the fades and the dragging. The playing bar is lit from `songPosition`, which changes a
// bar at a time, so nothing here renders for a step.
export default function DeskSong({ studio, track, view, onView, onShow }: DeskSongProps) {
  const { song, scenes, audioTracks, songPosition, globalTempo, synths, drumState, guests, currentSceneId, laneOrder } = studio;
  const lengthOf = sceneLengthIn(studio.sceneInfo), signatureOf = sceneSignatureIn(studio.sceneInfo), tempoOf = sceneTempoIn(studio.sceneInfo);
  const [selected, setSelected] = useState<string | null>(null);
  const layout = useMemo(
    () => songLayout(song, scenes, lengthOf, signatureOf),
    [song, scenes, studio.sceneInfo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const secondsOf = (tick: number) => songSecondsAt(song, tick, lengthOf, signatureOf, globalTempo, tempoOf);
  const tickAt = (time: number) => songTickAt(song, time, lengthOf, signatureOf, globalTempo, tempoOf);
  const lastEnd = audioTracks.reduce((end, item) => item.clips.reduce((latest, clip) => Math.max(latest, clipEndTick(clip, secondsOf, tickAt)), end), 0);
  const total = Math.max(layout.ticks, lastEnd, 1);

  const content = useMemo(() => {
    const flags = synths.map(synth => ({ id: synth.id, muted: synth.muted, solo: synth.solo }));
    const used = new Map<string, Scene>();
    layout.entries.forEach((entry) => {
      const scene = scenes.find(item => item.id === entry.sceneId);
      if (scene) used.set(entry.sceneId, entry.sceneId === currentSceneId ? liveSceneOf(scene, synths, drumState, guests) : scene);
    });
    const byScene = new Map([...used].map(([id, scene]) => [id, { lanes: lanesPlaying(scene, flags), drums: drumsPlaying(scene, drumState) }]));
    const ordered = layout.entries.map(entry => used.get(entry.sceneId)).filter((scene): scene is Scene => scene !== undefined);
    const mixes = new Map(guests.map(guest => [guest.id, guestPlaying(ordered, guest)]));
    return { byScene, mixes };
  }, [layout, scenes, synths, drumState, guests, currentSceneId]);

  // Where the song is now, as the bar that plays.
  const now = (() => {
    if (!songPosition) return null;
    const entry = layout.entries[songPosition.entryIndex];
    if (!entry) return null;
    const pass = entry.ticks / entry.repeats;
    return { at: entry.startTick + songPosition.repeat * pass + songPosition.bar * entry.perBar, ticks: entry.perBar };
  })();

  const openScene = (entry: EntryLayout) => {
    void studio.handleSceneSelect(entry.sceneId);
    onView('patterns');
  };
  const nowMark = now ? <span className="desk-song-now" style={{ left: percent(now.at, total), width: percent(now.ticks, total) }} aria-hidden="true" /> : null;
  const blocks = (name: string, playsIn: (entry: EntryLayout) => boolean) => layout.entries.map(entry => (
    playsIn(entry)
      ? (
        <button
          key={entry.index}
          className="desk-song-block"
          style={{ left: percent(entry.startTick, total), width: percent(entry.ticks, total) }}
          aria-label={`Song ${name} plays in ${entry.name}, entry ${entry.index + 1}`}
          title={`${name} plays in ${entry.name}. Press to open that scene`}
          onClick={() => openScene(entry)}
        />
      )
      : null
  ));
  const head = (label: string, sound: string | null, here: boolean, showAs: DeskTrack, extra?: JSX.Element) => (
    <div className="desk-track-head">
      <button className="desk-track-pick" aria-current={here ? 'true' : undefined} aria-label={`Show ${label} in the dock`} onClick={() => onShow(showAs)}>
        <span className="desk-track-swatch" aria-hidden="true" />
        <span className="desk-track-name">{label}</span>
        {sound && <span className="desk-track-sound">{sound}</span>}
      </button>
      {extra}
    </div>
  );

  const clipKey = (event: KeyboardEvent<HTMLElement>, clip: AudioClip) => {
    if (event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      studio.handleClipChange(clip.id, { at: Math.max(0, clip.at + (event.altKey ? STEP : BEAT) * (event.key === 'ArrowLeft' ? -1 : 1)) });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      studio.handleClipRemove(clip.id);
    }
  };

  const marks = barMarks(layout);
  const ids = synths.map(synth => synth.id);
  const placed = (() => {
    let position = -1;
    return layout.entries.map(entry => (content.byScene.has(entry.sceneId) ? ++position : -1));
  })();
  return (
    <div className="desk-grid desk-song" style={{ '--cols': Math.max(16, Math.ceil(total / 8)) } as CSSProperties}>
      <div className="desk-ruler">
        <DeskViewSwitch view={view} onView={onView} />
        <span className="desk-ruler-bars desk-song-ruler" aria-hidden="true">
          {marks.map(mark => <span key={mark.bar} className="desk-song-bar" style={{ left: percent(mark.tick, total) }}>{mark.bar + 1}</span>)}
        </span>
      </div>
      <div className="desk-track desk-song-order">
        <div className="desk-track-head"><span className="desk-track-name desk-song-title">Song order</span></div>
        <div className="desk-song-lane" role="group" aria-label="Song entries">
          {layout.entries.map(entry => (
            <button
              key={entry.index}
              className="desk-song-entry"
              data-color={entry.color}
              style={{ left: percent(entry.startTick, total), width: percent(entry.ticks, total) }}
              aria-label={`Song entry ${entry.index + 1}, ${entry.name}, ${entry.repeats} ${entry.repeats === 1 ? 'time' : 'times'}`}
              title={`${entry.name}, ${entry.bars} ${entry.bars === 1 ? 'bar' : 'bars'}. Press to open that scene`}
              onClick={() => openScene(entry)}
            >{entry.name}{entry.repeats > 1 ? ` ×${entry.repeats}` : ''}</button>
          ))}
          {nowMark}
        </div>
      </div>
      <ul>
        {shownLanes(ids, laneOrder).map((id) => {
          const synth = synths.find(entry => entry.id === id);
          if (!synth) return null;
          const name = laneName(id, synth.name);
          return (
            <li key={id} className="desk-track" data-track={laneTrack(id)} style={{ '--track-color': `var(--track-${id})` } as CSSProperties}>
              {head(name, null, track === laneTrack(id), laneTrack(id), (
                <span className="desk-track-ms">
                  <button className={synth.muted ? 'on' : ''} aria-pressed={synth.muted} aria-label={`Track list mute ${name}`} onClick={() => { void studio.handleSynthMixChange(id, { muted: !synth.muted }); }}>M</button>
                  <button className={synth.solo ? 'on' : ''} aria-pressed={synth.solo} aria-label={`Track list solo ${name}`} onClick={() => { void studio.handleSynthMixChange(id, { solo: !synth.solo }); }}>S</button>
                </span>
              ))}
              <div className="desk-song-lane">
                {blocks(name, entry => content.byScene.get(entry.sceneId)?.lanes.has(id) === true)}
                {nowMark}
              </div>
            </li>
          );
        })}
        <li className="desk-track" data-track="drums" style={{ '--track-color': 'var(--drum-kick)' } as CSSProperties}>
          {head('Drums', null, track === 'drums', 'drums', (
            <span className="desk-track-ms">
              <button className={drumsMuted(drumState) ? 'on' : ''} aria-pressed={drumsMuted(drumState)} aria-label="Track list mute Drums" onClick={() => studio.handleDrumMuteAll(!drumsMuted(drumState))}>M</button>
            </span>
          ))}
          <div className="desk-song-lane">
            {blocks('Drums', entry => content.byScene.get(entry.sceneId)?.drums === true)}
            {nowMark}
          </div>
        </li>
        {guests.map((guest, index) => {
          const name = guest.name || guestOrigin(guest.url) || `Guest ${index + 1}`;
          const plays = content.mixes.get(guest.id) ?? [];
          return (
            <li key={guest.id} className="desk-track" data-track="guests" style={{ '--track-color': 'var(--track-guest)' } as CSSProperties}>
              {head(name, 'Guest instrument', track === 'guests', 'guests')}
              <div className="desk-song-lane">
                {blocks(name, entry => plays[placed[entry.index]] === true)}
                {nowMark}
              </div>
            </li>
          );
        })}
        {audioTracks.map(item => (
          <li key={item.id} className="desk-track desk-audio-track" data-audio-track={item.id} style={{ '--track-color': 'var(--track-audio)' } as CSSProperties}>
            <div className="desk-track-head">
              <span className="desk-track-pick desk-audio-name">
                <span className="desk-track-swatch" aria-hidden="true" />
                <span className="desk-track-name">{item.name}</span>
                <span className="desk-track-sound">Audio track</span>
              </span>
              <span className="desk-track-ms">
                <button className={item.muted ? 'on' : ''} aria-pressed={Boolean(item.muted)} aria-label={`Track list mute ${item.name}`} onClick={() => studio.handleTrackChange(item.id, { muted: !item.muted })}>M</button>
                <button className={item.solo ? 'on' : ''} aria-pressed={Boolean(item.solo)} aria-label={`Track list solo ${item.name}`} onClick={() => studio.handleTrackChange(item.id, { solo: !item.solo })}>S</button>
              </span>
            </div>
            <div className="desk-song-lane" role="group" aria-label={`Song audio track ${item.name}`}>
              {item.clips.map((clip) => {
                const end = clipEndTick(clip, secondsOf, tickAt);
                return (
                  <button
                    key={clip.id}
                    className={`desk-song-clip${clip.id === selected ? ' on' : ''}`}
                    style={{ left: percent(clip.at, total), width: percent(Math.max(1, end - clip.at), total) }}
                    aria-pressed={clip.id === selected}
                    aria-label={`Song clip ${clip.name || 'Clip'}, ${item.name}`}
                    title="Press to pick it. The arrow keys move it a beat (Alt: a step) and Delete takes it out. Trim and fade it in the song unit's Timeline"
                    onClick={() => setSelected(clip.id)}
                    onKeyDown={event => clipKey(event, clip)}
                  >{clip.name || 'Clip'}</button>
                );
              })}
              {nowMark}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
