import { SynthParameters, OscillatorType } from './types';
import { ensureAudioContext } from './AudioContextPolyfill';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class Synthesizer {
  private parameters!: SynthParameters;
  private audioContext: AudioContext | null = null;
  private activeNotes: Map<string, { startTime: number; velocity: number }> = new Map();

  constructor() {
    ensureAudioContext();
    this.parameters = this.getDefaultParameters();
  }

  private getDefaultParameters(): SynthParameters {
    return {
      gain: 1.0,
      oscillator: { type: 'sine', detune: 0 },
      filter: { frequency: 20000, q: 1, type: 'lowpass' },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.0 },
      effects: {
        reverb: { enabled: false, wet: 0.3, decay: 1.5 },
        delay: { enabled: false, wet: 0.2, time: 0.25, feedback: 0.5 },
      },
    };
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  static noteToFrequency(note: string): number {
    const noteMap: Record<string, number> = {
      C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
      E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
      Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
    };
    const match = note.match(/^([A-G]#?b?)(-?\d+)$/);
    if (!match) return 440;
    const noteName = match[1];
    const octave = parseInt(match[2], 10);
    const semitone = noteMap[noteName] ?? 0;
    return 440 * Math.pow(2, (octave - 4 + (semitone - 9) / 12));
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

  renderNote(note: string, duration: number, velocity: number, sampleRate: number = 44100): Float32Array {
    const freq = Synthesizer.noteToFrequency(note);
    const detunedFreq = freq * Math.pow(2, this.parameters.oscillator.detune / 1200);
    const length = Math.floor(sampleRate * duration);
    const { attack, decay, sustain, release } = this.parameters.envelope;
    const oscType = this.parameters.oscillator.type;

    let samples = Synthesizer.generateOscillator(oscType, detunedFreq, sampleRate, length);
    samples = Synthesizer.applyADSR(samples, sampleRate, attack, decay, sustain, release, duration);
    samples = Synthesizer.applyLowpass(samples, sampleRate, this.parameters.filter.frequency);

    const master = clamp(this.parameters.gain, 0, 2);
    const vol = clamp(velocity, 0, 1);
    for (let i = 0; i < samples.length; i++) {
      samples[i] *= vol * master * 0.5;
    }

    return samples;
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
    this.ensureContext();
    const offlineCtx = new OfflineAudioContext(1, pcmData.length, sampleRate);
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
    this.parameters = { ...this.parameters, ...params };
    if (params.oscillator) {
      this.parameters.oscillator = { ...this.parameters.oscillator, ...params.oscillator };
    }
    if (params.filter) {
      this.parameters.filter = { ...this.parameters.filter, ...params.filter };
    }
    if (params.envelope) {
      this.parameters.envelope = { ...this.parameters.envelope, ...params.envelope };
    }
    if (params.effects) {
      this.parameters.effects = { ...this.parameters.effects, ...params.effects };
    }
  }

  getParameters(): SynthParameters {
    return { ...this.parameters };
  }

  dispose(): void {
    this.activeNotes.clear();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  getAudioState() {
    return {
      activeNotes: this.activeNotes.size,
    };
  }
}
