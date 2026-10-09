import type { EffectsLoopState, FxSendLevels } from '../types';
import { delaySeconds } from '../services/delayTime';
import { EQ_RANGE_DB, MAX_PRE_DELAY } from '../services/effectSettings';

const limit = (v: number | undefined, min: number, max: number, fallback = min) =>
  v !== undefined && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const smooth = (p: AudioParam, value: number, ctx: AudioContext) =>
  p.setTargetAtTime(value, ctx.currentTime, 0.015);
type EffectName = keyof FxSendLevels;

// Sidechain-style ducking: pull a gain down at a kick and let it swell back. Live playback
// and WAV export both schedule it with this, so they pump identically. Full amount is -20 dB.
export function scheduleDuck(gain: AudioParam, time: number, amount: number): void {
  const depth = 1 - limit(amount, 0, 1) * 0.9;
  if (depth >= 1) return;
  gain.setTargetAtTime(depth, time, 0.004);
  gain.setTargetAtTime(1, time + 0.03, 0.09);
}
type Effects = {
  inputs: Record<EffectName, GainNode>;
  wet: Record<EffectName, GainNode>;
  output: GainNode;
  delay: DelayNode;
  feedback: GainNode;
  reverb: ConvolverNode;
  reverbFade: GainNode;
  decay: number;
  drive: WaveShaperNode;
  driveFade: GainNode;
  driveAmount: number;
  tone: BiquadFilterNode;
  phaser: BiquadFilterNode[];
  phaserFeedback: GainNode;
  lfo: OscillatorNode;
  depth: GainNode;
  chorus: Chorus;
  reverbShape: string;
};

export const MASTER_LEVEL = 0.7;

// Shared with the offline WAV renderer so an export is shaped like live playback.
// Transparent below the knee, then a soft ceiling: the mix is only touched when it would clip.
export function safetyCurve() {
  const curve = new Float32Array(4097), knee = 0.85;
  for (let i = 0; i < curve.length; i++) {
    const x = 2 * i / (curve.length - 1) - 1, level = Math.abs(x);
    curve[i] = level <= knee ? x : Math.sign(x) * (knee + (0.99 - knee) * Math.tanh((level - knee) / (0.99 - knee)));
  }
  return curve;
}

// A peak limiter, not a compressor: with a low threshold a kick would duck every other
// drum that landed on the same step.
export function configureLimiter(limiter: DynamicsCompressorNode) {
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;
}

export function driveCurve(amount: number) {
  const curve = new Float32Array(2049);
  const k = limit(amount, 0, 1) * 18;
  for (let i = 0; i < curve.length; i++) {
    const x = 2 * i / (curve.length - 1) - 1;
    curve[i] = k === 0 ? x : Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

// `random` shapes the reverb's noise. Exports pass a seeded one, so the same song always renders the same file.
// With no pre-delay and no damping this is the plain decaying noise older projects were made
// with, sample for sample. Pre-delay is silence before the tail; damping closes a low-pass
// filter over the noise as the tail goes on, the way a real room loses its highs first.
export function reverbImpulse(ctx: BaseAudioContext, decay: number, random: () => number = Math.random, preDelay = 0, damping = 0): AudioBuffer {
  const rate = ctx.sampleRate, tail = Math.ceil(rate * limit(decay, 0.1, 8));
  const start = Math.round(rate * limit(preDelay, 0, MAX_PRE_DELAY)), damp = limit(damping, 0, 1);
  const buffer = ctx.createBuffer(2, start + tail, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    if (start === 0 && damp === 0) {
      for (let i = 0; i < tail; i++) data[i] = (random() * 2 - 1) * Math.exp(-6 * i / tail) * Math.min(1, i / 64);
      continue;
    }
    let low = 0;
    for (let i = 0; i < tail; i++) {
      const cutoff = 16000 * Math.exp(-4.5 * damp * i / tail);
      low += (1 - Math.exp(-2 * Math.PI * cutoff / rate)) * (random() * 2 - 1 - low);
      data[start + i] = low * Math.exp(-6 * i / tail) * Math.min(1, i / 64);
    }
  }
  return buffer;
}

// A stereo chorus in the manner of the string machines and the Juno: one short delay per side,
// swept in opposite directions by a slow triangle. It returns only the swept signal; the dry
// one is already in the mix. Live playback and export build it with this.
const CHORUS_DELAY = 0.007;
export const chorusSweep = (depth: number) => limit(depth, 0, 1) * 0.004;
export function createChorus(ctx: BaseAudioContext) {
  const input = ctx.createGain(), output = ctx.createChannelMerger(2);
  const lfo = ctx.createOscillator(), depth = ctx.createGain(), opposite = ctx.createGain();
  lfo.type = 'triangle';
  opposite.gain.value = -1;
  lfo.connect(depth).connect(opposite);
  [depth, opposite].forEach((sweep, side) => {
    const delay = ctx.createDelay(0.05);
    delay.channelCount = 1;
    delay.channelCountMode = 'explicit';
    delay.delayTime.value = CHORUS_DELAY;
    sweep.connect(delay.delayTime);
    input.connect(delay).connect(output, 0, side);
  });
  lfo.start();
  return { input, output, lfo, depth };
}
type Chorus = ReturnType<typeof createChorus>;

// The master EQ: a low shelf, a wide mid bell and a high shelf, in that order.
export function createMasterEq(ctx: BaseAudioContext): BiquadFilterNode[] {
  const bands = [['lowshelf', 120], ['peaking', 1000], ['highshelf', 6000]] as const;
  const nodes = bands.map(([type, frequency]) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = 0.7;
    return node;
  });
  nodes[0].connect(nodes[1]).connect(nodes[2]);
  return nodes;
}
export function eqGains(eq: EffectsLoopState['eq']): [number, number, number] {
  const band = (level: number) => limit(level, -EQ_RANGE_DB, EQ_RANGE_DB, 0);
  return eq?.enabled ? [band(eq.low), band(eq.mid), band(eq.high)] : [0, 0, 0];
}
const EFFECT_NAMES: EffectName[] = ['reverb', 'delay', 'drive', 'phaser', 'chorus'];

let context: AudioContext | undefined;
let master: GainNode;
let masterEq: BiquadFilterNode[] = [];
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
    master.gain.value = masterMuted ? 0 : masterVolume * MASTER_LEVEL;
    const limiter = context.createDynamicsCompressor();
    configureLimiter(limiter);
    const safety = context.createWaveShaper();
    safety.curve = safetyCurve();
    safety.oversample = '2x';
    masterEq = createMasterEq(context);
    eqGains(loop?.eq).forEach((gain, band) => { masterEq[band].gain.value = gain; });
    master.connect(masterEq[0]);
    masterEq[2].connect(limiter).connect(safety).connect(context.destination);
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
  if (context) smooth(master.gain, masterMuted ? 0 : masterVolume * MASTER_LEVEL, context);
}

export function setMasterMuted(muted: boolean): void {
  masterMuted = muted;
  if (context) smooth(master.gain, masterMuted ? 0 : masterVolume * MASTER_LEVEL, context);
}

const activeSampleSources = new Set<AudioBufferSourceNode>();

export function stopAllSamples(): void {
  for (const source of activeSampleSources) {
    try { source.stop(); } catch { /* already stopped */ }
  }
  activeSampleSources.clear();
}

export async function playSample(data: ArrayBuffer): Promise<void> {
  if (!await ensureAudioReady()) return;
  stopAllSamples();
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
  source.onended = () => { activeSampleSources.delete(source); source.disconnect(); gain.disconnect(); };
  activeSampleSources.add(source);
  source.start();
}

export function loadAudioWorklet(): Promise<void> {
  const ctx = getAudioContext();
  if (!workletLoading) {
    const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    workletLoading = ctx.audioWorklet.addModule(`${base}audio-worklet.js`)
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
  for (const name of EFFECT_NAMES) {
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
  const reverb = ctx.createConvolver(), reverbFade = ctx.createGain();
  inputs.reverb.connect(reverb).connect(reverbFade).connect(wet.reverb);
  const drive = ctx.createWaveShaper(), driveFade = ctx.createGain(), tone = ctx.createBiquadFilter();
  drive.oversample = '4x';
  inputs.drive.connect(drive).connect(driveFade).connect(tone).connect(wet.drive);
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
  const chorus = createChorus(ctx);
  inputs.chorus.connect(chorus.input);
  chorus.output.connect(wet.chorus);
  const bus = { inputs, wet, output, delay, feedback, reverb, reverbFade, decay: 0, drive, driveFade, driveAmount: -1, tone, phaser, phaserFeedback, lfo, depth, chorus, reverbShape: '' };
  effects.set(group, bus);
  if (loop) updateEffects(bus, group, loop, ctx);
  return bus;
}

function updateEffects(bus: Effects, group: 'synth' | 'drums', state: EffectsLoopState, ctx: AudioContext) {
  const enabled = state.enabled;
  smooth(bus.output.gain, enabled ? limit(state.returns[group], 0, 1) : 0, ctx);
  smooth(bus.delay.delayTime, delaySeconds(state.delay, effectsTempo), ctx);
  smooth(bus.feedback.gain, state.delay.enabled && enabled ? limit(state.delay.feedback, 0, 0.85) : 0, ctx);
  smooth(bus.wet.delay.gain, state.delay.enabled ? limit(state.delay.mix, 0, 1) : 0, ctx);
  smooth(bus.wet.reverb.gain, state.reverb.enabled ? limit(state.reverb.mix, 0, 1) : 0, ctx);
  const decay = limit(state.reverb.decay, 0.1, 8);
  const shape = `${(state.reverb.preDelay ?? 0).toFixed(3)}/${(state.reverb.damping ?? 0).toFixed(2)}`;
  if (Math.abs(decay - bus.decay) > 0.04 || shape !== bus.reverbShape) {
    const buffer = reverbImpulse(ctx, decay, Math.random, state.reverb.preDelay, state.reverb.damping);
    bus.reverbShape = shape;
    if (bus.reverb.buffer) {
      const previous = bus.reverb, previousFade = bus.reverbFade;
      const next = ctx.createConvolver(), fade = ctx.createGain();
      next.buffer = buffer;
      fade.gain.value = 0;
      bus.inputs.reverb.connect(next).connect(fade).connect(bus.wet.reverb);
      smooth(previousFade.gain, 0, ctx);
      smooth(fade.gain, 1, ctx);
      setTimeout(() => { bus.inputs.reverb.disconnect(previous); previous.disconnect(); previousFade.disconnect(); }, 120);
      bus.reverb = next;
      bus.reverbFade = fade;
    } else bus.reverb.buffer = buffer;
    bus.decay = decay;
  }
  const driveAmount = limit(state.drive.amount, 0, 1);
  if (Math.abs(driveAmount - bus.driveAmount) > 0.005) {
    const curve = driveCurve(driveAmount);
    if (bus.drive.curve) {
      const previous = bus.drive, previousFade = bus.driveFade;
      const next = ctx.createWaveShaper(), fade = ctx.createGain();
      next.curve = curve; next.oversample = '4x';
      fade.gain.value = 0;
      bus.inputs.drive.connect(next).connect(fade).connect(bus.tone);
      smooth(previousFade.gain, 0, ctx); smooth(fade.gain, 1, ctx);
      setTimeout(() => { bus.inputs.drive.disconnect(previous); previous.disconnect(); previousFade.disconnect(); }, 120);
      bus.drive = next; bus.driveFade = fade;
    } else bus.drive.curve = curve;
    bus.driveAmount = driveAmount;
  }
  smooth(bus.wet.drive.gain, state.drive.enabled ? 0.5 : 0, ctx);
  smooth(bus.tone.frequency, 400 * Math.pow(40, limit(state.drive.tone, 0, 1)), ctx);
  smooth(bus.lfo.frequency, limit(state.phaser.rate, 0.02, 20), ctx);
  smooth(bus.depth.gain, limit(state.phaser.depth, 0, 1) * 650, ctx);
  bus.phaser.forEach((node, i) => smooth(node.frequency, 900 + i * 350, ctx));
  smooth(bus.phaserFeedback.gain, enabled && state.phaser.enabled ? limit(state.phaser.feedback, 0, 0.75) : 0, ctx);
  smooth(bus.wet.phaser.gain, state.phaser.enabled ? limit(state.phaser.mix, 0, 1) * 0.5 : 0, ctx);
  smooth(bus.chorus.lfo.frequency, limit(state.chorus?.rate, 0.05, 8, 0.6), ctx);
  smooth(bus.chorus.depth.gain, chorusSweep(state.chorus?.depth ?? 0), ctx);
  smooth(bus.wet.chorus.gain, state.chorus?.enabled ? limit(state.chorus.mix, 0, 1) : 0, ctx);
}

// A tempo-synced delay follows this.
let effectsTempo = 120;
export function setEffectsTempo(tempo: number): void {
  if (!(tempo > 0) || tempo === effectsTempo) return;
  effectsTempo = tempo;
  if (context && loop) effects.forEach((bus, group) => updateEffects(bus, group, loop!, context!));
}

export function setEffectsLoop(state: EffectsLoopState): void {
  loop = state;
  if (!context) return;
  effects.forEach((bus, group) => updateEffects(bus, group, state, context!));
  // The EQ is on the whole mix, so it works whether or not the effects loop is on.
  eqGains(state.eq).forEach((gain, band) => smooth(masterEq[band].gain, gain, context!));
}

export function createAudioLane(group: 'synth' | 'drums') {
  const ctx = getAudioContext(), bus = createEffects(group);
  // input carries the lane volume; ducker sits after it so the dry signal and the sends pump together.
  const input = ctx.createGain(), ducker = ctx.createGain();
  input.connect(ducker);
  ducker.connect(master);
  const sends = {} as Record<EffectName, GainNode>;
  for (const name of EFFECT_NAMES) {
    sends[name] = ctx.createGain();
    sends[name].gain.value = 0;
    ducker.connect(sends[name]).connect(bus.inputs[name]);
  }
  return {
    input,
    output: ducker,
    duck(time: number, amount: number) { scheduleDuck(ducker.gain, time, amount); },
    setVolume(value: number) { smooth(input.gain, limit(value, 0, 1), ctx); },
    setSends(values: FxSendLevels, returnLevel = 1) {
      for (const name of Object.keys(sends) as EffectName[]) smooth(sends[name].gain, limit(values[name], 0, 1) * limit(returnLevel, 0, 1), ctx);
    },
    dispose() {
      input.disconnect();
      ducker.disconnect();
      Object.values(sends).forEach(node => node.disconnect());
    },
  };
}
