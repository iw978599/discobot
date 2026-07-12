import { SynthParameters, OscillatorType } from './types';
import { audioContextManager } from './AudioContextManager';
import { clamp, noteToFrequency as utilNoteToFrequency, deepMerge } from './utils';
import { AUDIO_MIXING } from './constants';

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
      gain: 1.0,
      oscillator: { type: 'sine', detune: 0 },
      lfo1: { enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.2 },
      lfo2: { enabled: false, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.25 },
      filter: { frequency: 20000, q: 1, type: 'lowpass' },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.0 },
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
      switch (type) {
        case 'sine':
          buffer[i] = Math.sin(2 * Math.PI * phase);
          break;
        case 'square':
          buffer[i] = frac < 0.5 ? 1 : -1;
          break;
        case 'sawtooth':
          buffer[i] = 2 * frac - 1;
          break;
        case 'triangle':
          buffer[i] = 4 * Math.abs(frac - 0.5) - 1;
          break;
      }
    }
    return buffer;
  }

  static applyADSR(samples: Float32Array, sampleRate: number, attack: number, decay: number, sustain: number, release: number, totalDuration: number): Float32Array {
    const output = new Float32Array(samples.length);
    const attackSamples = Math.floor(attack * sampleRate);
    const decaySamples = Math.floor(decay * sampleRate);
    const releaseSamples = Math.floor(release * sampleRate);
    const sustainStart = attackSamples + decaySamples;
    const releaseStart = Math.max(sustainStart, samples.length - releaseSamples);

    for (let i = 0; i < samples.length; i++) {
      let envelope: number;
      if (i < attackSamples) {
        envelope = i / attackSamples;
      } else if (i < sustainStart) {
        envelope = 1 - (1 - sustain) * ((i - attackSamples) / decaySamples);
      } else if (i < releaseStart) {
        envelope = sustain;
      } else {
        envelope = sustain * (1 - (i - releaseStart) / releaseSamples);
      }
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

  private static applyDelay(samples: Float32Array, sampleRate: number, time: number, feedback: number, wet: number): Float32Array {
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

  renderNote(note: string, duration: number, velocity: number, sampleRate: number = 44100): Float32Array {
    const freq = Synthesizer.noteToFrequency(note);
    const detunedFreq = freq * Math.pow(2, this.parameters.oscillator.detune / 1200);
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
      phase += currentFreq / sampleRate;
      samples[i] = Synthesizer.lfoValue(oscType, phase);
      lfo1Phase += lfos[0].rate / sampleRate;
      lfo2Phase += lfos[1].rate / sampleRate;
    }
    const shapedSamples = Synthesizer.applyADSR(samples, sampleRate, attack, decay, sustain, release, duration);
    const output = new Float32Array(shapedSamples.length);
    const lfoState = [0, 0];
    let filtered = 0;
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
      const dt = 1 / sampleRate;
      const rc = 1 / (2 * Math.PI * modulatedCutoff);
      const alpha = dt / (rc + dt);
      filtered = filtered + alpha * (shapedSamples[i] - filtered);
      output[i] = filtered;
    }

    let effected: Float32Array<ArrayBufferLike> = output;

    if (this.parameters.effects.delay.enabled && this.parameters.effects.delay.wet > 0) {
      effected = Synthesizer.applyDelay(
        effected,
        sampleRate,
        this.parameters.effects.delay.time,
        this.parameters.effects.delay.feedback,
        clamp(this.parameters.effects.delay.wet, 0, 1)
      );
    }

    if (this.parameters.effects.reverb.enabled && this.parameters.effects.reverb.wet > 0) {
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
      effected[i] *= vol * master * AUDIO_MIXING.SYNTH_MASTER_VOLUME;
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
      mix[i] = clamp(mix[i], -1, 1);
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
