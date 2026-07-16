import { useRef } from 'react';

interface PatternAudioLoopPayload {
  audio: string;
  sampleRate: number;
}

export function usePatternAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isResumingRef = useRef(false);
  const activeLoopRef = useRef(false);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }

  function ensureOutputGain(ctx: AudioContext): GainNode {
    if (outputGainRef.current) return outputGainRef.current;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
    outputGainRef.current = gain;
    return gain;
  }

  function decodeBase64Pcm(base64: string): Int16Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const safeLength = bytes.length - (bytes.length % 2);
    return new Int16Array(bytes.buffer.slice(0, safeLength));
  }

  function buildStereoBuffer(ctx: AudioContext, pcm: Int16Array, sampleRate: number): AudioBuffer | null {
    const frameCount = Math.floor(pcm.length / 2);
    if (frameCount <= 0) return null;
    const buffer = ctx.createBuffer(2, frameCount, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < frameCount; i++) {
      left[i] = pcm[i * 2] / 32768;
      right[i] = pcm[i * 2 + 1] / 32768;
    }
    return buffer;
  }

  async function ensureAudioReady(): Promise<boolean> {
    const ctx = getAudioContext();
    if (ctx.state === 'running') return true;
    if (ctx.state !== 'suspended') return false;

    if (!isResumingRef.current) {
      isResumingRef.current = true;
      try {
        await ctx.resume();
      } finally {
        isResumingRef.current = false;
      }
    } else {
      while (ctx.state === 'suspended' && isResumingRef.current) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    return ctx.state !== 'suspended';
  }

  function setMuted(muted: boolean) {
    if (outputGainRef.current) outputGainRef.current.gain.value = muted ? 0 : 1;
  }

  function stop() {
    const source = activeSourceRef.current;
    if (source) {
      try {
        source.stop();
      } catch {
        // ignore
      }
      source.disconnect();
      activeSourceRef.current = null;
    }
    activeLoopRef.current = false;
  }

  async function playLoop(payload: PatternAudioLoopPayload, muted: boolean): Promise<boolean> {
    if (!payload.audio) return false;
    const ready = await ensureAudioReady();
    if (!ready) return false;

    const ctx = getAudioContext();
    const out = ensureOutputGain(ctx);
    out.gain.value = muted ? 0 : 1;

    const pcm = decodeBase64Pcm(payload.audio);
    const buffer = buildStereoBuffer(ctx, pcm, payload.sampleRate || 48000);
    if (!buffer) return false;

    stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(out);
    source.onended = () => {
      if (activeSourceRef.current === source) {
        activeSourceRef.current = null;
        activeLoopRef.current = false;
      }
    };
    source.start();
    activeSourceRef.current = source;
    activeLoopRef.current = true;
    return true;
  }

  function isActive(): boolean {
    return activeLoopRef.current;
  }

  function dispose() {
    stop();
    if (outputGainRef.current) {
      try {
        outputGainRef.current.disconnect();
      } catch {
        // ignore
      }
      outputGainRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  return {
    ensureAudioReady,
    playLoop,
    stop,
    setMuted,
    isActive,
    dispose,
  };
}
