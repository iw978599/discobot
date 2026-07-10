/**
 * Hook for drum audio playback in the browser
 * Uses DrumSynthesizer from engine instead of duplicating code
 */

import { useRef } from 'react';
import { DrumInstrument, DrumSettings } from '../types';
import { DrumSynthesizer } from '@discord-synth/engine';

export function useDrumAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function playDrumHit(instrument: DrumInstrument, settings: DrumSettings, muted: boolean = false) {
    if (muted) return;

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch((err) => console.error('Failed to resume AudioContext:', err));
      }

      const sampleRate = ctx.sampleRate;

      // Use DrumSynthesizer from engine (no code duplication!)
      const pcm = DrumSynthesizer.renderHit(instrument, settings, sampleRate);

      // Debug: Check audio levels
      let maxVal = 0;
      for (let i = 0; i < pcm.length; i++) {
        const a = Math.abs(pcm[i]);
        if (a > maxVal) maxVal = a;
      }

      if (maxVal < 0.001) {
        console.warn(`Drum ${instrument} PCM too quiet (max=${maxVal.toFixed(4)}), skipping playback`);
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
      source.start();
    } catch (error) {
      console.error(`Error playing drum hit ${instrument}:`, error);
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
    playDrumHit,
    dispose,
  };
}
