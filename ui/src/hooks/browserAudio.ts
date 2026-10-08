import type { EffectsLoopState, FxSendLevels } from '../types';

const limit = (v: number, min: number, max: number, fallback = min) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const smooth = (p: AudioParam, value: number, ctx: AudioContext) =>
  p.setTargetAtTime(value, ctx.currentTime, 0.015);
type EffectName = keyof FxSendLevels;
type Effects = {
  inputs: Record<EffectName, GainNode>;
  wet: Record<EffectName, GainNode>;
  output: GainNode;
  delay: DelayNode;
  feedback: GainNode;
  reverb: ConvolverNode;
  decay: number;
  drive: WaveShaperNode;
  tone: BiquadFilterNode;
  phaser: BiquadFilterNode[];
  phaserFeedback: GainNode;
  lfo: OscillatorNode;
  depth: GainNode;
};

let context: AudioContext | undefined;
let master: GainNode;
let loop: EffectsLoopState | undefined;
let workletLoading: Promise<void> | undefined;
let masterVolume = 1;
let masterMuted = false;
const effects = new Map<'synth' | 'drums', Effects>();

export function getAudioContext(): AudioContext {
  if (!context || context.state === 'closed') {
    context = new AudioContext({ latencyHint: 'interactive' });
    effects.clear();
    workletLoading = undefined;
    master = context.createGain();
    master.gain.value = masterMuted ? 0 : masterVolume * 0.55;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    const safety = context.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((2 * i / (curve.length - 1) - 1) * 1.2) * 0.95;
    safety.curve = curve;
    safety.oversample = '2x';
    master.connect(limiter).connect(safety).connect(context.destination);
  }
  return context;
}

export async function ensureAudioReady(): Promise<boolean> {
  const ctx = getAudioContext();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch { return false; }
}

export function setMasterVolume(volume: number): void {
  masterVolume = limit(volume, 0, 1);
  if (context) smooth(master.gain, masterMuted ? 0 : masterVolume * 0.55, context);
}

export function setMasterMuted(muted: boolean): void {
  masterMuted = muted;
  if (context) smooth(master.gain, masterMuted ? 0 : masterVolume * 0.55, context);
}

export async function playSample(data: ArrayBuffer): Promise<void> {
  if (!await ensureAudioReady()) return;
  const ctx = getAudioContext();
  const buffer = await ctx.decodeAudioData(data.slice(0));
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  // Samples join the same protected master; short boundary ramps avoid cropped-file clicks.
  const end = ctx.currentTime + buffer.duration;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.7, ctx.currentTime + Math.min(0.005, buffer.duration / 2));
  gain.gain.setValueAtTime(0.7, Math.max(ctx.currentTime, end - 0.005));
  gain.gain.linearRampToValueAtTime(0, end);
  source.connect(gain).connect(master);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start();
}

export function loadSynthWorklet(): Promise<void> {
  const ctx = getAudioContext();
  if (!workletLoading) {
    const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    workletLoading = ctx.audioWorklet.addModule(`${base}synth-processor.js`)
      .catch(error => { workletLoading = undefined; throw error; });
  }
  return workletLoading;
}

function createEffects(group: 'synth' | 'drums'): Effects {
  const ctx = getAudioContext();
  const existing = effects.get(group);
  if (existing) return existing;
  const output = ctx.createGain();
  output.connect(master);
  const inputs = {} as Effects['inputs'], wet = {} as Effects['wet'];
  for (const name of ['reverb', 'delay', 'drive', 'phaser'] as EffectName[]) {
    inputs[name] = ctx.createGain();
    wet[name] = ctx.createGain();
    wet[name].gain.value = 0;
    wet[name].connect(output);
  }
  const delay = ctx.createDelay(2), feedback = ctx.createGain();
  feedback.gain.value = 0;
  inputs.delay.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet.delay);
  const reverb = ctx.createConvolver();
  inputs.reverb.connect(reverb).connect(wet.reverb);
  const drive = ctx.createWaveShaper(), tone = ctx.createBiquadFilter();
  drive.oversample = '4x';
  inputs.drive.connect(drive).connect(tone).connect(wet.drive);
  const phaser = Array.from({ length: 4 }, () => ctx.createBiquadFilter());
  phaser.forEach(node => { node.type = 'allpass'; node.Q.value = 0.7; });
  inputs.phaser.connect(phaser[0]);
  for (let i = 1; i < phaser.length; i++) phaser[i - 1].connect(phaser[i]);
  const phaserFeedback = ctx.createGain();
  phaserFeedback.gain.value = 0;
  phaser[3].connect(phaserFeedback).connect(phaser[0]);
  phaser[3].connect(wet.phaser);
  // An all-pass alone only rotates phase; mixing a dry tap creates the moving notches.
  inputs.phaser.connect(wet.phaser);
  const lfo = ctx.createOscillator(), depth = ctx.createGain();
  lfo.connect(depth);
  phaser.forEach(node => depth.connect(node.frequency));
  lfo.start();
  const bus = { inputs, wet, output, delay, feedback, reverb, decay: 0, drive, tone, phaser, phaserFeedback, lfo, depth };
  effects.set(group, bus);
  if (loop) updateEffects(bus, group, loop, ctx);
  return bus;
}

function updateEffects(bus: Effects, group: 'synth' | 'drums', state: EffectsLoopState, ctx: AudioContext) {
  const enabled = state.enabled;
  smooth(bus.output.gain, enabled ? limit(state.returns[group], 0, 1) : 0, ctx);
  smooth(bus.delay.delayTime, limit(state.delay.time, 0.01, 2), ctx);
  smooth(bus.feedback.gain, state.delay.enabled && enabled ? limit(state.delay.feedback, 0, 0.85) : 0, ctx);
  smooth(bus.wet.delay.gain, state.delay.enabled ? limit(state.delay.mix, 0, 1) : 0, ctx);
  smooth(bus.wet.reverb.gain, state.reverb.enabled ? limit(state.reverb.mix, 0, 1) : 0, ctx);
  const decay = limit(state.reverb.decay, 0.1, 8);
  if (Math.abs(decay - bus.decay) > 0.04) {
    const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * decay), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * i / data.length) * Math.min(1, i / 64);
    }
    bus.reverb.buffer = buffer;
    bus.decay = decay;
  }
  const driveAmount = limit(state.drive.amount, 0, 1);
  const curve = new Float32Array(2049);
  const k = 1 + driveAmount * 12;
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((2 * i / (curve.length - 1) - 1) * k) / Math.tanh(k);
  bus.drive.curve = curve;
  smooth(bus.wet.drive.gain, state.drive.enabled ? 0.5 : 0, ctx);
  smooth(bus.tone.frequency, 400 * Math.pow(40, limit(state.drive.tone, 0, 1)), ctx);
  smooth(bus.lfo.frequency, limit(state.phaser.rate, 0.02, 20), ctx);
  smooth(bus.depth.gain, limit(state.phaser.depth, 0, 1) * 650, ctx);
  bus.phaser.forEach((node, i) => smooth(node.frequency, 900 + i * 350, ctx));
  smooth(bus.phaserFeedback.gain, enabled && state.phaser.enabled ? limit(state.phaser.feedback, 0, 0.75) : 0, ctx);
  smooth(bus.wet.phaser.gain, state.phaser.enabled ? limit(state.phaser.mix, 0, 1) * 0.5 : 0, ctx);
}

export function setEffectsLoop(state: EffectsLoopState): void {
  loop = state;
  if (context) effects.forEach((bus, group) => updateEffects(bus, group, state, context!));
}

export function createAudioLane(group: 'synth' | 'drums') {
  const ctx = getAudioContext(), bus = createEffects(group);
  const input = ctx.createGain();
  input.connect(master);
  const sends = {} as Record<EffectName, GainNode>;
  for (const name of ['reverb', 'delay', 'drive', 'phaser'] as EffectName[]) {
    sends[name] = ctx.createGain();
    sends[name].gain.value = 0;
    input.connect(sends[name]).connect(bus.inputs[name]);
  }
  return {
    input,
    setVolume(value: number) { smooth(input.gain, limit(value, 0, 1), ctx); },
    setSends(values: FxSendLevels, returnLevel = 1) {
      for (const name of Object.keys(sends) as EffectName[]) smooth(sends[name].gain, limit(values[name], 0, 1) * limit(returnLevel, 0, 1), ctx);
    },
    dispose() {
      input.disconnect();
      Object.values(sends).forEach(node => node.disconnect());
    },
  };
}
