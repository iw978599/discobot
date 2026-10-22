import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Studio } from '../studio/useStudio';
import { sceneLengthIn, sceneSignatureIn, sceneTempoIn } from '../studio/studioState';
import { barTicks } from '../services/patternLength';
import { songSecondsAt, songTickAt } from '../services/clipTiming';
import { recordingNow } from '../services/clipRecordings';
import { MAX_TRACKS, MAX_CLIP_GAIN, type AudioClip, type AudioTrack } from '../services/audioTracks';
import ConfirmDialog from './ConfirmDialog';
import SessionRecordButton from './SessionRecordButton';

// The song's timeline (docs/TIMELINE_PLAN.md, stage 3), shown as the song unit's third view: the
// song's blocks along the top, bar by bar, and the audio tracks under them with their clips. A
// clip starts on a tick of the song and is as wide as its recording lasts at the tempo where it
// plays. Everything here is view state but what the store holds.

// Pixels a tick takes, at each zoom: a bar of 4/4 is 32, 64 or 128. The middle one to begin with.
const ZOOMS = [1, 2, 4];
// A beat is eight ticks and a step two: what a move snaps to, Alt choosing the finer.
const BEAT = 8, STEP = 2;
const MIN_SECONDS = 0.05;

const seconds = (value: number) => `${Math.round(value * 100) / 100} s`;

interface Drag { clipId: string; kind: 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut'; x: number; clip: AudioClip; trackId: string; moved: boolean }
type Preview = { clipId: string; trackId: string; patch: Partial<AudioClip> } | null;

export default function TrackTimeline({ studio }: { studio: Studio }) {
  const { song, scenes, audioTracks, songPosition, globalTempo } = studio;
  const lengthOf = sceneLengthIn(studio.sceneInfo), signatureOf = sceneSignatureIn(studio.sceneInfo), tempoOf = sceneTempoIn(studio.sceneInfo);
  const secondsOf = (tick: number) => songSecondsAt(song, tick, lengthOf, signatureOf, globalTempo, tempoOf);
  const tickAt = (time: number) => songTickAt(song, time, lengthOf, signatureOf, globalTempo, tempoOf);

  const [place, setPlace] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosenTrack, setChosenTrack] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AudioTrack | null>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [zoom, setZoom] = useState(1);
  const PX = ZOOMS[zoom];
  const drag = useRef<Drag | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // A clip moved by the keyboard to another track is drawn anew there; the keyboard follows it.
  const refocus = useRef<string | null>(null);

  // The song's entries laid along the ticks, each with its bar's length.
  let cursor = 0;
  const entries = song.entries.map((entry, index) => {
    const perBar = barTicks(signatureOf(entry.sceneId)), ticks = entry.repeats * Math.max(1, lengthOf(entry.sceneId)) * perBar;
    const scene = scenes.find(item => item.id === entry.sceneId);
    const laid = { index, start: cursor, ticks, perBar, name: scene?.name ?? '?', color: scene?.color };
    cursor += ticks;
    return laid;
  });
  const songTicks = cursor;
  const endOf = (clip: AudioClip) => Math.max(clip.at + 1, tickAt(secondsOf(clip.at) + clip.length));
  const lastEnd = audioTracks.reduce((end, track) => track.clips.reduce((latest, clip) => Math.max(latest, endOf(clip)), end), 0);
  const width = (Math.max(songTicks, lastEnd) + 4 * 32) * PX;

  // Bars counted from the song's start, each with its first tick; past the song, bars of 4/4.
  const barStart = (bar: number) => {
    let at = 0, count = 0;
    for (const entry of entries) {
      const bars = entry.ticks / entry.perBar;
      if (bar < count + bars) return at + (bar - count) * entry.perBar;
      at += entry.ticks;
      count += bars;
    }
    return at + (bar - count) * 32;
  };
  const barOf = (tick: number) => {
    let count = 0;
    for (const entry of entries) {
      if (tick < entry.start + entry.ticks) return { bar: count + Math.floor((tick - entry.start) / entry.perBar), beat: Math.floor(((tick - entry.start) % entry.perBar) / BEAT) };
      count += entry.ticks / entry.perBar;
    }
    const past = tick - songTicks;
    return { bar: count + Math.floor(past / 32), beat: Math.floor((past % 32) / BEAT) };
  };
  const placeAtBar = (tick: number) => barStart(barOf(Math.max(0, tick)).bar);

  const playing = songPosition ? (() => {
    const entry = entries[songPosition.entryIndex];
    if (!entry) return null;
    const pass = Math.max(1, lengthOf(song.entries[songPosition.entryIndex].sceneId)) * entry.perBar;
    return { at: entry.start + songPosition.repeat * pass + songPosition.bar * entry.perBar, ticks: entry.perBar };
  })() : null;

  const trackOf = (clipId: string | null) => audioTracks.find(track => track.clips.some(clip => clip.id === clipId));
  const clipOf = (clipId: string | null) => trackOf(clipId)?.clips.find(clip => clip.id === clipId);
  const target = audioTracks.find(track => track.id === chosenTrack) ?? trackOf(selected) ?? audioTracks[0];
  const recordingSeconds = (clip: AudioClip) => { const recording = recordingNow(clip.sampleId); return recording ? recording.channels[0].length / recording.rate : Infinity; };

  useEffect(() => {
    if (selected && !clipOf(selected)) setSelected(null);
    const wanted = refocus.current;
    if (!wanted) return;
    refocus.current = null;
    gridRef.current?.querySelector<HTMLElement>(`[data-clip="${wanted}"]`)?.focus();
  }, [audioTracks]);

  const addRecording = async (file: File | undefined) => {
    if (!file) return;
    const id = await studio.handleAddRecording(file, target?.id ?? null, place);
    if (id) setSelected(id);
  };

  // What a drag from where it began to `x` makes of the clip, snapped to a beat or, with Alt, a step.
  const dragged = (state: Drag, x: number, alt: boolean): Partial<AudioClip> => {
    const snap = alt ? STEP : BEAT, delta = (x - state.x) / PX, { clip } = state;
    const snapped = (tick: number) => Math.round(tick / snap) * snap;
    if (state.kind === 'move') return { at: Math.max(0, snapped(clip.at + delta)) };
    // A fade's handle moves through the clip's own seconds, as far as the pointer goes, unsnapped.
    if (state.kind === 'fadeIn' || state.kind === 'fadeOut') {
      const perPixel = clip.length / Math.max(1, (endOf(clip) - clip.at) * PX), by = (x - state.x) * perPixel;
      if (state.kind === 'fadeIn') return { fadeIn: Math.max(0, Math.min(clip.length - (clip.fadeOut ?? 0), (clip.fadeIn ?? 0) + by)) };
      return { fadeOut: Math.max(0, Math.min(clip.length - (clip.fadeIn ?? 0), (clip.fadeOut ?? 0) - by)) };
    }
    if (state.kind === 'end') {
      const end = Math.max(clip.at + 1, snapped(endOf(clip) + delta));
      const most = recordingSeconds(clip) - (clip.offset ?? 0);
      return { length: Math.max(MIN_SECONDS, Math.min(most, secondsOf(end) - secondsOf(clip.at))) };
    }
    const at = Math.max(0, Math.min(snapped(clip.at + delta), Math.floor(endOf(clip)) - 1));
    const shift = Math.max(-(clip.offset ?? 0), secondsOf(at) - secondsOf(clip.at));
    return { at, offset: (clip.offset ?? 0) + shift, length: Math.max(MIN_SECONDS, clip.length - shift) };
  };
  const startDrag = (event: ReactPointerEvent<HTMLElement>, track: AudioTrack, clip: AudioClip, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { clipId: clip.id, kind, x: event.clientX, clip, trackId: track.id, moved: false };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    if (!state.moved && Math.abs(event.clientX - state.x) < 4 && state.kind === 'move' && !overTrack(event, state.trackId)) return;
    state.moved = true;
    const trackId = state.kind === 'move' ? overTrack(event, state.trackId) ?? state.trackId : state.trackId;
    setPreview({ clipId: state.clipId, trackId, patch: dragged(state, event.clientX, event.altKey) });
  };
  const overTrack = (event: ReactPointerEvent<HTMLElement>, current: string) => {
    const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-lane]');
    const id = lane?.dataset.trackLane;
    return id && id !== current ? id : null;
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    drag.current = null;
    setPreview(null);
    if (!state) return;
    setSelected(state.clipId);
    if (!state.moved) return;
    const trackId = state.kind === 'move' ? overTrack(event, state.trackId) : null;
    studio.handleClipChange(state.clipId, { ...dragged(state, event.clientX, event.altKey), ...(trackId ? { trackId } : {}) });
  };

  // A clip with the keyboard: the arrows move it a beat (Alt, a step) or to the track above or
  // below, and Delete takes it out.
  const clipKey = (event: ReactKeyboardEvent<HTMLElement>, track: AudioTrack, clip: AudioClip) => {
    if (event.ctrlKey || event.metaKey) return;
    const index = audioTracks.indexOf(track);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const by = (event.altKey ? STEP : BEAT) * (event.key === 'ArrowLeft' ? -1 : 1);
      studio.handleClipChange(clip.id, { at: Math.max(0, clip.at + by) });
    } else if ((event.key === 'ArrowUp' && index > 0) || (event.key === 'ArrowDown' && index < audioTracks.length - 1)) {
      event.preventDefault();
      refocus.current = clip.id;
      studio.handleClipChange(clip.id, { trackId: audioTracks[index + (event.key === 'ArrowUp' ? -1 : 1)].id });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      studio.handleClipRemove(clip.id);
    }
  };

  const shown = (track: AudioTrack): Array<{ clip: AudioClip; track: AudioTrack }> => {
    const own = track.clips.filter(clip => !(preview && preview.clipId === clip.id && preview.trackId !== track.id)).map(clip => ({ clip, track }));
    if (preview && preview.trackId === track.id && !track.clips.some(clip => clip.id === preview.clipId)) {
      const moving = clipOf(preview.clipId);
      if (moving) own.push({ clip: moving, track });
    }
    return own.map(({ clip }) => ({ clip: preview?.clipId === clip.id ? { ...clip, ...preview.patch } : clip, track }));
  };
  const where = (tick: number) => { const { bar, beat } = barOf(tick); return `bar ${bar + 1} beat ${beat + 1}`; };
  const chosen = clipOf(selected), chosenOn = trackOf(selected);

  return (
    <div className="timeline" role="group" aria-label="Timeline">
      <div className="timeline-tools">
        <button className="rack-btn" disabled={audioTracks.length >= MAX_TRACKS} onClick={() => { const id = studio.handleAddTrack(); if (id) setChosenTrack(id); }} title={`Add an audio track (up to ${MAX_TRACKS})`}>+ Track</button>
        <button className="rack-btn" onClick={() => fileRef.current?.click()} title="Put a recording from a file on the chosen track, at the mark">Add Recording…</button>
        <SessionRecordButton onToggle={() => { void studio.handleRecordSession().then(id => { if (id) setSelected(id); }); }} />
        <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a" hidden aria-label="Recording file" onChange={(event) => { void addRecording(event.target.files?.[0]); event.target.value = ''; }} />
        <label className="timeline-place">
          At bar
          <input type="number" min={1} max={9999} value={barOf(place).bar + 1} aria-label="Bar new recordings go in at" onChange={(event) => { const bar = Math.max(1, Math.floor(Number(event.target.value) || 1)); setPlace(barStart(bar - 1)); }} />
        </label>
        {target && <span className="rack-hint">On {target.name}</span>}
        <div className="rack-grow" />
        <span className="timeline-zoom" role="group" aria-label="Timeline zoom">
          <button className="rack-btn" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} title="Show more of the song">−</button>
          <button className="rack-btn" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)} title="Show the bars wider">+</button>
        </span>
      </div>
      <div className="timeline-scroll">
        <div ref={gridRef} className="timeline-grid" style={{ width: `calc(var(--timeline-head) + ${width}px)` }}>
          <div className="timeline-row timeline-ruler">
            <div className="timeline-head"><span>Song</span></div>
            <div className="timeline-lane" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setPlace(placeAtBar((event.clientX - box.left) / PX)); }} title="Click to put the mark where new recordings go in">
              {entries.map(entry => (
                <span key={entry.index} className="timeline-block" data-color={entry.color} style={{ left: entry.start * PX, width: entry.ticks * PX, backgroundSize: `${entry.perBar * PX}px 100%` }}>{entry.name}</span>
              ))}
              {playing && <span className="timeline-playing" style={{ left: playing.at * PX, width: playing.ticks * PX }} aria-hidden="true" />}
              <span className="timeline-mark" style={{ left: place * PX }} aria-hidden="true" />
            </div>
          </div>
          {audioTracks.map(track => (
            <div key={track.id} className="timeline-row" role="group" aria-label={`Audio track ${track.name}`} data-chosen={track.id === target?.id ? 'true' : undefined}>
              <div className="timeline-head">
                <input
                  key={track.name}
                  className="timeline-name"
                  defaultValue={track.name}
                  aria-label={`Name of ${track.name}`}
                  onFocus={() => setChosenTrack(track.id)}
                  onBlur={(event) => { if (event.target.value !== track.name) studio.handleTrackChange(track.id, { name: event.target.value }); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
                <button className={`rack-btn ${track.muted ? 'on' : ''}`} aria-label={`Mute ${track.name}`} aria-pressed={Boolean(track.muted)} onClick={() => studio.handleTrackChange(track.id, { muted: !track.muted })}>M</button>
                <button className={`rack-btn ${track.solo ? 'on' : ''}`} aria-label={`Solo ${track.name}`} aria-pressed={Boolean(track.solo)} onClick={() => studio.handleTrackChange(track.id, { solo: !track.solo })}>S</button>
                <button className="rack-btn danger" aria-label={`Remove ${track.name}`} title="Take this track and its clips out" onClick={() => (track.clips.length ? setRemoving(track) : studio.handleRemoveTrack(track.id))}>✕</button>
              </div>
              <div className="timeline-lane" data-track-lane={track.id} onClick={() => setChosenTrack(track.id)}>
                {shown(track).map(({ clip }) => {
                  const left = clip.at * PX, wide = Math.max(8, (endOf(clip) - clip.at) * PX), on = clip.id === selected;
                  return (
                    <div
                      key={clip.id}
                      data-clip={clip.id}
                      className={`timeline-clip ${on ? 'on' : ''} ${preview?.clipId === clip.id ? 'moving' : ''}`}
                      style={{ left, width: wide }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      aria-label={`${clip.name || 'Clip'}, ${track.name}, ${where(clip.at)}, ${seconds(clip.length)}`}
                      title="Drag to move (Alt: by a step); drag an end to trim, a corner to fade. Arrow keys move it, Delete takes it out"
                      onPointerDown={(event) => startDrag(event, track, clip, 'move')}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={() => { drag.current = null; setPreview(null); }}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(clip.id); } else clipKey(event, track, clip); }}
                      onFocus={() => setChosenTrack(track.id)}
                    >
                      {/* The fades, drawn as slopes over the clip; on the chosen one each has a handle to drag. */}
                      {(clip.fadeIn ?? 0) > 0 && <span className="timeline-fade in" style={{ width: `${(100 * (clip.fadeIn ?? 0)) / clip.length}%` }} aria-hidden="true" />}
                      {(clip.fadeOut ?? 0) > 0 && <span className="timeline-fade out" style={{ width: `${(100 * (clip.fadeOut ?? 0)) / clip.length}%` }} aria-hidden="true" />}
                      <span className="timeline-clip-name">{clip.name || 'Clip'}</span>
                      {on && <span className="timeline-fade-handle in" style={{ left: `${(100 * (clip.fadeIn ?? 0)) / clip.length}%` }} aria-hidden="true" title="Drag to fade in" onPointerDown={(event) => startDrag(event, track, clip, 'fadeIn')} onPointerMove={moveDrag} onPointerUp={endDrag} />}
                      {on && <span className="timeline-fade-handle out" style={{ right: `${(100 * (clip.fadeOut ?? 0)) / clip.length}%` }} aria-hidden="true" title="Drag to fade out" onPointerDown={(event) => startDrag(event, track, clip, 'fadeOut')} onPointerMove={moveDrag} onPointerUp={endDrag} />}
                      {on && <span className="timeline-trim start" aria-hidden="true" onPointerDown={(event) => startDrag(event, track, clip, 'start')} onPointerMove={moveDrag} onPointerUp={endDrag} />}
                      {on && <span className="timeline-trim end" aria-hidden="true" onPointerDown={(event) => startDrag(event, track, clip, 'end')} onPointerMove={moveDrag} onPointerUp={endDrag} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {audioTracks.length === 0 && <p className="rack-hint">No audio tracks yet. Add Recording puts a file on a new track at the mark; the song plays it in Song mode.</p>}
      {chosen && chosenOn && (
        <div className="timeline-clip-tools" role="group" aria-label={`Clip ${chosen.name || 'Clip'}`}>
          <span className="step-tools-name">{chosen.name || 'Clip'}</span>
          <label>Track
            <select value={chosenOn.id} onChange={(event) => studio.handleClipChange(chosen.id, { trackId: event.target.value })}>
              {audioTracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}
            </select>
          </label>
          <span className="rack-hint">Starts at {where(chosen.at)}</span>
          <NumberField label="Trim start" unit="s" value={chosen.offset ?? 0} min={0} max={Math.max(0, recordingSeconds(chosen) - MIN_SECONDS)} onCommit={(offset) => studio.handleClipChange(chosen.id, { offset, length: Math.max(MIN_SECONDS, Math.min(chosen.length, recordingSeconds(chosen) - offset)) })} />
          <NumberField label="Length" unit="s" value={chosen.length} min={MIN_SECONDS} max={recordingSeconds(chosen) - (chosen.offset ?? 0)} onCommit={(length) => studio.handleClipChange(chosen.id, { length })} />
          <NumberField label="Level" unit="%" value={Math.round((chosen.gain ?? 1) * 100)} min={0} max={MAX_CLIP_GAIN * 100} onCommit={(level) => studio.handleClipChange(chosen.id, { gain: level / 100 })} />
          <NumberField label="Fade in" unit="s" value={chosen.fadeIn ?? 0} min={0} max={chosen.length} onCommit={(fadeIn) => studio.handleClipChange(chosen.id, { fadeIn })} />
          <NumberField label="Fade out" unit="s" value={chosen.fadeOut ?? 0} min={0} max={chosen.length} onCommit={(fadeOut) => studio.handleClipChange(chosen.id, { fadeOut })} />
          <button className="rack-btn danger" onClick={() => studio.handleClipRemove(chosen.id)}>Remove Clip</button>
        </div>
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this track?"
          confirmLabel="Remove"
          onCancel={() => setRemoving(null)}
          onConfirm={() => { studio.handleRemoveTrack(removing.id); setRemoving(null); }}
        >
          Remove the track "{removing.name}" and its {removing.clips.length === 1 ? 'clip' : `${removing.clips.length} clips`}? Undo puts them back; the recordings stay in this browser.
        </ConfirmDialog>
      )}
    </div>
  );
}

// A figure that is kept when it is left or Enter is pressed, held to its range.
function NumberField({ label, unit, value, min, max, onCommit }: { label: string; unit: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const shown = Math.round(value * 100) / 100;
  const commit = (text: string) => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    const held = Math.min(max, Math.max(min, parsed));
    if (held !== shown) onCommit(held);
  };
  return (
    <label className="timeline-number">
      {label}
      <input key={shown} type="number" step="any" defaultValue={shown} aria-label={`Clip ${label.toLowerCase()} in ${unit === 's' ? 'seconds' : 'percent'}`}
        onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <span>{unit}</span>
    </label>
  );
}
