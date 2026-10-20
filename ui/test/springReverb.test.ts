// The Spring (roadmap 15): played through the graph `createSpringReverb` builds, in the renderer that
// does what Chrome was seen to do with loops (`helpers/audioGraph.ts`), as the Hall is measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHallReverb, createSpringReverb } from '../src/hooks/browserAudio.ts';
import { sanitizeEffects } from '../src/services/projectSanitization.ts';
import { EFFECTS_DEFAULT } from '../src/services/effectSettings.ts';
import { GraphContext } from './helpers/audioGraph.ts';
import type { EffectsLoopState } from '../src/types.ts';

const RATE = 44100;
type Reverb = EffectsLoopState['reverb'];
const springOf = (decay: number, damping = 0): Reverb => ({ enabled: true, decay, mix: 1, kind: 'spring', damping, preDelay: 0 });

function response(make: typeof createSpringReverb | typeof createHallReverb, settings: Reverb, seconds: number, reversed = false) {
  const ctx = new GraphContext(RATE);
  const reverb = make(ctx as unknown as BaseAudioContext);
  reverb.set(settings);
  const click = new Float32Array(1); click[0] = 1;
  return ctx.render(reverb.input, reverb.output, click, Math.round(seconds * RATE), reversed);
}
const energy = (samples: Float32Array, from = 0, to = samples.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return sum;
};
const decibels = (channels: Float32Array[]) => 10 * Math.log10(energy(channels[0]) + energy(channels[1]));
// Seconds to fall 60 dB, from the slope of the energy still to come between -5 and -25 dB.
function decayTime(channels: Float32Array[]) {
  const length = channels[0].length, remaining = new Float64Array(length);
  let sum = 0;
  for (let i = length - 1; i >= 0; i--) { sum += channels[0][i] ** 2 + channels[1][i] ** 2; remaining[i] = sum; }
  const db = (i: number) => 10 * Math.log10(remaining[i] / remaining[0]);
  const at = (level: number) => { let i = 0; while (i < length - 1 && db(i) > level) i++; return i; };
  return (at(-25) - at(-5)) / RATE * 3;
}
// Where, in the first echo, a frequency is loudest: the time of its biggest 64-frame window.
function arrival(samples: Float32Array, hz: number, until: number) {
  let best = 0, when = 0;
  for (let at = 0; at + 64 < until; at += 16) {
    let re = 0, im = 0;
    for (let i = 0; i < 64; i++) { re += samples[at + i] * Math.cos(2 * Math.PI * hz * i / RATE); im += samples[at + i] * Math.sin(2 * Math.PI * hz * i / RATE); }
    if (re * re + im * im > best) { best = re * re + im * im; when = at; }
  }
  return when / RATE;
}
const brightness = (samples: Float32Array) => samples.reduce((sum, value, index) => sum + (index ? (value - samples[index - 1]) ** 2 : 0), 0) / energy(samples);

test('the Spring falls in about the time asked, and longer for a longer decay', () => {
  const times = [1, 2, 4].map(decay => decayTime(response(createSpringReverb, springOf(decay), decay * 1.6)));
  console.log('spring decays', times.map(time => time.toFixed(2)).join(' '));
  times.forEach((time, index) => {
    const asked = [1, 2, 4][index];
    assert.ok(time > asked * 0.7 && time < asked * 1.3, `${asked} s asked, ${time.toFixed(2)} s measured`);
  });
});

test('the Spring renders the same whichever order its inputs are pulled in, so an export repeats', () => {
  const ahead = response(createSpringReverb, springOf(2, 0.4), 1), behind = response(createSpringReverb, springOf(2, 0.4), 1, true);
  assert.deepEqual(ahead[0], behind[0]);
  assert.deepEqual(ahead[1], behind[1]);
});

test('the Spring is about as loud as the Hall at the same mix', () => {
  for (const decay of [1, 2, 3]) {
    const spring = decibels(response(createSpringReverb, springOf(decay), decay * 1.5));
    const hall = decibels(response(createHallReverb, { ...springOf(decay), kind: 'hall' }, decay * 1.5));
    console.log('spring level', decay, (spring - hall).toFixed(2));
    assert.ok(Math.abs(spring - hall) < 1.5, `${decay} s: the Spring ${(spring - hall).toFixed(1)} dB from the Hall`);
  }
});

test('in the Spring the highs arrive before the lows, which is the drip, and damping darkens it', () => {
  const [left] = response(createSpringReverb, springOf(2), 0.2);
  const first = Math.round(0.06 * RATE);
  assert.ok(arrival(left, 900, first) - arrival(left, 4000, first) > 0.002, `4 kHz at ${arrival(left, 4000, first)}, 900 Hz at ${arrival(left, 900, first)}`);
  // The tail, which has been round the tank's damping many times; the first echo has not.
  const tail = (damping: number) => response(createSpringReverb, springOf(2, damping), 1)[0].subarray(Math.round(0.2 * RATE));
  assert.ok(brightness(tail(1)) < brightness(tail(0)) * 0.8, `damped ${brightness(tail(1)).toFixed(4)}, open ${brightness(tail(0)).toFixed(4)}`);
});

test('a project with the Spring keeps it, and the Room is still stored as nothing', () => {
  const kept = sanitizeEffects({ ...EFFECTS_DEFAULT, reverb: { ...EFFECTS_DEFAULT.reverb, kind: 'spring' } }, EFFECTS_DEFAULT);
  assert.equal(kept.reverb.kind, 'spring');
  const room = sanitizeEffects({ ...EFFECTS_DEFAULT, reverb: { ...EFFECTS_DEFAULT.reverb, kind: 'room' } }, EFFECTS_DEFAULT);
  assert.equal('kind' in room.reverb, false);
});
