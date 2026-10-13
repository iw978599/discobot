import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams, type SynthSample } from '@discobot/engine';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { usedSampleIds } from '../src/services/projectSamples.ts';
import { renderSynthBars } from '../src/services/wavExport.ts';
import type { SequencerStep, SynthParameters } from '../src/types.ts';

const SR = 48000;
// A recording of a sine at A4, made at another rate than the one it is played back at.
const recording = (seconds = 2, hz = 440, rate = 44100): SynthSample =>
  ({ data: Float32Array.from({ length: Math.round(rate * seconds) }, (_, index) => 0.8 * Math.sin(2 * Math.PI * hz * index / rate)), rate });
const sampled = (extra: Partial<NonNullable<SynthParameters['sample']>> = {}): Partial<SynthParameters> =>
  ({ engine: 'sample', sample: { root: 69, loop: false, ...extra } });

function core(patch: Partial<SynthParameters>, sample?: SynthSample | null): SynthCore {
  const made = new SynthCore(SR);
  made.setParams(toVoiceParams({ ...createDefaultSynthParameters(), envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.05 }, ...patch }));
  if (sample !== undefined) made.setSample(sample);
  return made;
}
function play(patch: Partial<SynthParameters>, sample?: SynthSample | null, note = 'A4', seconds = 1): Float32Array {
  const made = core(patch, sample);
  made.noteOn({ note, velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  made.process(left, right);
  return left;
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((value, index) => value === b[index]);
function level(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SR);
  let s1 = 0, s2 = 0;
  for (const value of samples) { const s0 = value + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return 20 * Math.log10(Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / samples.length);
}
const loudness = (samples: Float32Array) => {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return 10 * Math.log10(Math.max(1e-30, sum / samples.length));
};
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('a sound saved before the sample engine existed plays exactly as it did, and a stored sample is checked', () => {
  const saw = { oscillator: { type: 'sawtooth' as const, detune: 0, pulseWidth: 0.5 } };
  // A recording handed to a lane that is not set to the sample engine changes nothing.
  assert.ok(same(play(saw), play(saw, recording())));
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as unknown as Record<string, unknown>;
  delete old.sample;
  assert.deepEqual(sanitizeSynthParams(old, defaults).sample, { root: 60, loop: false });
  const kept = sanitizeSynthParams({ ...defaults, engine: 'sample', sample: { id: ID, root: 48, loop: true } }, defaults);
  assert.deepEqual([kept.engine, kept.sample], ['sample', { id: ID, root: 48, loop: true }]);
  const hostile = sanitizeSynthParams({ ...defaults, engine: 'tape', sample: { id: '../../etc', root: 4000, loop: 'yes' } }, defaults);
  assert.deepEqual([hostile.engine, hostile.sample], ['subtractive', { root: 127, loop: false }]);
  // Choosing None in the editor sends an empty id, which is no sample.
  assert.deepEqual(sanitizeSynthParams({ ...defaults, sample: { id: '', root: 60, loop: false } }, defaults).sample, { root: 60, loop: false });
});

test('the sample engine plays its recording at the note asked for, whatever rate it was recorded at', () => {
  const settled = (samples: Float32Array) => samples.subarray(SR / 10);
  const atRoot = settled(play(sampled(), recording()));
  assert.ok(level(atRoot, 440) > -30, `at its root it is at its own pitch (${level(atRoot, 440).toFixed(1)} dB)`);
  const octaveUp = settled(play(sampled(), recording(), 'A5', 0.9));
  assert.ok(level(octaveUp, 880) > -30 && level(octaveUp, 440) < level(octaveUp, 880) - 30, 'an octave up it is an octave up');
  const octaveDown = settled(play(sampled(), recording(), 'A3'));
  assert.ok(level(octaveDown, 220) > -30 && level(octaveDown, 440) < level(octaveDown, 220) - 30);
  // The root says which key gives the recorded pitch: told the recording is an A3, A4 plays it twice as fast.
  const lowerRoot = settled(play(sampled({ root: 57 }), recording(), 'A4', 0.9));
  assert.ok(level(lowerRoot, 880) > -30 && level(lowerRoot, 440) < level(lowerRoot, 880) - 30);
  // It is about as loud as the oscillator it replaces.
  const sine = settled(play({}));
  assert.ok(Math.abs(loudness(atRoot) - loudness(sine)) < 3, `${loudness(atRoot).toFixed(1)} dB against ${loudness(sine).toFixed(1)} dB`);
});

test('with no recording, or one that is not on this device, the lane plays its oscillator', () => {
  // Changing engine crossfades for a moment, so the comparison starts after it.
  const settled = (samples: Float32Array) => samples.subarray(SR / 10);
  assert.ok(same(settled(play(sampled())), settled(play({}))));
  assert.ok(same(settled(play(sampled(), null)), settled(play({}))));
  // A recording taken away again gives the oscillator back.
  const made = core(sampled(), recording());
  made.setSample(null);
  made.noteOn({ note: 'A4', velocity: 1 });
  const left = new Float32Array(SR), right = new Float32Array(SR);
  made.process(left, right);
  assert.ok(same(settled(left), settled(play({}))));
});

test('a recording plays once and lets its voice go, or goes round while the key is held', () => {
  const short = recording(0.25);
  const once = play(sampled(), short);
  assert.ok(loudness(once.subarray(0, SR * 0.2)) > -30);
  assert.ok(loudness(once.subarray(SR * 0.5)) < -90, 'nothing after it has ended');
  const held = core(sampled(), short);
  held.noteOn({ note: 'A4', velocity: 1 });
  held.process(new Float32Array(SR), new Float32Array(SR));
  assert.ok(held.idle, 'and the voice is free again though the key is still down');

  const looped = play(sampled({ loop: true }), short);
  assert.ok(loudness(looped.subarray(SR * 0.5)) > -30, 'looped, it is still sounding');
  assert.ok(level(looped.subarray(SR * 0.5), 440) > -30);
});

test('the recording goes through the lane\'s filter and envelopes, and a note struck again starts it again', () => {
  const bright = recording(2, 3000);
  const open = play(sampled(), bright).subarray(SR / 10);
  const closed = play({ ...sampled(), filter: { ...createDefaultSynthParameters().filter, frequency: 300 } }, bright).subarray(SR / 10);
  assert.ok(level(closed, 3000) < level(open, 3000) - 30, 'the filter takes the top off it');
  const slow = play({ ...sampled(), envelope: { attack: 1, decay: 0.1, sustain: 1, release: 0.1 } }, recording());
  assert.ok(loudness(slow.subarray(0, SR * 0.05)) < loudness(slow.subarray(SR * 0.9)) - 20, 'the envelope fades it in');

  // A recording that is loud at its start and silent after: striking the key again brings the start back.
  const click: SynthSample = { data: Float32Array.from({ length: 44100 }, (_, index) => index < 4410 ? 0.8 * Math.sin(2 * Math.PI * 440 * index / 44100) : 0), rate: 44100 };
  const made = core(sampled({ loop: true }), click);
  const block = () => { const left = new Float32Array(SR / 2), right = new Float32Array(SR / 2); made.process(left, right); return left; };
  made.noteOn({ note: 'A4', velocity: 1, id: 1 });
  const first = block();
  assert.ok(loudness(first.subarray(SR * 0.2)) < -90);
  made.noteOn({ note: 'A4', velocity: 1, id: 2 });
  const second = block();
  assert.ok(loudness(second.subarray(0, SR * 0.08)) > -30, 'the start is heard again');
  assert.ok(second.every(value => Math.abs(value) <= 1));
});

test('an export plays the lane\'s recording, and a project file knows which samples its synth lanes use', () => {
  const steps: SequencerStep[] = Array.from({ length: 16 }, (_, index) => (index === 0 ? { active: true, note: 'A4', velocity: 1, length: 4 } : { active: false, velocity: 1 }));
  const params = { ...createDefaultSynthParameters(), ...sampled(), oscillator: { type: 'sawtooth' as const, detune: 0, pulseWidth: 0.5 } };
  const frames = SR * 2;
  const withSample = renderSynthBars([steps], params, 120, frames, SR, 2, recording(2, 660));
  const without = renderSynthBars([steps], params, 120, frames, SR, 2);
  const start = (stereo: Float32Array[]) => stereo[0].subarray(0, SR / 10);
  assert.ok(level(start(withSample), 660) > level(start(withSample), 440) + 15, 'the recording is in the export');
  assert.ok(level(start(without), 440) > level(start(without), 660) + 15, 'and without it the oscillator is');

  const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const project = {
    drumState: { kick: { sampleId: ID } },
    synths: [{ synthParams: { engine: 'sample', sample: { id: other } } }, { synthParams: { sample: { id: ID } } }, { synthParams: { sample: { id: 'nonsense' } } }, {}],
  };
  assert.deepEqual(usedSampleIds(project).sort(), [ID, other].sort());
  assert.deepEqual(usedSampleIds({ drumState: {}, synths: 'no' }), []);
});

// A second of recording: its first half one thing, its second half another.
const halves = (first: (index: number) => number, second: (index: number) => number, rate = 44100): SynthSample =>
  ({ data: Float32Array.from({ length: rate }, (_, index) => (index < rate / 2 ? first(index) : second(index))), rate });
const tone = (hz: number, rate = 44100) => (index: number) => 0.8 * Math.sin(2 * Math.PI * hz * index / rate);

test('a note can begin part of the way into a recording, and a sound that never said so is unchanged', () => {
  const late = halves(() => 0, tone(440));
  const whole = { start: 0, loopStart: 0, loopEnd: 1 };
  assert.ok(same(play(sampled(), late), play(sampled(whole), late)), 'the whole recording, said or unsaid');
  assert.ok(same(play(sampled({ loop: true }), late, 'A4', 3), play(sampled({ loop: true, ...whole }), late, 'A4', 3)), 'and the whole of it going round');

  const fromStart = play(sampled(), late), fromHalf = play(sampled({ start: 0.5 }), late);
  assert.ok(loudness(fromStart.subarray(SR * 0.05, SR * 0.3)) < -90, 'from its beginning the recording is silent at first');
  assert.ok(level(fromHalf.subarray(SR * 0.05, SR * 0.3), 440) > -30, 'from half way it sounds at once');
  assert.ok(loudness(fromHalf.subarray(SR * 0.6)) < -90, 'and ends half a recording sooner');
  // A recorded instrument of several notes begins the same share of the way into whichever one plays.
  const zoned: SynthSample = { ...late, root: 69, zones: [{ ...halves(() => 0, tone(880)), root: 81 }] };
  assert.ok(level(play(sampled({ start: 0.5 }), zoned, 'A5').subarray(SR * 0.05, SR * 0.3), 880) > -30);
});

test('the part of a recording that goes round can be chosen', () => {
  const two = halves(tone(440), tone(880));
  const after = (extra: Partial<NonNullable<SynthParameters['sample']>>) => play(sampled({ loop: true, ...extra }), two, 'A4', 3).subarray(SR * 2);
  const low = after({ loopEnd: 0.5 }), high = after({ loopStart: 0.5 }), all = after({});
  assert.ok(level(low, 440) > -30 && level(low, 880) < level(low, 440) - 20, 'the first half alone');
  assert.ok(level(high, 880) > -30 && level(high, 440) < level(high, 880) - 20, 'the second half alone, once the first has been played through');
  // Each tone is there half the time, so half as strong.
  assert.ok(level(all, 440) > -35 && level(all, 880) > -35, 'and the whole of it has both');
  // Without Loop the points do nothing: it plays once to its end.
  assert.ok(same(play(sampled({ loopStart: 0.5, loopEnd: 0.75 }), two), play(sampled(), two)));
  // A loop with nothing in it is the whole recording, not a stuck sample.
  const none = after({ loopStart: 0.5, loopEnd: 0.5 });
  assert.ok(level(none, 440) > -35 && level(none, 880) > -35);
});

test('a start and loop points are stored only where they are not the whole recording, and held in range', () => {
  const kept = (sample: Record<string, unknown>) => sanitizeSynthParams({ ...createDefaultSynthParameters(), engine: 'sample', sample: { root: 60, loop: true, ...sample } }, createDefaultSynthParameters()).sample!;
  assert.deepEqual(kept({ start: 0, loopStart: 0, loopEnd: 1 }), { root: 60, loop: true });
  assert.deepEqual(kept({}), { root: 60, loop: true });
  assert.deepEqual(kept({ start: 0.25, loopStart: 0.5, loopEnd: 0.75 }), { root: 60, loop: true, start: 0.25, loopStart: 0.5, loopEnd: 0.75 });
  assert.deepEqual(kept({ start: 7, loopStart: -1, loopEnd: 'x' }), { root: 60, loop: true, start: 0.99 });
  assert.deepEqual(kept({ loopStart: 0.6, loopEnd: 0.2 }), { root: 60, loop: true, loopStart: 0.6, loopEnd: 0.61 }, 'the end is kept after the start');
});

test('a chosen loop is faded into what comes before it, so going round does not click', () => {
  // The first half holds still where the loop begins; the second half, the loop, climbs away from
  // there, so going straight back to its start is a jump.
  const rate = 44100;
  const climb: SynthSample = { data: Float32Array.from({ length: rate }, (_, index) => (index < rate / 2 ? -0.5 : -0.5 + (index - rate / 2) / (rate / 2))), rate };
  const jump = (samples: Float32Array) => { let most = 0; for (let index = 1; index < samples.length; index += 1) most = Math.max(most, Math.abs(samples[index] - samples[index - 1])); return most; };
  const open: Partial<SynthParameters> = { filter: { ...createDefaultSynthParameters().filter, frequency: 20000 } };
  const round = play({ ...open, ...sampled({ loop: true, loopStart: 0.5 }) }, climb, 'A4', 3).subarray(SR);
  assert.ok(jump(round) < 0.02, `the join is smooth: ${jump(round)}`);
  assert.ok(loudness(round) > -30, 'and it is still sounding');
  // The whole recording going round has nothing before its start to fade into, and is as it was.
  const whole = play({ ...open, ...sampled({ loop: true }) }, climb, 'A4', 3).subarray(SR);
  assert.ok(jump(whole) > jump(round) * 10, `the whole of it still jumps where it always did: ${jump(whole)} against ${jump(round)}`);
});
