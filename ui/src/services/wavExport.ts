import { DrumCore, type DrumSample, SynthCore, toVoiceParams } from '@discobot/engine';
import type { DrumState, EffectsLoopState, FxSendLevels, Pattern, Scene, SequencerStep, SynthParameters } from '../types';
import { sceneDrumState } from './songPlayback';
import { DRUM_INSTRUMENTS } from './drumKits';
import { expandStepNotes } from './noteScheduling';
import { delaySeconds } from './delayTime';
import { expandDrumStep, seededRandom } from './drumScheduling';
import { createZip } from '../utils/zip';
import { MASTER_LEVEL, chorusSweep, configureLimiter, createChorus, createMasterEq, driveCurve, eqGains, reverbImpulse, safetyCurve, scheduleDuck } from '../hooks/browserAudio';
import type { DrumInstrument, DrumSettings } from '../types';

export interface ExportArrangement {
  tempo: number;
  synths: { id: number; pattern: Pattern | null; synthParams: SynthParameters | null; muted: boolean; solo: boolean }[];
  drumState: DrumState;
  drumKitId: string;
  drumMasterVolume: number;
  drumSwing: number;
  drumFx: { sends: FxSendLevels; returnLevel: number };
  effectsLoop: EffectsLoopState;
  // A whole song, one scene per bar. When present these are rendered end to end and each
  // lane's own pattern and the steps in `drumState` are ignored.
  bars?: Scene[];
  // Decoded samples for the drum lanes that use one. A lane without an entry is synthesized.
  drumSamples?: Partial<Record<DrumInstrument, DrumSample>>;
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
}

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
  return renderSynthBars(Array.from({ length: bars }, () => pattern.steps), params, tempo, frames, sampleRate, barDuration);
}

// The same, with different steps in each bar: a lane through a whole song.
export function renderSynthBars(
  bars: SequencerStep[][], params: SynthParameters, tempo: number, frames: number, sampleRate: number,
  barDuration = 240 / tempo,
): Stereo {
  const core = new SynthCore(sampleRate);
  core.setParams(toVoiceParams(params, tempo));
  const random = seededRandom(2);
  bars.forEach((steps, bar) => {
    const stepDuration = barDuration / Math.max(1, steps.length);
    steps.forEach((step, index) => {
      for (const scheduled of expandStepNotes(step, params, stepDuration, tempo, random)) {
        core.noteOn({
          note: scheduled.note, velocity: step.velocity, duration: scheduled.duration,
          time: bar * barDuration + index * stepDuration + scheduled.offset,
        });
      }
    });
  });
  return renderCore(core, frames);
}

type DrumArrangement = Pick<ExportArrangement, 'tempo' | 'drumState' | 'drumKitId' | 'drumMasterVolume' | 'drumSwing' | 'bars' | 'drumSamples'>;
interface DrumHit { instrument: DrumInstrument; time: number; velocity: number; settings: DrumSettings }

// Every drum hit the export plays, with its start time. Worked out once so the drum render
// and the kick ducking on the synth lanes agree on which chance steps played.
export function drumHits(arrangement: DrumArrangement, bars = 1, barDuration = 240 / arrangement.tempo): DrumHit[] {
  const stepDuration = barDuration / 16;
  const random = seededRandom(1);
  const hits: DrumHit[] = [];
  const count = arrangement.bars ? arrangement.bars.length : bars;
  for (let bar = 0; bar < count; bar++) {
    const state = arrangement.bars ? sceneDrumState(arrangement.bars[bar], arrangement.drumState) : arrangement.drumState;
    // Mutes and solos can differ from scene to scene.
    const solo = DRUM_INSTRUMENTS.some(instrument => state[instrument].solo);
    for (const instrument of DRUM_INSTRUMENTS) {
      const track = state[instrument];
      if (track.muted || (solo && !track.solo)) continue;
      for (let step = 0; step < 16; step++) {
        for (const offset of expandDrumStep(track, step, random)) {
          hits.push({
            instrument, velocity: track.stepVelocities?.[step] ?? 1,
            settings: { ...track.settings, volume: track.settings.volume * arrangement.drumMasterVolume },
            time: bar * barDuration + (step + (step % 2 ? arrangement.drumSwing : 0) + offset) * stepDuration,
          });
        }
      }
    }
  }
  return hits;
}

export function renderDrums(
  arrangement: DrumArrangement, frames: number, sampleRate: number, bars = 1, barDuration = 240 / arrangement.tempo,
): Stereo {
  const core = new DrumCore(sampleRate);
  for (const [instrument, sample] of Object.entries(arrangement.drumSamples ?? {})) core.setSample(instrument as DrumInstrument, sample);
  for (const hit of drumHits(arrangement, bars, barDuration)) core.trigger({ ...hit, kitId: arrangement.drumKitId });
  return renderCore(core, frames);
}

function connectEffects(ctx: OfflineAudioContext, input: AudioNode, master: AudioNode, sends: FxSendLevels, fxReturn: number, state: EffectsLoopState, group: 'synth' | 'drums', tempo: number) {
  input.connect(master);
  if (!state.enabled) return;
  const wet = ctx.createGain();
  wet.gain.value = fxReturn * state.returns[group];
  wet.connect(master);
  const send = (level: number) => {
    const gain = ctx.createGain(); gain.gain.value = level; input.connect(gain); return gain;
  };
  if (state.delay.enabled && sends.delay > 0) {
    const delay = ctx.createDelay(2), feedback = ctx.createGain(), level = ctx.createGain();
    delay.delayTime.value = delaySeconds(state.delay, tempo); feedback.gain.value = Math.min(.85, state.delay.feedback);
    level.gain.value = state.delay.mix;
    send(sends.delay).connect(delay); delay.connect(feedback).connect(delay); delay.connect(level).connect(wet);
  }
  if (state.reverb.enabled && sends.reverb > 0) {
    const reverb = ctx.createConvolver(), level = ctx.createGain();
    reverb.buffer = reverbImpulse(ctx, state.reverb.decay, seededRandom(3), state.reverb.preDelay, state.reverb.damping); level.gain.value = state.reverb.mix;
    send(sends.reverb).connect(reverb).connect(level).connect(wet);
  }
  if (state.drive.enabled && sends.drive > 0) {
    const drive = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), level = ctx.createGain();
    drive.curve = driveCurve(state.drive.amount); drive.oversample = '4x'; tone.frequency.value = 400 * Math.pow(40, state.drive.tone);
    level.gain.value = .5;
    send(sends.drive).connect(drive).connect(tone).connect(level).connect(wet);
  }
  if (state.phaser.enabled && sends.phaser > 0) {
    const filters = Array.from({ length: 4 }, () => ctx.createBiquadFilter());
    const source = send(sends.phaser), level = ctx.createGain(), feedback = ctx.createGain();
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = state.phaser.rate; depth.gain.value = state.phaser.depth * 650;
    lfo.connect(depth); lfo.start();
    filters.forEach((filter, i) => { filter.type = 'allpass'; filter.frequency.value = 900 + i * 350; filter.Q.value = .7; depth.connect(filter.frequency); });
    source.connect(filters[0]); filters.slice(1).forEach((filter, i) => filters[i].connect(filter));
    feedback.gain.value = Math.min(.75, state.phaser.feedback);
    filters[3].connect(feedback).connect(filters[0]); filters[3].connect(level); source.connect(level);
    level.gain.value = state.phaser.mix * .5; level.connect(wet);
  }
  if (state.chorus?.enabled && (sends.chorus ?? 0) > 0) {
    const chorus = createChorus(ctx), level = ctx.createGain();
    chorus.lfo.frequency.value = state.chorus.rate; chorus.depth.gain.value = chorusSweep(state.chorus.depth);
    level.gain.value = state.chorus.mix;
    send(sends.chorus!).connect(chorus.input); chorus.output.connect(level).connect(wet);
  }
}

// How many bars a render covers and how long each is. A loop plays the bar enough times
// for every tail to have wrapped round, then keeps only the last bar, which is what the
// pattern sounds like once it has been looping for a while.
// `length` is how many bars the pattern (or song) is.
export function renderPlan(tempo: number, tail: number, sampleRate: number, loop: boolean, length = 1) {
  if (!loop) {
    const barDuration = 240 / tempo;
    return { bars: length, barDuration, frames: Math.ceil((length * barDuration + tail) * sampleRate), start: 0 };
  }
  // A whole number of samples per bar, so the kept pass starts exactly on a bar line.
  const barFrames = Math.round(240 / tempo * sampleRate);
  const passes = 1 + Math.ceil(tail * sampleRate / (barFrames * length));
  return { bars: passes * length, barDuration: barFrames / sampleRate, frames: passes * length * barFrames, start: (passes - 1) * length * barFrames };
}

export async function renderArrangement(arrangement: ExportArrangement, options: RenderOptions = {}): Promise<{ channels: Stereo; sampleRate: number }> {
  const sampleRate = 44100;
  const reverb = arrangement.effectsLoop.reverb;
  const tail = Math.min(8.25, Math.max(1, reverb.enabled ? reverb.decay + (reverb.preDelay ?? 0) : 0,
    ...arrangement.synths.map(s => s.synthParams?.envelope.release || 0)));
  // With `loop`, the bars are one pattern to be looped, not a song with an ending.
  const looping = options.loop === true;
  const pattern = arrangement.bars;
  if (pattern && pattern.length * 240 / arrangement.tempo > MAX_EXPORT_SECONDS) {
    throw new Error(`Songs longer than ${MAX_EXPORT_SECONDS / 60} minutes cannot be exported as audio. Shorten the song or raise the tempo.`);
  }
  if (pattern && pattern.length === 0) throw new Error('The song is empty.');
  const plan = renderPlan(arrangement.tempo, tail, sampleRate, looping, pattern?.length ?? 1);
  // For a loop, the pattern is laid end to end as many times as the plan asks for.
  const song = pattern ? Array.from({ length: plan.bars }, (_, bar) => pattern[bar % pattern.length]) : undefined;
  if (song) arrangement = { ...arrangement, bars: song };
  const bars = plan.bars, barDuration = plan.barDuration, start = plan.start, frames = plan.frames;
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
  const play = ([left, right]: Stereo, sends: FxSendLevels, returnLevel: number, group: 'synth' | 'drums', duck = 0) => {
    const buffer = ctx.createBuffer(2, frames, sampleRate);
    buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const ducker = ctx.createGain();
    for (const time of kickTimes) scheduleDuck(ducker.gain, time, duck);
    source.connect(ducker);
    connectEffects(ctx, ducker, master, sends, returnLevel, arrangement.effectsLoop, group, arrangement.tempo); source.start(0);
  };
  const { only } = options;
  const synthSolo = arrangement.synths.some(s => s.solo);
  for (const lane of arrangement.synths) {
    if (!lane.pattern || !lane.synthParams) continue;
    if (only !== undefined ? only !== lane.id : lane.muted || (synthSolo && !lane.solo)) continue;
    const laneBars = song ? song.map(scene => scene.lanes[lane.id] ?? []) : Array.from({ length: bars }, () => lane.pattern!.steps);
    play(renderSynthBars(laneBars, lane.synthParams, arrangement.tempo, frames, sampleRate, barDuration),
      lane.synthParams.fxSends, lane.synthParams.fxReturn, 'synth', lane.synthParams.duck ?? 0);
  }
  if (only === undefined || only === 'drums') {
    play(renderDrums(arrangement, frames, sampleRate, bars, barDuration), arrangement.drumFx.sends, arrangement.drumFx.returnLevel, 'drums');
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
      level.gain.setValueAtTime(gainAt(bar - 1), bar * barDuration - GUEST_FADE);
      level.gain.linearRampToValueAtTime(gainAt(bar), bar * barDuration);
    }
    source.connect(level);
    connectEffects(ctx, level, master, take.sends ?? { reverb: 0, delay: 0, drive: 0, phaser: 0 }, 1, arrangement.effectsLoop, 'synth', arrangement.tempo);
    source.start(0);
  });
  const rendered = await ctx.startRendering();
  return { channels: [rendered.getChannelData(0).subarray(start), rendered.getChannelData(1).subarray(start)], sampleRate };
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
export async function renderStemsZip(arrangement: ExportArrangement) {
  const parts = stemParts(arrangement);
  if (parts.length === 0) throw new Error('There are no notes, drum steps or guest instruments to export.');
  const entries = [];
  for (const part of parts) {
    entries.push({ name: part.name, data: new Uint8Array(await renderArrangementWav(arrangement, { only: part.only })) });
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

export async function downloadStemsZip(arrangement: ExportArrangement) {
  downloadFile(await renderStemsZip(arrangement), 'application/zip', `discobot-stems-${Date.now()}.zip`);
}
