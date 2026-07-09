import { Pattern, SequencerStep } from './types';
import { Synthesizer } from './Synthesizer';

export class Sequencer {
  private synth: Synthesizer;
  private currentPattern: Pattern | null = null;
  private isPlaying: boolean = false;
  private currentStep: number = 0;
  private onStepCallback?: (step: number) => void;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private tempo: number = 120;
  private stepInterval: number = 125;

  constructor(synth: Synthesizer) {
    this.synth = synth;
  }

  loadPattern(pattern: Pattern): void {
    this.stop();
    this.currentPattern = pattern;
    this.tempo = pattern.tempo;
    this.stepInterval = (60 / this.tempo / 4) * 1000;
  }

  play(): void {
    if (!this.currentPattern || this.isPlaying) return;

    this.isPlaying = true;
    this.currentStep = 0;
    this.scheduleStep();
  }

  private scheduleStep(): void {
    if (!this.isPlaying || !this.currentPattern) return;

    const step = this.currentPattern.steps[this.currentStep];
    if (step && step.active && step.note) {
      this.synth.playNote(step.note, '16n', step.velocity);
    }

    if (this.onStepCallback) {
      this.onStepCallback(this.currentStep);
    }

    this.currentStep = (this.currentStep + 1) % (this.currentPattern?.steps.length || 16);

    this.timerId = setTimeout(() => this.scheduleStep(), this.stepInterval);
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    this.synth.releaseAll();
    this.currentStep = 0;
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  resume(): void {
    if (this.isPlaying || !this.currentPattern) return;
    this.isPlaying = true;
    this.scheduleStep();
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
    this.stepInterval = (60 / bpm / 4) * 1000;
    if (this.currentPattern) {
      this.currentPattern.tempo = bpm;
    }
  }

  getTempo(): number {
    return this.tempo;
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
