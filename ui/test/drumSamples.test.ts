import test from 'node:test';
import assert from 'node:assert/strict';
import { DrumCore, type DrumSample } from '../../engine/src/drums/DrumCore.ts';
import { MAX_DRUM_SAMPLE_SECONDS, toDrumSample } from '../src/services/drumSamples.ts';
import { sanitizeDrums } from '../src/services/projectSanitization.ts';
import { renderDrums } from '../src/services/wavExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumSettings, DrumState } from '../src/types.ts';

const SR = 48000;
const settings = (patch: Partial<DrumSettings> = {}): DrumSettings => ({ volume: 1, tone: 0.5, extra: 0.5, tune: 0, humanize: 0, pan: 0, ...patch });
const drums = (): DrumState => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: settings(),
}])) as DrumState;
// A recording that is easy to recognise: a steady ramp from 0 up to 0.5.
const ramp = (frames: number, rate = SR): DrumSample => ({ data: Float32Array.from({ length: frames }, (_, index) => 0.5 * index / frames), rate });
function hit(core: DrumCore, patch: Partial<DrumSettings> = {}, velocity = 1, frames = 4800) {
  core.trigger({ instrument: 'snare', settings: settings(patch), velocity, kitId: 'lofi-dirty' });
  const left = new Float32Array(frames), right = new Float32Array(frames);
  core.process(left, right);
  return { left, right };
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

test('a lane with a sample plays the recording, not its synthesized voice', () => {
  const core = new DrumCore(SR);
  const built = hit(core).left.slice();
  core.stopAll();

  const sampled = new DrumCore(SR);
  sampled.setSample('snare', ramp(2400));
  const { left, right } = hit(sampled);
  // Volume 1, velocity 1, centre pan: the recording at the hit level, on both sides equally.
  const scale = 0.7 * Math.SQRT1_2;
  for (const frame of [600, 1200, 1800]) assert.ok(Math.abs(left[frame] - 0.5 * frame / 2400 * scale) < 1e-4, `frame ${frame} is the recording`);
  assert.deepEqual(left, right);
  assert.equal(rms(left.subarray(2500)), 0, 'it stops when the recording ends');
  assert.ok(Math.abs(left[2395]) < Math.abs(left[2200]), 'the very end is faded so it does not click');
  assert.notDeepEqual(left, built, 'and it is not the synthesized snare');
  assert.ok(sampled.idle, 'the voice is released');

  // The kit's lo-fi colouring is not applied to a recording: the ramp has no steps in it.
  const jumps = new Set(Array.from(left.subarray(100, 2000), (value, index) => Math.round((left[index + 101] - value) * 1e6)));
  assert.ok(jumps.size < 4, 'a smooth ramp stays smooth');

  // Other lanes are untouched, and null hands the lane back.
  sampled.setSample('snare', null);
  assert.deepEqual(hit(sampled).left, built);
});

test('volume, velocity, pan and tune apply to a sample', () => {
  const play = (patch: Partial<DrumSettings>, velocity = 1) => { const core = new DrumCore(SR); core.setSample('snare', ramp(2400)); return hit(core, patch, velocity); };
  const full = play({});
  assert.ok(Math.abs(play({ volume: 0.5 }).left[1200] / full.left[1200] - 0.5) < 1e-4);
  assert.ok(Math.abs(play({}, 0.25).left[1200] / full.left[1200] - 0.25) < 1e-4);
  const hardLeft = play({ pan: -1 });
  assert.ok(hardLeft.left[1200] > 0.1 && Math.abs(hardLeft.right[1200]) < 1e-6);
  // Tune up an octave (tune 1 is +6 semitones; two of those is not available, so compare lengths instead).
  const up = play({ tune: 1 }), down = play({ tune: -1 });
  const length = (samples: Float32Array) => samples.findLastIndex(value => value !== 0);
  assert.ok(length(up.left) < length(full.left) && length(full.left) < length(down.left), 'tuning up shortens the recording and tuning down lengthens it');
  assert.ok(Math.abs(length(up.left) / length(full.left) - 2 ** -0.5) < 0.01);
});

test('a sample recorded at another rate plays at the right speed', () => {
  const core = new DrumCore(SR);
  core.setSample('snare', ramp(2205, 22050));   // a tenth of a second at 22.05 kHz
  const { left } = hit(core, {}, 1, 9600);
  const last = left.findLastIndex(value => value !== 0);
  assert.ok(Math.abs(last - 4800) < 20, `a tenth of a second at 48 kHz is 4800 frames, got ${last}`);
});

test('an export uses the sample, repeatably, and falls back when there is none', () => {
  const state = drums();
  state.kick.steps[0] = true;
  state.snare.steps[4] = true;
  const arrangement = { tempo: 120, drumState: state, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0 };
  const plain = renderDrums(arrangement, SR, SR)[0];
  const withSample = renderDrums({ ...arrangement, drumSamples: { snare: ramp(2400) } }, SR, SR)[0];
  const step = SR * 0.125;
  assert.deepEqual(withSample.subarray(0, step * 3), plain.subarray(0, step * 3), 'the kick, which has no sample, is unchanged');
  assert.notDeepEqual(withSample.subarray(step * 4, step * 5), plain.subarray(step * 4, step * 5));
  // Take the kick's tail away to see the snare lane alone.
  const kickOnly = drums();
  kickOnly.kick.steps[0] = true;
  const kick = renderDrums({ ...arrangement, drumState: kickOnly }, SR, SR)[0];
  assert.ok(Math.abs(withSample[step * 4 + 1200] - kick[step * 4 + 1200] - 0.25 * 0.7 * Math.SQRT1_2) < 1e-4, 'the snare step plays the recording');
  assert.deepEqual(renderDrums({ ...arrangement, drumSamples: { snare: ramp(2400) } }, SR, SR)[0], withSample);
});

test('decoded files are mixed to one channel and capped in length', () => {
  const sample = toDrumSample([Float32Array.of(1, 0, 0.5), Float32Array.of(0, 1, 0.5)], 44100);
  assert.deepEqual(Array.from(sample.data), [0.5, 0.5, 0.5]);
  assert.equal(sample.rate, 44100);
  const long = toDrumSample([new Float32Array(8000 * (MAX_DRUM_SAMPLE_SECONDS + 5))], 8000);
  assert.equal(long.data.length, 8000 * MAX_DRUM_SAMPLE_SECONDS);
  assert.equal(toDrumSample([], 44100).data.length, 0);
  const core = new DrumCore(SR);
  core.setSample('snare', toDrumSample([], 44100));
  assert.ok(rms(hit(core).left) > 0.01, 'an empty sample is ignored and the built-in sound plays');
});

test('a lane\'s sample choice is kept when it is a valid id and dropped otherwise', () => {
  const id = crypto.randomUUID();
  const input = drums() as unknown as Record<string, Record<string, unknown>>;
  input.kick.sampleId = id;
  input.snare.sampleId = '../../etc/passwd';
  input.clap.sampleId = 42;
  const clean = sanitizeDrums(input, drums());
  assert.equal(clean.kick.sampleId, id);
  assert.equal('sampleId' in clean.snare, false);
  assert.equal('sampleId' in clean.clap, false);
  assert.equal('sampleId' in clean.crash, false, 'lanes without one gain nothing');
});
