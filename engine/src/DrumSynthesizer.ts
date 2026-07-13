import { DrumState, DrumInstrument, DrumKitModelVariant } from './types';
import { clamp } from './utils';

interface DrumHitRenderOptions {
  velocity?: number;
  modelVariant?: DrumKitModelVariant;
  humanize?: {
    pitch: number;
    decay: number;
    transient: number;
  };
  sampleLayer?: Float32Array;
  sampleBlend?: number;
}

interface DrumPatternRenderOptions {
  modelVariant?: DrumKitModelVariant;
  humanizeAmount?: number;
  sampleLayers?: Partial<Record<DrumInstrument, Float32Array>>;
}

interface VariantProfile {
  body: number;
  transient: number;
  noise: number;
  saturation: number;
  humanize: number;
}

const VARIANT_PROFILES: Record<DrumKitModelVariant, VariantProfile> = {
  analog: { body: 1, transient: 0.9, noise: 0.95, saturation: 1, humanize: 0.75 },
  modern: { body: 1.06, transient: 1.2, noise: 0.85, saturation: 1.12, humanize: 0.5 },
  dirty: { body: 0.9, transient: 0.8, noise: 1.25, saturation: 1.35, humanize: 1.2 },
};

const defaultHumanize = { pitch: 0, decay: 0, transient: 0 };

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function randCentered(seed: number): number {
  return pseudoRandom(seed) * 2 - 1;
}

export class DrumSynthesizer {
  static renderHit(
    instrument: DrumInstrument,
    settings: { volume: number; tone: number; extra: number },
    sampleRate: number,
    options: DrumHitRenderOptions = {}
  ): Float32Array {
    const profile = VARIANT_PROFILES[options.modelVariant || 'analog'];
    const velocity = clamp(options.velocity ?? 0.85, 0.2, 1.2);
    const humanize = options.humanize || defaultHumanize;
    const vol = Math.max(0, Math.min(1, settings.volume)) * 2 * (0.72 + velocity * 0.42);
    const tone = clamp(Math.max(0, Math.min(1, settings.tone)) + humanize.pitch * 0.18 * profile.humanize + (velocity - 0.8) * 0.12, 0, 1);
    const extra = clamp(Math.max(0, Math.min(1, settings.extra)) + humanize.decay * 0.2 * profile.humanize + (velocity - 0.8) * 0.18, 0, 1);
    const transientScale = 1 + humanize.transient * 0.35 * profile.humanize + (velocity - 0.8) * 0.5;

    let output: Float32Array;
    switch (instrument) {
      case 'kick': output = this.renderKick(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'snare': output = this.renderSnare(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'openHH': output = this.renderOpenHH(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'closedHH': output = this.renderClosedHH(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'ride': output = this.renderRide(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'crash': output = this.renderCrash(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'snare2': output = this.renderSnare2(vol, tone, extra, transientScale, sampleRate, profile); break;
      case 'clap': output = this.renderClap(vol, tone, extra, transientScale, sampleRate, profile); break;
      default: output = new Float32Array(0); break;
    }
    const polished = this.polishHit(output, profile.saturation);
    return this.mixSampleLayer(polished, options.sampleLayer, options.sampleBlend ?? 0);
  }

  static renderPattern(
    drumState: DrumState,
    tempo: number,
    sampleRate: number,
    options: DrumPatternRenderOptions = {}
  ): Float32Array {
    const beatsPerStep = 60 / tempo / 4;
    const stepDuration = beatsPerStep;
    const totalSamples = Math.floor(16 * stepDuration * sampleRate);
    const mix = new Float32Array(totalSamples);
    const modelVariant = options.modelVariant || 'analog';
    const humanizeAmount = clamp(options.humanizeAmount ?? 0.5, 0, 1);

    const instruments = Object.keys(drumState) as DrumInstrument[];
    const hasSolo = instruments.some((inst) => Boolean(drumState[inst]?.solo));
    let hitCount = 0;
    for (const inst of instruments) {
      const track = drumState[inst];
      if (!track || !track.steps || !track.settings) continue;
      if (track.muted) continue;
      if (hasSolo && !track.solo) continue;
      for (let step = 0; step < Math.min(track.steps.length, 16); step++) {
        if (track.steps[step]) {
          hitCount += 1;
          const seedBase = (hitCount + 1) * 97 + (step + 1) * 13 + inst.length * 17;
          const downbeatAccent = step % 4 === 0 ? 1 : 0.88;
          const velocity = clamp(downbeatAccent + randCentered(seedBase + 3) * 0.08, 0.3, 1.1);
          const humanize = {
            pitch: randCentered(seedBase + 11) * humanizeAmount,
            decay: randCentered(seedBase + 19) * humanizeAmount,
            transient: randCentered(seedBase + 23) * humanizeAmount,
          };
          const pcm = this.renderHit(inst, track.settings, sampleRate, {
            velocity,
            modelVariant,
            humanize,
            sampleLayer: options.sampleLayers?.[inst],
            sampleBlend: modelVariant === 'modern' ? 0.12 : modelVariant === 'dirty' ? 0.2 : 0.08,
          });
          const offset = Math.floor(step * stepDuration * sampleRate);
          for (let i = 0; i < pcm.length && offset + i < totalSamples; i++) {
            mix[offset + i] += pcm[i];
          }
        }
      }
    }

    return mix;
  }

  private static mixSampleLayer(base: Float32Array, sampleLayer: Float32Array | undefined, blend: number): Float32Array {
    if (!sampleLayer || sampleLayer.length === 0 || blend <= 0) return base;
    const mix = clamp(blend, 0, 0.4);
    const out = new Float32Array(base.length);
    for (let i = 0; i < out.length; i++) {
      const sample = sampleLayer[i % sampleLayer.length] * mix;
      out[i] = base[i] * (1 - mix) + sample;
    }
    return out;
  }

  private static renderKick(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const startFreq = 150 + tone * 75;
    const endFreq = 34 + tone * 22;
    const punch = 0.3 + extra * 0.7;
    const dur = 0.2 + extra * 0.35;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phase = 0;
    let clickFilter = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const freqSweep = Math.exp(-t * (42 + tone * 12));
      const freq = endFreq + (startFreq - endFreq) * freqSweep;
      phase += freq / sampleRate;
      const bodyEnv = Math.exp(-t * (6 + (1 - extra) * 6.5));
      const sub = Math.sin(2 * Math.PI * phase * 0.5) * Math.exp(-t * 7.4) * 0.26;
      const body = (Math.sin(2 * Math.PI * phase) * 0.9 + sub) * bodyEnv * profile.body;
      const transientEnv = Math.exp(-t * (220 + tone * 60));
      const transient = Math.sin(2 * Math.PI * phase * 3.1) * transientEnv * 0.09 * transientScale * profile.transient;
      const noise = Math.random() * 2 - 1;
      clickFilter = clickFilter * 0.18 + noise * 0.82;
      const click = clickFilter * Math.exp(-t * (210 + tone * 45)) * (0.16 + punch * 0.22) * profile.noise;
      out[i] = Math.tanh((body + transient + click) * (1.5 + punch * 0.85) * profile.saturation) * volume * 0.9;
    }
    return out;
  }

  private static renderSnare(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const bodyStart = 280 + tone * 170;
    const bodyEnd = 170 + tone * 90;
    const snap = 0.25 + extra * 0.75;
    const dur = 0.24;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let bodyPhase = 0;
    let ringPhase1 = 0;
    let ringPhase2 = 0;
    let prevNoise = 0;
    let lpNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const bodyFreq = bodyEnd + (bodyStart - bodyEnd) * Math.exp(-t * 52);
      bodyPhase += bodyFreq / sampleRate;
      ringPhase1 += (bodyFreq * 1.78) / sampleRate;
      ringPhase2 += (bodyFreq * 2.34) / sampleRate;
      const bodyEnv = Math.exp(-t * (20 + (1 - extra) * 7));
      const body = (
        Math.sin(2 * Math.PI * bodyPhase) * 0.54 +
        Math.sin(2 * Math.PI * ringPhase1) * 0.27 +
        Math.sin(2 * Math.PI * ringPhase2) * 0.15
      ) * bodyEnv * 0.3 * profile.body;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const noisyBand = hpNoise - lpNoise * (0.18 + tone * 0.5);
      const wireEnv = Math.exp(-t * (14 + snap * 20));
      const crack = hpNoise * Math.exp(-t * 280) * (0.18 + tone * 0.2) * transientScale * profile.transient;
      const wire = noisyBand * wireEnv * (0.92 + snap * 0.55) * profile.noise;
      out[i] = Math.tanh((body + wire + crack) * 1.2 * profile.saturation) * volume * 1.05;
    }
    return out;
  }

  private static polishHit(samples: Float32Array, saturation: number): Float32Array {
    const out = new Float32Array(samples.length);
    let prevInput = 0;
    let prevOutput = 0;
    for (let i = 0; i < samples.length; i++) {
      const hp = samples[i] - prevInput + 0.995 * prevOutput;
      prevInput = samples[i];
      prevOutput = hp;
      out[i] = Math.tanh((samples[i] * 0.92 + hp * 0.28) * 1.05 * saturation);
    }
    return out;
  }

  private static renderOpenHH(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const dur = 0.22 + extra * 0.85;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let hpBand = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0, phase5 = 0;
    const base = 3000 + tone * 3200;
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
      ) * 0.33 * profile.body;
      const env = Math.exp(-t * (3.2 / dur));
      const shimmerEnv = Math.exp(-t * (0.95 / dur));
      const brightness = 0.42 + tone * 0.58;
      const transient = hpNoise * Math.exp(-t * 280) * 0.12 * transientScale * profile.transient;
      const body = metallic * shimmerEnv + hpBand * 0.66 * profile.noise + transient;
      out[i] = Math.tanh(body * 1.2 * profile.saturation) * env * volume * brightness;
    }
    return out;
  }

  private static renderClosedHH(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const dur = 0.015 + (1 - extra) * 0.13;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let hpBand = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0;
    const base = 4200 + tone * 3700;
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
      ) * 0.38 * profile.body;
      const env = Math.exp(-t * (16.5 / dur));
      const brightness = 0.42 + tone * 0.58;
      const stick = hpNoise * Math.exp(-t * 380) * 0.22 * transientScale * profile.transient;
      out[i] = Math.tanh((metallic + hpBand * 0.48 * profile.noise + stick) * 1.1 * profile.saturation) * env * volume * brightness;
    }
    return out;
  }

  private static renderRide(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const startFreq = 300 + tone * 210;
    const endFreq = 170 + tone * 110;
    const bend = 0.25 + extra * 0.75;
    const dur = 0.22 + extra * 0.38;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phaseA = 0;
    let phaseB = 0;
    let noiseLp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const glide = Math.exp(-t * (44 + bend * 28));
      const freq = endFreq + (startFreq - endFreq) * glide;
      phaseA += freq / sampleRate;
      phaseB += (freq * 1.6) / sampleRate;
      const body = (
        Math.sin(2 * Math.PI * phaseA) * 0.75 +
        Math.sin(2 * Math.PI * phaseB) * 0.25
      ) * Math.exp(-t * (9.5 - extra * 2.2)) * profile.body;
      const noise = Math.random() * 2 - 1;
      noiseLp = noiseLp * 0.82 + noise * 0.18;
      const attack = (noise - noiseLp) * Math.exp(-t * 120) * (0.17 + tone * 0.15) * transientScale * profile.transient;
      out[i] = Math.tanh((body + attack) * 1.3 * profile.saturation) * volume * 0.9;
    }
    return out;
  }

  private static renderCrash(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const dur = 0.8 + extra * 2.1;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let lpNoise = 0;
    let phase1 = 0, phase2 = 0, phase3 = 0, phase4 = 0, phase5 = 0;
    const base = 1800 + tone * 2600;
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
      ) * profile.body;
      const env = Math.exp(-t * (1.45 / dur));
      const attack = Math.exp(-t * 170);
      const brightness = 0.3 + tone * 0.7;
      const burst = hpNoise * attack * (0.5 + tone * 0.24) * transientScale * profile.transient;
      const wash = (hpNoise * 0.5 + (noise - lpNoise) * 0.52 + metallic) * env * profile.noise;
      out[i] = Math.tanh((burst + wash) * 1.02 * profile.saturation) * volume * brightness;
    }
    return out;
  }

  private static renderSnare2(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const startFreq = 220 + tone * 150;
    const endFreq = 95 + tone * 80;
    const bend = 0.2 + extra * 0.8;
    const dur = 0.26 + extra * 0.34;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let phaseA = 0;
    let phaseB = 0;
    let noiseLp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const glide = Math.exp(-t * (36 + bend * 34));
      const bodyFreq = endFreq + (startFreq - endFreq) * glide;
      phaseA += bodyFreq / sampleRate;
      phaseB += (bodyFreq * 1.52) / sampleRate;
      const bodyEnv = Math.exp(-t * (8.5 - extra * 2.1));
      const body = (
        Math.sin(2 * Math.PI * phaseA) * 0.8 +
        Math.sin(2 * Math.PI * phaseB) * 0.22
      ) * bodyEnv * 0.8 * profile.body;
      const noise = Math.random() * 2 - 1;
      noiseLp = noiseLp * 0.88 + noise * 0.12;
      const beater = (noise - noiseLp) * Math.exp(-t * 140) * (0.12 + tone * 0.12) * transientScale * profile.transient;
      out[i] = Math.tanh((body + beater) * 1.18 * profile.saturation) * volume * 0.9;
    }
    return out;
  }

  private static renderClap(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile): Float32Array {
    const dur = 0.16 + extra * 0.24;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let lpNoise = 0;
    let prevNoise = 0;
    const bodyFreq = 210 + tone * 180;
    const burstSpacing = 0.009 + (1 - extra) * 0.028;
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
      const tailEnv = Math.exp(-t * (16 - extra * 5));
      const body = Math.sin(2 * Math.PI * bodyFreq * t) * Math.exp(-t * 31) * 0.11 * profile.body;
      const transient = edge * burstEnv * (0.74 + tone * 0.22) * transientScale * profile.transient;
      const clapNoise = transient + hpNoise * tailEnv * 0.42 * profile.noise;
      out[i] = Math.tanh((clapNoise + body) * 1.1 * profile.saturation) * volume * 0.86;
    }
    return out;
  }
}
