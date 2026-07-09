import * as Tone from 'tone';
import { Pattern } from './types';
import { Synthesizer } from './Synthesizer';
import audioBufferToWav from 'audiobuffer-to-wav';

const ToneOffline = (Tone as any).Offline;

export class AudioExporter {
  async exportPattern(
    synth: Synthesizer,
    pattern: Pattern,
    durationInBars: number = 1
  ): Promise<Buffer> {
    const lengthInSeconds = (durationInBars * 4 * 60) / pattern.tempo;
    const sampleRate = 44100;
    const offline = ToneOffline(
      () => {
        (Tone as any).Transport.bpm.value = pattern.tempo;

        pattern.steps.forEach((step, index) => {
          if (step.active && step.note) {
            const time = (index / 16) * (4 * 60) / pattern.tempo;
            (Tone as any).Transport.schedule(() => {
              synth.playNote(step.note!, '16n', step.velocity);
            }, time);
          }
        });
      },
      lengthInSeconds,
      1,
      sampleRate
    );

    const buffer = await offline;
    const audioBuffer = buffer.get() as AudioBuffer;
    const wavBuffer = audioBufferToWav(audioBuffer);

    return Buffer.from(wavBuffer);
  }

  async exportNotes(
    synth: Synthesizer,
    notes: Array<{ note: string; time: number; duration: number; velocity: number }>,
    totalDuration: number
  ): Promise<Buffer> {
    const sampleRate = 44100;
    const offline = ToneOffline(
      () => {
        notes.forEach((n) => {
          (Tone as any).Transport.schedule(() => {
            synth.playNote(n.note, n.duration, n.velocity);
          }, n.time);
        });
      },
      totalDuration,
      1,
      sampleRate
    );

    const buffer = await offline;
    const audioBuffer = buffer.get() as AudioBuffer;
    const wavBuffer = audioBufferToWav(audioBuffer);

    return Buffer.from(wavBuffer);
  }
}
