export const finiteClamp = (value: number, min: number, max: number, fallback = min): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function polyBlep(phase: number, step: number): number {
  if (phase < step) {
    const t = phase / step;
    return t + t - t * t - 1;
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step;
    return t * t + t + t + 1;
  }
  return 0;
}

// Band-limited saw and pulse; phase is 0..1 and step is the per-sample phase increment.
export function oscillator(type: string, phase: number, step: number, pulseWidth = 0.5): number {
  if (type === 'sawtooth') return 2 * phase - 1 - polyBlep(phase, step);
  if (type === 'square') {
    const falling = phase - pulseWidth;
    return (phase < pulseWidth ? 1 : -1) + polyBlep(phase, step) - polyBlep(falling < 0 ? falling + 1 : falling, step);
  }
  if (type === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
  return Math.sin(2 * Math.PI * phase);
}

export function lfoShape(type: string, phase: number): number {
  if (type === 'square') return phase < 0.5 ? 1 : -1;
  if (type === 'sawtooth') return 2 * phase - 1;
  if (type === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
  return Math.sin(2 * Math.PI * phase);
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteFrequency(note: unknown): number | null {
  if (typeof note !== 'string') return null;
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  if (!match) return null;
  const midi = (Number(match[3]) + 1) * 12 + SEMITONES[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return midi >= 0 && midi <= 127 ? 440 * 2 ** ((midi - 69) / 12) : null;
}

// Seeded noise, so the same arrangement always renders the same audio.
export class Noise {
  private state: number;
  constructor(seed = 0x2545f491) { this.state = (seed >>> 0) || 1; }
  next(): number {
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 2147483648 - 1;
  }
}

// Per-sample coefficient for a one-pole approach that covers `ratio` of the distance in `seconds`.
export function approachCoefficient(seconds: number, sampleRate: number, timeConstants: number): number {
  return 1 - Math.exp(-timeConstants / (Math.max(0.0005, seconds) * sampleRate));
}

export function svfCoefficient(cutoff: number, sampleRate: number): number {
  return Math.tan(Math.PI * finiteClamp(cutoff, 16, sampleRate * 0.45, 1000) / sampleRate);
}

// Zero-delay-feedback state-variable filter: stable under fast cutoff modulation and high resonance.
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  lp = 0;
  bp = 0;
  hp = 0;

  reset(): void { this.ic1 = this.ic2 = this.lp = this.bp = this.hp = 0; }

  // g comes from svfCoefficient, k is 1/Q.
  tick(input: number, g: number, k: number): void {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const v3 = input - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + g * a2 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (!Number.isFinite(this.ic1) || !Number.isFinite(this.ic2)) { this.reset(); return; }
    this.lp = v2;
    this.bp = v1;
    this.hp = input - k * v1 - v2;
  }

  output(type: string, input: number, k: number): number {
    if (type === 'highpass') return this.hp;
    if (type === 'bandpass') return this.bp * k;
    if (type === 'notch') return input - k * this.bp;
    if (type === 'allpass') return input - 2 * k * this.bp;
    return this.lp;
  }
}

export type EnvelopeStage = 'off' | 'attack' | 'decay' | 'sustain' | 'release';

// Exponential ADSR: segments approach their target the way an analog envelope does.
export class Adsr {
  level = 0;
  stage: EnvelopeStage = 'off';

  gateOn(): void { this.stage = 'attack'; }
  gateOff(): void { if (this.stage !== 'off') this.stage = 'release'; }
  reset(): void { this.level = 0; this.stage = 'off'; }

  tick(attack: number, decay: number, sustain: number, release: number): number {
    if (this.stage === 'attack') {
      this.level += (1.3 - this.level) * attack;
      if (this.level >= 1) { this.level = 1; this.stage = 'decay'; }
    } else if (this.stage === 'decay') {
      this.level += (sustain - this.level) * decay;
      if (Math.abs(this.level - sustain) < 0.0005) this.stage = 'sustain';
    } else if (this.stage === 'sustain') {
      this.level += (sustain - this.level) * decay;
    } else if (this.stage === 'release') {
      this.level -= this.level * release;
      if (this.level < 0.001) { this.level = 0; this.stage = 'off'; }
    }
    return this.level;
  }
}
