import * as Tone from 'tone';
import { Sample } from './types';

export class SamplePlayer {
  private players: Map<string, Tone.Player> = new Map();
  private samples: Map<string, Sample> = new Map();
  private reverb: Tone.Reverb;
  private delay: Tone.FeedbackDelay;
  private reverbSend: Tone.Gain;
  private delaySend: Tone.Gain;

  constructor() {
    // Create effects (shared with synth if desired)
    this.reverb = new Tone.Reverb({ decay: 1.5 });
    this.delay = new Tone.FeedbackDelay({
      delayTime: 0.25,
      feedback: 0.5,
    });

    this.reverbSend = new Tone.Gain(0);
    this.delaySend = new Tone.Gain(0);

    this.reverbSend.connect(this.reverb);
    this.delaySend.connect(this.delay);
    this.reverb.toDestination();
    this.delay.toDestination();
  }

  async loadSample(id: string, name: string, url: string): Promise<void> {
    try {
      const player = new Tone.Player(url);
      await Tone.loaded();

      player.connect(Tone.Destination);
      player.connect(this.reverbSend);
      player.connect(this.delaySend);

      this.players.set(id, player);
      this.samples.set(id, {
        id,
        name,
        buffer: null,
        url,
      });
    } catch (error) {
      throw new Error(`Failed to load sample: ${error}`);
    }
  }

  playSample(id: string, velocity: number = 1.0): void {
    const player = this.players.get(id);
    if (!player) {
      throw new Error(`Sample ${id} not found`);
    }

    player.volume.value = Tone.gainToDb(velocity);
    player.start();
  }

  stopSample(id: string): void {
    const player = this.players.get(id);
    if (player) {
      player.stop();
    }
  }

  stopAll(): void {
    this.players.forEach((player) => player.stop());
  }

  getSamples(): Sample[] {
    return Array.from(this.samples.values());
  }

  removeSample(id: string): void {
    const player = this.players.get(id);
    if (player) {
      player.dispose();
      this.players.delete(id);
    }
    this.samples.delete(id);
  }

  setEffects(reverbWet: number, delayWet: number): void {
    this.reverbSend.gain.value = reverbWet;
    this.delaySend.gain.value = delayWet;
  }

  dispose(): void {
    this.players.forEach((player) => player.dispose());
    this.players.clear();
    this.samples.clear();
    this.reverb.dispose();
    this.delay.dispose();
    this.reverbSend.dispose();
    this.delaySend.dispose();
  }
}
