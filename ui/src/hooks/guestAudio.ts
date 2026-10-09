import { createAudioLane, getAudioContext, loadAudioWorklet } from './browserAudio';
import { GUEST_LATENCY_MS, contextTimeAtWall, placeBlock, resample } from '../services/guests';

const MAX_BLOCK_FRAMES = 16384;

// Brings one guest's audio into the mixer. Blocks arrive from the frame stamped with the
// time they would have been heard there; each is placed on this context's clock that much
// later plus the agreed latency, which the guest has already made up for by playing early.
export function createGuestPlayer() {
  const context = getAudioContext();
  const lane = createAudioLane('synth');
  let node: AudioWorkletNode | null = null;
  let expected: number | null = null;
  let blocks = 0;
  let disposed = false;

  void loadAudioWorklet().then(() => {
    if (disposed) return;
    node = new AudioWorkletNode(context, 'guest-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(lane.input);
  }).catch(() => { /* the guest stays silent; the rest of the app is unaffected */ });

  return {
    get blocks() { return blocks; },
    setVolume(volume: number) { lane.setVolume(volume); },
    // Returns false for anything that is not a sane block of audio.
    push(wall: unknown, sampleRate: unknown, left: unknown, right: unknown): boolean {
      if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length) return false;
      if (left.length === 0 || left.length > MAX_BLOCK_FRAMES) return false;
      if (typeof wall !== 'number' || !Number.isFinite(wall) || typeof sampleRate !== 'number' || !(sampleRate >= 8000 && sampleRate <= 192000)) return false;
      if (!node) return true;
      const l = resample(left, sampleRate, context.sampleRate), r = resample(right, sampleRate, context.sampleRate);
      const target = contextTimeAtWall(context, wall + GUEST_LATENCY_MS) * context.sampleRate;
      const frame = placeBlock(expected, target, context.sampleRate);
      expected = frame + l.length;
      blocks += 1;
      node.port.postMessage({ frame, left: l, right: r });
      return true;
    },
    clear() { expected = null; node?.port.postMessage({ type: 'clear' }); },
    dispose() {
      disposed = true;
      node?.disconnect();
      lane.dispose();
    },
  };
}

export type GuestPlayer = ReturnType<typeof createGuestPlayer>;
