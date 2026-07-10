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
    const startFreq = 72 + tone * 150;
    const endFreq = 34 + tone * 6;
    const dur = 0.1 + extra * 0.36;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phase = 0;
    const ratio = endFreq / startFreq;
    let clickNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const freq = startFreq * Math.pow(ratio, t / dur);
      phase += freq / sampleRate;
      const bodyEnv = Math.exp(-t * (4.4 / dur));
      const body = Math.sin(2 * Math.PI * phase) * bodyEnv;
      const n = Math.random() * 2 - 1;
      clickNoise = clickNoise * 0.2 + n * 0.8;
      const clickEnv = Math.exp(-t * (90 + tone * 40));
      const click = clickNoise * clickEnv * (0.2 + tone * 0.16);
      const driven = Math.tanh((body + click) * (1.7 + extra * 0.8));
      out[i] = driven * volume * 0.85;
    }
    return out;
  }

  private static renderSnare(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const bodyStart = 220 + tone * 140;
    const bodyEnd = 140 + tone * 70;
    const snappy = 0.35 + extra * 0.65;
    const dur = 0.19;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let bodyPhase1 = 0;
    let bodyPhase2 = 0;
    let bodyPhase3 = 0;
    let prevNoise = 0;
    let lpNoise = 0;
    const sweepDur = 0.04;
    const bodySweep = bodyEnd / bodyStart;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.88 + noise * 0.12;
      const sweepPos = Math.min(t / sweepDur, 1);
      const bodyFreq = bodyStart * Math.pow(bodySweep, sweepPos);
      bodyPhase1 += bodyFreq / sampleRate;
      bodyPhase2 += (bodyFreq * 1.43) / sampleRate;
      bodyPhase3 += (bodyFreq * 2.08) / sampleRate;
      const bodyEnv = Math.exp(-t * (22 + (1 - extra) * 8));
      const body = (
        Math.sin(2 * Math.PI * bodyPhase1) * 0.55 +
        Math.sin(2 * Math.PI * bodyPhase2) * 0.32 +
        Math.sin(2 * Math.PI * bodyPhase3) * 0.2
      ) * bodyEnv * 0.22;
      const noiseEnv = Math.exp(-t * (12 + snappy * 18));
      const snap = hpNoise * (0.8 + tone * 0.35) + (noise - lpNoise) * 0.45;
      out[i] = Math.tanh((snap * noiseEnv * snappy + body) * 1.2) * volume;
    }
    return out;
  }

  private static renderOpenHH(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.2 + extra * 0.6;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let lpNoise = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0;
    const base = 3100 + tone * 3500;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.72 + noise * 0.28;
      phase1 += base / sampleRate;
      phase2 += base * 1.43 / sampleRate;
      phase3 += base * 1.91 / sampleRate;
      phase4 += base * 2.57 / sampleRate;
      const metallic = (
        Math.sin(2 * Math.PI * phase1) +
        Math.sin(2 * Math.PI * phase2) * 0.72 +
        Math.sin(2 * Math.PI * phase3) * 0.58 +
        Math.sin(2 * Math.PI * phase4) * 0.42
      ) * 0.38;
      const env = Math.exp(-t * (4.8 / dur));
      const brightness = 0.45 + tone * 0.55;
      out[i] = (metallic + (hpNoise - lpNoise) * 0.6) * env * volume * brightness;
    }
    return out;
  }

  private static renderClosedHH(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.025 + (1 - extra) * 0.12;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0;
    const base = 4200 + tone * 4200;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      phase1 += base / sampleRate;
      phase2 += base * 1.57 / sampleRate;
      phase3 += base * 2.11 / sampleRate;
      const metallic = (
        Math.sin(2 * Math.PI * phase1) +
        Math.sin(2 * Math.PI * phase2) * 0.7 +
        Math.sin(2 * Math.PI * phase3) * 0.45
      ) * 0.4;
      const env = Math.exp(-t * (11.5 / dur));
      const brightness = 0.4 + tone * 0.6;
      out[i] = (hpNoise * 0.55 + metallic) * env * volume * brightness;
    }
    return out;
  }

  private static renderRide(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const base = 420 + tone * 260;
    const dur = 0.9 + extra * 1.9;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    let lpNoise = 0;
    let prevNoise = 0;
    const bellAmt = 0.08 + tone * 0.14;
    const shimmerAmt = 0.42 + tone * 0.32;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      p1 += base / sampleRate;
      p2 += base * 1.51 / sampleRate;
      p3 += base * 2.17 / sampleRate;
      p4 += base * 2.89 / sampleRate;
      const partials = (
        Math.sin(2 * Math.PI * p1) * 0.3 +
        Math.sin(2 * Math.PI * p2) * 0.24 +
        Math.sin(2 * Math.PI * p3) * 0.2 +
        Math.sin(2 * Math.PI * p4) * 0.14
      );
      const noise = Math.random() * 2 - 1;
      lpNoise = lpNoise * 0.9 + noise * 0.1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const stickEnv = Math.exp(-t * 72);
      const bodyEnv = Math.exp(-t * (1.45 / dur));
      const tailEnv = Math.exp(-t * (0.72 / dur));
      const bell = Math.sin(2 * Math.PI * p4) * Math.exp(-t * 4.2) * bellAmt;
      const stick = hpNoise * stickEnv * (0.22 + tone * 0.16);
      const shimmer = partials * bodyEnv * shimmerAmt;
      const wash = lpNoise * tailEnv * (0.2 + extra * 0.25);
      out[i] = Math.tanh((stick + shimmer + wash + bell) * 1.08) * volume * 0.78;
    }
    return out;
  }

  private static renderCrash(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.35 + extra * 1.65;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0;
    const base = 1800 + tone * 1900;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      phase1 += base / sampleRate;
      phase2 += base * 1.49 / sampleRate;
      phase3 += base * 2.27 / sampleRate;
      phase4 += base * 3.31 / sampleRate;
      const metallic = (
        Math.sin(2 * Math.PI * phase1) * 0.26 +
        Math.sin(2 * Math.PI * phase2) * 0.24 +
        Math.sin(2 * Math.PI * phase3) * 0.2 +
        Math.sin(2 * Math.PI * phase4) * 0.17
      );
      const env = Math.exp(-t * (2.4 / dur));
      const brightness = 0.35 + tone * 0.65;
      out[i] = (hpNoise * 0.68 + metallic) * env * volume * brightness;
    }
    return out;
  }

  private static renderSnare2(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const bodyStart = 320 + tone * 180;
    const bodyEnd = 180 + tone * 80;
    const snappy = 0.45 + extra * 0.55;
    const dur = 0.14;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let bodyPhase = 0;
    let prevNoise = 0;
    const sweepDur = 0.02;
    const bodySweep = bodyEnd / bodyStart;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const sweepPos = Math.min(t / sweepDur, 1);
      const bodyFreq = bodyStart * Math.pow(bodySweep, sweepPos);
      bodyPhase += bodyFreq / sampleRate;
      const body = Math.sin(2 * Math.PI * bodyPhase) * Math.exp(-t * 30) * 0.18;
      const noiseEnv = Math.exp(-t * (14 + snappy * 16));
      out[i] = Math.tanh(((hpNoise * (0.85 + tone * 0.2) + noise * 0.2) * noiseEnv * snappy + body) * 1.2) * volume;
    }
    return out;
  }

  private static renderClap(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.17 + extra * 0.16;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let lpNoise = 0;
    const bodyFreq = 170 + tone * 130;
    const decay = 26 - extra * 10;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const hpNoise = noise - lpNoise;
      const attack = Math.min(t / 0.0018, 1);
      const env = attack * Math.exp(-t * decay);
      const body = Math.sin(2 * Math.PI * bodyFreq * t) * Math.exp(-t * 42) * 0.08;
      out[i] = Math.tanh((hpNoise * 0.95 + noise * 0.18) * env + body) * volume * 0.82;
    }
    return out;
  }
}
