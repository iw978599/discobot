import type { Song, TimeSignature } from '../types';
import { barTicks } from './patternLength';
import type { AudioClip, AudioTrack } from './audioTracks';

// When the clips of the audio tracks sound (docs/TIMELINE_PLAN.md). A clip starts on a tick of
// the song, one of the transport's 32nd notes counted from the song's first beat; its length is
// seconds of its recording. So where a clip starts moves with the tempo and how long it lasts
// does not, and the two meet in seconds from the song's start.

// Seconds of one tick at a tempo: a 32nd note.
export const tickSeconds = (tempo: number) => 7.5 / (tempo > 0 ? tempo : 120);

type Length = (sceneId: string) => number;
type Signature = (sceneId: string) => TimeSignature | undefined;
type Tempo = (sceneId: string) => number | undefined;

// Seconds from the song's first beat to `tick`, each scene's ticks at its own tempo or the song's.
// A tick past the end is counted on at the last scene's tempo, so a clip placed after the song
// has a time, though the song ends before it.
export function songSecondsAt(song: Song, tick: number, lengthOf: Length, signatureOf: Signature, tempo: number, tempoOf?: Tempo): number {
  let left = Math.max(0, tick), seconds = 0, last = tempo;
  for (const entry of song.entries) {
    const at = tempoOf?.(entry.sceneId) ?? tempo;
    last = at;
    const ticks = entry.repeats * Math.max(1, lengthOf(entry.sceneId)) * barTicks(signatureOf(entry.sceneId));
    const taken = Math.min(left, ticks);
    seconds += taken * tickSeconds(at);
    left -= taken;
    if (left <= 0) return seconds;
  }
  return seconds + left * tickSeconds(last);
}

// The tick of the song `seconds` after its first beat, as a fraction: the other way from
// songSecondsAt. The timeline draws a clip as wide as the ticks its recording lasts.
export function songTickAt(song: Song, seconds: number, lengthOf: Length, signatureOf: Signature, tempo: number, tempoOf?: Tempo): number {
  let left = Math.max(0, seconds), ticks = 0, last = tempo;
  for (const entry of song.entries) {
    const at = tempoOf?.(entry.sceneId) ?? tempo;
    last = at;
    const count = entry.repeats * Math.max(1, lengthOf(entry.sceneId)) * barTicks(signatureOf(entry.sceneId));
    const lasts = count * tickSeconds(at);
    if (left <= lasts) return ticks + left / tickSeconds(at);
    ticks += count;
    left -= lasts;
  }
  return ticks + left / tickSeconds(last);
}

// The same for an export, whose bars are laid out already: each bar's signature, and when it
// starts and how long it lasts in seconds.
export function barSecondsAt(bars: Array<{ signature?: TimeSignature }>, times: Array<{ start: number; duration: number }>, tick: number): number {
  let left = Math.max(0, tick);
  for (let bar = 0; bar < bars.length; bar++) {
    const ticks = barTicks(bars[bar].signature);
    if (left < ticks) return times[bar].start + (left / ticks) * times[bar].duration;
    left -= ticks;
  }
  const last = times[times.length - 1];
  const lastTicks = barTicks(bars[bars.length - 1]?.signature);
  return last ? last.start + last.duration + (left / lastTicks) * last.duration : 0;
}

export interface ClipCue { track: AudioTrack; clip: AudioClip; into: number }

// The clips sounding at `seconds` into the song (`secondsOf` turns a clip's tick into seconds),
// with how far into each it is. A clip is sounding from its start until its length has passed.
export function clipsSounding(tracks: AudioTrack[], seconds: number, secondsOf: (tick: number) => number): ClipCue[] {
  const cues: ClipCue[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      const into = seconds - secondsOf(clip.at);
      if (into >= 0 && into < clip.length) cues.push({ track, clip, into });
    }
  }
  return cues;
}

// The clips that start on `tick`.
export const clipsStarting = (tracks: AudioTrack[], tick: number): ClipCue[] =>
  tracks.flatMap(track => track.clips.filter(clip => clip.at === tick).map(clip => ({ track, clip, into: 0 })));

// A clip's level over its own time: its gain, faded in from its start and out to its end. `into`
// is how far into the clip the sound begins. Answers the level now and the points to ramp through.
export function clipEnvelope(clip: AudioClip, into = 0): { now: number; points: Array<{ at: number; level: number }> } {
  const gain = clip.gain ?? 1, fadeIn = clip.fadeIn ?? 0, fadeOut = clip.fadeOut ?? 0;
  const level = (time: number) => {
    let value = gain;
    if (fadeIn > 0 && time < fadeIn) value *= time / fadeIn;
    if (fadeOut > 0 && time > clip.length - fadeOut) value *= Math.max(0, (clip.length - time) / fadeOut);
    return value;
  };
  const points: Array<{ at: number; level: number }> = [];
  for (const time of new Set([fadeIn, clip.length - fadeOut, clip.length])) {
    if (time > into) points.push({ at: time - into, level: level(time) });
  }
  return { now: level(into), points };
}
