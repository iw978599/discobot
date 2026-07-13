import { Pattern } from './types';
import { Synthesizer } from './Synthesizer';

function encodeWAV(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = Buffer.alloc(bufferSize);
  const writeString = (offset: number, str: string) => buffer.write(str, offset, 'ascii');

  writeString(0, 'RIFF');
  buffer.writeUInt32LE(36 + dataSize, 4);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  writeString(36, 'data');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  return buffer;
}

export class AudioExporter {
  async exportPattern(
    synth: Synthesizer,
    pattern: Pattern,
    durationInBars: number = 1
  ): Promise<Buffer> {
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
  ): Promise<Buffer> {
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
