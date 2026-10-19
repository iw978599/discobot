import type { AuxBus, AuxKind, EffectsLoopState, FxSendLevels } from '../types';
import { auxBuses, auxRate, auxSeconds } from '../services/auxSettings';
import { delaySeconds } from '../services/delayTime';
import { rateHz } from '../services/rateSync';
import { EQ_RANGE_DB, MAX_PRE_DELAY } from '../services/effectSettings';

const limit = (v: number | undefined, min: number, max: number, fallback = min) =>
  v !== undefined && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
// How fast a send moves to a step's automated level, live and in export.
export const SEND_GLIDE = 0.005;
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
  // The reverb that is sounding: the Room's convolver or the Hall, and never both.
  reverb: ConvolverNode | null;
  hall: Hall | null;
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
  // What each aux bus is pointed at, built the first time something is sent to it.
  aux: Array<{ kind: AuxKind; effect: AuxEffect } | null>;
};

export const MASTER_LEVEL = 0.7;
// How long a voice handed to a guest, or given back, takes to cross from one place to the other.
export const HAND_OVER_FADE = 0.01;

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

// The second kind of reverb, Hall, in the manner of Freeverb (Jezar's public-domain design, whose
// lengths these are): on each side six damped feedback combs of unrelated lengths in parallel,
// then three all-passes in series that thicken their echoes into a smooth tail. The right side's
// lengths are the left's and 23 frames, so the two sides are different signals. Nothing in it is
// random, so an export is repeatable, and the decay, damping and level are gains and filter
// settings: nothing is rebuilt to change them.
// A loop of native nodes is one render quantum (128 frames) longer than its delay: Chrome renders
// a block at a time and a loop reads the block before. `HALL_QUANTUM` is counted into every
// loop's length, and the decay follows it there; a browser that gives a loop no extra block (none
// on the check machines did) would ring about a tenth longer. Chrome was also seen to render a
// loop that has two ways out, or two loops that feed each other, differently from one run to the
// next, as the order it pulls a node's inputs in changes. So every loop here has one way out (its
// delay) and none feeds another, the all-passes take the form in which only their delay leaves
// the loop, and no node adds more than two signals, three or more being added in an order that
// changes the rounding. Lengths are in frames at 44.1 kHz and rounded to whole frames of the
// context's rate, because a delay between frames is interpolated, which takes highs away on every
// pass and would make live playback at 48 kHz duller than an export.
export const HALL_QUANTUM = 128;
const HALL_COMBS = [1116, 1188, 1277, 1356, 1491, 1617];
const HALL_DIFFUSERS = [556, 341, 225];
const HALL_SPREAD = 23;
const HALL_DIFFUSION = 0.5;
// Sets the Hall about as loud as the Room at the same mix; measured, see `hallReverb.test.ts`.
// The Room's convolver scales a damped impulse back up to the same power, while the Hall's damping
// takes energy out of its tail: `hallLevel` gives back about what the shelf takes from white
// noise, less for a short tail, whose early echoes the shelf has hardly touched. A short Hall is
// also brought down by its early echoes, which a Room of the same length spreads more thinly.
export const HALL_LEVEL = 0.02;
export function hallLevel(decay: number, damping: number | undefined) {
  const damp = limit(damping, 0, 1), above = 1 - hallDampHz(damp) / 22050, seconds = limit(decay, 0.1, 8);
  const kept = 1 - above + above / (1 + 5 * damp);
  return HALL_LEVEL * Math.pow(kept, -seconds * seconds / (seconds * seconds + 0.5) / 2) * Math.pow(10, -0.04 / seconds);
}
// What a comb whose loop lasts `seconds` gives back, so that its echoes have fallen 60 dB after `decay`.
export const hallFeedback = (decay: number, seconds: number) => Math.pow(10, -3 * seconds / limit(decay, 0.1, 8));
// Damping is a high shelf in each comb: above `hallDampHz` the tail dies up to six times as fast,
// which is a cut in decibels in proportion to the loop's length. No damping is a flat shelf.
export const hallDampHz = (damping: number | undefined) => 8000 * Math.pow(4, -limit(damping, 0, 1));
export const hallDampDb = (decay: number, damping: number | undefined, seconds: number) =>
  -60 * seconds / limit(decay, 0.1, 8) * 5 * limit(damping, 0, 1);
export function createHallReverb(ctx: BaseAudioContext) {
  const mono = <T extends AudioNode>(node: T) => { node.channelCount = 1; node.channelCountMode = 'explicit'; return node; };
  const nodes: AudioNode[] = [];
  const gain = (value: number) => { const node = mono(ctx.createGain()); node.gain.value = value; nodes.push(node); return node; };
  const whole = (frames: number) => Math.round(frames / 44100 * ctx.sampleRate) / ctx.sampleRate;
  const delayOf = (seconds: number) => { const node = mono(ctx.createDelay(0.25)); node.delayTime.value = seconds; nodes.push(node); return node; };
  const sum = (a: AudioNode, b: AudioNode, value = 1) => { const node = gain(value); a.connect(node); b.connect(node); return node; };
  const tree = (signals: AudioNode[]): AudioNode => signals.length === 1 ? signals[0]
    : tree(Array.from({ length: Math.ceil(signals.length / 2) }, (_, i) => signals[2 * i + 1] ? sum(signals[2 * i], signals[2 * i + 1]) : signals[2 * i]));
  // The sends are stereo and the combs are not: the two sides come from combs of their own.
  const input = gain(1), pre = mono(ctx.createDelay(MAX_PRE_DELAY + 0.05));
  nodes.push(pre);
  pre.delayTime.value = 0;
  input.connect(pre);
  const output = ctx.createChannelMerger(2);
  nodes.push(output);
  const lines: { seconds: number; delay: DelayNode; shelf: BiquadFilterNode; back: GainNode }[] = [];
  const sides = [0, HALL_SPREAD].map((spread, side) => {
    const combs = HALL_COMBS.map(frames => {
      const tap = whole(frames + spread), delay = delayOf(tap), shelf = mono(ctx.createBiquadFilter()), back = gain(0);
      shelf.type = 'highshelf';
      nodes.push(shelf);
      pre.connect(delay).connect(shelf).connect(back).connect(delay);
      lines.push({ seconds: tap + HALL_QUANTUM / ctx.sampleRate, delay, shelf, back });
      return delay;
    });
    let diffused = tree(combs);
    for (const frames of HALL_DIFFUSERS) {
      // v = x + g v (a loop later), and out = v (a delay later) - x: only the delay leaves the loop.
      const into = gain(1), delay = delayOf(whole(frames + spread)), back = gain(HALL_DIFFUSION), inverted = gain(-1);
      diffused.connect(into).connect(delay).connect(back).connect(into);
      diffused.connect(inverted);
      diffused = sum(delay, inverted);
    }
    const level = gain(HALL_LEVEL);
    diffused.connect(level).connect(output, 0, side);
    return { level };
  });
  // With a time the settings glide there, for live playback; without one they are simply set.
  const set = (reverb: EffectsLoopState['reverb'], at?: number) => {
    const put = (param: AudioParam, value: number, glide = 0.015) => {
      if (at === undefined) param.value = value;
      else param.setTargetAtTime(value, at, glide);
    };
    put(pre.delayTime, limit(reverb.preDelay, 0, MAX_PRE_DELAY), 0.05);
    for (const side of sides) put(side.level.gain, hallLevel(reverb.decay, reverb.damping));
    for (const line of lines) {
      put(line.back.gain, hallFeedback(reverb.decay, line.seconds));
      put(line.shelf.frequency, hallDampHz(reverb.damping));
      put(line.shelf.gain, hallDampDb(reverb.decay, reverb.damping, line.seconds));
    }
  };
  return { input, output, pre, lines, sides, nodes, set };
}
type Hall = ReturnType<typeof createHallReverb>;

// The effect behind an aux bus: an echo, the Hall or a chorus. It returns only the wet signal, which
// the caller scales by the bus's level. Live playback and export build it with this, and `set`
// gives it a bus's settings (gliding there at the time `at` for live playback, or at once).
export interface AuxEffect {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
  lfo?: OscillatorNode;
  set(bus: AuxBus, tempo: number, at?: number): void;
}
export function createAuxEffect(ctx: BaseAudioContext, kind: AuxKind): AuxEffect {
  const put = (param: AudioParam, value: number, at?: number) => {
    if (at === undefined) param.value = value;
    else param.setTargetAtTime(value, at, 0.015);
  };
  if (kind === 'hall') {
    const hall = createHallReverb(ctx);
    return { input: hall.input, output: hall.output, nodes: hall.nodes, set: (bus, _tempo, at) => hall.set({ enabled: true, mix: 1, decay: bus.main, damping: bus.shape }, at) };
  }
  if (kind === 'chorus') {
    const chorus = createChorus(ctx);
    return {
      input: chorus.input, output: chorus.output, nodes: [chorus.input, chorus.output, chorus.depth], lfo: chorus.lfo,
      set: (bus, tempo, at) => { put(chorus.lfo.frequency, limit(auxRate(bus, tempo), 0.02, 20, 0.6), at); put(chorus.depth.gain, chorusSweep(bus.shape), at); },
    };
  }
  const delay = ctx.createDelay(2), feedback = ctx.createGain();
  delay.connect(feedback).connect(delay);
  return {
    input: delay, output: delay, nodes: [delay, feedback],
    set: (bus, tempo, at) => { put(delay.delayTime, auxSeconds(bus, tempo), at); put(feedback.gain, limit(bus.shape, 0, 0.85), at); },
  };
}
const AUX_SENDS = ['auxA', 'auxB'] as const;

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
const EFFECT_NAMES: EffectName[] = ['reverb', 'delay', 'drive', 'phaser', 'chorus', 'auxA', 'auxB'];
type Group = 'synth' | 'drums';
type Live = { context: AudioContext; master: GainNode; eq: BiquadFilterNode[]; limiter: DynamicsCompressorNode; safety: WaveShaperNode };

const halt = (source: AudioScheduledSourceNode) => {
  try { source.stop(); } catch { /* already stopped */ }
};

// The chorus keeps two delays and an inverter to itself; cut off from the bus they go with the context.
function releaseEffects(bus: Effects) {
  halt(bus.lfo);
  halt(bus.chorus.lfo);
  const nodes: AudioNode[] = [
    ...Object.values(bus.inputs), ...Object.values(bus.wet), bus.output, bus.delay, bus.feedback,
    ...(bus.reverb ? [bus.reverb] : []), ...(bus.hall?.nodes ?? []), bus.reverbFade, bus.drive, bus.driveFade, bus.tone, ...bus.phaser, bus.phaserFeedback,
    bus.lfo, bus.depth, bus.chorus.input, bus.chorus.output, bus.chorus.lfo, bus.chorus.depth,
  ];
  for (const held of bus.aux) {
    if (!held) continue;
    if (held.effect.lfo) halt(held.effect.lfo);
    nodes.push(held.effect.input, held.effect.output, ...held.effect.nodes);
  }
  nodes.forEach(node => node.disconnect());
}

// Everything live playback keeps: the context, the protected master, the effect buses and what is
// sounding on them. The app has one (`audioEngine`); a test makes its own and disposes of it.
export class AudioEngine {
  private live?: Live;
  private loop?: EffectsLoopState;
  private workletLoading?: Promise<void>;
  private masterVolume = 1;
  private masterMuted = false;
  // A tempo-synced delay, phaser and chorus follow this.
  private effectsTempo = 120;
  private readonly effects = new Map<Group, Effects>();
  private readonly samples = new Map<AudioBufferSourceNode, GainNode>();
  private readonly clicks = new Map<OscillatorNode, GainNode>();
  private readonly lanes = new Set<() => void>();
  private readonly retiring = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor(private readonly makeContext: () => AudioContext = () => new AudioContext({ latencyHint: 'interactive' })) {}

  private open(): Live {
    if (this.live && this.live.context.state !== 'closed') return this.live;
    const context = this.makeContext();
    this.effects.clear();
    this.workletLoading = undefined;
    const master = context.createGain();
    master.gain.value = this.masterLevel();
    const limiter = context.createDynamicsCompressor();
    configureLimiter(limiter);
    const safety = context.createWaveShaper();
    safety.curve = safetyCurve();
    safety.oversample = '2x';
    const eq = createMasterEq(context);
    eqGains(this.loop?.eq).forEach((gain, band) => { eq[band].gain.value = gain; });
    master.connect(eq[0]);
    eq[2].connect(limiter).connect(safety).connect(context.destination);
    this.live = { context, master, eq, limiter, safety };
    return this.live;
  }

  private masterLevel() {
    return this.masterMuted ? 0 : this.masterVolume * MASTER_LEVEL;
  }

  private applyMasterLevel() {
    if (this.live) smooth(this.live.master.gain, this.masterLevel(), this.live.context);
  }

  getContext(): AudioContext {
    return this.open().context;
  }

  async ensureReady(): Promise<boolean> {
    const ctx = this.getContext();
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      return ctx.state === 'running';
    } catch { return false; }
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = limit(volume, 0, 1);
    this.applyMasterLevel();
  }

  setMasterMuted(muted: boolean): void {
    this.masterMuted = muted;
    this.applyMasterLevel();
  }

  stopAllSamples(): void {
    for (const source of this.samples.keys()) halt(source);
    this.samples.clear();
  }

  async playSample(data: ArrayBuffer): Promise<void> {
    if (!await this.ensureReady()) return;
    this.stopAllSamples();
    const { context: ctx, master } = this.open();
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
    source.onended = () => { this.samples.delete(source); source.disconnect(); gain.disconnect(); };
    this.samples.set(source, gain);
    source.start();
  }

  loadWorklet(): Promise<void> {
    const ctx = this.getContext();
    if (!this.workletLoading) {
      const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
      this.workletLoading = ctx.audioWorklet.addModule(`${base}audio-worklet.js`)
        .catch(error => { this.workletLoading = undefined; throw error; });
    }
    return this.workletLoading;
  }

  private bus(group: Group): Effects {
    const { context: ctx, master } = this.open();
    const existing = this.effects.get(group);
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
    const bus: Effects = { inputs, wet, output, delay, feedback, reverb, hall: null, reverbFade, decay: 0, drive, driveFade, driveAmount: -1, tone, phaser, phaserFeedback, lfo, depth, chorus, reverbShape: '', aux: [null, null] };
    this.effects.set(group, bus);
    if (this.loop) this.update(bus, group, this.loop, ctx);
    return bus;
  }

  // Points an aux bus at the effect the project says, building it if `create` and it is not there yet,
  // and gives it the bus's settings. A bus nothing has been sent to has no effect built.
  private syncAux(bus: Effects, slot: number, create: boolean) {
    const { context: ctx } = this.open(), config = auxBuses(this.loop?.aux)[slot], name = AUX_SENDS[slot];
    let held = bus.aux[slot];
    if (!held && !create) return;
    if (held && held.kind !== config.kind) {
      const old = held.effect;
      bus.inputs[name].disconnect(old.input);
      this.retire(() => { if (old.lfo) halt(old.lfo); old.output.disconnect(); old.nodes.forEach(node => node.disconnect()); });
      held = bus.aux[slot] = null;
    }
    if (!held) {
      const effect = createAuxEffect(ctx, config.kind);
      effect.set(config, this.effectsTempo);
      bus.inputs[name].connect(effect.input);
      effect.output.connect(bus.wet[name]);
      bus.aux[slot] = { kind: config.kind, effect };
      return;
    }
    held.effect.set(config, this.effectsTempo, ctx.currentTime);
  }

  // A replaced reverb or drive is let go once its fade is over, or at once if the engine goes first.
  private retire(release: () => void) {
    const timer = setTimeout(() => { this.retiring.delete(timer); release(); }, 120);
    this.retiring.set(timer, release);
  }

  // Puts another reverb in the place of the one that is sounding: the new one fades up as the old
  // fades down, and the old one, with every node inside it, is cut loose once it is silent.
  private replaceReverb(bus: Effects, ctx: AudioContext, next: { reverb: ConvolverNode } | { hall: Hall }) {
    const previous = bus.reverb ?? bus.hall!.input, previousNodes = bus.reverb ? [bus.reverb] : bus.hall!.nodes, previousFade = bus.reverbFade;
    const fade = ctx.createGain();
    fade.gain.value = 0;
    bus.reverb = 'reverb' in next ? next.reverb : null;
    bus.hall = 'hall' in next ? next.hall : null;
    bus.inputs.reverb.connect(bus.reverb ?? bus.hall!.input);
    (bus.reverb ?? bus.hall!.output).connect(fade).connect(bus.wet.reverb);
    smooth(previousFade.gain, 0, ctx);
    smooth(fade.gain, 1, ctx);
    this.retire(() => { bus.inputs.reverb.disconnect(previous); previousNodes.forEach(node => node.disconnect()); previousFade.disconnect(); });
    bus.reverbFade = fade;
  }

  private update(bus: Effects, group: Group, state: EffectsLoopState, ctx: AudioContext) {
    const enabled = state.enabled, tempo = this.effectsTempo;
    smooth(bus.output.gain, enabled ? limit(state.returns[group], 0, 1) : 0, ctx);
    smooth(bus.delay.delayTime, delaySeconds(state.delay, tempo), ctx);
    smooth(bus.feedback.gain, state.delay.enabled && enabled ? limit(state.delay.feedback, 0, 0.85) : 0, ctx);
    smooth(bus.wet.delay.gain, state.delay.enabled ? limit(state.delay.mix, 0, 1) : 0, ctx);
    smooth(bus.wet.reverb.gain, state.reverb.enabled ? limit(state.reverb.mix, 0, 1) : 0, ctx);
    const decay = limit(state.reverb.decay, 0.1, 8);
    const shape = `${(state.reverb.preDelay ?? 0).toFixed(3)}/${(state.reverb.damping ?? 0).toFixed(2)}`;
    if (state.reverb.kind === 'hall') {
      // The Hall's decay and damping are settings of the nodes it has: only choosing it builds one.
      if (bus.hall) bus.hall.set(state.reverb, ctx.currentTime);
      else {
        const hall = createHallReverb(ctx);
        hall.set(state.reverb);
        this.replaceReverb(bus, ctx, { hall });
        bus.decay = 0;
        bus.reverbShape = '';
      }
    } else if (!bus.reverb || Math.abs(decay - bus.decay) > 0.04 || shape !== bus.reverbShape) {
      const buffer = reverbImpulse(ctx, decay, Math.random, state.reverb.preDelay, state.reverb.damping);
      bus.reverbShape = shape;
      if (bus.reverb && !bus.reverb.buffer) bus.reverb.buffer = buffer;
      else {
        const reverb = ctx.createConvolver();
        reverb.buffer = buffer;
        this.replaceReverb(bus, ctx, { reverb });
      }
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
        this.retire(() => { bus.inputs.drive.disconnect(previous); previous.disconnect(); previousFade.disconnect(); });
        bus.drive = next; bus.driveFade = fade;
      } else bus.drive.curve = curve;
      bus.driveAmount = driveAmount;
    }
    smooth(bus.wet.drive.gain, state.drive.enabled ? 0.5 : 0, ctx);
    smooth(bus.tone.frequency, 400 * Math.pow(40, limit(state.drive.tone, 0, 1)), ctx);
    smooth(bus.lfo.frequency, limit(rateHz(state.phaser, tempo), 0.02, 20), ctx);
    smooth(bus.depth.gain, limit(state.phaser.depth, 0, 1) * 650, ctx);
    bus.phaser.forEach((node, i) => smooth(node.frequency, 900 + i * 350, ctx));
    smooth(bus.phaserFeedback.gain, enabled && state.phaser.enabled ? limit(state.phaser.feedback, 0, 0.75) : 0, ctx);
    smooth(bus.wet.phaser.gain, state.phaser.enabled ? limit(state.phaser.mix, 0, 1) * 0.5 : 0, ctx);
    smooth(bus.chorus.lfo.frequency, limit(rateHz(state.chorus, tempo, 0.6), 0.02, 20, 0.6), ctx);
    smooth(bus.chorus.depth.gain, chorusSweep(state.chorus?.depth ?? 0), ctx);
    smooth(bus.wet.chorus.gain, state.chorus?.enabled ? limit(state.chorus.mix, 0, 1) : 0, ctx);
    auxBuses(state.aux).forEach((config, slot) => {
      smooth(bus.wet[AUX_SENDS[slot]].gain, limit(config.level, 0, 1), ctx);
      this.syncAux(bus, slot, false);
    });
  }

  // One click of the metronome, at a time on the audio clock: a short high tone, higher and louder on
  // the first beat of the bar. It goes to the master level, past the lanes and the effects, so it
  // follows the volume and Mute and is in no export.
  // `loudness` is 1 for the level the click has always had.
  scheduleClick(time: number, accent: boolean, loudness = 1): void {
    if (loudness <= 0) return;
    const { context: ctx, master } = this.open();
    const tone = ctx.createOscillator(), level = ctx.createGain();
    const at = Math.max(time, ctx.currentTime);
    tone.type = 'square';
    tone.frequency.value = accent ? 1760 : 1175;
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime((accent ? 0.22 : 0.14) * loudness, at + 0.001);
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    tone.connect(level).connect(master);
    tone.start(at);
    tone.stop(at + 0.05);
    tone.onended = () => { this.clicks.delete(tone); tone.disconnect(); level.disconnect(); };
    this.clicks.set(tone, level);
  }

  setEffectsTempo(tempo: number): void {
    if (!(tempo > 0) || tempo === this.effectsTempo) return;
    this.effectsTempo = tempo;
    const { live, loop } = this;
    if (live && loop) this.effects.forEach((bus, group) => this.update(bus, group, loop, live.context));
  }

  setEffectsLoop(state: EffectsLoopState): void {
    this.loop = state;
    const live = this.live;
    if (!live) return;
    this.effects.forEach((bus, group) => this.update(bus, group, state, live.context));
    // The EQ is on the whole mix, so it works whether or not the effects loop is on.
    eqGains(state.eq).forEach((gain, band) => smooth(live.eq[band].gain, gain, live.context));
  }

  // `ownMix` names the effects this lane feeds with a mix of its own (the drums, whose every drum
  // has its own share of the delay and the reverb) in place of the signal at `input`. Each gets an
  // input in `taps` with the lane's volume and ducking, and the lane's send to that effect is fed
  // from it alone. A mix that is the same as the signal at `input` sounds exactly as if there were none.
  createLane(group: Group, ownMix: readonly EffectName[] = []) {
    const { context: ctx, master } = this.open(), bus = this.bus(group), engine = this;
    // input carries the lane volume; ducker sits after it so the dry signal and the sends pump together.
    const input = ctx.createGain(), ducker = ctx.createGain();
    // A lane handed to a guest (`handOver`) leaves the mix and every send, and goes to `toGuest`
    // alone, ducked as the mix would be. At rest the gates pass everything and `toGuest` nothing.
    const gates = [ctx.createGain()], guestDucker = ctx.createGain(), toGuest = ctx.createGain();
    toGuest.gain.value = 0;
    input.connect(gates[0]).connect(ducker);
    input.connect(guestDucker).connect(toGuest);
    ducker.connect(master);
    const sends = {} as Record<EffectName, GainNode>;
    const taps: Partial<Record<EffectName, GainNode>> = {}, tapDuckers: GainNode[] = [];
    for (const name of EFFECT_NAMES) {
      sends[name] = ctx.createGain();
      sends[name].gain.value = 0;
      if (ownMix.includes(name)) {
        const tap = ctx.createGain(), tapDucker = ctx.createGain(), gate = ctx.createGain();
        tap.connect(gate).connect(tapDucker).connect(sends[name]).connect(bus.inputs[name]);
        taps[name] = tap;
        tapDuckers.push(tapDucker);
        gates.push(gate);
      } else ducker.connect(sends[name]).connect(bus.inputs[name]);
    }
    let handed: AudioNode | null = null;
    const dispose = () => {
      this.lanes.delete(dispose);
      input.disconnect();
      ducker.disconnect();
      [guestDucker, toGuest, ...gates, ...Object.values(taps), ...tapDuckers, ...Object.values(sends)].forEach(node => node.disconnect());
    };
    this.lanes.add(dispose);
    return {
      input,
      output: ducker,
      taps,
      duck(time: number, amount: number) { for (const node of [ducker, guestDucker, ...tapDuckers]) scheduleDuck(node.gain, time, amount); },
      // Hands the lane to `tap`, after its level and before its sends, or with null gives it back
      // to the mix. Each switch is a crossfade of HAND_OVER_FADE seconds, so it does not click.
      handOver(tap: AudioNode | null) {
        if (tap === handed) return;
        const at = ctx.currentTime, previous = handed;
        const fade = (param: AudioParam, to: number) => {
          param.cancelScheduledValues(at);
          param.setValueAtTime(param.value, at);
          param.linearRampToValueAtTime(to, at + HAND_OVER_FADE);
        };
        if (previous) setTimeout(() => { try { toGuest.disconnect(previous); } catch { /* already gone */ } }, HAND_OVER_FADE * 4000);
        if (tap) toGuest.connect(tap);
        fade(toGuest.gain, tap ? 1 : 0);
        for (const gate of gates) fade(gate.gain, tap ? 0 : 1);
        handed = tap;
      },
      setVolume(value: number) { for (const node of [input, ...Object.values(taps)]) smooth(node.gain, limit(value, 0, 1), ctx); },
      // With a time, the levels are reached then, glided as quickly as an export's are (`SEND_GLIDE`): a step's automation.
      setSends(values: FxSendLevels, returnLevel = 1, time?: number) {
        AUX_SENDS.forEach((name, slot) => { if (limit(values[name], 0, 1) > 0) engine.syncAux(bus, slot, true); });
        for (const name of Object.keys(sends) as EffectName[]) {
          const level = limit(values[name], 0, 1) * limit(returnLevel, 0, 1);
          if (time === undefined) smooth(sends[name].gain, level, ctx);
          else sends[name].gain.setTargetAtTime(level, Math.max(time, ctx.currentTime), SEND_GLIDE);
        }
      },
      dispose,
    };
  }

  // Stops and disconnects everything the engine made and closes its context. The volume, mute,
  // effects and tempo it was given stay, as they do when a closed context is made again.
  async dispose(): Promise<void> {
    const live = this.live;
    this.live = undefined;
    this.workletLoading = undefined;
    for (const [timer, release] of this.retiring) { clearTimeout(timer); release(); }
    this.retiring.clear();
    [...this.lanes].forEach(release => release());
    for (const sounding of [this.samples, this.clicks]) {
      for (const [source, level] of sounding) { halt(source); source.disconnect(); level.disconnect(); }
      sounding.clear();
    }
    this.effects.forEach(releaseEffects);
    this.effects.clear();
    if (!live) return;
    [live.master, ...live.eq, live.limiter, live.safety].forEach(node => node.disconnect());
    if (live.context.state !== 'closed') await live.context.close().catch(() => {});
  }
}

export const audioEngine = new AudioEngine();

export function getAudioContext(): AudioContext {
  return audioEngine.getContext();
}

export function ensureAudioReady(): Promise<boolean> {
  return audioEngine.ensureReady();
}

export function setMasterVolume(volume: number): void {
  audioEngine.setMasterVolume(volume);
}

export function setMasterMuted(muted: boolean): void {
  audioEngine.setMasterMuted(muted);
}

export function stopAllSamples(): void {
  audioEngine.stopAllSamples();
}

export function playSample(data: ArrayBuffer): Promise<void> {
  return audioEngine.playSample(data);
}

export function loadAudioWorklet(): Promise<void> {
  return audioEngine.loadWorklet();
}

export function scheduleClick(time: number, accent: boolean, loudness = 1): void {
  audioEngine.scheduleClick(time, accent, loudness);
}

export function setEffectsTempo(tempo: number): void {
  audioEngine.setEffectsTempo(tempo);
}

export function setEffectsLoop(state: EffectsLoopState): void {
  audioEngine.setEffectsLoop(state);
}

export function createAudioLane(group: Group, ownMix: readonly EffectName[] = []) {
  return audioEngine.createLane(group, ownMix);
}
