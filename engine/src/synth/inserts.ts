import { Svf, svfCoefficient } from '../dsp';

// What a lane's insert effects are told, flat like the rest of the voice's parameters. All of
// it at its neutral value (everything 0) is no insert at all.
export interface InsertSettings {
  insDrive: number;
  insTone: number;
  insChorusMix: number;
  insChorusDepth: number;
  insChorusRate: number;
  insDelayMix: number;
  insDelayTime: number;
  insDelayFeedback: number;
}

export const NO_INSERTS: InsertSettings = {
  insDrive: 0, insTone: 0, insChorusMix: 0, insChorusDepth: 0, insChorusRate: 0.6, insDelayMix: 0, insDelayTime: 0.25, insDelayFeedback: 0.3,
};

export const MAX_INSERT_DELAY = 1.5;
const CHORUS_CENTRE = 0.012;
const CHORUS_SWEEP = 0.005;

const clamp = (value: number, low: number, high: number, fallback: number) => (Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback);

export function insertsActive(p: InsertSettings): boolean {
  return p.insDrive > 0 || p.insTone !== 0 || p.insChorusMix > 0 || p.insDelayMix > 0;
}

// A lane's own effects, after its voices and before they reach the mixer: drive, a tone control
// (a low-pass below the middle, a high-pass above it), a stereo chorus and a delay, in that
// order. Live playback and export both run it inside SynthCore, so they sound the same.
export class InsertChain {
  private readonly size: number;
  private readonly bufferL: Float32Array;
  private readonly bufferR: Float32Array;
  private readonly chorusL: Float32Array;
  private readonly chorusR: Float32Array;
  private readonly smoothing: number;
  private writeDelay = 0;
  private writeChorus = 0;
  private phase = 0;
  private toneL = new Svf();
  private toneR = new Svf();
  private drive = 0;
  private tone = 0;
  private chorusMix = 0;
  private delayMix = 0;
  private delayTime = 0.25;
  private dirty = false;

  constructor(readonly sampleRate: number) {
    this.size = Math.ceil(sampleRate * (MAX_INSERT_DELAY + 0.1));
    this.bufferL = new Float32Array(this.size);
    this.bufferR = new Float32Array(this.size);
    this.chorusL = new Float32Array(Math.ceil(sampleRate * 0.05));
    this.chorusR = new Float32Array(this.chorusL.length);
    this.smoothing = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  private clear(): void {
    this.bufferL.fill(0); this.bufferR.fill(0); this.chorusL.fill(0); this.chorusR.fill(0);
    this.toneL.reset(); this.toneR.reset();
    this.drive = this.tone = this.chorusMix = this.delayMix = 0;
    this.dirty = false;
  }

  private static read(buffer: Float32Array, write: number, delay: number): number {
    const position = write - delay, base = Math.floor(position), fraction = position - base, n = buffer.length;
    const a = buffer[((base % n) + n) % n], b = buffer[(((base + 1) % n) + n) % n];
    return a + (b - a) * fraction;
  }

  process(left: Float32Array, right: Float32Array, p: InsertSettings): void {
    if (!insertsActive(p)) {
      if (this.dirty) this.clear();
      return;
    }
    this.dirty = true;
    const sr = this.sampleRate, k = this.smoothing;
    const drive = clamp(p.insDrive, 0, 1, 0), tone = clamp(p.insTone, -1, 1, 0);
    const chorusMix = clamp(p.insChorusMix, 0, 1, 0), chorusSweep = clamp(p.insChorusDepth, 0, 1, 0) * CHORUS_SWEEP;
    const chorusStep = clamp(p.insChorusRate, 0.02, 20, 0.6) / sr;
    const delayMix = clamp(p.insDelayMix, 0, 1, 0), feedback = clamp(p.insDelayFeedback, 0, 0.85, 0.3);
    const delayTime = clamp(p.insDelayTime, 0.01, MAX_INSERT_DELAY, 0.25);
    const chorusSize = this.chorusL.length;
    for (let i = 0; i < left.length; i++) {
      this.drive += (drive - this.drive) * k;
      this.tone += (tone - this.tone) * k;
      this.chorusMix += (chorusMix - this.chorusMix) * k;
      this.delayMix += (delayMix - this.delayMix) * k;
      this.delayTime += (delayTime - this.delayTime) * k * 0.1;
      let l = left[i], r = right[i];

      if (this.drive > 0.0005) {
        const gain = 1 + this.drive * 9;
        const makeup = 1 / Math.sqrt(gain);
        l = Math.tanh(l * gain) * makeup;
        r = Math.tanh(r * gain) * makeup;
      }

      if (Math.abs(this.tone) > 0.002) {
        const low = this.tone < 0;
        const cutoff = low ? 20000 * (400 / 20000) ** -this.tone : 20 * (2000 / 20) ** this.tone;
        const g = svfCoefficient(Math.min(cutoff, sr * 0.45), sr);
        this.toneL.tick(l, g, Math.SQRT2);
        this.toneR.tick(r, g, Math.SQRT2);
        l = low ? this.toneL.lp : this.toneL.hp;
        r = low ? this.toneR.lp : this.toneR.hp;
      }

      {
        this.chorusL[this.writeChorus] = l;
        this.chorusR[this.writeChorus] = r;
        const sweepL = Math.sin(2 * Math.PI * this.phase), sweepR = Math.sin(2 * Math.PI * (this.phase + 0.25));
        const wetL = InsertChain.read(this.chorusL, this.writeChorus, (CHORUS_CENTRE + sweepL * chorusSweep) * sr);
        const wetR = InsertChain.read(this.chorusR, this.writeChorus, (CHORUS_CENTRE + sweepR * chorusSweep) * sr);
        l = l * (1 - this.chorusMix) + wetL * this.chorusMix;
        r = r * (1 - this.chorusMix) + wetR * this.chorusMix;
        this.writeChorus = (this.writeChorus + 1) % chorusSize;
      }
      this.phase = (this.phase + chorusStep) % 1;

      {
        const wetL = InsertChain.read(this.bufferL, this.writeDelay, this.delayTime * sr);
        const wetR = InsertChain.read(this.bufferR, this.writeDelay, this.delayTime * sr);
        this.bufferL[this.writeDelay] = l + wetL * feedback;
        this.bufferR[this.writeDelay] = r + wetR * feedback;
        this.writeDelay = (this.writeDelay + 1) % this.size;
        l += wetL * this.delayMix;
        r += wetR * this.delayMix;
      }

      left[i] = Number.isFinite(l) ? l : 0;
      right[i] = Number.isFinite(r) ? r : 0;
    }
  }
}
