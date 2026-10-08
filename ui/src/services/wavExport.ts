import { Synthesizer, DrumSynthesizer } from '@discobot/engine';
import type { DrumState, EffectsLoopState, FxSendLevels, Pattern, SynthParameters } from '../types';
import { DRUM_INSTRUMENTS, DRUM_KITS } from './drumKits';
import { transposeNote } from '../utils/midiExport';

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

function addNote(mix: Float32Array, pcm: Float32Array, time: number, sampleRate: number) {
  const offset = Math.round(time * sampleRate);
  for (let i = 0; i < pcm.length && offset + i < mix.length; i++) mix[offset + i] += pcm[i];
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
    const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * state.reverb.decay), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * i / data.length);
    }
    reverb.buffer = buffer; level.gain.value = state.reverb.mix;
    send(sends.reverb).connect(reverb).connect(level).connect(wet);
  }
  if (state.drive.enabled && sends.drive > 0) {
    const drive = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), level = ctx.createGain();
    const curve = new Float32Array(2049), k = 1 + state.drive.amount * 12;
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((2 * i / (curve.length - 1) - 1) * k) / Math.tanh(k);
    drive.curve = curve; drive.oversample = '4x'; tone.frequency.value = 400 * Math.pow(40, state.drive.tone);
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
  const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor();
  const safety = ctx.createWaveShaper(), curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((2 * i / (curve.length - 1) - 1) * 1.2) * .95;
  safety.curve = curve;
  safety.oversample = '2x';
  master.gain.value = .55;
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 20;
  limiter.attack.value = .003; limiter.release.value = .1;
  master.connect(limiter).connect(safety).connect(ctx.destination);
  const play = (pcm: Float32Array, pan: number, sends: FxSendLevels, returnLevel: number, group: 'synth' | 'drums') => {
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate); buffer.getChannelData(0).set(pcm);
    const source = ctx.createBufferSource(), panner = ctx.createStereoPanner();
    source.buffer = buffer; panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(panner); connectEffects(ctx, panner, master, sends, returnLevel, arrangement.effectsLoop, group); source.start(0);
  };
  const synthSolo = arrangement.synths.some(s => s.solo);
  for (const lane of arrangement.synths) {
    if (lane.muted || (synthSolo && !lane.solo) || !lane.pattern || !lane.synthParams) continue;
    const synth = new Synthesizer(), params = lane.synthParams;
    const syncLfo = (lfo: SynthParameters['lfo1']) => ({
      ...lfo, rate: lfo.sync ? arrangement.tempo * 4 / (60 * Math.max(1, Math.round(lfo.rate))) : lfo.rate,
    });
    synth.updateParameters({ ...params, lfo1: syncLfo(params.lfo1), lfo2: syncLfo(params.lfo2),
      effects: { reverb: { ...params.effects.reverb, enabled: false }, delay: { ...params.effects.delay, enabled: false } } });
    const mix = new Float32Array(frames), stepDuration = barDuration / lane.pattern.steps.length;
    lane.pattern.steps.forEach((step, index) => {
      if (!step.active || !step.note) return;
      const arp = params.arpeggiator;
      if (!arp.enabled) {
        addNote(mix, synth.renderNote(step.note, stepDuration * .92, step.velocity, sampleRate), index * stepDuration, sampleRate);
      } else {
        const offsets = arp.mode === 'down' ? [12,7,4,0] : arp.mode === 'updown' ? [0,4,7,12,7,4]
          : arp.mode === 'downup' ? [12,7,4,0,4,7] : arp.mode === 'converge' ? [0,12,4,7] : arp.mode === 'diverge' ? [7,4,12,0] : [0,4,7,12];
        const divisor = arp.rate === '1/4' ? 1 : arp.rate === '1/8' ? 2 : arp.rate === '1/16' ? 4 : 8;
        const interval = 60 / arrangement.tempo / divisor;
        for (let pulse = 0; pulse < Math.max(1, Math.floor(stepDuration / interval)); pulse++) {
          const offset = offsets[arp.mode === 'random' ? Math.floor(Math.random() * offsets.length) : pulse % offsets.length];
          const note = transposeNote(step.note, offset);
          if (note) addNote(mix, synth.renderNote(note, interval * arp.gate, step.velocity, sampleRate), index * stepDuration + pulse * interval, sampleRate);
        }
      }
    });
    play(mix, params.pan || 0, params.fxSends, params.fxReturn, 'synth');
  }
  const drumSolo = DRUM_INSTRUMENTS.some(i => arrangement.drumState[i].solo);
  const variant = DRUM_KITS.find(k => k.id === arrangement.drumKitId)?.modelVariant || 'analog';
  for (const instrument of DRUM_INSTRUMENTS) {
    const track = arrangement.drumState[instrument];
    if (track.muted || (drumSolo && !track.solo)) continue;
    const mix = new Float32Array(frames);
    track.steps.forEach((active, step) => {
      if (!active) return;
      const velocity = track.stepVelocities?.[step] ?? 1;
      if (velocity <= 0) return;
      const pcm = DrumSynthesizer.renderHit(instrument, { ...track.settings, volume: track.settings.volume * arrangement.drumMasterVolume }, sampleRate, { velocity, modelVariant: variant });
      addNote(mix, pcm, (step + (step % 2 ? arrangement.drumSwing : 0)) * barDuration / 16, sampleRate);
    });
    play(mix, track.settings.pan || 0, arrangement.drumFx.sends, arrangement.drumFx.returnLevel, 'drums');
  }
  const rendered = await ctx.startRendering();
  return encodeWav([rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate);
}

export async function downloadArrangementWav(arrangement: ExportArrangement) {
  const url = URL.createObjectURL(new Blob([await renderArrangementWav(arrangement)], { type: 'audio/wav' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `discobot-${Date.now()}.wav`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
