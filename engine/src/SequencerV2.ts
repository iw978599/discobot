/**
 * Improved Sequencer using Web Audio API scheduling for precise timing
 * Replaces setTimeout-based scheduling to eliminate timing drift
 */

import { Pattern, SequencerStep } from './types';
import { Synthesizer } from './Synthesizer';
import { audioContextManager } from './AudioContextManager';
import { SEQUENCER } from './constants';

export class SequencerV2 {
  private synth: Synthesizer;
  private currentPattern: Pattern | null = null;
  private isPlaying: boolean = false;
  private currentStep: number = 0;
  private onStepCallback?: (step: number) => void;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime: number = 0;
  private tempo: number = SEQUENCER.DEFAULT_TEMPO;
  private stepDuration: number = 0;

  constructor(synth: Synthesizer) {
    this.synth = synth;
    this.updateStepDuration();
  }

  private updateStepDuration(): void {
    const stepCount = Math.max(1, this.currentPattern?.steps.length || 16);
    this.stepDuration = (60 / this.tempo) * 4 / stepCount;
  }

  loadPattern(pattern: Pattern): void {
    this.stop();
    this.currentPattern = pattern;
    this.tempo = pattern.tempo;
    this.updateStepDuration();
  }

  play(): void {
    if (!this.currentPattern || this.isPlaying) return;

    this.isPlaying = true;
    this.currentStep = 0;

    const ctx = audioContextManager.getContext();
    this.nextStepTime = ctx.currentTime;

    // Schedule ahead by a small amount
    this.scheduleNextNotes();

    // Check periodically if we need to schedule more notes
    this.schedulerTimer = setInterval(() => {
      if (this.isPlaying) {
        this.scheduleNextNotes();
      }
    }, SEQUENCER.SCHEDULE_INTERVAL);
  }

  private scheduleNextNotes(): void {
    if (!this.currentPattern) return;

    const ctx = audioContextManager.getContext();
    const currentTime = ctx.currentTime;

    // Schedule notes that fall within the look-ahead window
    while (this.nextStepTime < currentTime + SEQUENCER.SCHEDULE_AHEAD_TIME) {
      this.scheduleStep(this.nextStepTime);
      this.advanceStep();
      this.nextStepTime += this.stepDuration;
    }
  }

  private scheduleStep(time: number): void {
    if (!this.currentPattern) return;

    const step = this.currentPattern.steps[this.currentStep];

    // Schedule visual callback slightly before audio plays
    const callbackDelay = Math.max(0, (time - audioContextManager.getContext().currentTime) * 1000);
    setTimeout(() => {
      if (this.onStepCallback && this.isPlaying) {
        this.onStepCallback(this.currentStep);
      }
    }, callbackDelay);

    // Play note if present
    if (step && step.note) {
      this.playNoteAtTime(step.note, step.velocity, time);
    }
  }

  private playNoteAtTime(note: string, velocity: number, startTime: number): void {
    const ctx = audioContextManager.getContext();
    const freq = Synthesizer.noteToFrequency(note);
    const params = this.synth.getParameters();

    // Create oscillator and gain nodes
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = params.oscillator.type;
    osc.frequency.value = freq;
    osc.detune.value = params.oscillator.detune;

    // Apply filter
    const filter = ctx.createBiquadFilter();
    filter.type = params.filter.type;
    filter.frequency.value = params.filter.frequency;
    filter.Q.value = params.filter.q;

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Apply ADSR envelope
    const { attack, decay, sustain, release } = params.envelope;
    const vol = params.gain * velocity * 0.3;

    const attackTime = startTime + attack;
    const decayTime = attackTime + decay;
    const releaseTime = startTime + this.stepDuration - release;
    const endTime = startTime + this.stepDuration;

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(vol, attackTime);
    gainNode.gain.linearRampToValueAtTime(vol * sustain, decayTime);
    gainNode.gain.setValueAtTime(vol * sustain, releaseTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, endTime);

    osc.start(startTime);
    osc.stop(endTime);
  }

  private advanceStep(): void {
    this.currentStep = (this.currentStep + 1) % (this.currentPattern?.steps.length || 16);
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    this.synth.releaseAll();
    this.currentStep = 0;
  }

  pause(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  resume(): void {
    if (this.isPlaying || !this.currentPattern) return;

    this.isPlaying = true;

    const ctx = audioContextManager.getContext();
    this.nextStepTime = ctx.currentTime;

    this.scheduleNextNotes();

    this.schedulerTimer = setInterval(() => {
      if (this.isPlaying) {
        this.scheduleNextNotes();
      }
    }, SEQUENCER.SCHEDULE_INTERVAL);
  }

  setTempo(bpm: number): void {
    this.tempo = Math.max(SEQUENCER.MIN_TEMPO, Math.min(SEQUENCER.MAX_TEMPO, bpm));
    this.updateStepDuration();

    if (this.currentPattern) {
      this.currentPattern.tempo = this.tempo;
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
      tempo: this.tempo,
    };
  }

  dispose(): void {
    this.stop();
  }
}
