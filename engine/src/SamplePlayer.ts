import { Sample } from './types';

export class SamplePlayer {
  private samples: Map<string, Sample> = new Map();

  constructor() {
  }

  async loadSample(id: string, name: string, url: string): Promise<void> {
    this.samples.set(id, {
      id,
      name,
      buffer: null,
      url,
    });
  }

  playSample(id: string, velocity: number = 1.0): void {
    const sample = this.samples.get(id);
    if (!sample) {
      throw new Error(`Sample ${id} not found`);
    }
  }

  stopSample(id: string): void {
  }

  stopAll(): void {
  }

  getSamples(): Sample[] {
    return Array.from(this.samples.values());
  }

  removeSample(id: string): void {
    this.samples.delete(id);
  }

  setEffects(reverbWet: number, delayWet: number): void {
  }

  dispose(): void {
    this.samples.clear();
  }
}
