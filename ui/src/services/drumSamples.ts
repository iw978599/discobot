import type { DrumSample } from '../../../engine/src/drums/DrumCore';
import { getAudioContext } from '../hooks/browserAudio';
import { getSample } from './sampleStore';

// A drum hit is short. Anything longer is cut, so a whole song dropped on a lane by mistake
// does not sit in memory or get copied to the audio thread.
export const MAX_DRUM_SAMPLE_SECONDS = 10;

// Mixes a decoded file down to the one channel a drum lane plays.
export function toDrumSample(channels: Float32Array[], rate: number): DrumSample {
  const length = Math.min(channels[0]?.length ?? 0, Math.floor(rate * MAX_DRUM_SAMPLE_SECONDS));
  const data = new Float32Array(length);
  for (const channel of channels) for (let index = 0; index < length; index++) data[index] += channel[index] / channels.length;
  return { data, rate };
}

const decoded = new Map<string, Promise<DrumSample | null>>();

// The stored sample, decoded once. Null when it is not on this device (samples do not travel
// with a project) or cannot be decoded; the lane then plays its synthesized voice.
export function loadDrumSample(id: string): Promise<DrumSample | null> {
  let loading = decoded.get(id);
  if (!loading) {
    loading = (async () => {
      const stored = await getSample(id);
      if (!stored) return null;
      const buffer = await getAudioContext().decodeAudioData(stored.data.slice(0));
      return toDrumSample(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)), buffer.sampleRate);
    })().catch(() => null);
    decoded.set(id, loading);
    // A sample imported later under the same id is not possible, but one that was missing may arrive.
    void loading.then(sample => { if (!sample) decoded.delete(id); });
  }
  return loading;
}
