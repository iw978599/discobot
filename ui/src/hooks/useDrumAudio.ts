/**
 * Hook for drum audio playback in the browser
 * Uses DrumSynthesizer from engine instead of duplicating code
 */

import { useRef } from 'react';
import { DrumInstrument, DrumSettings } from '../types';
import { DrumSynthesizer } from '@discord-synth/engine';

export function useDrumAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const isResumingRef = useRef<boolean>(false);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function getMasterGain(): GainNode {
    if (masterGainRef.current) return masterGainRef.current;
    const ctx = getAudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
    masterGainRef.current = gain;
    return gain;
  }

  function setVolume(volume: number): void {
    const gain = masterGainRef.current;
    if (gain) gain.gain.value = volume;
  }

  function tryResume(): void {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
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

  async function playDrumHit(instrument: DrumInstrument, settings: DrumSettings, muted: boolean = false) {
    if (muted) return;

    try {
      tryResume();
      const ready = await ensureAudioReady();
      if (!ready) return;
      const ctx = getAudioContext();

      const sampleRate = ctx.sampleRate;

      // Use DrumSynthesizer from engine (no code duplication!)
      const pcm = DrumSynthesizer.renderHit(instrument, settings, sampleRate);

      let maxVal = 0;
      for (let i = 0; i < pcm.length; i++) {
        const a = Math.abs(pcm[i]);
        if (a > maxVal) maxVal = a;
      }
      if (maxVal < 0.001) {
        console.warn('Drum PCM output too quiet', {
          instrument,
          maxLevel: maxVal,
          settings,
          bufferLength: pcm.length,
        });
        return;
      }

      // Create and play audio buffer
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;

      const pan = Math.max(-1, Math.min(1, settings.pan ?? 0));
      const panNode = ctx.createStereoPanner();
      panNode.pan.value = pan;

      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(getMasterGain());
      source.start();
    } catch (error) {
      console.error('Drum playback error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        instrument,
        settings,
      });
    }
  }

  function dispose() {
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch((err) => {
        console.error('Error closing drum audio context:', err);
      });
      audioCtxRef.current = null;
    }
  }

  return {
    ensureAudioReady,
    tryResume,
    playDrumHit,
    setVolume,
    dispose,
  };
}
