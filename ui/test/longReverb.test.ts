// A long reverb (the owner, 2026-10-20: a Room with a long Decay made everything sound like static).
// Measured on the Room's impulse, scaled the way a browser's convolver normalizes one: past the
// default decay it no longer grows louder with its length, its tail loses its highs, and at the
// default and below it is what it always was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REVERB_STEADY_DECAY, reverbAir, reverbImpulse, reverbLevel } from '../src/hooks/browserAudio.ts';
import { seededRandom } from '../src/services/drumScheduling.ts';

const RATE = 44100;
const ctx = { sampleRate: RATE, createBuffer(channels: number, length: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { length, getChannelData: (channel: number) => data[channel] };
} } as unknown as BaseAudioContext;
const energy = (samples: Float32Array) => samples.reduce((sum, value) => sum + value * value, 0);
// What steady music gets back from the Room, in decibels: the impulse's energy once the browser has
// normalized it, at the level `reverbLevel` gives it.
function loudness(decay: number, damping = 0) {
  const impulse = reverbImpulse(ctx, decay, seededRandom(3), 0, damping), left = impulse.getChannelData(0);
  const power = Math.max(0.000125, Math.sqrt(energy(left) / impulse.length));
  const scale = Math.pow(10, -58 / 20) / power * reverbLevel(decay);
  return 10 * Math.log10(energy(left) * scale * scale);
}
// How much of the late tail is hiss: energy in the change from sample to sample, against the whole.
function lateBrightness(decay: number) {
  const left = reverbImpulse(ctx, decay, seededRandom(3)).getChannelData(0), late = left.subarray(Math.floor(left.length * 0.6));
  return late.reduce((sum, value, index) => sum + (index ? (value - late[index - 1]) ** 2 : 0), 0) / energy(late);
}

test('a long Room is no louder than the default one, where before it grew about 6 dB', () => {
  const steady = loudness(REVERB_STEADY_DECAY);
  for (const decay of [3, 5, 8]) assert.ok(Math.abs(loudness(decay) - steady) < 1, `${decay}s: ${(loudness(decay) - steady).toFixed(2)} dB`);
  assert.ok(loudness(1) < steady, 'a shorter one is still quieter, as it always was');
  // What it was before: the level alone grows with the length.
  const before = (decay: number) => loudness(decay) - 20 * Math.log10(reverbLevel(decay));
  assert.ok(before(8) - before(REVERB_STEADY_DECAY) > 5);
});

test('a long Room\'s tail loses its highs even with no damping, and a short one is sample for sample as it was', () => {
  assert.ok(lateBrightness(8) < lateBrightness(REVERB_STEADY_DECAY) * 0.5, `${lateBrightness(8).toFixed(3)} against ${lateBrightness(REVERB_STEADY_DECAY).toFixed(3)}`);
  assert.equal(reverbAir(REVERB_STEADY_DECAY), 0);
  assert.equal(reverbLevel(REVERB_STEADY_DECAY), 1);
  // The plain decaying noise older projects were made with, written out as it always was.
  for (const decay of [0.5, REVERB_STEADY_DECAY]) {
    const random = seededRandom(3), tail = Math.ceil(RATE * decay);
    const was = new Float32Array(tail);
    for (let i = 0; i < tail; i++) was[i] = (random() * 2 - 1) * Math.exp(-6 * i / tail) * Math.min(1, i / 64);
    assert.deepEqual(reverbImpulse(ctx, decay, seededRandom(3)).getChannelData(0), was, `${decay}s`);
  }
  // Damping chosen by hand still wins where it is more than the air.
  assert.ok(reverbAir(8) < 1 && reverbAir(8) > 0);
});
