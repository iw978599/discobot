import { DrumCore, SynthCore, toVoiceParams } from '@discobot/engine';
import type { DrumState, EffectsLoopState, FxSendLevels, Pattern, SynthParameters } from '../types';
import { DRUM_INSTRUMENTS } from './drumKits';
import { expandStep } from './noteScheduling';
import { MASTER_LEVEL, configureLimiter, driveCurve, reverbImpulse, safetyCurve } from '../hooks/browserAudio';

export interface ExportArrangement {
  tempo: number;
  synths: { id: number; pattern: Pattern | null; synthParams: SynthParameters | null; muted: boolean; solo: boolean }[];
  drumState: DrumState;
  drumKitId: string;
  drumMasterVolume: number;
  drumSwing: number;
  drumFx: { sends: FxSendLevels; returnLevel: number };
  effectsLoop: EffectsLoopState;
}

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

// One bar of a synth lane through the same voice core the worklet runs live.
export function renderSynthLane(pattern: Pattern, params: SynthParameters, tempo: number, frames: number, sampleRate: number): Stereo {
  const core = new SynthCore(sampleRate);
  core.setParams(toVoiceParams(params, tempo));
  const stepDuration = 240 / tempo / pattern.steps.length;
  pattern.steps.forEach((step, index) => {
    if (!step.active || !step.note) return;
    for (const scheduled of expandStep(step.note, params, stepDuration, tempo, step.slide)) {
      core.noteOn({ note: scheduled.note, velocity: step.velocity, duration: scheduled.duration, time: index * stepDuration + scheduled.offset });
    }
  });
  return renderCore(core, frames);
}

export function renderDrums(
  arrangement: Pick<ExportArrangement, 'tempo' | 'drumState' | 'drumKitId' | 'drumMasterVolume' | 'drumSwing'>,
  frames: number, sampleRate: number,
): Stereo {
  const core = new DrumCore(sampleRate);
  const stepDuration = 240 / arrangement.tempo / 16;
  const solo = DRUM_INSTRUMENTS.some(instrument => arrangement.drumState[instrument].solo);
  for (const instrument of DRUM_INSTRUMENTS) {
    const track = arrangement.drumState[instrument];
    if (track.muted || (solo && !track.solo)) continue;
    track.steps.forEach((active, step) => {
      const velocity = track.stepVelocities?.[step] ?? 1;
      if (!active || velocity <= 0) return;
      core.trigger({
        instrument, velocity, kitId: arrangement.drumKitId,
        settings: { ...track.settings, volume: track.settings.volume * arrangement.drumMasterVolume },
        time: (step + (step % 2 ? arrangement.drumSwing : 0)) * stepDuration,
      });
    });
  }
  return renderCore(core, frames);
}

function connectEffects(ctx: OfflineAudioContext, input: AudioNode, master: AudioNode, sends: FxSendLevels, fxReturn: number, state: EffectsLoopState, group: 'synth' | 'drums') {
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
    delay.delayTime.value = state.delay.time; feedback.gain.value = Math.min(.85, state.delay.feedback);
    level.gain.value = state.delay.mix;
    send(sends.delay).connect(delay); delay.connect(feedback).connect(delay); delay.connect(level).connect(wet);
  }
  if (state.reverb.enabled && sends.reverb > 0) {
    const reverb = ctx.createConvolver(), level = ctx.createGain();
    reverb.buffer = reverbImpulse(ctx, state.reverb.decay); level.gain.value = state.reverb.mix;
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
}

export async function renderArrangementWav(arrangement: ExportArrangement): Promise<ArrayBuffer> {
  const sampleRate = 44100;
  const barDuration = 240 / arrangement.tempo;
  const tail = Math.min(8, Math.max(1, arrangement.effectsLoop.reverb.enabled ? arrangement.effectsLoop.reverb.decay : 0,
    ...arrangement.synths.map(s => s.synthParams?.envelope.release || 0)));
  const frames = Math.ceil((barDuration + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor(), safety = ctx.createWaveShaper();
  safety.curve = safetyCurve();
  safety.oversample = '2x';
  master.gain.value = MASTER_LEVEL;
  configureLimiter(limiter);
  master.connect(limiter).connect(safety).connect(ctx.destination);
  const play = ([left, right]: Stereo, sends: FxSendLevels, returnLevel: number, group: 'synth' | 'drums') => {
    const buffer = ctx.createBuffer(2, frames, sampleRate);
    buffer.getChannelData(0).set(left); buffer.getChannelData(1).set(right);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    connectEffects(ctx, source, master, sends, returnLevel, arrangement.effectsLoop, group); source.start(0);
  };
  const synthSolo = arrangement.synths.some(s => s.solo);
  for (const lane of arrangement.synths) {
    if (lane.muted || (synthSolo && !lane.solo) || !lane.pattern || !lane.synthParams) continue;
    play(renderSynthLane(lane.pattern, lane.synthParams, arrangement.tempo, frames, sampleRate),
      lane.synthParams.fxSends, lane.synthParams.fxReturn, 'synth');
  }
  play(renderDrums(arrangement, frames, sampleRate), arrangement.drumFx.sends, arrangement.drumFx.returnLevel, 'drums');
  const rendered = await ctx.startRendering();
  return encodeWav([rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate);
}

export async function downloadArrangementWav(arrangement: ExportArrangement) {
  const url = URL.createObjectURL(new Blob([await renderArrangementWav(arrangement)], { type: 'audio/wav' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `discobot-${Date.now()}.wav`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
