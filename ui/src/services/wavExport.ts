import { DrumCore, type DrumRecordings, type DrumSample, SynthCore, type SynthSample, toVoiceParams } from '@discobot/engine';
import type { Automation, DrumState, EffectsLoopState, FxSendLevels, Pattern, Scene, SequencerStep, SynthParameters, TimeSignature } from '../types';
import { type BarTime, barSteps, barTimes, wholeNotes } from './patternLength';
import { sceneDrumState } from './songPlayback';
import { DRUM_INSTRUMENTS } from './drumKits';
import { expandStepNotes } from './noteScheduling';
import { SEND_PARAMS, automationChange, stepSends, stepVoiceParams } from './automation';
import { delaySeconds } from './delayTime';
import { auxBuses, auxSeconds } from './auxSettings';
import { rateHz } from './rateSync';
import { expandDrumStep, seededRandom, swingLate } from './drumScheduling';
import { createZip } from '../utils/zip';
import { MASTER_LEVEL, SEND_GLIDE, chorusSweep, createWow, delayColorHz, configureLimiter, createAuxEffect, createChorus, createBuiltReverb, createMasterEq, driveCurve, eqGains, reverbImpulse, reverbLevel, safetyCurve, scheduleDuck } from '../hooks/browserAudio';
import type { DrumInstrument, DrumSettings } from '../types';

export interface ExportArrangement {
  tempo: number;
  synths: { id: number; pattern: Pattern | null; synthParams: SynthParameters | null; muted: boolean; solo: boolean; swing?: boolean }[];
  drumState: DrumState;
  drumKitId: string;
  drumMasterVolume: number;
  drumSwing: number;
  drumFx: { sends: FxSendLevels; returnLevel: number };
  effectsLoop: EffectsLoopState;
  // A whole song, one scene per bar. When present these are rendered end to end and each
  // lane's own pattern and the steps in `drumState` are ignored. Each bar is as long as its
  // own time signature makes it.
  bars?: Scene[];
  // The time signature of the one bar that is rendered when there are no `bars`. Absent means 4/4.
  signature?: TimeSignature;
  // Decoded samples for the drum lanes that use one. A lane without an entry is synthesized.
  drumSamples?: Partial<Record<DrumInstrument, DrumSample>>;
  // The app's cymbal recordings, by kind. Without them the cymbal lane is synthesized.
  drumCymbals?: DrumRecordings;
  // Decoded recordings for the synth lanes set to the sample engine, by lane id. A lane without
  // one plays its oscillators, as it does live.
  synthSamples?: Record<number, SynthSample>;
  // Guest instruments, recorded in real time at 44.1 kHz from the first beat. For a loop each
  // take is exactly one pass of the pattern, recorded once it had already been round once.
  // In a song `gains` is the guest's level in each bar, and is used instead of `gain`.
  guestTakes?: Array<{ left: Float32Array; right: Float32Array; gain: number; gains?: number[]; name?: string; sends?: FxSendLevels }>;
}

// How long a guest's level takes to move when it changes at a bar line, in seconds.
const GUEST_FADE = 0.005;

// Rendering holds every lane in memory at once, so very long songs are refused.
export const MAX_EXPORT_SECONDS = 480;

export interface RenderOptions {
  // Render only this synth lane (ignoring its mute and solo), only the drums, or only one
  // guest's recording: a stem.
  only?: StemPart;
  // Render exactly one bar that repeats seamlessly, with the effect tails wrapped into it.
  loop?: boolean;
  // Told how far the render has got, from 0 to 1. Given one, the render stops for a moment after
  // each lane and the drums so the page can show it, and the browser's render reports ten times.
  onProgress?: (fraction: number) => void;
}

const PROGRESS_POINTS = 10;

export type StemPart = number | 'drums' | { guest: number };

type Stereo = [Float32Array, Float32Array];

export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const count = channels.length;
  const frames = channels[0]?.length || 0;
  const dataSize = frames * count * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataSize, true);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < count; channel++) {
      const sample = channels[channel][frame];
      view.setInt16(44 + (frame * count + channel) * 2,
        Math.round(Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0)) * 32767), true);
    }
  }
  return buffer;
}

function renderCore(core: { process(left: Float32Array, right: Float32Array): void }, frames: number): Stereo {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += 128) {
    const end = Math.min(frames, offset + 128);
    core.process(left.subarray(offset, end), right.subarray(offset, end));
  }
  return [left, right];
}

// A synth lane through the same voice core the worklet runs live. The bar is repeated
// `bars` times in one pass, so tails and held notes carry across the bar line.
export function renderSynthLane(
  pattern: Pattern, params: SynthParameters, tempo: number, frames: number, sampleRate: number,
  bars = 1, barDuration = 240 / tempo,
): Stereo {
  return renderSynthBars(Array.from({ length: bars }, () => pattern.steps), params, tempo, frames, sampleRate, barDuration, undefined, undefined, Array.from({ length: bars }, () => pattern.automation));
}

const evenBars = (count: number, barDuration: number): BarTime[] => Array.from({ length: count }, (_, bar) => ({ start: bar * barDuration, duration: barDuration }));

// The same, with different steps in each bar: a lane through a whole song. `times` says when
// each bar starts and how long it is, for bars that are not all one length; without it every
// bar lasts `barDuration`. `automation` is each bar's automation, cut to the bar as its steps
// are: at the start of every step the voice is sent what the live scheduler sends it then.
export function renderSynthBars(
  bars: SequencerStep[][], params: SynthParameters, tempo: number, frames: number, sampleRate: number,
  barDuration = 240 / tempo, sample?: SynthSample | null, times: BarTime[] = evenBars(bars.length, barDuration),
  automation: Array<Automation | undefined> = [], swing = 0,
): Stereo {
  const core = new SynthCore(sampleRate), sound = toVoiceParams(params, tempo);
  core.setParams(sound);
  if (sample) core.setSample(sample);
  const random = seededRandom(2);
  let automated: ReturnType<typeof stepVoiceParams> = null;
  bars.forEach((steps, bar) => {
    const { start, duration } = times[bar];
    const stepDuration = duration / Math.max(1, steps.length);
    steps.forEach((step, index) => {
      const now = stepVoiceParams(params, automation[bar], index, tempo), moved = automationChange(automated, now, sound);
      if (moved) core.setParams(moved, start + index * stepDuration);
      automated = now;
      const late = swingLate(index * stepDuration, 15 / tempo, swing);
      for (const scheduled of expandStepNotes(step, params, stepDuration, tempo, random)) {
        core.noteOn({
          note: scheduled.note, velocity: step.velocity, duration: scheduled.duration,
          time: start + index * stepDuration + late + scheduled.offset,
        });
      }
    });
  });
  return renderCore(core, frames);
}

type DrumArrangement = Pick<ExportArrangement, 'tempo' | 'drumState' | 'drumKitId' | 'drumMasterVolume' | 'drumSwing' | 'bars' | 'signature' | 'drumSamples' | 'drumCymbals'>;
// The time signature of each bar a render plays.
const barSignatures = (arrangement: Pick<ExportArrangement, 'bars' | 'signature'>, bars: number): unknown[] =>
  (arrangement.bars ? arrangement.bars.map(scene => scene.signature) : Array.from({ length: bars }, () => arrangement.signature));
// How much longer each bar is than at the project's tempo: a scene with a tempo of its own plays at
// it (roadmap 17). None at all for an arrangement whose scenes have none.
const barScales = (arrangement: Pick<ExportArrangement, 'bars' | 'tempo'>): number[] =>
  (arrangement.bars?.some(scene => scene.tempo) ? arrangement.bars.map(scene => (scene.tempo ? arrangement.tempo / scene.tempo : 1)) : []);
interface DrumHit { instrument: DrumInstrument; time: number; velocity: number; settings: DrumSettings }

// Every drum hit the export plays, with its start time. Worked out once so the drum render
// and the kick ducking on the synth lanes agree on which chance steps played. `barDuration` is
// how long a bar of 4/4 lasts; a drum step is a sixteenth of it in every time signature.
export function drumHits(arrangement: DrumArrangement, bars = 1, barDuration = 240 / arrangement.tempo): DrumHit[] {
  const random = seededRandom(1);
  const hits: DrumHit[] = [];
  const count = arrangement.bars ? arrangement.bars.length : bars;
  const signatures = barSignatures(arrangement, count), scales = barScales(arrangement), times = barTimes(signatures, barDuration, scales);
  for (let bar = 0; bar < count; bar++) {
    const steps = barSteps(signatures[bar]), start = times[bar].start, stepDuration = barDuration / 16 * (scales[bar] ?? 1);
    const state = arrangement.bars ? sceneDrumState(arrangement.bars[bar], arrangement.drumState) : arrangement.drumState;
    // Mutes and solos can differ from scene to scene.
    const solo = DRUM_INSTRUMENTS.some(instrument => state[instrument].solo);
    for (const instrument of DRUM_INSTRUMENTS) {
      const track = state[instrument];
      if (track.muted || (solo && !track.solo)) continue;
      for (let step = 0; step < steps; step++) {
        for (const offset of expandDrumStep(track, step, random)) {
          hits.push({
            instrument, velocity: track.stepVelocities?.[step] ?? 1,
            settings: { ...track.settings, volume: track.settings.volume * arrangement.drumMasterVolume },
            time: start + (step + (step % 2 ? arrangement.drumSwing : 0) + offset) * stepDuration,
          });
        }
      }
    }
  }
  return hits;
}

// The effects each drum has a send of its own to, and the setting that holds it.
const DRUM_SENDS = { delay: 'delaySend', reverb: 'reverbSend' } as const;
type OwnMix = keyof typeof DRUM_SENDS;

// The drums as the core mixes them: the kit, and beside it what the kit sends to the delay and to
// the reverb, each drum by its own share. A mix is only made when some drum that plays has a share
// other than the whole; without one it would be the kit sample for sample, and the kit is used.
export function renderDrumMixes(
  arrangement: DrumArrangement, frames: number, sampleRate: number, bars = 1, barDuration = 240 / arrangement.tempo,
): { kit: Stereo } & Partial<Record<OwnMix, Stereo>> {
  const core = new DrumCore(sampleRate);
  core.setCymbals(arrangement.drumCymbals);
  for (const [instrument, sample] of Object.entries(arrangement.drumSamples ?? {})) core.setSample(instrument as DrumInstrument, sample);
  const hits = drumHits(arrangement, bars, barDuration);
  for (const hit of hits) core.trigger({ ...hit, kitId: arrangement.drumKitId });
  const own = (name: OwnMix): Stereo | undefined =>
    (hits.some(hit => (hit.settings[DRUM_SENDS[name]] ?? 1) !== 1) ? [new Float32Array(frames), new Float32Array(frames)] : undefined);
  const delay = own('delay'), reverb = own('reverb');
  if (!delay && !reverb) return { kit: renderCore(core, frames) };
  const kit: Stereo = [new Float32Array(frames), new Float32Array(frames)];
  for (let offset = 0; offset < frames; offset += 128) {
    const end = Math.min(frames, offset + 128), block = (mix?: Stereo) => mix?.map(channel => channel.subarray(offset, end));
    core.process(kit[0].subarray(offset, end), kit[1].subarray(offset, end), block(delay), block(reverb));
  }
  return { kit, ...(delay ? { delay } : {}), ...(reverb ? { reverb } : {}) };
}

export function renderDrums(
  arrangement: DrumArrangement, frames: number, sampleRate: number, bars = 1, barDuration = 240 / arrangement.tempo,
): Stereo {
  return renderDrumMixes(arrangement, frames, sampleRate, bars, barDuration).kit;
}

// `own` gives the delay or the reverb a signal of its own to take in place of `input`, still at the
// level `sends` says. It is only asked for when that effect is on and sent to.
// `timeline` is a lane's automated sends: the levels from each step's time on. An effect is built
// for any send that reaches above nothing at some step, and each send moves as the live one does.
function connectEffects(ctx: OfflineAudioContext, input: AudioNode, master: AudioNode, sends: FxSendLevels, fxReturn: number, state: EffectsLoopState, group: 'synth' | 'drums', tempo: number, own: Partial<Record<OwnMix, () => AudioNode>> = {}, timeline: SendTimeline = []) {
  input.connect(master);
  if (!state.enabled) return;
  const wet = ctx.createGain();
  wet.gain.value = fxReturn * state.returns[group];
  wet.connect(master);
  const peak = { ...sends } as Record<keyof FxSendLevels, number>;
  for (const { sends: at } of timeline) for (const name of Object.keys(at) as Array<keyof FxSendLevels>) peak[name] = Math.max(peak[name] ?? 0, at[name] ?? 0);
  const send = (name: keyof FxSendLevels, from: AudioNode = input) => {
    const gain = ctx.createGain(); gain.gain.value = sends[name] ?? 0; from.connect(gain);
    for (const step of timeline) gain.gain.setTargetAtTime(step.sends[name] ?? 0, step.time, SEND_GLIDE);
    return gain;
  };
  if (state.delay.enabled && peak.delay > 0) {
    const delay = ctx.createDelay(2), feedback = ctx.createGain(), level = ctx.createGain();
    delay.delayTime.value = delaySeconds(state.delay, tempo); feedback.gain.value = Math.min(.85, state.delay.feedback);
    level.gain.value = state.delay.mix;
    // A coloured delay's repeats pass through its filter; a plain one's go straight round, as they always did.
    let repeats: AudioNode = delay;
    if (state.delay.color) {
      const color = ctx.createBiquadFilter();
      color.type = 'lowpass'; color.Q.value = 0.5; color.frequency.value = delayColorHz(state.delay.color);
      delay.connect(color);
      repeats = color;
    }
    if (state.delay.wow) createWow(ctx, delay.delayTime).set(state.delay.wow);
    send('delay', own.delay?.()).connect(delay); repeats.connect(feedback).connect(delay); repeats.connect(level).connect(wet);
  }
  if (state.reverb.enabled && peak.reverb > 0 && (state.reverb.kind === 'hall' || state.reverb.kind === 'spring')) {
    const built = createBuiltReverb(ctx, state.reverb.kind), level = ctx.createGain();
    built.set(state.reverb); level.gain.value = state.reverb.mix * reverbLevel(state.reverb.decay);
    send('reverb', own.reverb?.()).connect(built.input); built.output.connect(level).connect(wet);
  } else if (state.reverb.enabled && peak.reverb > 0) {
    const reverb = ctx.createConvolver(), level = ctx.createGain();
    reverb.buffer = reverbImpulse(ctx, state.reverb.decay, seededRandom(3), state.reverb.preDelay, state.reverb.damping); level.gain.value = state.reverb.mix * reverbLevel(state.reverb.decay);
    send('reverb', own.reverb?.()).connect(reverb).connect(level).connect(wet);
  }
  if (state.drive.enabled && peak.drive > 0) {
    const drive = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), level = ctx.createGain();
    drive.curve = driveCurve(state.drive.amount, state.drive.kind); drive.oversample = '4x'; tone.frequency.value = 400 * Math.pow(40, state.drive.tone);
    level.gain.value = .5;
    send('drive').connect(drive).connect(tone).connect(level).connect(wet);
  }
  if (state.phaser.enabled && peak.phaser > 0) {
    const filters = Array.from({ length: 4 }, () => ctx.createBiquadFilter());
    const source = send('phaser'), level = ctx.createGain(), feedback = ctx.createGain();
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = rateHz(state.phaser, tempo); depth.gain.value = state.phaser.depth * 650;
    lfo.connect(depth); lfo.start();
    filters.forEach((filter, i) => { filter.type = 'allpass'; filter.frequency.value = 900 + i * 350; filter.Q.value = .7; depth.connect(filter.frequency); });
    source.connect(filters[0]); filters.slice(1).forEach((filter, i) => filters[i].connect(filter));
    feedback.gain.value = Math.min(.75, state.phaser.feedback);
    filters[3].connect(feedback).connect(filters[0]); filters[3].connect(level); source.connect(level);
    level.gain.value = state.phaser.mix * .5; level.connect(wet);
  }
  auxBuses(state.aux).forEach((bus, slot) => {
    const amount = peak[AUX_SENDS[slot]] ?? 0;
    if (bus.level <= 0 || amount <= 0) return;
    const effect = createAuxEffect(ctx, bus.kind), level = ctx.createGain();
    effect.set(bus, tempo); level.gain.value = bus.level;
    send(AUX_SENDS[slot]).connect(effect.input); effect.output.connect(level).connect(wet);
  });
  if (state.chorus?.enabled && (peak.chorus ?? 0) > 0) {
    const chorus = createChorus(ctx), level = ctx.createGain();
    chorus.lfo.frequency.value = rateHz(state.chorus, tempo); chorus.depth.gain.value = chorusSweep(state.chorus.depth);
    level.gain.value = state.chorus.mix;
    send('chorus').connect(chorus.input); chorus.output.connect(level).connect(wet);
  }
}

const AUX_SENDS = ['auxA', 'auxB'] as const;

// A lane's automated sends through an arrangement, one entry a step: from that step's time, its
// send levels, as the live scheduler sends them (`stepSends`, or the sound's own where the step
// has none). Empty when no send of the lane is automated anywhere, and the sends stay as set.
export type SendTimeline = Array<{ time: number; sends: FxSendLevels }>;
const automatesSends = (automation: Automation | undefined) => SEND_PARAMS.some(key => automation?.[key]?.some(value => value !== null));
export function sendTimeline(bars: SequencerStep[][], params: SynthParameters, automation: Array<Automation | undefined>, times: BarTime[]): SendTimeline {
  if (!automation.some(automatesSends)) return [];
  return bars.flatMap((steps, bar) => {
    const { start, duration } = times[bar], each = duration / Math.max(1, steps.length);
    return steps.map((_, index) => ({ time: start + index * each, sends: stepSends(params, automation[bar], index) ?? params.fxSends }));
  });
}

// How long the effects that something is sent to, and the delays on the lanes, go on ringing after
// the last note: an aux bus counts only when a lane, the drums or a guest sends to it.
export function effectsTail(arrangement: ExportArrangement): number {
  // A lane's automation can send to a bus its sound does not.
  const automated = (synth: ExportArrangement['synths'][number], key: string) => [synth.pattern?.automation, ...(arrangement.bars ?? []).map(bar => bar.laneAutomation?.[synth.id])]
    .some(automation => automation?.[key]?.some(value => (value ?? 0) > 0));
  const sent = (name: typeof AUX_SENDS[number]) => arrangement.synths.some(synth => (synth.synthParams?.fxSends?.[name] ?? 0) > 0 || automated(synth, `${name}Send`))
    || (arrangement.drumFx.sends[name] ?? 0) > 0 || (arrangement.guestTakes ?? []).some(take => (take.sends?.[name] ?? 0) > 0);
  const aux = auxBuses(arrangement.effectsLoop.aux).map((bus, slot) => {
    if (bus.level <= 0 || !sent(AUX_SENDS[slot])) return 0;
    return bus.kind === 'hall' ? bus.main + 0.5 : bus.kind === 'echo' ? Math.min(4, auxSeconds(bus, arrangement.tempo) * 6) : 0.2;
  });
  const inserts = arrangement.synths.map(synth => {
    const delay = synth.synthParams?.inserts?.delay;
    return synth.synthParams && delay && delay.mix > 0 ? Math.min(4, toVoiceParams(synth.synthParams, arrangement.tempo).insDelayTime * 6) : 0;
  });
  return Math.max(0, ...aux, ...inserts);
}

// One pass of a looped pattern, in samples, and how long a bar of 4/4 then lasts: a whole number
// of samples in the pass, so the kept pass starts exactly on a bar line. `wholes` is the pattern's
// length in whole notes, which is its length in bars when they are all 4/4.
export function loopPass(tempo: number, sampleRate: number, wholes: number) {
  if (Number.isInteger(wholes)) {
    const barFrames = Math.round(240 / tempo * sampleRate);
    return { frames: barFrames * wholes, barDuration: barFrames / sampleRate };
  }
  const frames = Math.round(240 / tempo * sampleRate * wholes);
  return { frames, barDuration: frames / wholes / sampleRate };
}

// How many bars a render covers and how long a bar of 4/4 is in it. A loop plays the pattern
// enough times for every tail to have wrapped round, then keeps only the last pass, which is what
// the pattern sounds like once it has been looping for a while.
// `length` is how many bars the pattern (or song) is, and `wholes` how long that is in whole
// notes: the same number unless a bar is not in 4/4.
export function renderPlan(tempo: number, tail: number, sampleRate: number, loop: boolean, length = 1, wholes = length) {
  if (!loop) {
    const barDuration = 240 / tempo;
    return { bars: length, barDuration, frames: Math.ceil((wholes * barDuration + tail) * sampleRate), start: 0 };
  }
  const pass = loopPass(tempo, sampleRate, wholes);
  const passes = 1 + Math.ceil(tail * sampleRate / pass.frames);
  return { bars: passes * length, barDuration: pass.barDuration, frames: passes * pass.frames, start: (passes - 1) * pass.frames };
}

// How long an arrangement lasts, in whole notes: its bars, each as long as its time signature.
export const arrangementWholes = (arrangement: Pick<ExportArrangement, 'bars' | 'signature' | 'tempo'>): number => {
  const signatures = barSignatures(arrangement, 1), scales = barScales(arrangement);
  return scales.length ? signatures.reduce<number>((sum, signature, bar) => sum + barSteps(signature) / 16 * scales[bar], 0) : wholeNotes(signatures);
};

export async function renderArrangement(arrangement: ExportArrangement, options: RenderOptions = {}): Promise<{ channels: Stereo; sampleRate: number }> {
  const sampleRate = 44100;
  const reverb = arrangement.effectsLoop.reverb;
  const tail = Math.min(8.25, Math.max(1, reverb.enabled ? reverb.decay + (reverb.preDelay ?? 0) : 0, effectsTail(arrangement),
    ...arrangement.synths.map(s => s.synthParams?.envelope.release || 0)));
  // With `loop`, the bars are one pattern to be looped, not a song with an ending.
  const looping = options.loop === true;
  const pattern = arrangement.bars;
  if (pattern && arrangementWholes(arrangement) * 240 / arrangement.tempo > MAX_EXPORT_SECONDS) {
    throw new Error(`Songs longer than ${MAX_EXPORT_SECONDS / 60} minutes cannot be exported as audio. Shorten the song or raise the tempo.`);
  }
  if (pattern && pattern.length === 0) throw new Error('The song is empty.');
  const plan = renderPlan(arrangement.tempo, tail, sampleRate, looping, pattern?.length ?? 1, arrangementWholes(arrangement));
  // For a loop, the pattern is laid end to end as many times as the plan asks for.
  const song = pattern ? Array.from({ length: plan.bars }, (_, bar) => pattern[bar % pattern.length]) : undefined;
  if (song) arrangement = { ...arrangement, bars: song };
  const bars = plan.bars, barDuration = plan.barDuration, start = plan.start, frames = plan.frames;
  // When each bar starts: bars of different time signatures are of different lengths.
  const times = barTimes(barSignatures(arrangement, bars), barDuration, barScales(arrangement));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor(), safety = ctx.createWaveShaper();
  safety.curve = safetyCurve();
  safety.oversample = '2x';
  master.gain.value = MASTER_LEVEL;
  configureLimiter(limiter);
  // An EQ left flat is left out, so a project without one renders exactly as it did before.
  const gains = eqGains(arrangement.effectsLoop.eq);
  if (gains.some(gain => gain !== 0)) {
    const eq = createMasterEq(ctx);
    gains.forEach((gain, band) => { eq[band].gain.value = gain; });
    master.connect(eq[0]);
    eq[2].connect(limiter);
  } else master.connect(limiter);
  limiter.connect(safety).connect(ctx.destination);
  const kickTimes = drumHits(arrangement, bars, barDuration).filter(hit => hit.instrument === 'kick').map(hit => hit.time);
  const ducked = ([left, right]: Stereo, duck: number) => {
    const buffer = ctx.createBuffer(2, frames, sampleRate);
    buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const ducker = ctx.createGain();
    for (const time of kickTimes) scheduleDuck(ducker.gain, time, duck);
    source.connect(ducker);
    source.start(0);
    return ducker;
  };
  const play = (stereo: Stereo, sends: FxSendLevels, returnLevel: number, group: 'synth' | 'drums', duck = 0, mixes: Partial<Record<OwnMix, Stereo>> = {}, timeline: SendTimeline = []) => {
    const own = Object.fromEntries(Object.entries(mixes).map(([name, mix]) => [name, () => ducked(mix, duck)]));
    connectEffects(ctx, ducked(stereo, duck), master, sends, returnLevel, arrangement.effectsLoop, group, arrangement.tempo, own, timeline);
  };
  const { only, onProgress } = options;
  const synthSolo = arrangement.synths.some(s => s.solo);
  const lanes = arrangement.synths.filter(lane => lane.pattern && lane.synthParams && (only !== undefined ? only === lane.id : !lane.muted && (!synthSolo || lane.solo)));
  const drums = only === undefined || only === 'drums';
  // The lanes and the drums are rendered here, on the page's thread, and are the first half of the
  // work; the browser's render of the effects is the second. A guest's stem has only the second.
  const parts = lanes.length + (drums ? 1 : 0), share = parts ? 0.5 : 0;
  let rendered = 0;
  const partDone = async () => {
    if (!onProgress) return;
    onProgress(share * ++rendered / parts);
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  for (const lane of lanes) {
    if (!lane.pattern || !lane.synthParams) continue;
    const laneBars = song ? song.map(scene => scene.lanes[lane.id] ?? []) : Array.from({ length: bars }, () => lane.pattern!.steps);
    const laneAutomation = song ? song.map(scene => scene.laneAutomation?.[lane.id]) : Array.from({ length: bars }, () => lane.pattern!.automation);
    play(renderSynthBars(laneBars, lane.synthParams, arrangement.tempo, frames, sampleRate, barDuration, arrangement.synthSamples?.[lane.id], times, laneAutomation, lane.swing ? arrangement.drumSwing : 0),
      lane.synthParams.fxSends, lane.synthParams.fxReturn, 'synth', lane.synthParams.duck ?? 0, {}, sendTimeline(laneBars, lane.synthParams, laneAutomation, times));
    await partDone();
  }
  if (drums) {
    // The kit's own sends are a master over each drum's: the delay and the reverb take the mix the
    // core made for them, at the kit's level. A stem of the drums has its effects, as it always had.
    const { kit, ...mixes } = renderDrumMixes(arrangement, frames, sampleRate, bars, barDuration);
    play(kit, arrangement.drumFx.sends, arrangement.drumFx.returnLevel, 'drums', 0, mixes);
    await partDone();
  }
  // Guests are finished audio: their level and their effect sends, no ducking. In a loop the
  // take is one pass of the pattern and is laid end to end like everything else, so what it
  // sends to the reverb and delay wraps round too.
  (arrangement.guestTakes ?? []).forEach((take, index) => {
    if (only !== undefined && !(typeof only === 'object' && only.guest === index)) return;
    const buffer = ctx.createBuffer(2, frames, sampleRate);
    [take.left, take.right].forEach((recorded, channel) => {
      const data = buffer.getChannelData(channel);
      if (!looping) data.set(recorded.subarray(0, frames));
      else if (recorded.length > 0) for (let offset = 0; offset < frames; offset += recorded.length) data.set(recorded.subarray(0, Math.min(recorded.length, frames - offset)), offset);
    });
    const source = ctx.createBufferSource(), level = ctx.createGain();
    source.buffer = buffer;
    const gainAt = (bar: number) => Math.max(0, Math.min(1, take.gains?.[bar] ?? take.gain));
    level.gain.value = gainAt(0);
    // The level moves over the last moment of a bar, so a held sound does not click and the
    // next bar starts at its own level.
    for (let bar = 1; take.gains && bar < bars; bar++) {
      if (gainAt(bar) === gainAt(bar - 1)) continue;
      level.gain.setValueAtTime(gainAt(bar - 1), times[bar].start - GUEST_FADE);
      level.gain.linearRampToValueAtTime(gainAt(bar), times[bar].start);
    }
    source.connect(level);
    connectEffects(ctx, level, master, take.sends ?? { reverb: 0, delay: 0, drive: 0, phaser: 0 }, 1, arrangement.effectsLoop, 'synth', arrangement.tempo);
    source.start(0);
  });
  // The browser's render stops at each point to say so, on a whole render quantum, and goes on.
  if (onProgress) {
    for (let point = 1; point < PROGRESS_POINTS; point++) {
      const at = Math.floor(frames * point / PROGRESS_POINTS / 128) * 128;
      if (at > 0) void ctx.suspend(at / sampleRate).then(() => { onProgress(share + (1 - share) * point / PROGRESS_POINTS); return ctx.resume(); });
    }
  }
  const output = await ctx.startRendering();
  onProgress?.(1);
  return { channels: [output.getChannelData(0).subarray(start), output.getChannelData(1).subarray(start)], sampleRate };
}

export async function renderArrangementWav(arrangement: ExportArrangement, options: RenderOptions = {}): Promise<ArrayBuffer> {
  const { channels, sampleRate } = await renderArrangement(arrangement, options);
  return encodeWav(channels, sampleRate);
}

// The parts worth exporting on their own: lanes with notes, and the drums if any step is on.
export function stemParts(arrangement: ExportArrangement): Array<{ only: StemPart; name: string }> {
  const parts: Array<{ only: StemPart; name: string }> = arrangement.synths
    .filter(lane => lane.synthParams && lane.pattern?.steps.some(step => step.active && step.note))
    .map(lane => ({ only: lane.id, name: `synth-${lane.id}.wav` }));
  if (DRUM_INSTRUMENTS.some(instrument => arrangement.drumState[instrument].steps.some(Boolean))) {
    parts.push({ only: 'drums', name: 'drums.wav' });
  }
  (arrangement.guestTakes ?? []).forEach((take, guest) => {
    const name = (take.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    parts.push({ only: { guest }, name: `guest-${guest + 1}${name ? `-${name}` : ''}.wav` });
  });
  return parts;
}

// Every stem is the same length and starts at the same instant, so they line up in a DAW.
// `onProgress` is told which file is being made and how far the whole zip has got, from 0 to 1.
export async function renderStemsZip(arrangement: ExportArrangement, onProgress?: (done: number, total: number, fraction: number) => void) {
  const parts = stemParts(arrangement);
  if (parts.length === 0) throw new Error('There are no notes, drum steps or guest instruments to export.');
  const entries = [];
  for (const part of parts) {
    const done = entries.length;
    onProgress?.(done, parts.length, done / parts.length);
    const progress = onProgress && ((fraction: number) => onProgress(done, parts.length, (done + fraction) / parts.length));
    entries.push({ name: part.name, data: new Uint8Array(await renderArrangementWav(arrangement, { only: part.only, ...(progress ? { onProgress: progress } : {}) })) });
  }
  return createZip(entries);
}

export function downloadFile(data: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadArrangementWav(arrangement: ExportArrangement, options: RenderOptions = {}) {
  const kind = arrangement.bars ? 'song-' : options.loop ? 'loop-' : '';
  downloadFile(await renderArrangementWav(arrangement, options), 'audio/wav', `discobot-${kind}${Date.now()}.wav`);
}

export async function downloadStemsZip(arrangement: ExportArrangement, onProgress?: (done: number, total: number, fraction: number) => void) {
  downloadFile(await renderStemsZip(arrangement, onProgress), 'application/zip', `discobot-stems-${Date.now()}.zip`);
}
