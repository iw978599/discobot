/**
 * Hook for drum audio playback in the browser
 * Uses DrumSynthesizer from engine instead of duplicating code
 */

import { useRef } from 'react';
import { DrumInstrument, DrumSettings } from '../types';
import { DrumSynthesizer } from '@discord-synth/engine';

export function useDrumAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isResumingRef = useRef<boolean>(false);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
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

    return ctx.state === 'running';
  }

  async function playDrumHit(instrument: DrumInstrument, settings: DrumSettings, muted: boolean = false) {
    console.log('playDrumHit called:', instrument, settings, 'muted:', muted);
    if (muted) return;

    try {
      console.log('Getting AudioContext...');
      const ready = await ensureAudioReady();
      if (!ready) return;
      const ctx = getAudioContext();
      console.log('AudioContext state:', ctx.state);

      const sampleRate = ctx.sampleRate;

      // Use DrumSynthesizer from engine (no code duplication!)
      const pcm = DrumSynthesizer.renderHit(instrument, settings, sampleRate);

      console.log('PCM buffer generated, length:', pcm.length);

      // Validate audio output
      let maxVal = 0;
      for (let i = 0; i < pcm.length; i++) {
        const a = Math.abs(pcm[i]);
        if (a > maxVal) maxVal = a;
      }

      console.log('PCM max value:', maxVal);

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

      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      console.log('Connected to destination:', ctx.destination);
      console.log('Destination max channels:', ctx.destination.maxChannelCount);
      source.start();
      console.log('Audio source started successfully');
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
    playDrumHit,
    dispose,
  };
}
