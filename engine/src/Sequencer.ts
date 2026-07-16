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
  private nextStepAt: number | null = null;

  constructor(synth: Synthesizer) {
    this.synth = synth;
  }

  private getStepIntervalMs(stepCount: number): number {
    const normalizedSteps = Math.max(1, stepCount);
    return ((60 / this.tempo) * 4 * 1000) / normalizedSteps;
  }

  loadPattern(pattern: Pattern): void {
    this.currentPattern = pattern;
    this.tempo = pattern.tempo;
    const length = this.currentPattern.steps.length || 16;
    this.stepInterval = this.getStepIntervalMs(length);
    this.currentStep = ((this.currentStep % length) + length) % length;
  }

  play(startStep: number = 0, startAt?: number): void {
    if (!this.currentPattern || this.isPlaying) return;

    const stepCount = this.currentPattern.steps.length || 16;
    this.currentStep = ((Math.floor(startStep) % stepCount) + stepCount) % stepCount;
    this.isPlaying = true;
    const now = Date.now();
    const delay = startAt ? Math.max(0, startAt - now) : 0;
    if (delay > 0) {
      this.nextStepAt = now + delay;
      this.timerId = setTimeout(() => this.scheduleStep(), delay);
      return;
    }
    this.scheduleStep();
  }

  private scheduleStep(): void {
    if (!this.isPlaying || !this.currentPattern) return;

    const stepIndex = this.currentStep;
    const step = this.currentPattern.steps[stepIndex];
    if (step?.active && step.note) {
      this.synth.playNote(step.note, '16n', step.velocity);
    }

    if (this.onStepCallback) {
      this.onStepCallback(stepIndex);
    }

    this.currentStep = (stepIndex + 1) % (this.currentPattern?.steps.length || 16);
    this.nextStepAt = Date.now() + this.stepInterval;

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
    this.nextStepAt = null;
    this.currentStep = 0;
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.nextStepAt = null;
  }

  resume(): void {
    if (this.isPlaying || !this.currentPattern) return;
    this.isPlaying = true;
    this.scheduleStep();
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
    this.stepInterval = this.getStepIntervalMs(this.currentPattern?.steps.length || 16);
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

  getNextStepTime(): number | null {
    return this.nextStepAt;
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
