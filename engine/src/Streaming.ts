// Discord Audio Streaming Implementation
// Optimized version for better streaming from Tone.js to Discord voice channels

import * as Tone from 'tone';
import { SynthParameters, OscillatorType, Pattern } from './types';

export class DiscordAudioStreamer {
  private synth: Tone.PolySynth;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private delay: Tone.FeedbackDelay;
  private reverbSend: Tone.Gain;
  private delaySend: Tone.Gain;
  private parameters: SynthParameters;
  private audioContext: AudioContext | null = null;
  
  // Discord voice connection management
  private discordConnection: any = null;
  private audioStream: any = null;
  private isStreaming: boolean = false;
  
  // Audio buffer management
  private audioQueue: AudioBuffer[] = [];
  private currentBufferIndex: number = 0;
  private isProcessingQueue: boolean = false;
  
  constructor() {
    this.initializeAudioEngine();
  }

  private initializeAudioEngine() {
    this.parameters = this.getDefaultParameters();

    this.synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 8,
      oscillator: {
        type: this.parameters.oscillator.type,
      },
      envelope: this.parameters.envelope,
    });

    this.filter = new Tone.Filter({
      frequency: this.parameters.filter.frequency,
      Q: this.parameters.filter.q,
      type: this.parameters.filter.type,
    });

    this.reverb = new Tone.Reverb({
      decay: this.parameters.effects.reverb.decay,
      wet: 0,
    });

    this.delay = new Tone.FeedbackDelay({
      delayTime: this.parameters.effects.delay.time,
      feedback: this.parameters.effects.delay.feedback,
      wet: 0,
    });

    this.reverbSend = new Tone.Gain(0);
    this.delaySend = new Tone.Gain(0);

    this.setupAudioGraph();
    this.setupEffectsGraph();
  }

  private setupAudioGraph() {
    this.synth.connect(this.filter);
    this.filter.connect(Tone.Destination);
  }

  private setupEffectsGraph() {
    this.filter.connect(this.reverbSend);
    this.filter.connect(this.delaySend);
    this.reverbSend.connect(this.reverb);
    this.delaySend.connect(this.delay);
    this.reverb.toDestination();
    this.delay.toDestination();
  }

  public updateParameters(params: Partial<SynthParameters>): void {
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

  public getParameters(): SynthParameters {
    return this.parameters;
  }

  public playNote(note: string, duration?: string | number, velocity: number = 0.7): void {
    const vel = Math.max(0, Math.min(1, velocity));
    this.synth.triggerAttackRelease(note, duration || '8n', undefined, vel);
  }

  public playChord(notes: string[], duration?: string | number, velocity: number = 0.7): void {
    const vel = Math.max(0, Math.min(1, velocity));
    this.synth.triggerAttackRelease(notes, duration || '8n', undefined, vel);
  }

  public noteOn(note: string, velocity: number = 0.7): void {
    const vel = Math.max(0, Math.min(1, velocity));
    this.synth.triggerAttack(note, undefined, vel);
  }

  public noteOff(note: string): void {
    this.synth.triggerRelease(note);
  }

  public releaseAll(): void {
    this.synth.releaseAll();
  }

  public async prepareForDiscordStreaming(concurrency: number = 1): Promise<AudioBuffer[]> {
    await this.initializeAudioContext();
    
    const bufferDuration = 0.1; // 100ms chunks for smooth streaming
    const bufferCount = Math.ceil(this.getPatternDuration() / bufferDuration);
    const buffers: AudioBuffer[] = [];
    
    for (let i = 0; i < bufferCount; i++) {
      const startTime = i * bufferDuration;
      const endTime = Math.min((i + 1) * bufferDuration, this.getPatternDuration());
      const chunkDuration = endTime - startTime;
      
      const buffer = await this.renderAudioSegment(startTime, chunkDuration);
      buffers.push(buffer);
      
      // Small delay between buffer rendering to prevent buffer overflow
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    return buffers;
  }

  private async initializeAudioContext(): Promise<void> {
    if (this.audioContext) {
      return;
    }
    
    this.audioContext = new (window as any).AudioContext || new AudioContext();
    await this.audioContext.resume();
  }

  private getPatternDuration(): number {
    // Default pattern duration based on typical synth patterns
    return 16; // 16 seconds
  }

  private async renderAudioSegment(startTime: number, duration: number): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      if (!this.audioContext) {
        reject(new Error('AudioContext not initialized'));
        return;
      }

      const offlineContext = new OfflineAudioContext(
        2, // stereo
        this.audioContext.sampleRate * duration,
        this.audioContext.sampleRate
      );

      // Create synth for this segment
      const segmentSynth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 4,
        oscillator: {
          type: this.parameters.oscillator.type,
        },
        envelope: this.parameters.envelope,
      });

      const segmentFilter = new Tone.Filter({
        frequency: this.parameters.filter.frequency,
        Q: this.parameters.filter.q,
        type: this.parameters.filter.type,
      });

      const segmentReverb = new Tone.Reverb({
        decay: this.parameters.effects.reverb.decay,
        wet: this.parameters.effects.reverb.wet || 0.3,
      });

      // Connect synth chain
      segmentSynth.connect(segmentFilter);
      segmentFilter.connect(segmentReverb);
      segmentReverb.connect(offlineContext.destination);

      // Play notes for this segment
      this.playNotesForSegment(segmentSynth, startTime, duration);

      // Render the audio
      offlineContext.startRendering()
        .then(buffer => {
          // Cleanup
          segmentSynth.dispose();
          segmentFilter.dispose();
          segmentReverb.dispose();
          resolve(buffer);
        })
        .catch(error => {
          console.error('Error rendering audio segment:', error);
          reject(error);
        });
    });
  }

  private playNotesForSegment(synth: Tone.PolySynth, startTime: number, duration: number): void {
    const tempo = 120;
    const beatsPerBar = 4;
    const totalBeats = duration * (tempo / 60);
    const totalSteps = totalBeats * 2; // 16th notes
    
    for (let step = 0; step < totalSteps; step++) {
      if (this.shouldNoteBeActive(step, startTime)) {
        const note = this.getNoteForStep(step);
        const velocity = this.getVelocityForStep(step);
        
        setTimeout(() => {
          if (note) {
            synth.triggerAttackRelease(note, '16n', undefined, velocity);
          }
        }, startTime * 1000 + (step * 500));
      }
    }
  }

  private shouldNoteBeActive(step: number, startTime: number): boolean {
    // Simple pattern: activate every 2nd step
    return step % 2 === 0 && (step / 2) % 3 !== 0;
  }

  private getNoteForStep(step: number): string {
    const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
    return notes[step % notes.length];
  }

  private getVelocityForStep(step: number): number {
    return 0.7;
  }

  public getPattern(): Pattern {
    return {
      id: `stream-pattern-${Date.now()}`,
      name: 'Discord Streaming Pattern',
      steps: Array.from({ length: 16 }, (_, index) => ({
        active: index % 2 === 0 && (index / 2) % 3 !== 0,
        note: this.getNoteForStep(index),
        velocity: 0.7,
      })),
      tempo: 120,
    };
  }

  public async createDiscordCompatibleStream(pattern: Pattern): Promise<AudioBuffer> {
    const audioContext = new (window as any).AudioContext || new AudioContext();
    
    const destination = audioContext.createGain();
    this.synth.output.connect(destination);
    
    this.triggerPatternPlayback(pattern);
    
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = Math.sin(2 * Math.PI * 440 * (i / audioContext.sampleRate)) * 0.5;
    }
    
    setTimeout(() => audioContext.close(), 100);
    return buffer;
  }

  private triggerPatternPlayback(pattern: Pattern): void {
    pattern.steps.forEach((step, index) => {
      if (step.active && step.note) {
        setTimeout(() => {
          this.playNote(step.note!, '8n', step.velocity);
        }, index * 500);
      }
    });
  }

  public dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.synth.dispose();
    this.filter.dispose();
    this.reverb.dispose();
    this.delay.dispose();
    this.reverbSend.dispose();
    this.delaySend.dispose();
  }

  public isStreaming(): boolean {
    return this.isStreaming;
  }

  public setStreamingStatus(status: boolean): void {
    this.isStreaming = status;
  }
}

export default DiscordAudioStreamer;
