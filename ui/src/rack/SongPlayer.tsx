import { useEffect, useRef, useState } from 'react';

const clock = (seconds: number) => {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

// The rack's own player for a rendered song: play and pause, a bar to move along it, and the
// time. The sound is an ordinary audio element, kept out of sight; this only drives it.
// `onAudio` hands that element to whatever else follows the song (the share page's timeline).
export default function SongPlayer({ src, label, onAudio }: { src: string; label: string; onAudio?: (audio: HTMLAudioElement | null) => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);

  useEffect(() => {
    onAudio?.(audioRef.current);
    return () => onAudio?.(null);
  }, [onAudio]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };

  return (
    <div className="song-player" role="group" aria-label={label}>
      <audio
        ref={audioRef}
        src={src}
        autoPlay
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setLength(event.currentTarget.duration)}
      />
      <button className={playing ? 'rack-btn go playing' : 'rack-btn go'} aria-pressed={playing} onClick={toggle}>
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <input
        type="range"
        aria-label="Place in the song"
        aria-valuetext={`${clock(time)} of ${clock(length)}`}
        min={0}
        max={Number.isFinite(length) && length > 0 ? length : 1}
        step={0.1}
        value={Math.min(time, length || 0)}
        onChange={(event) => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.currentTime = Number(event.target.value);
          setTime(audio.currentTime);
        }}
      />
      <output className="song-player-time">{clock(time)} / {clock(length)}</output>
    </div>
  );
}
