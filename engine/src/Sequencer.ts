import * as Tone from 'tone';
import { Pattern, SequencerStep } from './types';
import { Synthesizer } from './Synthesizer';

export class Sequencer {
  private synth: Synthesizer;
  private sequence: Tone.Sequence | null = null;
  private currentPattern: Pattern | null = null;
  private isPlaying: boolean = false;
  private currentStep: number = 0;
  private onStepCallback?: (step: number) => void;

  constructor(synth: Synthesizer) {
    this.synth = synth;
  }

  loadPattern(pattern: Pattern): void {
    this.stop();
    this.currentPattern = pattern;
    Tone.Transport.bpm.value = pattern.tempo;
  }

  play(): void {
    if (!this.currentPattern || this.isPlaying) return;

    this.isPlaying = true;
    this.currentStep = 0;

    const steps = this.currentPattern.steps;

    this.sequence = new Tone.Sequence(
      (time, step) => {
        this.currentStep = step;

        const sequencerStep = steps[step];
        if (sequencerStep && sequencerStep.active && sequencerStep.note) {
          this.synth.playNote(
            sequencerStep.note,
            '16n',
            sequencerStep.velocity
          );
        }

        // Callback for UI updates
        if (this.onStepCallback) {
          Tone.Draw.schedule(() => {
            this.onStepCallback!(step);
          }, time);
        }
      },
      Array.from({ length: 16 }, (_, i) => i),
      '16n'
    );

    this.sequence.start(0);
    Tone.Transport.start();
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    Tone.Transport.stop();

    if (this.sequence) {
      this.sequence.stop();
      this.sequence.dispose();
      this.sequence = null;
    }

    this.synth.releaseAll();
    this.currentStep = 0;
  }

  pause(): void {
    if (!this.isPlaying) return;
    Tone.Transport.pause();
  }

  resume(): void {
    if (!this.isPlaying) return;
    Tone.Transport.start();
  }

  setTempo(bpm: number): void {
    Tone.Transport.bpm.value = bpm;
    if (this.currentPattern) {
      this.currentPattern.tempo = bpm;
    }
  }

  getTempo(): number {
    return Tone.Transport.bpm.value;
  }

  updateStep(stepIndex: number, step: Partial<SequencerStep>): void {
    if (!this.currentPattern) return;
    if (stepIndex < 0 || stepIndex >= this.currentPattern.steps.length) return;

    this.currentPattern.steps[stepIndex] = {
      ...this.currentPattern.steps[stepIndex],
      ...step,
    };
  }

  getCurrentPattern(): Pattern | null {
    return this.currentPattern;
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  onStep(callback: (step: number) => void): void {
    this.onStepCallback = callback;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  createEmptyPattern(name: string = 'New Pattern'): Pattern {
    return {
      id: `pattern-${Date.now()}`,
      name,
      steps: Array.from({ length: 16 }, () => ({
        active: false,
        velocity: 0.7,
      })),
      tempo: 120,
    };
  }

  dispose(): void {
    this.stop();
  }
}
