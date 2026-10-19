import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { swingLate } from '../src/services/drumScheduling.ts';
import { renderSynthBars } from '../src/services/wavExport.ts';
import { createMidiFile } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import { createMemoryLibrary } from '../src/services/projectLibrary.ts';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { setup } from './helpers/store.ts';
import type { DrumState, SequencerStep } from '../src/types.ts';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

const SR = 44100;
const off = (): SequencerStep => ({ active: false, velocity: .7 });
const lane = (length: number, at: number[]) => Array.from({ length }, (_, index) => at.includes(index) ? { active: true, note: 'C4', velocity: 1 } : off());
const drums = () => Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
  steps: Array(16).fill(false), muted: false, solo: false, settings: { volume: 1, tone: .5, extra: .5 },
}])) as unknown as DrumState;

test('every second sixteenth is late by the swing, and nothing else is', () => {
  assert.deepEqual([0, 1, 2, 3].map(sixteenth => swingLate(sixteenth * 10, 10, .5)), [0, 5, 0, 5]);
  // A lane of finer steps: both thirty-seconds of the second sixteenth move.
  assert.deepEqual([0, 1, 2, 3].map(step => swingLate(step * 5, 10, .5)), [0, 0, 5, 5]);
  assert.equal(swingLate(10, 10, 0), 0);
});

test('a swung lane is exported to MIDI with its off-beat sixteenths late; a straight one is not', () => {
  const ticks = (swing?: boolean) => {
    const bytes = createMidiFile({
      tempo: 120, drumState: drums(), drumSwing: .5, drumMasterVolume: 1,
      synthLanes: [{ id: 1, pattern: { id: 'p', name: 'Bass', tempo: 120, steps: lane(16, [0, 1, 2, 3]) }, swing }],
    });
    return new Midi(bytes).tracks.flatMap(track => track.notes.map(note => note.ticks));
  };
  // 480 to a quarter note, so 120 to a sixteenth.
  assert.deepEqual(ticks(), [0, 120, 240, 360]);
  assert.deepEqual(ticks(true), [0, 180, 240, 420]);
});

test('a swung lane renders its off-beat notes late by the swing', () => {
  const tempo = 120, sixteenth = 15 / tempo, sound = createDefaultSynthParameters();
  const onset = (swing: number) => {
    const [left] = renderSynthBars([lane(16, [1])], sound, tempo, Math.round(SR * 2), SR, undefined, undefined, undefined, [], swing);
    return left.findIndex(sample => Math.abs(sample) > 1e-4) / SR;
  };
  const straight = onset(0), swung = onset(.5);
  assert.ok(Math.abs(straight - sixteenth) < .005, `straight onset ${straight}`);
  assert.ok(Math.abs(swung - straight - .5 * sixteenth) < .002, `swung onset ${swung}`);
  const onBeat = (swing: number) => renderSynthBars([lane(16, [2])], sound, tempo, Math.round(SR), SR, undefined, undefined, undefined, [], swing)[0];
  assert.deepEqual(onBeat(.5), onBeat(0), 'a note on the beat does not move');
});

test('a lane is stored with no swing until it swings, and a file carries it and is checked', async () => {
  const service = setup();
  await service.openLibrary(createMemoryLibrary());
  assert.equal('swing' in service.snapshot().synths[0], false, 'a lane that never swung stores nothing, so older projects are unchanged');
  assert.ok(service.setSynthSwing(1, true).ok);
  const file = JSON.parse(JSON.stringify(service.exportProject()));
  const read = service.readProjectFile(file);
  assert.ok(read.ok);
  if (read.ok) assert.equal(read.project.synths[0].swing, true);
  file.project.synths[0].swing = 'yes';
  const hostile = service.readProjectFile(file);
  assert.ok(hostile.ok);
  if (hostile.ok) assert.equal('swing' in hostile.project.synths[0], false);
});
