export const finiteClamp = (value: number, min: number, max: number, fallback = min): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

// A phase taken back into 0..1: the same number as phase % 1 for any phase that is not below
// -1, bit for bit (taking a whole number off leaves a fraction that is exactly representable), but
// without the remainder, which is slow and is asked for by every voice on every sample.
export const wrap = (phase: number): number => (phase >= 1 ? phase - Math.floor(phase) : phase);

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

// A four-pole ladder low-pass: four one-pole stages in a row with the last fed back to the first,
// solved without a delay in the loop so it stays in tune and stable while the cutoff moves. The
// feedback is the resonance. It is what gives a ladder its two marks: the peak takes level out of
// everything under it, so the bass thins as resonance comes up, and at full feedback it rings by
// itself. The input stage saturates, which keeps that ringing bounded and rounds a hot signal.
const LADDER_MAKEUP = 0.75;
const LADDER_BEND = 0.35;

export class Ladder {
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private s4 = 0;

  reset(): void { this.s1 = this.s2 = this.s3 = this.s4 = 0; }

  // g comes from svfCoefficient; feedback is 0 (no resonance) to 4 (rings by itself).
  tick(input: number, g: number, feedback: number): number {
    const G = g / (1 + g), G2 = G * G;
    // What the four stages would put out with no input, from what they hold now.
    const held = (1 - G) * (G2 * G * this.s1 + G2 * this.s2 + G * this.s3 + this.s4);
    // Three quarters of the level the feedback takes away is given back: a resonant sound is a little thinner in
    // the bass, as a ladder's is, without going faint. A real ladder loses far more; a lane's level stops at 200%,
    // and a sound that quiet could not be brought back up.
    // The input stage bends only what is well over a full-level signal, so the peak can stand several times
    // over the sound it is in before it is held back. Bending at full level would flatten the resonance away.
    const u = Math.tanh((input * (1 + LADDER_MAKEUP * feedback) - feedback * held) / (1 + feedback * G2 * G2) * LADDER_BEND) / LADDER_BEND;
    let v = (u - this.s1) * G; const y1 = v + this.s1; this.s1 = y1 + v;
    v = (y1 - this.s2) * G; const y2 = v + this.s2; this.s2 = y2 + v;
    v = (y2 - this.s3) * G; const y3 = v + this.s3; this.s3 = y3 + v;
    v = (y3 - this.s4) * G; const y4 = v + this.s4; this.s4 = y4 + v;
    if (!Number.isFinite(this.s1 + this.s2 + this.s3 + this.s4)) { this.reset(); return 0; }
    return y4;
  }
}

// The ladder's feedback for a resonance set as a Q, the way the other filter takes it. A ladder's
// peak stands (1 + k) / (4 - k) times over its passband for a feedback of k, and that is set
// equal to the Q, so the same setting gives much the same peak on either filter: none at a
// quarter, most of the way to ringing by ten, never quite all the way.
export function ladderFeedback(q: number): number {
  const wanted = Math.max(q, 0.1);
  return finiteClamp((4 * wanted - 1) / (wanted + 1), 0, 3.95, 0);
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

// A low-pass that keeps the lower half of what a recording can hold: a windowed sinc, its taps
// adding up to one. Used only by `halve`.
const HALF_BAND = (() => {
  const taps = new Float64Array(63), middle = (taps.length - 1) / 2;
  let sum = 0;
  for (let index = 0; index < taps.length; index += 1) {
    const x = index - middle, phase = 2 * Math.PI * index / (taps.length - 1);
    const sinc = x === 0 ? 0.42 : Math.sin(2 * Math.PI * 0.21 * x) / (Math.PI * x);
    taps[index] = sinc * (0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase));
    sum += taps[index];
  }
  return taps.map(tap => tap / sum);
})();

// A recording at half its rate: everything above a quarter of the old rate is taken out first, so
// nothing folds back, then every second sample is kept. Read at half the position, it is the same
// sound with its top octave gone.
export function halve(data: Float32Array): Float32Array {
  const out = new Float32Array(Math.ceil(data.length / 2)), middle = (HALF_BAND.length - 1) / 2, last = data.length - 1;
  for (let index = 0; index < out.length; index += 1) {
    const centre = index * 2;
    let sum = 0;
    for (let tap = 0; tap < HALF_BAND.length; tap += 1) {
      const at = centre + tap - middle;
      sum += HALF_BAND[tap] * data[at < 0 ? 0 : at > last ? last : at];
    }
    out[index] = sum;
  }
  return out;
}
