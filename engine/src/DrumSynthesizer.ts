import { DrumState, DrumInstrument } from './types';

export class DrumSynthesizer {
  static renderHit(
    instrument: DrumInstrument,
    settings: { volume: number; tone: number; extra: number },
    sampleRate: number
  ): Float32Array {
    const vol = Math.max(0, Math.min(1, settings.volume));
    const tone = Math.max(0, Math.min(1, settings.tone));
    const extra = Math.max(0, Math.min(1, settings.extra));

    switch (instrument) {
      case 'kick': return this.renderKick(vol, tone, extra, sampleRate);
      case 'snare': return this.renderSnare(vol, tone, extra, sampleRate);
      case 'openHH': return this.renderOpenHH(vol, tone, extra, sampleRate);
      case 'closedHH': return this.renderClosedHH(vol, tone, extra, sampleRate);
      case 'ride': return this.renderRide(vol, tone, extra, sampleRate);
      case 'crash': return this.renderCrash(vol, tone, extra, sampleRate);
      case 'snare2': return this.renderSnare2(vol, tone, extra, sampleRate);
      case 'clap': return this.renderClap(vol, tone, extra, sampleRate);
    }
  }

  static renderPattern(
    drumState: DrumState,
    tempo: number,
    sampleRate: number
  ): Float32Array {
    const beatsPerStep = 60 / tempo / 4;
    const stepDuration = beatsPerStep;
    const totalSamples = Math.floor(16 * stepDuration * sampleRate);
    const mix = new Float32Array(totalSamples);

    const instruments = Object.keys(drumState) as DrumInstrument[];
    for (const inst of instruments) {
      const track = drumState[inst];
      if (!track || !track.steps || !track.settings) continue;
      for (let step = 0; step < Math.min(track.steps.length, 16); step++) {
        if (track.steps[step]) {
          const pcm = this.renderHit(inst, track.settings, sampleRate);
          const offset = Math.floor(step * stepDuration * sampleRate);
          for (let i = 0; i < pcm.length && offset + i < totalSamples; i++) {
            mix[offset + i] += pcm[i];
          }
        }
      }
    }

    return mix;
  }

  private static renderKick(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const startFreq = 60 + tone * 180;
    const endFreq = 30;
    const dur = 0.08 + extra * 0.42;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phase = 0;
    const ratio = endFreq / startFreq;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const freq = startFreq * Math.pow(ratio, t / dur);
      phase += freq / sampleRate;
      const env = Math.exp(-t * 4 / dur);
      out[i] = Math.sin(2 * Math.PI * phase) * env * volume;
    }
    return out;
  }

  private static renderSnare(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const bodyFreq = 150 + tone * 150;
    const snappy = extra;
    const dur = 0.12;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      phase += bodyFreq / sampleRate;
      const body = Math.sin(2 * Math.PI * phase);
      const noise = Math.random() * 2 - 1;
      const nd = Math.exp(-t * (5 + snappy * 20));
      const bd = Math.exp(-t * 8);
      out[i] = (body * bd * 0.4 + noise * nd * snappy) * volume;
    }
    return out;
  }

  private static renderOpenHH(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.05 + extra * 0.45;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const env = Math.exp(-t * 5 / dur);
      const brightness = 0.3 + tone * 0.7;
      out[i] = hpNoise * env * volume * brightness * 1.5;
    }
    return out;
  }

  private static renderClosedHH(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.015 + (1 - extra) * 0.085;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const env = Math.exp(-t * 12 / dur);
      const brightness = 0.4 + tone * 0.6;
      out[i] = hpNoise * env * volume * brightness * 1.5;
    }
    return out;
  }

  private static renderRide(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const fund = 800 + tone * 3200;
    const brightness = extra;
    const dur = 0.2;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let p = 0, p3 = 0, p5 = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      p += fund / sampleRate;
      p3 += fund * 2.76 / sampleRate;
      p5 += fund * 4.51 / sampleRate;
      const a1 = Math.sin(2 * Math.PI * p);
      const a2 = Math.sin(2 * Math.PI * p3) * 0.5 * brightness;
      const a3 = Math.sin(2 * Math.PI * p5) * 0.25 * brightness * brightness;
      const env = Math.exp(-t * 6);
      out[i] = (a1 + a2 + a3) * env * volume * 0.6;
    }
    return out;
  }

  private static renderCrash(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.2 + extra * 1.0;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const env = Math.exp(-t * 3 / dur);
      const brightness = 0.2 + tone * 0.8;
      out[i] = hpNoise * env * volume * brightness;
    }
    return out;
  }

  private static renderSnare2(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const bodyFreq = 200 + tone * 200;
    const snappy = extra;
    const dur = 0.12;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      phase += bodyFreq / sampleRate;
      const body = Math.sin(2 * Math.PI * phase);
      const noise = Math.random() * 2 - 1;
      const nd = Math.exp(-t * (5 + snappy * 20));
      const bd = Math.exp(-t * 8);
      out[i] = (body * bd * 0.35 + noise * nd * snappy) * volume;
    }
    return out;
  }

  private static renderClap(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.25;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    const roomSamples = Math.floor((10 + extra * 80) * sampleRate / 1000);
    const numLayers = 5;
    for (let layer = 0; layer < numLayers; layer++) {
      const delay = layer * roomSamples;
      for (let i = delay; i < length; i++) {
        const t = (i - delay) / sampleRate;
        const noise = Math.random() * 2 - 1;
        const env = Math.exp(-t * 25);
        out[i] += noise * env * (1 / numLayers);
      }
    }
    for (let i = 0; i < length; i++) {
      out[i] *= volume * 0.8;
    }
    return out;
  }
}
