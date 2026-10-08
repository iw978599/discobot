import { Pattern } from './types';
import { Synthesizer } from './Synthesizer';

export function encodeWAV(samples: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = new Uint8Array(bufferSize);
  const view = new DataView(buffer.buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) buffer[offset + i] = str.charCodeAt(i);
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }

  return buffer;
}

export class AudioExporter {
  async exportPattern(
    synth: Synthesizer,
    pattern: Pattern,
    durationInBars: number = 1
  ): Promise<Uint8Array> {
    const sampleRate = 44100;
    const stepCount = Math.max(1, pattern.steps.length);
    const lengthInSeconds = (durationInBars * 4 * 60) / pattern.tempo;
    const totalSamples = Math.floor(sampleRate * lengthInSeconds);
    const mix = new Float32Array(totalSamples);

    pattern.steps.forEach((step, index) => {
      if (step.active && step.note) {
        const time = (index / stepCount) * (4 * 60) / pattern.tempo;
        const offset = Math.floor(time * sampleRate);
        const noteSamples = synth.renderNote(step.note, 0.25, step.velocity, sampleRate);
        for (let j = 0; j < noteSamples.length && offset + j < totalSamples; j++) {
          mix[offset + j] += noteSamples[j];
        }
      }
    });

    for (let i = 0; i < totalSamples; i++) {
      mix[i] = Math.max(-1, Math.min(1, mix[i]));
    }

    return encodeWAV(mix, sampleRate);
  }

  async exportNotes(
    synth: Synthesizer,
    notes: Array<{ note: string; time: number; duration: number; velocity: number }>,
    totalDuration: number
  ): Promise<Uint8Array> {
    const sampleRate = 44100;
    const totalSamples = Math.floor(sampleRate * totalDuration);
    const mix = new Float32Array(totalSamples);

    notes.forEach((n) => {
      const offset = Math.floor(n.time * sampleRate);
      const noteSamples = synth.renderNote(n.note, n.duration, n.velocity, sampleRate);
      for (let j = 0; j < noteSamples.length && offset + j < totalSamples; j++) {
        mix[offset + j] += noteSamples[j];
      }
    });

    for (let i = 0; i < totalSamples; i++) {
      mix[i] = Math.max(-1, Math.min(1, mix[i]));
    }

    return encodeWAV(mix, sampleRate);
  }
}
