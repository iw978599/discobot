import { createAudioLane, getAudioContext, loadAudioWorklet } from './browserAudio';
import { GUEST_LATENCY_MS, NO_SENDS, contextTimeAtWall, latencyAfterLateBlocks, placeBlock, resample } from '../services/guests';
import type { FxSendLevels } from '../types';
import type { GuestPlayerMessage, GuestTapMessage } from '@discobot/engine';

const MAX_BLOCK_FRAMES = 16384;
// Audio that would start sooner than this from now is too late to place where it belongs.
const HEADROOM_SECONDS = 0.01;
// This many late blocks in a row is not a passing stall.
const LATE_RUN = 4;

export interface GuestPlayerStats { blocks: number; late: number; latencyMs: number; failed: boolean }

// Brings one guest's audio into the mixer. Blocks arrive from the frame stamped with the
// time they would have been heard there; each is placed on this context's clock that much
// later plus the latency, which the guest has already made up for by playing early.
//
// How long audio takes to cross from the frame differs between browsers and machines. A block
// that arrives after its time is still played, straight away, so a guest is late rather than
// silent. If that keeps happening the latency is raised by what was missing and `onLatency`
// is called, so the guest can be told to play that much earlier and land on the beat again.
const send = (node: AudioWorkletNode | null, message: GuestPlayerMessage) => node?.port.postMessage(message);

export function createGuestPlayer(onLatency: (latencyMs: number) => void, initialLatencyMs = GUEST_LATENCY_MS) {
  const context = getAudioContext();
  const lane = createAudioLane('synth');
  let node: AudioWorkletNode | null = null;
  let expected: number | null = null;
  let disposed = false;
  let lateRun = 0, worstLate = 0;
  const stats: GuestPlayerStats = { blocks: 0, late: 0, latencyMs: initialLatencyMs, failed: false };

  void loadAudioWorklet().then(() => {
    if (disposed) return;
    node = new AudioWorkletNode(context, 'guest-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.connect(lane.input);
  }).catch(() => { stats.failed = true; });

  return {
    stats,
    setVolume(volume: number) { lane.setVolume(volume); },
    setSends(sends: FxSendLevels | undefined) { lane.setSends(sends ?? NO_SENDS); },
    // Returns false for anything that is not a sane block of audio.
    push(wall: unknown, sampleRate: unknown, left: unknown, right: unknown): boolean {
      if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length) return false;
      if (left.length === 0 || left.length > MAX_BLOCK_FRAMES) return false;
      if (typeof wall !== 'number' || !Number.isFinite(wall) || typeof sampleRate !== 'number' || !(sampleRate >= 8000 && sampleRate <= 192000)) return false;
      stats.blocks += 1;
      if (!node) return true;
      const rate = context.sampleRate;
      const l = resample(left, sampleRate, rate), r = resample(right, sampleRate, rate);
      const soonest = Math.round((context.currentTime + HEADROOM_SECONDS) * rate);
      let frame = placeBlock(expected, contextTimeAtWall(context, wall + stats.latencyMs) * rate, rate);
      if (frame < soonest) {
        // Too late for its own place: play it now, after whatever is already queued.
        stats.late += 1;
        lateRun += 1;
        worstLate = Math.max(worstLate, (soonest - frame) / rate);
        frame = Math.max(soonest, expected ?? 0);
        if (lateRun >= LATE_RUN) {
          const next = latencyAfterLateBlocks(stats.latencyMs, worstLate);
          lateRun = 0; worstLate = 0;
          if (next !== stats.latencyMs) { stats.latencyMs = next; onLatency(next); }
        }
      } else {
        lateRun = 0; worstLate = 0;
      }
      expected = frame + l.length;
      send(node, { type: 'block', frame, left: l, right: r });
      return true;
    },
    clear() { expected = null; lateRun = 0; worstLate = 0; send(node, { type: 'clear' }); },
    dispose() {
      disposed = true;
      node?.disconnect();
      lane.dispose();
    },
  };
}

export type GuestPlayer = ReturnType<typeof createGuestPlayer>;

// Where a voice handed to a guest is taken (services/guestInput): the `guest-tap` processor, whose
// blocks are handed to `onBlock` with the frame each starts on. Its own output is silence, sent
// to the speakers only so that the browser keeps running it.
export function createGuestTap(onBlock: (frame: number, left: Float32Array, right: Float32Array) => void) {
  const context = getAudioContext();
  let node: AudioWorkletNode | null = null, keepAlive: GainNode | null = null, disposed = false;
  const ready = loadAudioWorklet().then(() => {
    if (disposed) return null;
    node = new AudioWorkletNode(context, 'guest-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = ({ data }: MessageEvent<GuestTapMessage>) => { if (data?.type === 'block') onBlock(data.frame, data.left, data.right); };
    keepAlive = context.createGain();
    keepAlive.gain.value = 0;
    node.connect(keepAlive).connect(context.destination);
    return node;
  });
  return {
    ready,
    dispose() {
      disposed = true;
      if (node) { node.port.onmessage = null; node.disconnect(); }
      keepAlive?.disconnect();
    },
  };
}
