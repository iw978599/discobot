import type { FxSendLevels } from '../types';
import { TRACK_SEND_NAMES, trackHeard, type AudioClip, type AudioTrack } from './audioTracks';
import { resample } from './guests';
import type { Recording } from './clipRecordings';

// The audio tracks in an export (docs/TIMELINE_PLAN.md, stage 2). Each heard track becomes one
// stereo take as long as the export, every clip laid where it starts with its level, its fades and
// the track's pan, as the live player plays it; the export then mixes the take through the
// track's level and sends, as it does a guest's recording. Nothing here is random.

export interface TrackTake { left: Float32Array; right: Float32Array; gain: number; name: string; sends?: FxSendLevels }

// A clip's level `time` seconds into it: its gain, faded in and out in straight lines.
export function clipLevel(clip: AudioClip, time: number): number {
  const fadeIn = clip.fadeIn ?? 0, fadeOut = clip.fadeOut ?? 0;
  let level = clip.gain ?? 1;
  if (fadeIn > 0 && time < fadeIn) level *= time / fadeIn;
  if (fadeOut > 0 && time > clip.length - fadeOut) level *= Math.max(0, (clip.length - time) / fadeOut);
  return level;
}

// What a StereoPannerNode does, so an export pans as playback does: a mono recording is spread by
// equal power; a stereo one keeps both sides and folds the far side across.
export function panFrame(left: number, right: number | undefined, pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  if (right === undefined) {
    const x = (p + 1) / 2;
    return [left * Math.cos(x * Math.PI / 2), left * Math.sin(x * Math.PI / 2)];
  }
  const x = p <= 0 ? p + 1 : p, near = Math.cos(x * Math.PI / 2), far = Math.sin(x * Math.PI / 2);
  return p <= 0 ? [left + right * near, right * far] : [left * near, right + left * far];
}

const sendsOf = (track: AudioTrack): FxSendLevels | undefined => {
  if (!track.sends) return undefined;
  return { reverb: 0, delay: 0, drive: 0, phaser: 0, ...Object.fromEntries(TRACK_SEND_NAMES.map(name => [name, track.sends?.[name] ?? 0])) };
};

// `secondsOf` says when a tick of the song falls in the export. A clip whose recording is not
// here (not on this device) is left out, as it is silent when playing.
export function renderTrackTakes(tracks: AudioTrack[], recordings: Map<string, Recording>, secondsOf: (tick: number) => number, frames: number, sampleRate: number): TrackTake[] {
  const resampled = new Map<Recording, Float32Array[]>();
  const channelsAt = (recording: Recording) => {
    let found = resampled.get(recording);
    if (!found) { found = recording.channels.map(channel => resample(channel, recording.rate, sampleRate)); resampled.set(recording, found); }
    return found;
  };
  const takes: TrackTake[] = [];
  for (const track of tracks) {
    if (!trackHeard(track, tracks) || track.volume <= 0) continue;
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let any = false;
    for (const clip of track.clips) {
      const recording = recordings.get(clip.sampleId);
      if (!recording) continue;
      const [first, second] = channelsAt(recording);
      const start = Math.round(secondsOf(clip.at) * sampleRate), from = Math.round((clip.offset ?? 0) * sampleRate);
      const length = Math.min(Math.round(clip.length * sampleRate), first.length - from, frames - start);
      for (let index = Math.max(0, -start); index < length; index++) {
        const level = clipLevel(clip, index / sampleRate);
        const [l, r] = panFrame(first[from + index] * level, second ? second[from + index] * level : undefined, track.pan ?? 0);
        left[start + index] += l;
        right[start + index] += r;
        any = true;
      }
    }
    if (any) takes.push({ left, right, gain: track.volume, name: track.name, ...(sendsOf(track) ? { sends: sendsOf(track) } : {}) });
  }
  return takes;
}
