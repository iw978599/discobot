import { useRef, useCallback, useEffect } from 'react';
import { SynthParameters, EffectsLoopState } from '../types';

interface SharedEffectsBus {
  input: GainNode;
  output: GainNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
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
  if (k === 0) {
    for (let i = 0; i < samples; i++) curve[i] = (i * 2) / samples - 1;
    return curve;
  }
  const limit = Math.tanh(k);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * k) / limit;
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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletReadyRef = useRef<boolean>(false);
  const sharedBusRef = useRef<SharedEffectsBus | null>(null);
  const reverbImpulseCache = useRef<Map<string, AudioBuffer>>(new Map());
  const isResumingRef = useRef<boolean>(false);
  const pendingParamsRef = useRef<Partial<SynthParameters> | null>(null);

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  async function ensureWorklet(): Promise<boolean> {
    const ctx = getAudioContext();
    if (workletReadyRef.current && workletNodeRef.current) return true;

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      await ctx.audioWorklet.addModule('/synth-processor.js');
      const node = new AudioWorkletNode(ctx, 'synth-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      workletNodeRef.current = node;
      workletReadyRef.current = true;

      const bus = getOrCreateSharedBus(ctx);
      node.connect(bus.input);
      bus.output.connect(ctx.destination);

      if (pendingParamsRef.current) {
        node.port.postMessage({ type: 'params', params: flattenParams(pendingParamsRef.current as SynthParameters) });
        pendingParamsRef.current = null;
      }

      return true;
    } catch (err) {
      console.error('Failed to load AudioWorklet:', err);
      return false;
    }
  }

  function getOrCreateSharedBus(ctx: AudioContext): SharedEffectsBus {
    if (sharedBusRef.current) return sharedBusRef.current;

    const input = ctx.createGain();
    input.gain.value = 1;
    const output = ctx.createGain();
    output.gain.value = 1;

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

    const driveShaper = ctx.createWaveShaper();
    const driveWet = ctx.createGain();
    driveShaper.curve = createDriveCurve(0.18);
    driveShaper.oversample = '2x';
    driveWet.gain.value = 0.18;
    input.connect(driveShaper);
    driveShaper.connect(driveWet);
    driveWet.connect(output);

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
      input, output, delay, delayFeedback, delayWet,
      reverb, reverbWet, driveShaper, driveWet,
      phaserFilter, phaserFeedback, phaserWet, phaserLfo, phaserDepth,
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
    if (bus.reverb.buffer !== impulse) bus.reverb.buffer = impulse;

    bus.driveShaper.curve = createDriveCurve(loop.drive.amount);
    bus.driveWet.gain.value = loop.drive.enabled ? loop.drive.amount : 0;

    bus.phaserLfo.frequency.value = loop.phaser.rate;
    bus.phaserDepth.gain.value = loop.phaser.depth * 1200;
    bus.phaserFeedback.gain.value = loop.phaser.enabled ? loop.phaser.feedback : 0;
    bus.phaserWet.gain.value = loop.phaser.enabled ? loop.phaser.mix : 0;
    bus.phaserFilter.frequency.value = 320 + loop.phaser.depth * 980;
  }

  function flattenParams(p: SynthParameters): Record<string, unknown> {
    return {
      oscType: p.oscillator.type,
      detune: p.oscillator.detune,
      filterFreq: p.filter.frequency,
      filterQ: p.filter.q,
      attack: p.envelope.attack,
      decay: p.envelope.decay,
      sustain: p.envelope.sustain,
      release: p.envelope.release,
      gain: p.gain,
      pan: p.pan ?? 0,
      portamentoEnabled: p.portamento?.enabled ?? false,
      portamentoGlide: p.portamento?.glide ?? 0.05,
      lfo1Enabled: p.lfo1.enabled,
      lfo1Target: p.lfo1.target,
      lfo1Waveform: p.lfo1.waveform,
      lfo1Rate: p.lfo1.rate,
      lfo1Depth: p.lfo1.depth,
      lfo2Enabled: p.lfo2.enabled,
      lfo2Target: p.lfo2.target,
      lfo2Waveform: p.lfo2.waveform,
      lfo2Rate: p.lfo2.rate,
      lfo2Depth: p.lfo2.depth,
    };
  }

  async function ensureAudioReady(): Promise<boolean> {
    const ctx = getAudioContext();
    if (ctx.state === 'running') return true;
    if (ctx.state !== 'suspended') return false;
    if (!isResumingRef.current) {
      isResumingRef.current = true;
      try { await ctx.resume(); } catch (err) { console.error('Failed to resume AudioContext:', err); }
      finally { isResumingRef.current = false; }
    } else {
      while (ctx.state === 'suspended' && isResumingRef.current) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    return ctx.state !== 'suspended';
  }

  const playNote = useCallback(async (
    note: string,
    synthParams: SynthParameters | null,
    duration?: number,
    velocity: number = 1,
    muted: boolean = false,
    effectsLoop?: EffectsLoopState
  ) => {
    if (muted) return;
    const ready = await ensureAudioReady();
    if (!ready) return;
    const workletReady = await ensureWorklet();
    if (!workletReady) return;
    const ctx = getAudioContext();
    const node = workletNodeRef.current!;

    if (synthParams) {
      node.port.postMessage({ type: 'params', params: flattenParams(synthParams) });
    }

    if (effectsLoop?.enabled) {
      const bus = getOrCreateSharedBus(ctx);
      updateSharedBus(bus, effectsLoop, ctx);
    }

    const vol = Math.max(0, Math.min(1, velocity));
    node.port.postMessage({ type: 'noteOn', note, velocity: vol });

    if (duration) {
      setTimeout(() => {
        node.port.postMessage({ type: 'noteOff', note });
      }, duration * 1000);
    }
  }, []);

  const stopNote = useCallback((note: string, _synthParams: SynthParameters | null) => {
    const node = workletNodeRef.current;
    if (!node) return;
    node.port.postMessage({ type: 'noteOff', note });
  }, []);

  const stopAllNotes = useCallback((_release: number = 0.03) => {
    const node = workletNodeRef.current;
    if (!node) return;
    node.port.postMessage({ type: 'allNotesOff' });
  }, []);

  const dispose = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
      workletReadyRef.current = false;
    }
    if (sharedBusRef.current) {
      try { sharedBusRef.current.input.disconnect(); sharedBusRef.current.output.disconnect(); } catch { /* ignore */ }
      sharedBusRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => { dispose(); };
  }, [dispose]);

  return {
    ensureAudioReady,
    playNote,
    stopNote,
    stopAllNotes,
    dispose,
  };
}
