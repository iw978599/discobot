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

export function oscillator(type: string, phase: number, step: number): number {
  if (type === 'sawtooth') return 2 * phase - 1 - polyBlep(phase, step);
  if (type === 'square') return (phase < 0.5 ? 1 : -1) + polyBlep(phase, step) - polyBlep((phase + 0.5) % 1, step);
  if (type === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
  return Math.sin(2 * Math.PI * phase);
}

export class ResonantFilter {
  private z1 = 0;
  private z2 = 0;

  process(input: number, sampleRate: number, cutoff: number, q: number, type: string): number {
    const w = 2 * Math.PI * finiteClamp(cutoff, 20, sampleRate * 0.45, 5000) / sampleRate;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = s / (2 * finiteClamp(q, 0.1, 20, 0.707));
    let b0 = (1 - c) / 2, b1 = 1 - c, b2 = b0;
    if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
    if (type === 'notch') { b0 = 1; b1 = -2 * c; b2 = 1; }
    if (type === 'allpass') { b0 = 1 - alpha; b1 = -2 * c; b2 = 1 + alpha; }
    const a0 = 1 + alpha, a1 = -2 * c / a0, a2 = (1 - alpha) / a0;
    const output = b0 / a0 * input + this.z1;
    this.z1 = b1 / a0 * input - a1 * output + this.z2;
    this.z2 = b2 / a0 * input - a2 * output;
    if (!Number.isFinite(output)) { this.z1 = 0; this.z2 = 0; return 0; }
    return output;
  }
}
