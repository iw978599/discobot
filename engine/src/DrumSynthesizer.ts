import { DrumState, DrumInstrument } from './types';

export class DrumSynthesizer {
  static renderHit(
    instrument: DrumInstrument,
    settings: { volume: number; tone: number; extra: number },
    sampleRate: number
  ): Float32Array {
    const vol = Math.max(0, Math.min(1, settings.volume)) * 2;
    const tone = Math.max(0, Math.min(1, settings.tone));
    const extra = Math.max(0, Math.min(1, settings.extra));

    let output: Float32Array;
    switch (instrument) {
      case 'kick': output = this.renderKick(vol, tone, extra, sampleRate); break;
      case 'snare': output = this.renderSnare(vol, tone, extra, sampleRate); break;
      case 'openHH': output = this.renderOpenHH(vol, tone, extra, sampleRate); break;
      case 'closedHH': output = this.renderClosedHH(vol, tone, extra, sampleRate); break;
      case 'ride': output = this.renderRide(vol, tone, extra, sampleRate); break;
      case 'crash': output = this.renderCrash(vol, tone, extra, sampleRate); break;
      case 'snare2': output = this.renderSnare2(vol, tone, extra, sampleRate); break;
      case 'clap': output = this.renderClap(vol, tone, extra, sampleRate); break;
      default: output = new Float32Array(0); break;
    }
    return this.polishHit(output);
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
    const hasSolo = instruments.some((inst) => {
      const track = drumState[inst];
      return Boolean(track?.solo);
    });
    for (const inst of instruments) {
      const track = drumState[inst];
      if (!track || !track.steps || !track.settings) continue;
      if (track.muted) continue;
      if (hasSolo && !track.solo) continue;
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
    const startFreq = 130 + tone * 95;
    const endFreq = 40 + tone * 14;
    const dur = 0.18 + extra * 0.32;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phase = 0;
    let clickFilter = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const freqSweep = Math.exp(-t * (38 + tone * 14));
      const freq = endFreq + (startFreq - endFreq) * freqSweep;
      phase += freq / sampleRate;
      const bodyEnv = Math.exp(-t * (6.6 + (1 - extra) * 5.2));
      const sub = Math.sin(2 * Math.PI * phase * 0.5) * Math.exp(-t * 8.5) * 0.2;
      const body = (Math.sin(2 * Math.PI * phase) + sub) * bodyEnv;

      const noise = Math.random() * 2 - 1;
      clickFilter = clickFilter * 0.12 + noise * 0.88;
      const click = clickFilter * Math.exp(-t * (160 + tone * 40)) * (0.22 + tone * 0.16);

      out[i] = Math.tanh((body + click) * (1.55 + extra * 0.7)) * volume * 0.86;
    }
    return out;
  }

  private static renderSnare(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const bodyStart = 260 + tone * 120;
    const bodyEnd = 160 + tone * 60;
    const snappy = 0.3 + extra * 0.7;
    const dur = 0.22;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let bodyPhase = 0;
    let ringPhase = 0;
    let prevNoise = 0;
    let lpNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const bodyFreq = bodyEnd + (bodyStart - bodyEnd) * Math.exp(-t * 65);
      bodyPhase += bodyFreq / sampleRate;
      ringPhase += (bodyFreq * 1.91) / sampleRate;
      const bodyEnv = Math.exp(-t * (22 + (1 - extra) * 6));
      const body = (
        Math.sin(2 * Math.PI * bodyPhase) * 0.58 +
        Math.sin(2 * Math.PI * ringPhase) * 0.28
      ) * bodyEnv * 0.26;

      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.84 + noise * 0.16;
      const bandNoise = hpNoise - lpNoise * (0.2 + tone * 0.45);
      const wireEnv = Math.exp(-t * (16 + snappy * 18));
      const crackEnv = Math.exp(-t * 260) * (0.2 + tone * 0.22);
      const crack = hpNoise * crackEnv;
      const wires = bandNoise * wireEnv * (0.9 + snappy * 0.5);

      out[i] = Math.tanh((body + wires + crack) * 1.22) * volume * 1.15;
    }
    return out;
  }

  private static polishHit(samples: Float32Array): Float32Array {
    const out = new Float32Array(samples.length);
    let prevInput = 0;
    let prevOutput = 0;
    for (let i = 0; i < samples.length; i++) {
      const hp = samples[i] - prevInput + 0.995 * prevOutput;
      prevInput = samples[i];
      prevOutput = hp;
      out[i] = Math.tanh((samples[i] * 0.92 + hp * 0.28) * 1.05);
    }
    return out;
  }

  private static renderOpenHH(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.28 + extra * 0.72;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let hpBand = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0, phase5 = 0;
    const base = 2600 + tone * 2800;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      hpBand = hpBand * 0.7 + hpNoise * 0.3;
      phase1 += base / sampleRate;
      phase2 += base * 1.31 / sampleRate;
      phase3 += base * 1.73 / sampleRate;
      phase4 += base * 2.37 / sampleRate;
      phase5 += base * 3.11 / sampleRate;
      const metallic = (
        Math.sin(2 * Math.PI * phase1) +
        Math.sin(2 * Math.PI * phase2) * 0.81 +
        Math.sin(2 * Math.PI * phase3) * 0.66 +
        Math.sin(2 * Math.PI * phase4) * 0.47 +
        Math.sin(2 * Math.PI * phase5) * 0.34
      ) * 0.33;
      const env = Math.exp(-t * (3.4 / dur));
      const shimmerEnv = Math.exp(-t * (1.25 / dur));
      const brightness = 0.48 + tone * 0.52;
      const body = metallic * shimmerEnv + hpBand * 0.58;
      out[i] = Math.tanh(body * 1.1) * env * volume * brightness;
    }
    return out;
  }

  private static renderClosedHH(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.018 + (1 - extra) * 0.14;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let hpBand = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0;
    const base = 3900 + tone * 3600;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      hpBand = hpBand * 0.65 + hpNoise * 0.35;
      phase1 += base / sampleRate;
      phase2 += base * 1.43 / sampleRate;
      phase3 += base * 1.97 / sampleRate;
      phase4 += base * 2.49 / sampleRate;
      const metallic = (
        Math.sin(2 * Math.PI * phase1) +
        Math.sin(2 * Math.PI * phase2) * 0.74 +
        Math.sin(2 * Math.PI * phase3) * 0.52 +
        Math.sin(2 * Math.PI * phase4) * 0.31
      ) * 0.38;
      const env = Math.exp(-t * (14.5 / dur));
      const brightness = 0.42 + tone * 0.58;
      const stick = hpNoise * Math.exp(-t * 320) * 0.24;
      out[i] = (metallic + hpBand * 0.45 + stick) * env * volume * brightness;
    }
    return out;
  }

  private static renderRide(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const base = 520 + tone * 380;
    const dur = 1.1 + extra * 2.1;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0;
    let lpNoise = 0;
    let prevNoise = 0;
    const bellAmt = 0.15 + tone * 0.18;
    const shimmerAmt = 0.36 + tone * 0.34;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      p1 += base / sampleRate;
      p2 += base * 1.47 / sampleRate;
      p3 += base * 2.11 / sampleRate;
      p4 += base * 2.73 / sampleRate;
      p5 += base * 3.39 / sampleRate;
      const partials = (
        Math.sin(2 * Math.PI * p1) * 0.26 +
        Math.sin(2 * Math.PI * p2) * 0.24 +
        Math.sin(2 * Math.PI * p3) * 0.2 +
        Math.sin(2 * Math.PI * p4) * 0.16 +
        Math.sin(2 * Math.PI * p5) * 0.11
      );
      const noise = Math.random() * 2 - 1;
      lpNoise = lpNoise * 0.92 + noise * 0.08;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const stickEnv = Math.exp(-t * 85);
      const bodyEnv = Math.exp(-t * (1.2 / dur));
      const tailEnv = Math.exp(-t * (0.58 / dur));
      const bell = (Math.sin(2 * Math.PI * p4) + Math.sin(2 * Math.PI * p5) * 0.5) * Math.exp(-t * 5.2) * bellAmt;
      const stick = hpNoise * stickEnv * (0.2 + tone * 0.14);
      const shimmer = partials * bodyEnv * shimmerAmt;
      const wash = lpNoise * tailEnv * (0.23 + extra * 0.26);
      out[i] = Math.tanh((stick + shimmer + wash + bell) * 1.06) * volume * 0.76;
    }
    return out;
  }

  private static renderCrash(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.5 + extra * 1.8;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let lpNoise = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0, phase5 = 0;
    const base = 1500 + tone * 2200;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.86 + noise * 0.14;
      phase1 += base / sampleRate;
      phase2 += base * 1.41 / sampleRate;
      phase3 += base * 2.03 / sampleRate;
      phase4 += base * 2.87 / sampleRate;
      phase5 += base * 3.53 / sampleRate;
      const metallic = (
        Math.sin(2 * Math.PI * phase1) * 0.24 +
        Math.sin(2 * Math.PI * phase2) * 0.23 +
        Math.sin(2 * Math.PI * phase3) * 0.21 +
        Math.sin(2 * Math.PI * phase4) * 0.16 +
        Math.sin(2 * Math.PI * phase5) * 0.11
      );
      const env = Math.exp(-t * (1.9 / dur));
      const attack = Math.exp(-t * 190);
      const brightness = 0.34 + tone * 0.66;
      const burst = hpNoise * attack * (0.55 + tone * 0.25);
      const wash = (hpNoise * 0.62 + (noise - lpNoise) * 0.4 + metallic) * env;
      out[i] = Math.tanh((burst + wash) * 0.98) * volume * brightness;
    }
    return out;
  }

  private static renderSnare2(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const bodyStart = 360 + tone * 210;
    const bodyEnd = 210 + tone * 90;
    const snappy = 0.4 + extra * 0.6;
    const dur = 0.16;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let bodyPhase1 = 0;
    let bodyPhase2 = 0;
    let prevNoise = 0;
    let lpNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const bodyFreq = bodyEnd + (bodyStart - bodyEnd) * Math.exp(-t * 90);
      bodyPhase1 += bodyFreq / sampleRate;
      bodyPhase2 += (bodyFreq * 1.65) / sampleRate;
      const bodyEnv = Math.exp(-t * (31 + (1 - extra) * 9));
      const body = (
        Math.sin(2 * Math.PI * bodyPhase1) * 0.5 +
        Math.sin(2 * Math.PI * bodyPhase2) * 0.26
      ) * bodyEnv * 0.2;

      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const air = hpNoise - lpNoise * (0.3 + tone * 0.3);
      const noiseEnv = Math.exp(-t * (18 + snappy * 15));
      out[i] = Math.tanh((air * noiseEnv * (0.95 + snappy * 0.4) + body) * 1.16) * volume;
    }
    return out;
  }

  private static renderClap(volume: number, tone: number, extra: number, sampleRate: number): Float32Array {
    const dur = 0.15 + extra * 0.22;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let lpNoise = 0;
    let prevNoise = 0;
    const bodyFreq = 190 + tone * 150;
    const burstSpacing = 0.012 + (1 - extra) * 0.03;
    const burstCount = 4;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const hpNoise = noise - lpNoise;
      const edge = hpNoise - prevNoise * 0.2;
      prevNoise = hpNoise;

      let burstEnv = 0;
      for (let b = 0; b < burstCount; b++) {
        const burstTime = b * burstSpacing;
        const dt = t - burstTime;
        if (dt >= 0) {
          burstEnv += Math.exp(-dt * (120 + b * 36));
        }
      }
      const tailEnv = Math.exp(-t * (18 - extra * 5));
      const body = Math.sin(2 * Math.PI * bodyFreq * t) * Math.exp(-t * 36) * 0.09;
      const clapNoise = edge * burstEnv * (0.75 + tone * 0.2) + hpNoise * tailEnv * 0.35;
      out[i] = Math.tanh((clapNoise + body) * 1.08) * volume * 0.84;
    }
    return out;
  }
}
