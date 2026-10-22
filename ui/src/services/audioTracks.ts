// Audio tracks on the song's timeline (roadmap V23, docs/TIMELINE_PLAN.md). A track holds clips;
// a clip is a stretch of one recording, kept in this browser like a drum lane's sample and named
// here by its sample id. A clip starts at a tick of the song (32nd notes from its first beat), so
// it stays on its beat when the tempo changes; its offset into the recording, its length and its
// fades are seconds of the recording, which is never stretched. A project with no tracks stores
// none, and every project from before is unchanged.

export const MAX_TRACKS = 8;
export const MAX_CLIPS = 128;
export const MAX_TRACK_NAME = 40;
export const MAX_CLIP_NAME = 80;
// The furthest a clip can start: far beyond any song, but a bound on what a file can claim.
export const MAX_CLIP_TICK = 10_000_000;
// The longest recording a clip can play, in seconds.
export const MAX_CLIP_SECONDS = 3600;
export const MAX_CLIP_GAIN = 2;
export const TRACK_VOLUME = 0.8;

// What a track sends to the shared effects and the aux buses; a name is absent while it is 0.
export const TRACK_SEND_NAMES = ['reverb', 'delay', 'drive', 'phaser', 'chorus', 'auxA', 'auxB'] as const;
export type TrackSendName = typeof TRACK_SEND_NAMES[number];
export type TrackSends = Partial<Record<TrackSendName, number>>;

export interface AudioClip {
  id: string;
  sampleId: string;
  // The tick of the song it starts on.
  at: number;
  // Seconds: where in the recording it starts, how much of it plays.
  length: number;
  offset?: number;
  // Its level, 1 being the recording as it is; absent is 1.
  gain?: number;
  // Seconds of fade at its start and its end; absent is none.
  fadeIn?: number;
  fadeOut?: number;
  name?: string;
}

export interface AudioTrack {
  id: string;
  name: string;
  volume: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
  sends?: TrackSends;
  clips: AudioClip[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A sample's id, as `sampleStore` makes one.
const SAMPLE_ID = /^[0-9a-f-]{36}$/;
export const isTrackId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const between = (value: unknown, low: number, high: number, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback);
const tidy = (value: unknown, limit: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '');
// Seconds are kept to a hundred-thousandth, which is finer than a sample and keeps files short.
const seconds = (value: number) => Math.round(value * 1e5) / 1e5;

export const defaultTrackName = (index: number) => `Audio ${index + 1}`;

export function sanitizeSends(value: unknown, current: TrackSends = {}): TrackSends | undefined {
  const input = record(value), sends: TrackSends = {};
  for (const name of TRACK_SEND_NAMES) {
    const level = between(name in input ? input[name] : current[name], 0, 1, 0);
    if (level > 0) sends[name] = level;
  }
  return Object.keys(sends).length ? sends : undefined;
}

// A clip as the store keeps it, or null for one that cannot be: no id, no recording, nothing to play.
export function sanitizeClip(value: unknown): AudioClip | null {
  const input = record(value);
  if (!isTrackId(input.id) || typeof input.sampleId !== 'string' || !SAMPLE_ID.test(input.sampleId)) return null;
  const length = between(input.length, 0, MAX_CLIP_SECONDS, 0);
  if (!(length >= 0.001)) return null;
  const clip: AudioClip = {
    id: input.id,
    sampleId: input.sampleId,
    at: Math.round(between(input.at, 0, MAX_CLIP_TICK, 0)),
    length: seconds(length),
  };
  const offset = seconds(between(input.offset, 0, MAX_CLIP_SECONDS, 0));
  if (offset > 0) clip.offset = offset;
  const gain = between(input.gain, 0, MAX_CLIP_GAIN, 1);
  if (gain !== 1) clip.gain = gain;
  // Fades fit inside the clip: together they never last longer than it does.
  const fadeIn = seconds(between(input.fadeIn, 0, clip.length, 0));
  const fadeOut = seconds(between(input.fadeOut, 0, clip.length - fadeIn, 0));
  if (fadeIn > 0) clip.fadeIn = fadeIn;
  if (fadeOut > 0) clip.fadeOut = fadeOut;
  const name = tidy(input.name, MAX_CLIP_NAME);
  if (name) clip.name = name;
  return clip;
}

function sanitizeTrack(value: unknown, index: number): AudioTrack | null {
  const input = record(value);
  if (!isTrackId(input.id)) return null;
  const seen = new Set<string>(), clips: AudioClip[] = [];
  for (const entry of Array.isArray(input.clips) ? input.clips : []) {
    const clip = sanitizeClip(entry);
    if (!clip || seen.has(clip.id) || clips.length >= MAX_CLIPS) continue;
    seen.add(clip.id);
    clips.push(clip);
  }
  const track: AudioTrack = { id: input.id, name: tidy(input.name, MAX_TRACK_NAME) || defaultTrackName(index), volume: between(input.volume, 0, 1, TRACK_VOLUME), clips: sortClips(clips) };
  const pan = between(input.pan, -1, 1, 0);
  if (pan !== 0) track.pan = pan;
  if (input.muted === true) track.muted = true;
  if (input.solo === true) track.solo = true;
  const sends = sanitizeSends(input.sends);
  if (sends) track.sends = sends;
  return track;
}

// Tracks read from storage, a file, a link, the account or another browser, which are all
// untrusted. Undefined when there are none, so a project without tracks stores nothing.
export function sanitizeAudioTracks(value: unknown): AudioTrack[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tracks: AudioTrack[] = [], ids = new Set<string>();
  for (const entry of value) {
    if (tracks.length >= MAX_TRACKS) break;
    const track = sanitizeTrack(entry, tracks.length);
    // A clip's id is unique across the project, so one can be named by its id alone.
    if (!track || ids.has(track.id)) continue;
    track.clips = track.clips.filter(clip => !ids.has(clip.id) && ids.add(clip.id));
    ids.add(track.id);
    tracks.push(track);
  }
  return tracks.length ? tracks : undefined;
}

export const sortClips = (clips: AudioClip[]) => [...clips].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

// What can be changed on a track, and on a clip. Each is changed only when it is there, and checked.
export interface TrackPatch { name?: string; volume?: number; pan?: number; muted?: boolean; solo?: boolean; sends?: TrackSends }
export type ClipPatch = Partial<Omit<AudioClip, 'id' | 'sampleId'>>;

export function patchTrack(track: AudioTrack, patch: Record<string, unknown>, index: number): AudioTrack {
  const next = sanitizeTrack({
    ...track,
    ...('name' in patch ? { name: tidy(patch.name, MAX_TRACK_NAME) || defaultTrackName(index) } : {}),
    ...('volume' in patch ? { volume: between(patch.volume, 0, 1, track.volume) } : {}),
    ...('pan' in patch ? { pan: between(patch.pan, -1, 1, track.pan ?? 0) } : {}),
    ...('muted' in patch ? { muted: patch.muted === true } : {}),
    ...('solo' in patch ? { solo: patch.solo === true } : {}),
    ...('sends' in patch ? { sends: sanitizeSends(patch.sends, track.sends) } : {}),
  }, index);
  return next ?? track;
}

export function patchClip(clip: AudioClip, patch: Record<string, unknown>): AudioClip {
  const fields = ['at', 'length', 'offset', 'gain', 'fadeIn', 'fadeOut', 'name'] as const;
  const next: Record<string, unknown> = { ...clip };
  for (const field of fields) if (field in patch) next[field] = patch[field];
  return sanitizeClip(next) ?? clip;
}

// The sample ids the project's clips play.
export function clipSampleIds(tracks: unknown): string[] {
  const ids = new Set<string>();
  for (const track of Array.isArray(tracks) ? tracks : []) {
    for (const clip of Array.isArray(record(track).clips) ? record(track).clips as unknown[] : []) {
      const id = record(clip).sampleId;
      if (typeof id === 'string' && SAMPLE_ID.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

// Whether a track is heard, given every track's mute and solo.
export function trackHeard(track: AudioTrack, tracks: AudioTrack[]): boolean {
  if (track.muted) return false;
  return !tracks.some(other => other.solo) || track.solo === true;
}
