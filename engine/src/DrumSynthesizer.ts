import { DrumState, DrumInstrument, DrumKitModelVariant, DrumSettings } from './types';
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
  swing?: number;
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
    settings: DrumSettings,
    sampleRate: number,
    options: DrumHitRenderOptions = {}
  ): Float32Array {
    const profile = VARIANT_PROFILES[options.modelVariant || 'analog'];
    const velocity = clamp(options.velocity ?? 0.85, 0.2, 1.2);
    const tune = clamp(settings.tune ?? 0, -1, 1);
    const pitchMultiplier = Math.pow(2, tune * 0.5);
    const userHumanize = clamp(settings.humanize ?? 0.35, 0, 1);
    const optionHumanize = options.humanize || defaultHumanize;
    const transientSeed = Math.random() * 10_000;
    const transientHumanize = options.humanize
      ? defaultHumanize
      : {
          pitch: randCentered(transientSeed + 1) * 0.08 * userHumanize,
          decay: randCentered(transientSeed + 2) * 0.08 * userHumanize,
          transient: randCentered(transientSeed + 3) * 0.08 * userHumanize,
        };
    const humanize = {
      pitch: clamp((optionHumanize.pitch + transientHumanize.pitch) * userHumanize, -1, 1),
      decay: clamp((optionHumanize.decay + transientHumanize.decay) * userHumanize, -1, 1),
      transient: clamp((optionHumanize.transient + transientHumanize.transient) * userHumanize, -1, 1),
    };
    const vol = Math.max(0, Math.min(1, settings.volume)) * 2 * (0.72 + velocity * 0.42);
    const tone = clamp(Math.max(0, Math.min(1, settings.tone)) + humanize.pitch * 0.18 * profile.humanize + (velocity - 0.8) * 0.12, 0, 1);
    const extra = clamp(Math.max(0, Math.min(1, settings.extra)) + humanize.decay * 0.2 * profile.humanize + (velocity - 0.8) * 0.18, 0, 1);
    const transientScale = 1 + humanize.transient * 0.35 * profile.humanize + (velocity - 0.8) * 0.5;

    let output: Float32Array;
    switch (instrument) {
      case 'kick': output = this.renderKick(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
      case 'snare': output = this.renderSnare(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
      case 'openHH': output = this.renderOpenHH(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
      case 'closedHH': output = this.renderClosedHH(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
      case 'ride': output = this.renderRide(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
      case 'crash': output = (settings as { cymbalType?: string }).cymbalType === 'ride'
        ? this.renderRide(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier)
        : this.renderCrash(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier);
        break;
      case 'snare2': output = this.renderSnare2(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
      case 'clap': output = this.renderClap(vol, tone, extra, transientScale, sampleRate, profile, pitchMultiplier); break;
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
  ): { left: Float32Array; right: Float32Array } {
    const beatsPerStep = 60 / tempo / 4;
    const stepDuration = beatsPerStep;
    const totalSamples = Math.floor(16 * stepDuration * sampleRate);
    const mixL = new Float32Array(totalSamples);
    const mixR = new Float32Array(totalSamples);
    const modelVariant = options.modelVariant || 'analog';
    const humanizeAmount = clamp(options.humanizeAmount ?? 0.5, 0, 1);
    const swing = clamp(options.swing ?? 0, 0, 0.75);

    const instruments = Object.keys(drumState) as DrumInstrument[];
    const hasSolo = instruments.some((inst) => Boolean(drumState[inst]?.solo));
    let hitCount = 0;
    for (const inst of instruments) {
      const track = drumState[inst];
      if (!track || !track.steps || !track.settings) continue;
      if (track.muted) continue;
      if (hasSolo && !track.solo) continue;
      const pan = clamp(track.settings.pan ?? 0, -1, 1);
      const panAngle = (pan + 1) * Math.PI / 4;
      const panL = Math.cos(panAngle);
      const panR = Math.sin(panAngle);
      for (let step = 0; step < Math.min(track.steps.length, 16); step++) {
        if (track.steps[step]) {
          hitCount += 1;
          const seedBase = (hitCount + 1) * 97 + (step + 1) * 13 + inst.length * 17;
          const downbeatAccent = step % 4 === 0 ? 1 : 0.88;
          const explicitVelocity = track.stepVelocities?.[step];
          const velocity = explicitVelocity !== undefined
            ? clamp(explicitVelocity, 0.1, 1)
            : clamp(downbeatAccent + randCentered(seedBase + 3) * 0.08, 0.3, 1.1);
          const humanize = {
            pitch: randCentered(seedBase + 11) * humanizeAmount * clamp(track.settings.humanize ?? 0.35, 0, 1),
            decay: randCentered(seedBase + 19) * humanizeAmount * clamp(track.settings.humanize ?? 0.35, 0, 1),
            transient: randCentered(seedBase + 23) * humanizeAmount * clamp(track.settings.humanize ?? 0.35, 0, 1),
          };
          const pcm = this.renderHit(inst, track.settings, sampleRate, {
            velocity,
            modelVariant,
            humanize,
            sampleLayer: options.sampleLayers?.[inst],
            sampleBlend: modelVariant === 'modern' ? 0.12 : modelVariant === 'dirty' ? 0.2 : 0.08,
          });
          const isOddStep = step % 2 === 1;
          const swingOffset = isOddStep ? swing * stepDuration * 0.5 : 0;
          const offset = Math.floor((step * stepDuration + swingOffset) * sampleRate);
          for (let i = 0; i < pcm.length && offset + i < totalSamples; i++) {
            mixL[offset + i] += pcm[i] * panL;
            mixR[offset + i] += pcm[i] * panR;
          }
        }
      }
    }

    let maxVal = 0;
    for (let i = 0; i < mixL.length; i++) {
      const absL = Math.abs(mixL[i]);
      const absR = Math.abs(mixR[i]);
      if (absL > maxVal) maxVal = absL;
      if (absR > maxVal) maxVal = absR;
    }
    if (maxVal > 1) {
      const scale = 1 / maxVal;
      for (let i = 0; i < mixL.length; i++) {
        mixL[i] = Math.tanh(mixL[i] * scale * 1.1) / Math.tanh(1.1);
        mixR[i] = Math.tanh(mixR[i] * scale * 1.1) / Math.tanh(1.1);
      }
    }

    return { left: mixL, right: mixR };
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

  private static renderKick(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const startFreq = (150 + tone * 75) * pitchMultiplier;
    const endFreq = (34 + tone * 22) * pitchMultiplier;
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

  private static renderSnare(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const bodyStart = (150 + tone * 120) * pitchMultiplier;
    const bodyEnd = (80 + tone * 70) * pitchMultiplier;
    const subFreq = (55 + tone * 30) * pitchMultiplier;
    const snap = 0.25 + extra * 0.75;
    const dur = 0.28;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let bodyPhase = 0;
    let subPhase = 0;
    let ringPhase1 = 0;
    let ringPhase2 = 0;
    let prevNoise = 0;
    let lpNoise = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const bodyFreq = bodyEnd + (bodyStart - bodyEnd) * Math.exp(-t * 40);
      bodyPhase += bodyFreq / sampleRate;
      subPhase += subFreq / sampleRate;
      ringPhase1 += (bodyFreq * 1.78) / sampleRate;
      ringPhase2 += (bodyFreq * 2.34) / sampleRate;
      const bodyEnv = Math.exp(-t * (16 + (1 - extra) * 6));
      const subEnv = Math.exp(-t * (10 + (1 - extra) * 4));
      const body = (
        Math.sin(2 * Math.PI * bodyPhase) * 0.42 +
        Math.sin(2 * Math.PI * subPhase) * 0.28 +
        Math.sin(2 * Math.PI * ringPhase1) * 0.18 +
        Math.sin(2 * Math.PI * ringPhase2) * 0.1
      ) * bodyEnv * 0.4 * profile.body;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const noisyBand = hpNoise - lpNoise * (0.18 + tone * 0.5);
      const wireEnv = Math.exp(-t * (12 + snap * 18));
      const crack = hpNoise * Math.exp(-t * 260) * (0.18 + tone * 0.2) * transientScale * profile.transient;
      const wire = noisyBand * wireEnv * (0.92 + snap * 0.55) * profile.noise;
      out[i] = Math.tanh((body + wire + crack) * 1.2 * profile.saturation) * volume * 1.575;
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

  private static renderOpenHH(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const dur = 0.25 + extra * 0.95;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let hpBand1 = 0;
    let hpBand2 = 0;
    let lpBand = 0;
    const base = (3000 + tone * 3200) * pitchMultiplier;
    const phases = [0, 0, 0, 0, 0, 0, 0, 0];
    const ratios = [1, 1.31, 1.73, 2.37, 3.11, 3.79, 4.33, 5.17];
    const amps = [0.18, 0.15, 0.12, 0.09, 0.07, 0.05, 0.03, 0.02];
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hp1 = noise - prevNoise;
      prevNoise = noise;
      hpBand1 = hpBand1 * 0.6 + hp1 * 0.4;
      hpBand2 = hpBand2 * 0.4 + hp1 * 0.6;
      lpBand = lpBand * 0.85 + noise * 0.15;
      let metallic = 0;
      for (let p = 0; p < phases.length; p++) {
        phases[p] += (base * ratios[p]) / sampleRate;
        metallic += Math.sin(2 * Math.PI * phases[p]) * amps[p];
      }
      metallic *= 0.5 * profile.body;
      const env = Math.exp(-t * 3.5);
      const shimmerEnv = Math.exp(-t * 0.9);
      const bright = 0.42 + tone * 0.58;
      const transient = hp1 * Math.exp(-t * 280) * 0.12 * transientScale * profile.transient;
      const noiseBody = hpBand1 * 0.35 + hpBand2 * 0.25 + (noise - lpBand) * 0.2;
      const body = metallic * shimmerEnv + noiseBody * profile.noise + transient;
      out[i] = Math.tanh(body * 1.2 * profile.saturation) * env * volume * bright;
    }
    return out;
  }

  private static renderClosedHH(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const dur = 0.015 + (1 - extra) * 0.13;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let hpBand1 = 0;
    let hpBand2 = 0;
    let lpBand = 0;
    const base = (4200 + tone * 3700) * pitchMultiplier;
    const phases = [0, 0, 0, 0, 0, 0];
    const ratios = [1, 1.43, 1.97, 2.49, 3.11, 3.78];
    const amps = [0.2, 0.16, 0.12, 0.09, 0.06, 0.04];
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hp1 = noise - prevNoise;
      prevNoise = noise;
      hpBand1 = hpBand1 * 0.6 + hp1 * 0.4;
      hpBand2 = hpBand2 * 0.4 + hp1 * 0.6;
      lpBand = lpBand * 0.82 + noise * 0.18;
      let metallic = 0;
      for (let p = 0; p < phases.length; p++) {
        phases[p] += (base * ratios[p]) / sampleRate;
        metallic += Math.sin(2 * Math.PI * phases[p]) * amps[p];
      }
      metallic *= 0.55 * profile.body;
      const env = Math.exp(-t * 20);
      const bright = 0.42 + tone * 0.58;
      const stick = hp1 * Math.exp(-t * 380) * 0.22 * transientScale * profile.transient;
      const noiseBody = hpBand1 * 0.3 + hpBand2 * 0.2 + (noise - lpBand) * 0.15;
      out[i] = Math.tanh((metallic + noiseBody * profile.noise + stick) * 1.1 * profile.saturation) * env * volume * bright;
    }
    return out;
  }

  private static renderRide(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const baseFreq = (3200 + tone * 3600) * pitchMultiplier;
    const decay = 0.4 + extra * 1.2;
    const dur = 0.5 + decay;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    const phases = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ratios = [1, 1.37, 1.73, 2.09, 2.51, 2.87, 3.24, 3.68, 4.11, 4.53];
    const amps = [0.22, 0.18, 0.15, 0.12, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02];
    let prevNoise = 0;
    let hpBand1 = 0;
    let hpBand2 = 0;
    let lpBand = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let metallic = 0;
      for (let p = 0; p < phases.length; p++) {
        phases[p] += (baseFreq * ratios[p]) / sampleRate;
        metallic += Math.sin(2 * Math.PI * phases[p]) * amps[p];
      }
      const bodyEnv = Math.exp(-t * (2.2 / decay)) * profile.body;
      const noise = Math.random() * 2 - 1;
      const hp = noise - prevNoise;
      prevNoise = noise;
      hpBand1 = hpBand1 * 0.5 + hp * 0.5;
      hpBand2 = hpBand2 * 0.35 + hp * 0.65;
      lpBand = lpBand * 0.88 + noise * 0.12;
      const shimmer = hpBand1 * 0.25 + hpBand2 * 0.15 + (noise - lpBand) * 0.15;
      const shimmerEnv = Math.exp(-t * (1.5 / decay));
      const stick = hp * Math.exp(-t * 200) * (0.2 + tone * 0.15) * transientScale * profile.transient;
      const bell = Math.sin(2 * Math.PI * baseFreq * 1.73 * t) * Math.exp(-t * 22) * 0.03 * profile.body;
      const mix = metallic * bodyEnv + shimmer * shimmerEnv * profile.noise + stick + bell;
      out[i] = Math.tanh(mix * 1.2 * profile.saturation) * volume * 0.9;
    }
    return out;
  }

  private static renderCrash(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const dur = 1.2 + extra * 2.8;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let prevNoise = 0;
    let lpNoise = 0;
    let hpBand = 0;
    const base = (1800 + tone * 2600) * pitchMultiplier;
    const phases = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ratios = [1, 1.37, 1.73, 2.09, 2.51, 2.87, 3.24, 3.68, 4.11, 4.53, 5.02, 5.47];
    const amps = [0.16, 0.15, 0.14, 0.13, 0.11, 0.1, 0.08, 0.06, 0.04, 0.03, 0.02, 0.01];
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      lpNoise = lpNoise * 0.86 + noise * 0.14;
      hpBand = hpBand * 0.5 + hpNoise * 0.5;
      let metallic = 0;
      for (let p = 0; p < phases.length; p++) {
        phases[p] += (base * ratios[p]) / sampleRate;
        metallic += Math.sin(2 * Math.PI * phases[p]) * amps[p];
      }
      metallic *= profile.body;
      const env = Math.exp(-t * 1.5);
      const sustainEnv = Math.exp(-t * 0.4);
      const attack = Math.exp(-t * 170);
      const bright = 0.3 + tone * 0.7;
      const burst = hpNoise * attack * (0.5 + tone * 0.24) * transientScale * profile.transient;
      const wash = (hpBand * 0.4 + (noise - lpNoise) * 0.35 + metallic * sustainEnv) * env * profile.noise;
      out[i] = Math.tanh((burst + wash) * 1.02 * profile.saturation) * volume * bright;
    }
    return out;
  }

  private static renderSnare2(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const startFreq = (220 + tone * 150) * pitchMultiplier;
    const endFreq = (95 + tone * 80) * pitchMultiplier;
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

  private static renderClap(volume: number, tone: number, extra: number, transientScale: number, sampleRate: number, profile: VariantProfile, pitchMultiplier: number): Float32Array {
    const dur = 0.16 + extra * 0.24;
    const length = Math.floor(sampleRate * dur);
    const out = new Float32Array(length);
    let lpNoise = 0;
    let prevNoise = 0;
    const bodyFreq = (210 + tone * 180) * pitchMultiplier;
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
