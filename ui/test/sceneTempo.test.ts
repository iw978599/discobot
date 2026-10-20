// A tempo for each scene (roadmap 17): kept in a project, how long a song with one lasts, its bars'
// times in an export, its MIDI file's tempo, and the transport placing each tick at its scene's tempo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTransport, type TransportTick } from '../src/services/browserTransport.ts';
import { barTimes } from '../src/services/patternLength.ts';
import { songRows, songSeconds } from '../src/services/songPlayback.ts';
import { arrangementWholes } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { ok, setup } from './helpers/store.ts';
import type { Song } from '../src/types.ts';

test('a scene keeps a tempo of its own in a project file, a tempo that is not one is dropped, and an old project has none', () => {
  const service = setup();
  const scene = service.openSceneId();
  ok(service.setSceneTempo(scene, 84));
  const file = service.exportProject() as { project: { scenes: Array<Record<string, unknown>> } };
  const read = service.readProjectFile(file);
  assert.ok(read.ok);
  if (read.ok) assert.equal(read.project.scenes[0].tempo, 84);
  for (const hostile of [10, 9000, 'fast', null, Number.NaN]) {
    const bad = structuredClone(file);
    bad.project.scenes[0].tempo = hostile;
    const back = service.readProjectFile(bad);
    assert.ok(back.ok && !('tempo' in back.project.scenes[0]), `${String(hostile)} is not a tempo`);
  }
  const old = structuredClone(file);
  delete old.project.scenes[0].tempo;
  const opened = service.readProjectFile(old);
  assert.ok(opened.ok && !('tempo' in opened.project.scenes[0]), 'a project from before plays at its own tempo');
});

test('a song lasts as long as each scene at its own tempo, and with none as it always did', () => {
  const song: Song = { entries: [{ sceneId: 'verse', repeats: 2 }, { sceneId: 'break', repeats: 1 }], loop: false };
  const tempoOf = (id: string) => (id === 'break' ? 60 : undefined);
  // Two bars at 120 (two seconds each), then one at 60 (four seconds).
  assert.equal(songSeconds(song, () => 1, 120), 6);
  assert.equal(songSeconds(song, () => 1, 120, undefined, tempoOf), 8);
  assert.deepEqual(songRows(song, () => 1, 120, undefined, tempoOf).map(row => [row.startSeconds, row.seconds]), [[0, 4], [4, 4]]);
});

test('a bar at a scene\'s own tempo is stretched in an export, and bars without are timed exactly as before', () => {
  assert.deepEqual(barTimes([undefined, undefined], 2), [{ start: 0, duration: 2 }, { start: 2, duration: 2 }]);
  assert.deepEqual(barTimes([undefined, undefined, undefined], 2, [1, 2, 1]), [{ start: 0, duration: 2 }, { start: 2, duration: 4 }, { start: 6, duration: 2 }]);
  const scene = (tempo?: number) => ({ id: 's', name: 'S', lanes: {}, drums: {} as never, ...(tempo ? { tempo } : {}) });
  assert.equal(arrangementWholes({ tempo: 120, bars: [scene(), scene()] }), 2);
  assert.equal(arrangementWholes({ tempo: 120, bars: [scene(), scene(60)] }), 3, 'a bar at half the tempo lasts two');
});

test('a MIDI file has the tempo at the start and again where a scene plays at another', () => {
  const bar = (name: string, tempo?: number) => ({ name, lanes: {}, drumState: {} as never, ...(tempo ? { tempo } : {}) });
  const tempoEvents = (bytes: Uint8Array) => {
    const found: number[] = [];
    for (let i = 0; i + 5 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0x51 && bytes[i + 2] === 0x03) found.push(Math.round(60000000 / ((bytes[i + 3] << 16) | (bytes[i + 4] << 8) | bytes[i + 5])));
    return found;
  };
  const base = { tempo: 120, synthLanes: [], drumState: {} as never, drumSwing: 0, drumMasterVolume: 1 };
  assert.deepEqual(tempoEvents(createMidiFile({ ...base, bars: [bar('A'), bar('A')] })), [120]);
  assert.deepEqual(tempoEvents(createMidiFile({ ...base, bars: [bar('A'), bar('B', 90), bar('B', 90), bar('A')] })), [120, 90, 120]);
  assert.deepEqual(tempoEvents(createMidiFile({ ...base, bars: [bar('B', 90), bar('A')] })), [90, 120], 'the start is the first bar\'s');
});

test('the transport places each tick at the tempo of its own, so a scene with another starts on time', () => {
  let time = 0;
  const ticks: TransportTick[] = [];
  // Eight ticks (a beat) at 120, then 60.
  const transport = new BrowserTransport(() => time, tick => (tick < 8 ? 120 : 60), tick => ticks.push(tick));
  transport.start(0);
  for (let i = 1; i <= 100; i++) { time = i * 0.02; transport.pump(); }
  transport.stop();
  const gap = (index: number) => ticks[index + 1].time - ticks[index].time;
  assert.ok(Math.abs(gap(0) - 60 / 120 / 8) < 1e-9);
  assert.ok(Math.abs(ticks[8].time - 0.5) < 1e-9, 'the first tick at the new tempo comes a beat of the old one in');
  assert.ok(Math.abs(gap(8) - 60 / 60 / 8) < 1e-9);
  assert.equal(ticks[8].duration, 60 / 60 / 8);
});
