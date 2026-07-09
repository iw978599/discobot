// Discord Audio Streaming Implementation
// Modified version of engine/src/Synthesizer.ts with Discord streaming capabilities

import * as Tone from 'tone';
import { SynthParameters, OscillatorType, Pattern } from './types';

export class AudioStreamingService {
  private synth: Tone.PolySynth;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private delay: Tone.FeedbackDelay;
  private reverbSend: Tone.Gain;
  private delaySend: Tone.Gain;
  private parameters: SynthParameters;
  private audioContext: AudioContext | null = null;
  
  // Discord streaming state
  private discordConnection: any = null;
  private isStreamingToDiscord: boolean = false;
  private discordAudioNode: AudioNode | null = null;
  private streamingBuffer: AudioBuffer | null = null;
  
  // Stream queue and processing
  private audioQueue: AudioBuffer[] = [];
  private isProcessingQueue: boolean = false;
  
  // Opus encoding preparation
  private opusEncoder: any = null;
  private opusDecoder: any = null;
  
  constructor() {
    this.initializeAudioEngine();
    this.setupDiscordStreamingCapabilities();
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

    this.setupAudioGraphConnections();
    this.setupEffectsSends();
  }

  private setupAudioGraphConnections() {
    this.synth.connect(this.filter);
    this.filter.connect(Tone.Destination);
  }

  private setupEffectsSends() {
    this.filter.connect(this.reverbSend);
    this.filter.connect(this.delaySend);
    this.reverbSend.connect(this.reverb);
    this.delaySend.connect(this.delay);
    this.reverb.toDestination();
    this.delay.toDestination();
  }

  private setupDiscordStreamingCapabilities() {
    this.isStreamingToDiscord = false;
    this.discordConnection = null;
    this.discordAudioNode = null;
    this.audioQueue = [];
    this.isProcessingQueue = false;
  }

  public async startDiscordStreaming(guildId: string, channelId: string) {
    if (this.isStreamingToDiscord) {
      console.log('Already streaming to Discord voice channel');
      return;
    }

    try {
      console.log(`Starting Discord streaming for guild ${guildId}, channel ${channelId}`);
      
      // Create AudioContext for Discord audio processing
      this.audioContext = new (window as any).AudioContext || new AudioContext();
      await this.audioContext.resume();

      // Connect Tone.js output to Discord audio node
      const destination = this.audioContext.createGain();
      this.synth.output.connect(destination);
      this.discordAudioNode = destination;

      // Prepare audio buffer for streaming
      await this.prepareAudioBufferForStreaming()
        .then(buffer => {
          this.streamingBuffer = buffer;
          this.isStreamingToDiscord = true;
          console.log('Discord streaming started successfully');
        })
        .catch(error => {
          console.error('Error preparing audio buffer for Discord streaming:', error);
          throw error;
        });

    } catch (error) {
      console.error('Error starting Discord streaming:', error);
      this.cleanupDiscordStreaming();
      throw error;
    }
  }

  public stopDiscordStreaming() {
    if (!this.isStreamingToDiscord) {
      console.log('Not currently streaming to Discord voice channel');
      return;
    }

    try {
      console.log('Stopping Discord streaming');
      
      // Clean up audio context and nodes
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      if (this.discordAudioNode) {
        this.discordAudioNode.disconnect();
        this.discordAudioNode = null;
      }

      // Clean up Tone.js connections
      this.cleanupAudioConnections();

      this.isStreamingToDiscord = false;
      this.streamingBuffer = null;
      console.log('Discord streaming stopped successfully');

    } catch (error) {
      console.error('Error stopping Discord streaming:', error);
      this.cleanupDiscordStreaming();
    }
  }

  private async prepareAudioBufferForStreaming(duration: number = 2.0): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      if (!this.audioContext) {
        reject(new Error('AudioContext not initialized'));
        return;
      }

      const offlineContext = new OfflineAudioContext(
        2, // number of channels
        this.audioContext.sampleRate * duration, // length in samples
        this.audioContext.sampleRate // sample rate
      );

      // Create a new synth for offline rendering
      const offlineSynth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 8,
        oscillator: {
          type: this.parameters.oscillator.type,
        },
        envelope: this.parameters.envelope,
      });

      const offlineFilter = new Tone.Filter({
        frequency: this.parameters.filter.frequency,
        Q: this.parameters.filter.q,
        type: this.parameters.filter.type,
      });

      const offlineReverb = new Tone.Reverb({
        decay: this.parameters.effects.reverb.decay,
      });

      const offlineDelay = new Tone.FeedbackDelay({
        delayTime: this.parameters.effects.delay.time,
        feedback: this.parameters.effects.delay.feedback,
      });

      const offlineReverbSend = new Tone.Gain(this.parameters.effects.reverb.wet);
      const offlineDelaySend = new Tone.Gain(this.parameters.effects.delay.wet);

      // Setup offline audio graph
      offlineSynth.connect(offlineFilter);
      offlineFilter.connect(offlineReverbSend);
      offlineFilter.connect(offlineDelaySend);
      offlineReverbSend.connect(offlineReverb);
      offlineDelaySend.connect(offlineDelay);
      offlineReverb.connect(offlineContext.destination);
      offlineDelay.connect(offlineContext.destination);

      // Create test pattern for streaming
      const testPattern = this.createTestPatternForStreaming();
      this.triggerPattern(offlineSynth, testPattern);

      // Render the audio
      offlineContext.startRendering()
        .then(buffer => {
          console.log('Audio buffer prepared successfully for Discord streaming');
          resolve(buffer);
        })
        .catch(error => {
          console.error('Error rendering audio buffer:', error);
          reject(error);
        });
    });
  }

  private createTestPatternForStreaming(): Pattern {
    return {
      id: `discord-stream-${Date.now()}`,
      name: 'Discord Streaming Test Pattern',
      tempo: 120,
      steps: Array.from({ length: 16 }, (_, index) => {
        const note = index % 4 === 0 ? ['C4', 'E4', 'G4'][Math.floor(index / 4) % 3] || 'C4' : null;
        return {
          active: !!note,
          note: note,
          velocity: 0.7,
        };
      }),
    };
  }

  private triggerPattern(synth: Tone.PolySynth, pattern: Pattern): void {
    pattern.steps.forEach((step, index) => {
      if (step.active && step.note) {
        setTimeout(() => {
          synth.triggerAttackRelease(step.note!, '8n', undefined, step.velocity || 0.7);
        }, index * 500);
      }
    });
  }

  public async convertAudioBufferToPCM(audioBuffer: AudioBuffer): Promise<ArrayBuffer> {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    
    // Create WAV header
    const wavBuffer = new ArrayBuffer(44 + audioBuffer.length * numberOfChannels * 2);
    const view = new DataView(wavBuffer);
    
    // Write WAV header
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + audioBuffer.length * numberOfChannels * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, audioBuffer.length * numberOfChannels * 2, true);
    
    // Write audio data
    const offset = 44;
    const channelData = Array.from({ length: numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
    
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = channelData[channel][i];
        const intSample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset + (i * numberOfChannels + channel) * 2, intSample * 32767, true);
      }
    }
    
    return wavBuffer;
  }

  public async startStreamingQueue(buffers: AudioBuffer[]): Promise<void> {
    if (this.isProcessingQueue) {
      console.log('Queue already processing');
      return;
    }

    this.audioQueue = [...buffers];
    this.isProcessingQueue = true;

    console.log(`Started streaming queue with ${this.audioQueue.length} buffers`);
    await this.processStreamingQueue();
  }

  private async processStreamingQueue(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isProcessingQueue = false;
      console.log('Streaming queue completed');
      return;
    }

    const buffer = this.audioQueue.shift();
    if (!buffer) {
      this.isProcessingQueue = false;
      return;
    }

    try {
      // Convert buffer to PCM format
      const pcmData = await this.convertAudioBufferToPCM(buffer);
      
      // Queue processing happens here - would be handled by Discord bot
      console.log(`Processed audio buffer: duration=${buffer.duration}s, channels=${buffer.numberOfChannels}, samples=${buffer.length}
      
      setTimeout(() => this.processStreamingQueue(), buffer.duration * 1000);
      
    } catch (error) {
      console.error('Error processing audio buffer:', error);
      setTimeout(() => this.processStreamingQueue(), 1000);
    }
  }

  public isDiscordStreaming(): boolean {
    return this.isStreamingToDiscord;
  }

  private cleanupAudioConnections() {
    if (this.synth) {
      this.synth.disconnect();
    }
    if (this.filter) {
      this.filter.disconnect();
    }
    if (this.reverbSend) {
      this.reverbSend.disconnect();
    }
    if (this.delaySend) {
      this.delaySend.disconnect();
    }
  }

  private cleanupDiscordStreaming() {
    this.stopDiscordStreaming();
    this.setupDiscordStreamingCapabilities();
  }

  // Existing methods...
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

  public dispose(): void {
    this.cleanupAudioConnections();
    this.synth.dispose();
    this.filter.dispose();
    this.reverb.dispose();n    this.delay.dispose();
    this.reverbSend.dispose();
    this.delaySend.dispose();
  }

  public disposeSyncForDiscord() {
    this.cleanupDiscordStreaming();
    this.dispose();
  }

  public getAudioState() {
    return {
      isDiscordStreaming: this.isDiscordStreaming(),
      streamingBuffer: this.streamingBuffer,
      isProcessingQueue: this.isProcessingQueue,
      queueLength: this.audioQueue.length,
      audioContext: this.audioContext
    };
  }
}