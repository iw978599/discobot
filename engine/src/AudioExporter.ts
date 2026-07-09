import * as Tone from 'tone';
import { Pattern } from './types';
import { Synthesizer } from './Synthesizer';
import audioBufferToWav from 'audiobuffer-to-wav';

export class AudioExporter {
  async exportPattern(
    synth: Synthesizer,
    pattern: Pattern,
    durationInBars: number = 1
  ): Promise<Buffer> {
    // Create offline context
    const lengthInSeconds = (durationInBars * 4 * 60) / pattern.tempo;
    const sampleRate = 44100;
    const offline = new Tone.Offline(
      (transport) => {
        transport.bpm.value = pattern.tempo;

        // Schedule pattern
        pattern.steps.forEach((step, index) => {
          if (step.active && step.note) {
            const time = (index / 16) * (4 * 60) / pattern.tempo;
            synth.playNote(step.note, '16n', step.velocity);
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
    const offline = new Tone.Offline(
      () => {
        notes.forEach((n) => {
          Tone.Transport.schedule(() => {
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
