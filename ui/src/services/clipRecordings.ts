import { getAudioContext } from '../hooks/browserAudio';
import { getSample } from './sampleStore';

// The recordings the audio tracks' clips play, decoded once each and kept as plain channels, so
// live playback (an AudioBuffer in the live context) and an export (mixed by hand) use the same.
export interface Recording { rate: number; channels: Float32Array[] }

const decoded = new Map<string, Promise<Recording | null>>();
const ready = new Map<string, Recording>();

// The stored sample, decoded. Null when it is not on this device (a recording travels in a
// project file, but not with sync, a link or a live session) or cannot be decoded.
export function loadRecording(id: string): Promise<Recording | null> {
  let loading = decoded.get(id);
  if (!loading) {
    loading = (async () => {
      const stored = await getSample(id);
      if (!stored) return null;
      const buffer = await getAudioContext().decodeAudioData(stored.data.slice(0));
      const recording = { rate: buffer.sampleRate, channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) => buffer.getChannelData(channel)) };
      ready.set(id, recording);
      return recording;
    })().catch(() => null);
    decoded.set(id, loading);
    // One that was missing may arrive later, in a project file.
    void loading.then(recording => { if (!recording) decoded.delete(id); });
  }
  return loading;
}

// A recording already decoded, for the scheduler, which cannot wait.
export const recordingNow = (id: string): Recording | undefined => ready.get(id);

// Decodes every recording the tracks play, in the background.
export function loadRecordings(ids: Iterable<string>): Promise<Map<string, Recording>> {
  const list = [...new Set(ids)];
  return Promise.all(list.map(id => loadRecording(id))).then(found => new Map(list.flatMap((id, index) => (found[index] ? [[id, found[index]!] as const] : []))));
}

// The recording as an AudioBuffer of a context, made once per context.
const buffers = new WeakMap<BaseAudioContext, Map<Recording, AudioBuffer>>();
export function recordingBuffer(context: BaseAudioContext, recording: Recording): AudioBuffer {
  let made = buffers.get(context);
  if (!made) { made = new Map(); buffers.set(context, made); }
  let buffer = made.get(recording);
  if (!buffer) {
    buffer = context.createBuffer(recording.channels.length, recording.channels[0]?.length || 1, recording.rate);
    recording.channels.forEach((channel, index) => buffer!.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
    made.set(recording, buffer);
  }
  return buffer;
}
