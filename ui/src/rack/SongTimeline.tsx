import { useEffect, useRef, useState } from 'react';
import { rowAtSeconds, songClock, type SongRow } from '../services/songPlayback';

export interface TimelineEntry extends SongRow {
  name: string;
  color?: string;
}

// The song on the share page as a strip of its entries, each as wide as it lasts and in its
// scene's colour. With the song's audio ready, the playing entry is lit, a line follows the music,
// and pressing an entry plays from there. The line moves outside React, a frame at a time, and
// only while the music plays.
export default function SongTimeline({ entries, audio }: { entries: TimelineEntry[]; audio: HTMLAudioElement | null }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState(-1);
  const total = entries.reduce((sum, entry) => sum + entry.seconds, 0);

  useEffect(() => {
    if (!audio || total <= 0) return;
    let frame = 0, shown = -1;
    // Short entries keep a width that can be read, so the line is placed within the playing
    // entry rather than as a share of the whole strip.
    const show = () => {
      const time = audio.currentTime, index = rowAtSeconds(entries, time);
      setCurrent(index);
      const strip = stripRef.current, line = lineRef.current;
      const element = index >= 0 ? strip?.children[index] as HTMLElement | undefined : undefined;
      if (!strip || !line) return;
      if (!element) { line.style.visibility = 'hidden'; shown = index; return; }
      const entry = entries[index], within = entry.seconds > 0 ? (time - entry.startSeconds) / entry.seconds : 0;
      line.style.visibility = '';
      line.style.left = `${element.offsetLeft + Math.min(1, Math.max(0, within)) * element.offsetWidth}px`;
      if (index !== shown && (element.offsetLeft < strip.scrollLeft || element.offsetLeft + element.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
        strip.scrollLeft = element.offsetLeft;
      }
      shown = index;
    };
    const loop = () => { show(); frame = requestAnimationFrame(loop); };
    const start = () => { cancelAnimationFrame(frame); loop(); };
    const stop = () => { cancelAnimationFrame(frame); show(); };
    audio.addEventListener('play', start);
    audio.addEventListener('pause', stop);
    audio.addEventListener('ended', stop);
    audio.addEventListener('seeked', show);
    if (audio.paused) show(); else start();
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('play', start);
      audio.removeEventListener('pause', stop);
      audio.removeEventListener('ended', stop);
      audio.removeEventListener('seeked', show);
    };
  }, [audio, entries, total]);

  const playFrom = (entry: TimelineEntry) => {
    if (!audio) return;
    audio.currentTime = entry.startSeconds;
    if (audio.paused) void audio.play().catch(() => {});
  };

  return (
    <div ref={stripRef} className="song-timeline" role="group" aria-label="Song order">
      {entries.map((entry, index) => {
        const label = `${entry.name} ×${entry.repeats}`;
        const style = { flexGrow: total > 0 ? entry.seconds : 1 };
        return audio
          ? (
            <button
              key={index}
              type="button"
              className={index === current ? 'song-timeline-entry playing' : 'song-timeline-entry'}
              data-color={entry.color}
              style={style}
              aria-current={index === current ? 'true' : undefined}
              title={`Play from ${entry.name}, at ${songClock(entry.startSeconds)}`}
              onClick={() => playFrom(entry)}
            >{label}</button>
          )
          : <span key={index} className="song-timeline-entry" data-color={entry.color} style={style}>{label}</span>;
      })}
      {audio && <span ref={lineRef} className="song-timeline-line" aria-hidden="true" />}
    </div>
  );
}
