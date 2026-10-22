import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CLIPS, MAX_CLIP_SECONDS, MAX_CLIP_TICK, MAX_TRACKS, clipSampleIds, sanitizeAudioTracks, sanitizeClip, trackHeard, type AudioTrack,
} from '../src/services/audioTracks.ts';
import { editKeys, overlap } from '../src/services/liveSession.ts';
import { ok, setup } from './helpers/store.ts';

const SAMPLE = '11111111-2222-4333-8444-555555555555';
const id = () => crypto.randomUUID();
const clip = (rest: object = {}) => ({ id: id(), sampleId: SAMPLE, at: 0, length: 1, ...rest });
const track = (rest: object = {}) => ({ id: id(), name: 'Take', volume: .8, clips: [], ...rest });

test('a project with no tracks stores none, and one opened from before holds none', () => {
  const service = setup();
  const before = service.exportProject();
  assert.equal('audioTracks' in before.project, false);
  const read = service.readProjectFile(before);
  assert.ok(read.ok);
  assert.equal('audioTracks' in read.project, false);
  assert.equal(sanitizeAudioTracks([]), undefined);
  assert.equal(sanitizeAudioTracks('tracks'), undefined);
});

test('everything about a track and a clip from a file is held to what it can be', () => {
  const tracks = sanitizeAudioTracks([
    track({ name: 7, volume: -1, pan: 9, muted: 'yes', solo: true, sends: { reverb: 2, bogus: 1, delay: -1 }, clips: [
      clip({ at: -5, length: MAX_CLIP_SECONDS * 2, offset: Infinity, gain: 99, fadeIn: -1, fadeOut: 'long', name: 'x'.repeat(200) }),
      clip({ length: 0 }), clip({ sampleId: '../../etc' }), { ...clip(), id: 'not an id' }, 'clip',
      clip({ at: MAX_CLIP_TICK * 3, length: .5 }),
    ] }),
    'nonsense', { id: 'bad' },
  ])!;
  assert.equal(tracks.length, 1);
  const [only] = tracks;
  assert.deepEqual({ ...only, id: 0, clips: only.clips.length }, { id: 0, name: 'Audio 1', volume: 0, pan: 1, solo: true, sends: { reverb: 1 }, clips: 2 });
  assert.deepEqual({ ...only.clips[0], id: 0 }, { id: 0, sampleId: SAMPLE, at: 0, length: MAX_CLIP_SECONDS, gain: 2, name: 'x'.repeat(80) });
  assert.equal(only.clips[1].at, MAX_CLIP_TICK);
});

test('there are at most eight tracks of 128 clips, and an id belongs to one thing in the project', () => {
  const shared = id();
  const many = sanitizeAudioTracks(Array.from({ length: MAX_TRACKS + 3 }, (_, index) => track({ id: index === 1 ? shared : id(), clips: index === 0 ? Array.from({ length: MAX_CLIPS + 5 }, () => clip()) : [] })))!;
  assert.equal(many.length, MAX_TRACKS);
  assert.equal(many[0].clips.length, MAX_CLIPS);
  const twice = sanitizeAudioTracks([track({ clips: [clip({ id: shared }), clip({ id: shared, at: 9 })] }), track({ id: shared })])!;
  assert.deepEqual(twice.map(entry => entry.clips.length), [1], 'a second clip and a track with an id already used are left out');
});

test('clips are kept in the order they play, and fades never last longer than the clip', () => {
  const [kept] = sanitizeAudioTracks([track({ clips: [clip({ at: 64 }), clip({ at: 8 }), clip({ at: 32 })] })])!;
  assert.deepEqual(kept.clips.map(entry => entry.at), [8, 32, 64]);
  const faded = sanitizeClip(clip({ length: 2, fadeIn: 1.5, fadeOut: 1.5 }))!;
  assert.deepEqual([faded.fadeIn, faded.fadeOut], [1.5, .5]);
});

test('a track is heard unless muted, or another is soloed', () => {
  const [a, b] = sanitizeAudioTracks([track(), track()]) as AudioTrack[];
  assert.equal(trackHeard(a, [a, b]), true);
  assert.equal(trackHeard({ ...a, muted: true }, [a, b]), false);
  assert.equal(trackHeard(a, [a, { ...b, solo: true }]), false);
  assert.equal(trackHeard({ ...a, solo: true, muted: true }, [{ ...a, solo: true }, b]), false, 'mute wins over solo');
});

test('the samples a project\'s clips play are found, whatever else is in the list', () => {
  assert.deepEqual(clipSampleIds([track({ clips: [clip(), clip(), clip({ sampleId: 'x' })] }), 'junk', { clips: 'no' }]), [SAMPLE]);
  assert.deepEqual(clipSampleIds(undefined), []);
});

test('a track and its clips are undone, and undoing the first takes the tracks away altogether', async () => {
  const service = setup();
  const trackId = ok(service.addTrack('Bass')).audioTracks[0].id;
  // Edits made in one turn are one undo step; a person adds the clip later.
  await new Promise(resolve => setTimeout(resolve, 0));
  ok(service.addClip(trackId, { sampleId: SAMPLE, at: 0, length: 2 }));
  service.undo();
  assert.equal(service.snapshot().audioTracks[0].clips.length, 0);
  service.undo();
  assert.equal('audioTracks' in service.snapshot(), false);
  service.redo();
  assert.equal(service.snapshot().audioTracks[0].name, 'Bass');
});

test('in a live session every track and clip edit covers the tracks, and a track\'s own settings only themselves', () => {
  const trackId = id();
  for (const op of [
    { type: 'track.add', trackId }, { type: 'track.remove', trackId },
    { type: 'clip.add', trackId, clip: clip() }, { type: 'clip.patch', clipId: id(), patch: { at: 3 } }, { type: 'clip.remove', clipId: id() },
  ] as const) assert.deepEqual(editKeys(op as never, 'scene'), ['tracks']);
  const volume = editKeys({ type: 'track.patch', trackId, patch: { volume: .5 } }, 'scene');
  assert.deepEqual(volume, [`tracks/${trackId}/volume`]);
  assert.ok(overlap(volume, ['tracks']), 'a clip edit and a track\'s level are applied again in order');
  assert.ok(!overlap(volume, [`tracks/${trackId}/pan`]));
});
