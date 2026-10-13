// What can be said about a preset without ears: how loud it gets, whether it clips, how bright
// it is, how fast it speaks and how long it rings after the key is let go. It renders the
// preset through the same SynthCore the app plays, on notes of the kind it is meant for.
import { readFileSync } from 'node:fs';
import { SynthCore, toVoiceParams } from '@discobot/engine';
import { parseWaveBundle } from '../../src/services/builtInWaves.ts';
import type { SynthParameters } from '../../src/types.ts';
import type { PresetKind } from '../../src/services/presetKinds.ts';

export const AUDIT_RATE = 48000;

// What each kind is played with: a bass and a lead one note at a time, a pad and keys as a chord.
export const AUDIT_NOTES: Record<PresetKind, string[]> = {
  bass: ['C2'],
  lead: ['C4'],
  pad: ['C3', 'E3', 'G3'],
  keys: ['C3', 'E3', 'G3'],
  pluck: ['C4'],
  effects: ['C3'],
};

export interface PresetMeasure {
  // the largest sample, 0 to 1; the core's own limiter bends anything near 1
  peak: number;
  // the loudest tenth of a second, in dB below full scale
  loudness: number;
  // where the weight of the spectrum lies at its loudest, in Hz
  brightness: number;
  // seconds from the key going down to half the level it holds at (or half its loudest, for a
  // sound that dies away while the key is down)
  attack: number;
  // seconds from the key coming up until it is 60 dB under its loudest, or `ringLimit` if it never is
  ring: number;
  finite: boolean;
}

// The app's own waves, read from the file the build ships, so a preset made of one is measured with it.
const bundle = readFileSync(new URL('../../public/waves.bin', import.meta.url));
export const BUNDLED_WAVES = parseWaveBundle(bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength) as ArrayBuffer);

const HOLD = 1.5;
export const RING_LIMIT = 12;
const WINDOW = 4800;

function spectrumCentroid(samples: Float32Array, at: number): number {
  const size = 4096, start = Math.max(0, Math.min(samples.length - size, at));
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = (samples[start + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let i = 0; i < size; i += length) {
      for (let k = 0; k < length / 2; k++) {
        const wr = Math.cos(angle * k), wi = Math.sin(angle * k);
        const a = i + k, b = a + length / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  let weighted = 0, total = 0;
  for (let bin = 1; bin < size / 2; bin++) {
    const power = re[bin] * re[bin] + im[bin] * im[bin];
    weighted += power * bin * AUDIT_RATE / size;
    total += power;
  }
  return total > 0 ? weighted / total : 0;
}

export interface PresetMotion {
  // how far the level moves while the key is held, once the note has spoken: its loudest tenth
  // of a second over its quietest, in dB
  swing: number;
  // how much of the sound is the difference between the two sides, against what they share:
  // 0 is the same on both, and it rises as the sound is spread or moves from side to side
  width: number;
}

// What a held sound does over eight seconds, long enough for a slow LFO to come round once.
export function measureMotion(params: SynthParameters, kind: PresetKind, notes = AUDIT_NOTES[kind]): PresetMotion {
  const core = new SynthCore(AUDIT_RATE);
  core.setParams(toVoiceParams(params));
  if (params.sample?.wave) core.setSample(BUNDLED_WAVES.get(params.sample.wave) ?? null);
  for (const note of notes) core.noteOn({ note, velocity: 0.9 });
  const total = 8 * AUDIT_RATE, from = 1.5 * AUDIT_RATE;
  const left = new Float32Array(128), right = new Float32Array(128);
  const levels: number[] = [];
  let shared = 0, apart = 0, sum = 0, count = 0;
  for (let at = 0; at + 128 <= total; at += 128) {
    core.process(left, right);
    for (let i = 0; i < 128; i++) {
      const mid = (left[i] + right[i]) / 2, side = (left[i] - right[i]) / 2;
      shared += mid * mid; apart += side * side;
      if (at < from) continue;
      sum += mid * mid;
      if (++count === WINDOW) { levels.push(Math.sqrt(sum / WINDOW)); sum = 0; count = 0; }
    }
  }
  const loudest = Math.max(...levels), quietest = Math.max(1e-9, Math.min(...levels));
  return { swing: loudest > 1e-6 ? 20 * Math.log10(loudest / quietest) : 0, width: shared > 0 ? Math.sqrt(apart / shared) : 0 };
}

export function measurePreset(params: SynthParameters, kind: PresetKind, notes = AUDIT_NOTES[kind]): PresetMeasure {
  const core = new SynthCore(AUDIT_RATE);
  core.setParams(toVoiceParams(params));
  if (params.sample?.wave) core.setSample(BUNDLED_WAVES.get(params.sample.wave) ?? null);
  for (const note of notes) core.noteOn({ note, velocity: 0.9 });
  const held = Math.round(HOLD * AUDIT_RATE), total = held + RING_LIMIT * AUDIT_RATE;
  const mono = new Float32Array(total);
  const left = new Float32Array(128), right = new Float32Array(128);
  let finite = true, released = false, end = total;
  for (let at = 0; at < total; at += 128) {
    if (!released && at >= held) { for (const note of notes) core.noteOff(note); released = true; }
    core.process(left, right);
    for (let i = 0; i < 128 && at + i < total; i++) {
      const value = (left[i] + right[i]) * Math.SQRT1_2;
      if (!Number.isFinite(value)) finite = false;
      mono[at + i] = value;
    }
    if (released && core.idle) { end = Math.min(total, at + 128); break; }
  }

  let peak = 0;
  for (let i = 0; i < end; i++) peak = Math.max(peak, Math.abs(mono[i]));
  // Short-term level in tenths of a second, hopping by half of one.
  const levels: number[] = [];
  for (let start = 0; start + WINDOW <= end; start += WINDOW / 2) {
    let sum = 0;
    for (let i = start; i < start + WINDOW; i++) sum += mono[i] * mono[i];
    levels.push(Math.sqrt(sum / WINDOW));
  }
  const loudest = Math.max(1e-9, ...levels);
  const loudestAt = levels.indexOf(Math.max(...levels)) * WINDOW / 2;
  // Attack: the first moment a 5 ms level reaches half the level the sound holds at. Stacked,
  // detuned copies beat, and their loudest moment can come long after the note has spoken, so
  // the level in the middle of the held time is the measure; a sound that has died away by then
  // is measured against its loudest.
  const whileHeld = levels.slice(0, Math.floor((held - WINDOW) / (WINDOW / 2)) + 1).sort((a, b) => a - b);
  const middle = whileHeld[Math.floor(whileHeld.length / 2)] ?? loudest;
  const reference = middle >= loudest * 0.25 ? middle : loudest;
  let attack = HOLD;
  const short = 240;
  for (let start = 0; start + short <= held; start += short / 2) {
    let sum = 0;
    for (let i = start; i < start + short; i++) sum += mono[i] * mono[i];
    if (Math.sqrt(sum / short) >= reference * 0.5) { attack = start / AUDIT_RATE; break; }
  }
  let ring = RING_LIMIT;
  const floor = loudest * 0.001;
  for (let index = levels.length - 1; index >= 0; index--) {
    if (levels[index] > floor) { ring = Math.max(0, (index * WINDOW / 2 + WINDOW - held) / AUDIT_RATE); break; }
  }
  if (end < total) ring = Math.min(ring, (end - held) / AUDIT_RATE);
  return {
    peak, loudness: 20 * Math.log10(loudest), brightness: spectrumCentroid(mono, loudestAt), attack, ring, finite,
  };
}
