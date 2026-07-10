/**
 * Hook for synthesizer audio playback in the browser
 * Manages Web Audio API nodes and ADSR envelope
 */

import { useRef } from 'react';
import { SynthParameters } from '../types';

// Note to frequency conversion
function noteToFrequency(note: string): number {
  const noteMap: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1,
    D: 2, 'D#': 3, Eb: 3,
    E: 4,
    F: 5, 'F#': 6, Gb: 6,
    G: 7, 'G#': 8, Ab: 8,
    A: 9, 'A#': 10, Bb: 10,
    B: 11,
  };
  const match = note.match(/^([A-G]#?b?)(-?\d+)$/);
  if (!match) {
    console.warn(`Invalid note format: ${note}, defaulting to A4 (440Hz)`);
    return 440;
  }

  const noteName = match[1];
  const octave = parseInt(match[2], 10);
  const semitone = noteMap[noteName] ?? 0;

  const midiNote = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

interface ActiveVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

export function useSynthAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeVoices = useRef<Map<string, ActiveVoice>>(new Map());

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function playNote(
    note: string,
    synthParams: SynthParameters | null,
    duration?: number,
    muted: boolean = false
  ) {
    if (muted) return;

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch((err) => console.error('Failed to resume AudioContext:', err));
      }

      const freq = noteToFrequency(note);
      const p = synthParams;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = p?.oscillator.type || 'sine';
      osc.frequency.value = freq;
      osc.detune.value = p?.oscillator.detune || 0;

      // Apply filter if parameters exist
      if (p) {
        const filter = ctx.createBiquadFilter();
        filter.type = (p.filter.type || 'lowpass') as BiquadFilterType;
        filter.frequency.value = p.filter.frequency;
        filter.Q.value = p.filter.q;
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }

      // Apply delay effect if enabled
      if (p?.effects.delay.enabled && p.effects.delay.wet > 0) {
        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const delayNode = ctx.createDelay(p.effects.delay.time);
        const feedbackGain = ctx.createGain();
        const outputGain = ctx.createGain();

        dryGain.gain.value = 1 - p.effects.delay.wet;
        wetGain.gain.value = p.effects.delay.wet;
        delayNode.delayTime.value = p.effects.delay.time;
        feedbackGain.gain.value = p.effects.delay.feedback;

        gain.connect(dryGain);
        gain.connect(delayNode);
        delayNode.connect(wetGain);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        dryGain.connect(outputGain);
        wetGain.connect(outputGain);
        outputGain.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }

      // Apply ADSR envelope
      const now = ctx.currentTime;
      const attack = p?.envelope.attack ?? 0.01;
      const decay = p?.envelope.decay ?? 0.1;
      const sustainLvl = p?.envelope.sustain ?? 0.7;
      const release = p?.envelope.release ?? 0.3;
      const vol = (p?.gain ?? 1.0) * 0.3;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + attack);
      gain.gain.linearRampToValueAtTime(vol * sustainLvl, now + attack + decay);

      osc.start(now);

      if (duration) {
        // Note with fixed duration
        const end = now + Math.max(duration, attack + decay + 0.01);
        gain.gain.setValueAtTime(vol * sustainLvl, end - release);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        osc.stop(end);
      } else {
        // Sustained note (store for later release)
        activeVoices.current.set(note, { osc, gain });
      }
    } catch (error) {
      console.error('Synth playback error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        note,
        duration,
      });
    }
  }

  function stopNote(note: string, synthParams: SynthParameters | null) {
    const voice = activeVoices.current.get(note);
    if (!voice) return;

    try {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      const release = synthParams?.envelope.release ?? 0.3;

      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.001, now + release);
      voice.osc.stop(now + release);

      activeVoices.current.delete(note);
    } catch (error) {
      console.error('Note release error:', {
        error: error instanceof Error ? error.message : String(error),
        note,
      });
    }
  }

  function dispose() {
    // Stop all active voices
    activeVoices.current.forEach((voice, note) => {
      try {
        voice.osc.stop();
        voice.gain.disconnect();
        voice.osc.disconnect();
      } catch (error) {
        console.error(`Error disposing voice ${note}:`, error);
      }
    });
    activeVoices.current.clear();

    // Close audio context
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch((err) => {
        console.error('Error closing synth audio context:', err);
      });
      audioCtxRef.current = null;
    }
  }

  return {
    playNote,
    stopNote,
    dispose,
  };
}
