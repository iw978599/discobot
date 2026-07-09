import * as Tone from 'tone';
import { SynthParameters, OscillatorType } from './types';

export class Synthesizer {
  private synth: Tone.PolySynth;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private delay: Tone.FeedbackDelay;
  private reverbSend: Tone.Gain;
  private delaySend: Tone.Gain;
  private parameters: SynthParameters;

  constructor() {
    this.parameters = this.getDefaultParameters();

    // Create synth chain
    this.synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 8,
      oscillator: {
        type: this.parameters.oscillator.type,
      },
      envelope: this.parameters.envelope,
    });

    // Filter
    this.filter = new Tone.Filter({
      frequency: this.parameters.filter.frequency,
      Q: this.parameters.filter.q,
      type: this.parameters.filter.type,
    });

    // Effects
    this.reverb = new Tone.Reverb({
      decay: this.parameters.effects.reverb.decay,
      wet: 0,
    });

    this.delay = new Tone.FeedbackDelay({
      delayTime: this.parameters.effects.delay.time,
      feedback: this.parameters.effects.delay.feedback,
      wet: 0,
    });

    // Send/return setup
    this.reverbSend = new Tone.Gain(0);
    this.delaySend = new Tone.Gain(0);

    // Connect audio graph
    this.synth.connect(this.filter);
    this.filter.connect(Tone.Destination);

    // Effects sends
    this.filter.connect(this.reverbSend);
    this.filter.connect(this.delaySend);
    this.reverbSend.connect(this.reverb);
    this.delaySend.connect(this.delay);
    this.reverb.toDestination();
    this.delay.toDestination();
  }

  private getDefaultParameters(): SynthParameters {
    return {
      oscillator: {
        type: 'sine',
        detune: 0,
      },
      filter: {
        frequency: 2000,
        q: 1,
        type: 'lowpass',
      },
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0.3,
        release: 1,
      },
      effects: {
        reverb: {
          enabled: false,
          wet: 0.3,
          decay: 1.5,
        },
        delay: {
          enabled: false,
          wet: 0.3,
          time: 0.25,
          feedback: 0.5,
        },
      },
    };
  }

  updateParameters(params: Partial<SynthParameters>): void {
    this.parameters = { ...this.parameters, ...params };

    if (params.oscillator) {
      this.synth.set({
        oscillator: {
          type: params.oscillator.type,
          detune: params.oscillator.detune,
        },
      });
    }

    if (params.filter) {
      this.filter.frequency.value = params.filter.frequency;
      this.filter.Q.value = params.filter.q;
      this.filter.type = params.filter.type;
    }

    if (params.envelope) {
      this.synth.set({ envelope: params.envelope });
    }

    if (params.effects?.reverb) {
      this.reverb.decay = params.effects.reverb.decay;
      this.reverbSend.gain.value = params.effects.reverb.enabled
        ? params.effects.reverb.wet
        : 0;
    }

    if (params.effects?.delay) {
      this.delay.delayTime.value = params.effects.delay.time;
      this.delay.feedback.value = params.effects.delay.feedback;
      this.delaySend.gain.value = params.effects.delay.enabled
        ? params.effects.delay.wet
        : 0;
    }
  }

  getParameters(): SynthParameters {
    return this.parameters;
  }

  playNote(note: string, duration?: string | number, velocity: number = 0.7): void {
    const vel = Math.max(0, Math.min(1, velocity));
    this.synth.triggerAttackRelease(note, duration || '8n', undefined, vel);
  }

  playChord(notes: string[], duration?: string | number, velocity: number = 0.7): void {
    const vel = Math.max(0, Math.min(1, velocity));
    this.synth.triggerAttackRelease(notes, duration || '8n', undefined, vel);
  }

  noteOn(note: string, velocity: number = 0.7): void {
    const vel = Math.max(0, Math.min(1, velocity));
    this.synth.triggerAttack(note, undefined, vel);
  }

  noteOff(note: string): void {
    this.synth.triggerRelease(note);
  }

  releaseAll(): void {
    this.synth.releaseAll();
  }

  dispose(): void {
    this.synth.dispose();
    this.filter.dispose();
    this.reverb.dispose();
    this.delay.dispose();
    this.reverbSend.dispose();
    this.delaySend.dispose();
  }
}
