import type { FxSendLevels } from '../types';
import { audioEngine, type AudioEngine } from './browserAudio';
import { TRACK_SEND_NAMES, trackHeard, type AudioClip, type AudioTrack } from '../services/audioTracks';
import { clipEnvelope } from '../services/clipTiming';
import { recordingBuffer, type Recording } from '../services/clipRecordings';

// The audio tracks as they sound live (docs/TIMELINE_PLAN.md, stage 2). Each track is a channel
// of the engine's, like a guest's: its level and its sends, ducked with the rest, through a pan of
// its own. Each clip played is a buffer source with its own level, which carries its fades.
// The scheduler says when each clip starts; Stop stops them all.

const NO_SENDS: FxSendLevels = { reverb: 0, delay: 0, drive: 0, phaser: 0 };
export const trackSends = (track: Pick<AudioTrack, 'sends'>): FxSendLevels =>
  ({ ...NO_SENDS, ...Object.fromEntries(TRACK_SEND_NAMES.map(name => [name, track.sends?.[name] ?? 0])) });

type Channel = { lane: ReturnType<AudioEngine['createLane']>; pan: StereoPannerNode };

export function createTrackPlayer(engine: AudioEngine = audioEngine) {
  const channels = new Map<string, Channel>();
  const sounding = new Set<{ source: AudioBufferSourceNode; level: GainNode }>();
  let shown: AudioTrack[] = [];

  const apply = (track: AudioTrack, { lane, pan }: Channel) => {
    lane.setVolume(trackHeard(track, shown) ? track.volume : 0);
    pan.pan.setTargetAtTime(track.pan ?? 0, engine.getContext().currentTime, 0.01);
    lane.setSends(trackSends(track));
  };
  // A track's channel is made when it first plays, which is always after a press of Play, so a
  // project with tracks does not start the audio before the page has been touched.
  const channel = (track: AudioTrack): Channel => {
    let found = channels.get(track.id);
    if (!found) {
      const lane = engine.createLane('synth'), pan = engine.getContext().createStereoPanner();
      pan.connect(lane.input);
      found = { lane, pan };
      channels.set(track.id, found);
      apply(track, found);
    }
    return found;
  };

  return {
    // The tracks as the project holds them: a channel for each, at its level, pan and sends; a
    // muted track, or one another's solo leaves out, is at nothing. A track that is gone is let go.
    sync(tracks: AudioTrack[]) {
      shown = tracks;
      for (const track of tracks) {
        const found = channels.get(track.id);
        if (found) apply(track, found);
      }
      for (const [id, { lane, pan }] of channels) {
        if (tracks.some(track => track.id === id)) continue;
        pan.disconnect();
        lane.dispose();
        channels.delete(id);
      }
    },
    // Plays `clip` of `track` at `when` on the audio clock, from `into` seconds into the clip.
    play(track: AudioTrack, clip: AudioClip, recording: Recording, when: number, into = 0) {
      if (!shown.some(entry => entry.id === track.id) || into >= clip.length) return;
      const ctx = engine.getContext();
      const buffer = recordingBuffer(ctx, recording);
      const start = (clip.offset ?? 0) + into;
      if (start >= buffer.duration) return;
      const source = ctx.createBufferSource(), level = ctx.createGain();
      source.buffer = buffer;
      const at = Math.max(when, ctx.currentTime);
      const envelope = clipEnvelope(clip, into + (at - when));
      level.gain.setValueAtTime(envelope.now, at);
      for (const point of envelope.points) level.gain.linearRampToValueAtTime(point.level, at + point.at);
      source.connect(level).connect(channel(track).pan);
      const length = Math.min(clip.length - into - (at - when), buffer.duration - start - (at - when));
      if (length <= 0) return;
      source.start(at, start + (at - when), length);
      const entry = { source, level };
      sounding.add(entry);
      source.onended = () => { sounding.delete(entry); source.disconnect(); level.disconnect(); };
    },
    // Stops every clip at once, with a few milliseconds' fade so nothing clicks.
    stop() {
      const ctx = engine.getContext(), now = ctx.currentTime;
      for (const { source, level } of sounding) {
        level.gain.cancelScheduledValues(now);
        level.gain.setValueAtTime(level.gain.value, now);
        level.gain.linearRampToValueAtTime(0, now + 0.01);
        try { source.stop(now + 0.015); } catch { /* already stopped */ }
      }
      sounding.clear();
    },
    playing: () => sounding.size,
  };
}

// The app's one.
export const trackPlayer = createTrackPlayer();
