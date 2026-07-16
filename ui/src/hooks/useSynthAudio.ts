/**
 * Hook for synthesizer audio playback in the browser
 * Manages Web Audio API nodes, ADSR envelope, and shared effects loop bus
 */

import { useRef } from 'react';
import { SynthParameters, EffectsLoopState } from '../types';

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
  nodes: AudioNode[];
  lfos: OscillatorNode[];
}

interface SharedEffectsBus {
  input: GainNode;
  output: GainNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  reverbImpulse: AudioBuffer;
  driveShaper: WaveShaperNode;
  driveWet: GainNode;
  phaserFilter: BiquadFilterNode;
  phaserFeedback: GainNode;
  phaserWet: GainNode;
  phaserLfo: OscillatorNode;
  phaserDepth: GainNode;
}

function createDriveCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 256;
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
  const k = amount * 18;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k || 1);
  }
  return curve;
}

function createReverbImpulse(ctx: AudioContext, decay: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * decay));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const pos = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * pos * pos;
    }
  }
  return impulse;
}

export function useSynthAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeVoices = useRef<Map<string, ActiveVoice>>(new Map());
  const pendingStops = useRef<Set<string>>(new Set());
  const isResumingRef = useRef<boolean>(false);
  const reverbImpulseCache = useRef<Map<string, AudioBuffer>>(new Map());
  const sharedBusRef = useRef<SharedEffectsBus | null>(null);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function getOrCreateSharedBus(ctx: AudioContext): SharedEffectsBus {
    if (sharedBusRef.current) return sharedBusRef.current;

    const input = ctx.createGain();
    input.gain.value = 1;
    const output = ctx.createGain();
    output.gain.value = 1;

    // Delay
    const delay = ctx.createDelay(2);
    const delayFeedback = ctx.createGain();
    const delayWet = ctx.createGain();
    delay.delayTime.value = 0.22;
    delayFeedback.gain.value = 0.35;
    delayWet.gain.value = 0.3;
    input.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(output);

    // Reverb
    const reverb = ctx.createConvolver();
    const reverbWet = ctx.createGain();
    const decay = 2.1;
    const decayKey = decay.toFixed(2);
    let impulse = reverbImpulseCache.current.get(decayKey);
    if (!impulse) {
      impulse = createReverbImpulse(ctx, decay);
      reverbImpulseCache.current.set(decayKey, impulse);
    }
    reverb.buffer = impulse;
    reverbWet.gain.value = 0.38;
    input.connect(reverb);
    reverb.connect(reverbWet);
    reverbWet.connect(output);

    // Drive (waveshaper)
    const driveShaper = ctx.createWaveShaper();
    const driveWet = ctx.createGain();
    driveShaper.curve = createDriveCurve(0.18);
    driveShaper.oversample = '2x';
    driveWet.gain.value = 0.18;
    input.connect(driveShaper);
    driveShaper.connect(driveWet);
    driveWet.connect(output);

    // Phaser
    const phaserFilter = ctx.createBiquadFilter();
    phaserFilter.type = 'allpass';
    phaserFilter.frequency.value = 720;
    const phaserFeedback = ctx.createGain();
    phaserFeedback.gain.value = 0.25;
    const phaserWet = ctx.createGain();
    phaserWet.gain.value = 0;
    const phaserLfo = ctx.createOscillator();
    phaserLfo.type = 'sine';
    phaserLfo.frequency.value = 0.45;
    const phaserDepth = ctx.createGain();
    phaserDepth.gain.value = 520;
    phaserLfo.connect(phaserDepth);
    phaserDepth.connect(phaserFilter.frequency);
    input.connect(phaserFilter);
    phaserFilter.connect(phaserFeedback);
    phaserFeedback.connect(phaserFilter);
    phaserFilter.connect(phaserWet);
    phaserWet.connect(output);
    phaserLfo.start();

    output.connect(ctx.destination);

    sharedBusRef.current = {
      input,
      output,
      delay,
      delayFeedback,
      delayWet,
      reverb,
      reverbWet,
      reverbImpulse: impulse,
      driveShaper,
      driveWet,
      phaserFilter,
      phaserFeedback,
      phaserWet,
      phaserLfo,
      phaserDepth,
    };
    return sharedBusRef.current;
  }

  function updateSharedBus(bus: SharedEffectsBus, loop: EffectsLoopState, ctx: AudioContext) {
    bus.delay.delayTime.value = loop.delay.time;
    bus.delayFeedback.gain.value = loop.delay.feedback;
    bus.delayWet.gain.value = loop.delay.enabled ? loop.delay.mix : 0;

    bus.reverbWet.gain.value = loop.reverb.enabled ? loop.reverb.mix : 0;
    const newDecay = Math.max(0.1, loop.reverb.decay);
    const decayKey = newDecay.toFixed(2);
    let impulse = reverbImpulseCache.current.get(decayKey);
    if (!impulse) {
      impulse = createReverbImpulse(ctx, newDecay);
      reverbImpulseCache.current.set(decayKey, impulse);
    }
    if (bus.reverb.buffer !== impulse) {
      bus.reverb.buffer = impulse;
    }

    bus.driveShaper.curve = createDriveCurve(loop.drive.amount);
    bus.driveWet.gain.value = loop.drive.enabled ? loop.drive.amount : 0;

    bus.phaserLfo.frequency.value = loop.phaser.rate;
    bus.phaserDepth.gain.value = loop.phaser.depth * 1200;
    bus.phaserFeedback.gain.value = loop.phaser.enabled ? loop.phaser.feedback : 0;
    bus.phaserWet.gain.value = loop.phaser.enabled ? loop.phaser.mix : 0;
    bus.phaserFilter.frequency.value = 320 + loop.phaser.depth * 980;
  }

  async function ensureAudioReady(): Promise<boolean> {
    const ctx = getAudioContext();
    if (ctx.state === 'running') return true;
    if (ctx.state !== 'suspended') return false;

    if (!isResumingRef.current) {
      isResumingRef.current = true;
      try {
        await ctx.resume();
      } catch (err) {
        console.error('Failed to resume AudioContext:', err);
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

  async function playNote(
    note: string,
    synthParams: SynthParameters | null,
    duration?: number,
    velocity: number = 1,
    muted: boolean = false,
    effectsLoop?: EffectsLoopState
  ) {
    if (muted) return;

    try {
      const ready = await ensureAudioReady();
      if (!ready) return;
      const ctx = getAudioContext();

      const freq = noteToFrequency(note);
      const p = synthParams;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const nodes: AudioNode[] = [osc, gain];
      const lfos: OscillatorNode[] = [];

      osc.type = p?.oscillator.type || 'sine';
      osc.frequency.value = freq;
      osc.detune.value = p?.oscillator.detune || 0;

      let filterNode: BiquadFilterNode | null = null;
      if (p) {
        filterNode = ctx.createBiquadFilter();
        filterNode.type = (p.filter.type || 'lowpass') as BiquadFilterType;
        filterNode.frequency.value = p.filter.frequency;
        filterNode.Q.value = p.filter.q;
        osc.connect(filterNode);
        filterNode.connect(gain);
        nodes.push(filterNode);
      } else {
        osc.connect(gain);
      }

      const lfoConfig = [p?.lfo1, p?.lfo2].filter(Boolean) as NonNullable<SynthParameters['lfo1']>[];
      lfoConfig.forEach((lfo) => {
        if (!lfo.enabled) return;
        const lfoOsc = ctx.createOscillator();
        lfoOsc.type = lfo.waveform;
        lfoOsc.frequency.value = lfo.rate;
        const lfoGain = ctx.createGain();
        if (lfo.target === 'pitch') {
          lfoGain.gain.value = lfo.depth * 1200;
          lfoOsc.connect(lfoGain);
          lfoGain.connect(osc.detune);
        } else if (filterNode) {
          lfoGain.gain.value = lfo.depth * 2400;
          lfoOsc.connect(lfoGain);
          lfoGain.connect(filterNode.detune);
        }
        lfoOsc.start(ctx.currentTime);
        lfos.push(lfoOsc);
        nodes.push(lfoOsc, lfoGain);
      });

      const finalOutput = ctx.createGain();
      nodes.push(finalOutput);

      const delayEnabled = Boolean(p?.effects.delay.enabled && p.effects.delay.wet > 0);
      const reverbEnabled = Boolean(p?.effects.reverb.enabled && p.effects.reverb.wet > 0);

      if (!delayEnabled && !reverbEnabled) {
        gain.connect(finalOutput);
      } else {
        const dryGain = ctx.createGain();
        const maxWet = Math.max(
          delayEnabled ? p?.effects.delay.wet ?? 0 : 0,
          reverbEnabled ? p?.effects.reverb.wet ?? 0 : 0
        );
        dryGain.gain.value = Math.max(0, 1 - maxWet);
        gain.connect(dryGain);
        dryGain.connect(finalOutput);
        nodes.push(dryGain);

        if (delayEnabled && p) {
          const delayNode = ctx.createDelay(Math.max(0.001, p.effects.delay.time));
          const delayWetGain = ctx.createGain();
          const feedbackGain = ctx.createGain();
          delayWetGain.gain.value = p.effects.delay.wet;
          delayNode.delayTime.value = p.effects.delay.time;
          feedbackGain.gain.value = p.effects.delay.feedback;
          gain.connect(delayNode);
          delayNode.connect(delayWetGain);
          delayWetGain.connect(finalOutput);
          delayNode.connect(feedbackGain);
          feedbackGain.connect(delayNode);
          nodes.push(delayNode, delayWetGain, feedbackGain);
        }

        if (reverbEnabled && p) {
          const convolver = ctx.createConvolver();
          const reverbWetGain = ctx.createGain();
          const decay = Math.max(0.1, p.effects.reverb.decay);
          const decayKey = decay.toFixed(2);
          let impulse = reverbImpulseCache.current.get(decayKey);
          if (!impulse) {
            impulse = createReverbImpulse(ctx, decay);
            reverbImpulseCache.current.set(decayKey, impulse);
          }
          convolver.buffer = impulse;
          reverbWetGain.gain.value = p.effects.reverb.wet;
          gain.connect(convolver);
          convolver.connect(reverbWetGain);
          reverbWetGain.connect(finalOutput);
          nodes.push(convolver, reverbWetGain);
        }
      }

      // Route to shared effects bus
      if (effectsLoop?.enabled && p?.fxSends) {
        const bus = getOrCreateSharedBus(ctx);
        updateSharedBus(bus, effectsLoop, ctx);
        const sendGain = ctx.createGain();
        const sendLevel = (p.fxSends.reverb + p.fxSends.delay + p.fxSends.drive + p.fxSends.phaser) / 4;
        const returnLevel = Math.max(0, Math.min(1, p.fxReturn ?? 0.85));
        sendGain.gain.value = sendLevel * returnLevel;
        gain.connect(sendGain);
        sendGain.connect(bus.input);
        nodes.push(sendGain);
      }

      finalOutput.connect(ctx.destination);

      const now = ctx.currentTime;
      const attack = p?.envelope.attack ?? 0.01;
      const decay = p?.envelope.decay ?? 0.1;
      const sustainLvl = p?.envelope.sustain ?? 0.7;
      const release = p?.envelope.release ?? 0.3;
      const vol = (p?.gain ?? 1.0) * Math.max(0, Math.min(1, velocity)) * 0.3;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + attack);
      gain.gain.linearRampToValueAtTime(vol * sustainLvl, now + attack + decay);

      osc.start(now);

      if (duration) {
        const end = now + Math.max(duration, attack + decay + 0.01);
        const releaseStart = Math.max(now + attack + decay, end - release, now);
        gain.gain.setValueAtTime(vol * sustainLvl, releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        osc.stop(end);
        lfos.forEach((lfo) => lfo.stop(end));
      } else {
        activeVoices.current.set(note, { osc, gain, nodes, lfos });
        if (pendingStops.current.has(note)) {
          pendingStops.current.delete(note);
          stopNote(note, p || null);
        }
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
    if (!voice) {
      pendingStops.current.add(note);
      return;
    }

    try {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      const release = synthParams?.envelope.release ?? 0.3;

      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.exponentialRampToValueAtTime(0.001, now + release);
      voice.osc.stop(now + release);
      voice.lfos.forEach(lfo => lfo.stop(now + release));

      activeVoices.current.delete(note);
      pendingStops.current.delete(note);
    } catch (error) {
      console.error('Note release error:', {
        error: error instanceof Error ? error.message : String(error),
        note,
      });
    }
  }

  function stopAllNotes(release: number = 0.03) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    activeVoices.current.forEach((voice) => {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.001), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.001, now + release);
        voice.osc.stop(now + release);
        voice.lfos.forEach(lfo => lfo.stop(now + release));
      } catch {
        // ignore
      }
      activeVoices.current.delete(voice.osc.frequency.value.toString());
    });
    pendingStops.current.clear();
  }

  function dispose() {
    activeVoices.current.forEach((voice) => {
      try {
        voice.osc.stop();
        voice.lfos.forEach(lfo => lfo.stop());
        voice.nodes.forEach(node => node.disconnect());
      } catch (error) {
        console.error('Error disposing voice:', error);
      }
    });
    activeVoices.current.clear();
    pendingStops.current.clear();

    if (sharedBusRef.current) {
      try {
        sharedBusRef.current.input.disconnect();
        sharedBusRef.current.output.disconnect();
      } catch { /* ignore */ }
      sharedBusRef.current = null;
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch((err) => {
        console.error('Error closing synth audio context:', err);
      });
      audioCtxRef.current = null;
    }
  }

  return {
    ensureAudioReady,
    playNote,
    stopNote,
    stopAllNotes,
    dispose,
  };
}
