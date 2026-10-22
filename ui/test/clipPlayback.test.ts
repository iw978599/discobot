import test from 'node:test';
import assert from 'node:assert/strict';
import { barSecondsAt, clipEnvelope, clipsSounding, clipsStarting, songSecondsAt, songTickAt, tickSeconds } from '../src/services/clipTiming.ts';
import { clipLevel, panFrame, renderTrackTakes } from '../src/services/trackRender.ts';
import { mixerChannels } from '../src/services/mixerChannels.ts';
import type { AudioClip, AudioTrack } from '../src/services/audioTracks.ts';
import type { Song } from '../src/types.ts';

const SAMPLE = '11111111-2222-4333-8444-555555555555';
const clip = (rest: Partial<AudioClip> = {}): AudioClip => ({ id: crypto.randomUUID(), sampleId: SAMPLE, at: 0, length: 1, ...rest });
const track = (rest: Partial<AudioTrack> = {}): AudioTrack => ({ id: crypto.randomUUID(), name: 'Take', volume: .8, clips: [], ...rest });
const close = (actual: number, expected: number, what = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${what} ${actual} is not ${expected}`);

test('a tick is a 32nd note: at 120 a bar of 4/4 is 32 ticks and two seconds', () => {
  close(tickSeconds(120) * 32, 2);
  close(tickSeconds(0), tickSeconds(120), 'a tempo that is not one counts as 120');
});

test('seconds into the song follow each scene\'s tempo and time signature, and go on past the end', () => {
  // Two bars of a at 120 in 4/4 (64 ticks, 4 s), then one bar of b at 60 in 3/4 (24 ticks, 3 s).
  const song: Song = { entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }], loop: false };
  const lengthOf = () => 1, signatureOf = (id: string) => (id === 'b' ? '3/4' as const : undefined), tempoOf = (id: string) => (id === 'b' ? 60 : undefined);
  const at = (tick: number) => songSecondsAt(song, tick, lengthOf, signatureOf, 120, tempoOf);
  close(at(0), 0);
  close(at(32), 2);
  close(at(64), 4, 'the start of b');
  close(at(64 + 12), 5.5, 'half way through b');
  close(at(64 + 24 + 8), 8, 'a beat past the end, at b\'s tempo');
  close(at(-5), 0);
});

test('an export\'s bars say the same', () => {
  const bars = [{}, {}, { signature: '3/4' as const }];
  const times = [{ start: 0, duration: 2 }, { start: 2, duration: 2 }, { start: 4, duration: 3 }];
  close(barSecondsAt(bars, times, 64 + 12), 5.5);
  close(barSecondsAt(bars, times, 64 + 24 + 12), 8.5, 'past the last bar, at its pace');
});

test('the clips sounding at a moment, with how far in, and those starting on a tick', () => {
  const early = clip({ at: 0, length: 3 }), late = clip({ at: 32, length: 1 }), gone = clip({ at: 0, length: .5 });
  const tracks = [track({ clips: [early, gone] }), track({ clips: [late] })];
  const secondsOf = (tick: number) => tick * tickSeconds(120);
  const now = clipsSounding(tracks, 2.25, secondsOf);
  assert.deepEqual(now.map(cue => [cue.clip.id, cue.into]), [[early.id, 2.25], [late.id, .25]]);
  assert.deepEqual(clipsSounding(tracks, 3, secondsOf).map(cue => cue.clip.id), [], 'a clip ends when its length has passed');
  assert.deepEqual(clipsStarting(tracks, 32).map(cue => cue.clip.id), [late.id]);
});

test('a clip\'s level is its gain, faded in and out in straight lines, from any point in it', () => {
  const faded = clip({ length: 4, gain: .5, fadeIn: 1, fadeOut: 2 });
  assert.deepEqual([0, .5, 1, 2, 3, 4].map(time => clipLevel(faded, time)), [0, .25, .5, .5, .25, 0]);
  assert.deepEqual(clipEnvelope(faded), { now: 0, points: [{ at: 1, level: .5 }, { at: 2, level: .5 }, { at: 4, level: 0 }] });
  assert.deepEqual(clipEnvelope(faded, 3), { now: .25, points: [{ at: 1, level: 0 }] }, 'joined part way through the fade out');
  assert.deepEqual(clipEnvelope(clip({ length: 2 })), { now: 1, points: [{ at: 2, level: 1 }] });
});

test('a pan is what a StereoPannerNode does', () => {
  const [l, r] = panFrame(1, undefined, 0);
  close(l, Math.SQRT1_2); close(r, Math.SQRT1_2);
  assert.deepEqual(panFrame(1, undefined, -1).map(value => Math.round(value * 1e9) / 1e9), [1, 0]);
  assert.deepEqual(panFrame(.5, .25, 0), [.5, .25], 'stereo in the middle is left as it is');
  const [hardLeft, none] = panFrame(.5, .25, -1);
  close(hardLeft, .75); close(none, 0);
  const [nothing, hardRight] = panFrame(.5, .25, 1);
  close(nothing, 0); close(hardRight, .75);
});

test('an export lays each heard track\'s clips where they fall, from their offset, faded and panned', () => {
  const rate = 10, recording = { rate, channels: [Float32Array.from({ length: 40 }, (_, index) => index + 1)] };
  const recordings = new Map([[SAMPLE, recording]]);
  const secondsOf = (tick: number) => tick / 10;
  const one = track({ volume: .5, pan: -1, sends: { reverb: .4 }, clips: [clip({ at: 10, length: .5, offset: 1 })] });
  const [take] = renderTrackTakes([one], recordings, secondsOf, 30, rate);
  assert.equal(take.gain, .5);
  assert.deepEqual(take.sends, { reverb: .4, delay: 0, drive: 0, phaser: 0, chorus: 0, auxA: 0, auxB: 0 });
  assert.deepEqual(Array.from(take.left.slice(9, 17)).map(Math.round), [0, 11, 12, 13, 14, 15, 0, 0], 'one second in, from one second into the recording, for half a second');
  assert.deepEqual(Array.from(take.right).map(value => Math.round(value * 1e6)), Array(30).fill(0), 'panned hard left');

  const muted = track({ muted: true, clips: [clip()] }), soloed = track({ solo: true, clips: [clip({ at: 0, length: .2 })] }), missing = track({ solo: true, clips: [clip({ sampleId: 'aaaaaaaa-2222-4333-8444-555555555555' })] });
  const takes = renderTrackTakes([muted, soloed, missing], recordings, secondsOf, 30, rate);
  assert.deepEqual(takes.map(entry => entry.name), ['Take'], 'a muted track, and one whose recording is not here, make no take');
  assert.equal(takes[0].sends, undefined);
  assert.ok(takes[0].left[0] > 0 && takes[0].left[2] === 0);
});

test('the mixer has a strip for each audio track, and none without', () => {
  const base = { synths: [], drumState: {} as never, drumMasterVolume: 1, guests: [], effectsLoop: { returns: { synth: 1, drums: 1 } } as never, browserVolume: 1 };
  assert.deepEqual(mixerChannels(base).tracks, []);
  const [one] = mixerChannels({ ...base, audioTracks: [track({ name: 'Vox', pan: .5, solo: true })] }).tracks;
  assert.deepEqual({ ...one, id: 0 }, { id: 0, name: 'Vox', volume: .8, pan: .5, muted: false, solo: true });
});

test('a time in the song turns back into the tick it fell on', () => {
  const song: Song = { entries: [{ sceneId: 'a', repeats: 2 }, { sceneId: 'b', repeats: 1 }], loop: false };
  const lengthOf = () => 1, signatureOf = (id: string) => (id === 'b' ? '3/4' as const : undefined), tempoOf = (id: string) => (id === 'b' ? 60 : undefined);
  for (const tick of [0, 5, 32, 64, 70, 88, 120.5]) {
    close(songTickAt(song, songSecondsAt(song, tick, lengthOf, signatureOf, 120, tempoOf), lengthOf, signatureOf, 120, tempoOf), tick, `tick ${tick}`);
  }
});
