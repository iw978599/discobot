import { SynthParameters, OscillatorType } from './types';
import { audioContextManager } from './AudioContextManager';
import { noteToFrequency as utilNoteToFrequency, deepMerge } from './utils';
import { AUDIO_MIXING } from './constants';
import { ResonantFilter, oscillator, finiteClamp, finiteClamp as clamp } from './dsp';

export class Synthesizer {
  private static readonly PITCH_LFO_MAX_CENTS = 1200;
  private static readonly FILTER_LFO_MAX_OCTAVES = 2;
  private parameters!: SynthParameters;
  private activeNotes: Map<string, { startTime: number; velocity: number }> = new Map();

  constructor() {
    this.parameters = this.getDefaultParameters();
  }

  private getDefaultParameters(): SynthParameters {
    return {
      hold: false,
      gain: 1.0,
      fxReturn: 0.85,
      pan: 0,
      portamento: { enabled: false, glide: 0.05 },
      arpeggiator: { enabled: false, mode: 'up', rate: '1/16', gate: 0.7 },
      oscillator: { type: 'sine', detune: 0 },
      lfo1: { enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.2 },
      lfo2: { enabled: false, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.25 },
      filter: { frequency: 5000, q: 1, type: 'lowpass' },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.0 },
      fxSends: { reverb: 0.25, delay: 0.2, drive: 0.15, phaser: 0.1 },
      effects: {
        reverb: { enabled: false, wet: 0.3, decay: 1.5 },
        delay: { enabled: false, wet: 0.2, time: 0.25, feedback: 0.5 },
      },
    };
  }

  static noteToFrequency(note: string): number {
    return utilNoteToFrequency(note);
  }

  static generateOscillator(type: OscillatorType, frequency: number, sampleRate: number, length: number): Float32Array {
    const buffer = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const phase = (i * frequency) / sampleRate;
      const frac = phase - Math.floor(phase);
      buffer[i] = oscillator(type, frac, finiteClamp(frequency / sampleRate, 0.000001, 0.45));
    }
    return buffer;
  }

  static applyADSR(samples: Float32Array, sampleRate: number, attack: number, decay: number, sustain: number, release: number, totalDuration: number): Float32Array {
    attack = clamp(attack, 0.002, 10, 0.01);
    decay = clamp(decay, 0.002, 10, 0.2);
    sustain = clamp(sustain, 0, 1, 0.5);
    release = clamp(release, 0.005, 10, 0.3);
    const output = new Float32Array(samples.length);
    const attackSamples = Math.max(1, Math.floor(Math.max(0.002, attack) * sampleRate));
    const decaySamples = Math.max(1, Math.floor(decay * sampleRate));
    const releaseSamples = Math.max(1, Math.floor(Math.max(0.005, release) * sampleRate));
    const sustainStart = attackSamples + decaySamples;
    const releaseStart = Math.max(1, samples.length - Math.min(releaseSamples, Math.floor(samples.length * 0.5)));
    const heldEnvelope = (i: number): number => i < attackSamples ? i / attackSamples
      : i < sustainStart ? 1 - (1 - sustain) * ((i - attackSamples) / decaySamples) : sustain;

    for (let i = 0; i < samples.length; i++) {
      let envelope: number;
      envelope = i < releaseStart ? heldEnvelope(i)
        : heldEnvelope(releaseStart) * (1 - (i - releaseStart) / Math.max(1, samples.length - releaseStart - 1));
      output[i] = samples[i] * Math.max(0, envelope);
    }
    return output;
  }

  static applyLowpass(samples: Float32Array, sampleRate: number, cutoff: number): Float32Array {
    const output = new Float32Array(samples.length);
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoff);
    const alpha = dt / (rc + dt);
    output[0] = samples[0];
    for (let i = 1; i < samples.length; i++) {
      output[i] = output[i - 1] + alpha * (samples[i] - output[i - 1]);
    }
    return output;
  }

  static applyFilterType(samples: Float32Array, sampleRate: number, cutoff: number, q: number, type: string): Float32Array {
    const output = new Float32Array(samples.length);
    const filter = new ResonantFilter();
    for (let i = 0; i < samples.length; i++) {
      output[i] = filter.process(samples[i], sampleRate, cutoff, q, type);
    }
    return output;
  }

  private static applyDelay(samples: Float32Array, sampleRate: number, time: number, feedback: number, wet: number): Float32Array {
    time = clamp(time, 0.001, 2, 0.25);
    feedback = clamp(feedback, 0, 0.85);
    const output = new Float32Array(samples.length);
    const delaySamples = Math.max(1, Math.floor(time * sampleRate));
    const delayBuffer = new Float32Array(delaySamples);
    let writeIndex = 0;
    const dry = 1 - wet;

    for (let i = 0; i < samples.length; i++) {
      const delayed = delayBuffer[writeIndex];
      const input = samples[i] + delayed * feedback;
      delayBuffer[writeIndex] = input;
      writeIndex = (writeIndex + 1) % delaySamples;
      output[i] = samples[i] * dry + delayed * wet;
    }
    return output;
  }

  private static applyReverb(samples: Float32Array, sampleRate: number, decay: number, wet: number): Float32Array {
    const output = new Float32Array(samples.length);
    const dry = 1 - wet;
    const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((sec) => Math.max(1, Math.floor(sec * sampleRate)));
    const combBuffers = combDelays.map((len) => new Float32Array(len));
    const combIndices = new Array(combDelays.length).fill(0);
    const feedback = clamp(0.55 + decay * 0.035, 0.5, 0.92);

    for (let i = 0; i < samples.length; i++) {
      let reverbAccum = 0;
      for (let c = 0; c < combBuffers.length; c++) {
        const buffer = combBuffers[c];
        const idx = combIndices[c];
        const delayed = buffer[idx];
        buffer[idx] = samples[i] + delayed * feedback;
        combIndices[c] = (idx + 1) % buffer.length;
        reverbAccum += delayed;
      }
      const wetSignal = reverbAccum / combBuffers.length;
      output[i] = samples[i] * dry + wetSignal * wet;
    }

    return output;
  }

  private static lfoValue(type: OscillatorType, phase: number): number {
    const frac = phase - Math.floor(phase);
    switch (type) {
      case 'sine':
        return Math.sin(2 * Math.PI * phase);
      case 'square':
        return frac < 0.5 ? 1 : -1;
      case 'sawtooth':
        return 2 * frac - 1;
      case 'triangle':
        return 1 - 4 * Math.abs(frac - 0.5);
      default:
        return 0;
    }
  }

  renderNote(
    note: string,
    duration: number,
    velocity: number,
    sampleRate: number = 44100,
    options?: { applyInsertEffects?: boolean }
  ): Float32Array {
    sampleRate = finiteClamp(sampleRate, 8000, 192000, 44100);
    duration = finiteClamp(duration, 0, 60);
    const freq = Synthesizer.noteToFrequency(note);
    const detunedFreq = freq * Math.pow(2, finiteClamp(this.parameters.oscillator.detune, -1200, 1200, 0) / 1200);
    const length = Math.floor(sampleRate * duration);
    const { attack, decay, sustain, release } = this.parameters.envelope;
    const oscType = this.parameters.oscillator.type;
    const lfos = [this.parameters.lfo1, this.parameters.lfo2];
    let phase = 0;
    let lfo1Phase = 0;
    let lfo2Phase = 0;
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const lfoValues = [
        lfos[0].enabled ? Synthesizer.lfoValue(lfos[0].waveform, lfo1Phase) : 0,
        lfos[1].enabled ? Synthesizer.lfoValue(lfos[1].waveform, lfo2Phase) : 0,
      ];
      const pitchMod = lfoValues.reduce((sum, val, idx) => (
        lfos[idx].enabled && lfos[idx].target === 'pitch' ? sum + val * lfos[idx].depth : sum
      ), 0);
      const pitchCents = pitchMod * Synthesizer.PITCH_LFO_MAX_CENTS;
      const currentFreq = detunedFreq * Math.pow(2, pitchCents / 1200);
      const step = finiteClamp(currentFreq / sampleRate, 0.000001, 0.45);
      phase = (phase + step) % 1;
      samples[i] = oscillator(oscType, phase, step);
      lfo1Phase += lfos[0].rate / sampleRate;
      lfo2Phase += lfos[1].rate / sampleRate;
    }
    const shapedSamples = Synthesizer.applyADSR(samples, sampleRate, attack, decay, sustain, release, duration);
    const output = new Float32Array(shapedSamples.length);
    const lfoState = [0, 0];
    const filter = new ResonantFilter();
    for (let i = 0; i < shapedSamples.length; i++) {
      lfoState[0] += lfos[0].rate / sampleRate;
      lfoState[1] += lfos[1].rate / sampleRate;
      const filterModRaw = lfos.reduce((sum, lfo, idx) => (
        lfo.enabled && lfo.target === 'filter'
          ? sum + Synthesizer.lfoValue(lfo.waveform, lfoState[idx]) * lfo.depth
          : sum
      ), 0);
      const filterMod = clamp(filterModRaw, -1, 1);
      const modulatedCutoff = clamp(
        this.parameters.filter.frequency * Math.pow(2, filterMod * Synthesizer.FILTER_LFO_MAX_OCTAVES),
        20,
        20000
      );
      const filterType = this.parameters.filter.type || 'lowpass';
      const q = clamp(this.parameters.filter.q, 0.1, 20);
      output[i] = filter.process(shapedSamples[i], sampleRate, modulatedCutoff, q, filterType);
    }

    let effected: Float32Array<ArrayBufferLike> = output;

    const applyInsertEffects = options?.applyInsertEffects ?? true;
    if (applyInsertEffects && this.parameters.effects.delay.enabled && this.parameters.effects.delay.wet > 0) {
      effected = Synthesizer.applyDelay(
        effected,
        sampleRate,
        this.parameters.effects.delay.time,
        this.parameters.effects.delay.feedback,
        clamp(this.parameters.effects.delay.wet, 0, 1)
      );
    }

    if (applyInsertEffects && this.parameters.effects.reverb.enabled && this.parameters.effects.reverb.wet > 0) {
      effected = Synthesizer.applyReverb(
        effected,
        sampleRate,
        this.parameters.effects.reverb.decay,
        clamp(this.parameters.effects.reverb.wet, 0, 1)
      );
    }

    const master = clamp(this.parameters.gain, 0, 2);
    const vol = clamp(velocity, 0, 1);
    for (let i = 0; i < effected.length; i++) {
      const fade = Math.min(1, i / Math.max(1, sampleRate * 0.002), (effected.length - 1 - i) / Math.max(1, sampleRate * 0.005));
      effected[i] = Math.tanh(effected[i] * vol * master * AUDIO_MIXING.SYNTH_MASTER_VOLUME) * Math.max(0, fade);
    }

    return effected as Float32Array;
  }

  renderChord(notes: string[], duration: number, velocity: number, sampleRate: number = 44100): Float32Array {
    const length = Math.floor(sampleRate * duration);
    const mix = new Float32Array(length);
    for (const note of notes) {
      const part = this.renderNote(note, duration, velocity, sampleRate);
      for (let i = 0; i < Math.min(length, part.length); i++) {
        mix[i] += part[i];
      }
    }
    for (let i = 0; i < length; i++) {
      mix[i] = Math.tanh(mix[i] * 0.5);
    }
    return mix;
  }

  renderToAudioBuffer(pcmData: Float32Array, sampleRate: number = 44100): AudioBuffer {
    const offlineCtx = audioContextManager.createOfflineContext(1, pcmData.length, sampleRate);
    const buffer = offlineCtx.createBuffer(1, pcmData.length, sampleRate);
    buffer.getChannelData(0).set(pcmData);
    return buffer;
  }

  playNote(note: string, _duration?: string | number, velocity: number = 0.7): void {
    this.activeNotes.set(note, { startTime: Date.now(), velocity });
  }

  playChord(notes: string[], _duration?: string | number, velocity: number = 0.7): void {
    for (const note of notes) {
      this.activeNotes.set(note, { startTime: Date.now(), velocity });
    }
  }

  noteOn(note: string, velocity: number = 0.7): void {
    this.activeNotes.set(note, { startTime: Date.now(), velocity });
  }

  noteOff(note: string): void {
    this.activeNotes.delete(note);
  }

  releaseAll(): void {
    this.activeNotes.clear();
  }

  updateParameters(params: Partial<SynthParameters>): void {
    this.parameters = deepMerge(this.parameters, params);
  }

  getParameters(): SynthParameters {
    return { ...this.parameters };
  }

  dispose(): void {
    this.activeNotes.clear();
  }

  getAudioState() {
    return {
      activeNotes: this.activeNotes.size,
    };
  }
}
