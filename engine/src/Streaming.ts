import { SynthParameters } from './types';
import { Synthesizer } from './Synthesizer';
import { audioContextManager } from './AudioContextManager';

export class DiscordAudioStreamer {
  private synth: Synthesizer;
  private _isStreaming: boolean = false;

  constructor() {
    this.synth = new Synthesizer();
  }

  async prepareForDiscordStreaming(): Promise<AudioBuffer[]> {
    const ctx = audioContextManager.getContext();
    const bufferDuration = 0.1;
    const totalDuration = 16;
    const bufferCount = Math.ceil(totalDuration / bufferDuration);
    const buffers: AudioBuffer[] = [];
    const sampleRate = ctx.sampleRate;

    for (let i = 0; i < bufferCount; i++) {
      const startTime = i * bufferDuration;
      const endTime = Math.min((i + 1) * bufferDuration, totalDuration);
      const chunkDuration = endTime - startTime;

      const pcm = this.renderSegment(startTime, chunkDuration, sampleRate);
      const offlineCtx = audioContextManager.createOfflineContext(1, pcm.length, sampleRate);
      const buffer = offlineCtx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);
      buffers.push(buffer);
    }

    return buffers;
  }

  private renderSegment(startTime: number, duration: number, sampleRate: number): Float32Array {
    const length = Math.floor(sampleRate * duration);
    const output = new Float32Array(length);
    const tempo = 120;
    const beatsPerStep = 60 / tempo / 4;
    const totalSteps = Math.floor(duration / beatsPerStep / 2);

    for (let step = 0; step < totalSteps; step++) {
      const globalStep = Math.floor(startTime / beatsPerStep) + step;
      if (globalStep % 2 === 0 && (globalStep / 2) % 3 !== 0) {
        const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
        const note = notes[globalStep % notes.length];
        const stepStart = step * beatsPerStep * 2 * sampleRate;
        const stepSamples = Math.floor(beatsPerStep * 2 * sampleRate * 0.9);
        const offset = Math.floor(stepStart);

        const noteSamples = Synthesizer.generateOscillator('sine', Synthesizer.noteToFrequency(note), sampleRate, stepSamples);
        const envSamples = Synthesizer.applyADSR(noteSamples, sampleRate, 0.01, 0.05, 0.3, 0.05, stepSamples / sampleRate);
        for (let j = 0; j < stepSamples && offset + j < length; j++) {
          output[offset + j] += envSamples[j] * 0.3;
        }
      }
    }

    for (let i = 0; i < length; i++) {
      output[i] = Math.max(-1, Math.min(1, output[i]));
    }
    return output;
  }

  updateParameters(params: Partial<SynthParameters>): void {
    this.synth.updateParameters(params);
  }

  getParameters(): SynthParameters {
    return this.synth.getParameters();
  }

  playNote(note: string, duration?: string | number, velocity: number = 0.7): void {
    this.synth.playNote(note, duration, velocity);
  }

  isStreaming(): boolean {
    return this._isStreaming;
  }

  setStreamingStatus(status: boolean): void {
    this._isStreaming = status;
  }

  dispose(): void {
    this.synth.dispose();
  }
}
