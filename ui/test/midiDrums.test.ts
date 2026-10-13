import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRUM_CHANNEL, asDrumChannel, drumForNote } from '../src/services/midiDrums.ts';
import { DRUM_NOTE_MAP } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';

test('the notes a MIDI export writes for the drums come back to the lanes they were written from', () => {
  for (const instrument of DRUM_INSTRUMENTS) assert.equal(drumForNote(DRUM_NOTE_MAP[instrument]), instrument);
});

test('every pad of a sixteen-pad controller plays a drum, and a note that is no drum plays nothing', () => {
  const pads = Array.from({ length: 16 }, (_, index) => drumForNote(36 + index));
  assert.ok(pads.every(Boolean), pads.join(', '));
  assert.deepEqual(new Set(pads), new Set(DRUM_INSTRUMENTS), 'and between them they reach all eight lanes');
  assert.equal(drumForNote(35), 'kick');
  assert.equal(drumForNote(40), 'snare');
  assert.equal(drumForNote(51), 'crash');
  for (const none of [0, 12, 34, 60, 127, -1, 3.5, Number.NaN]) assert.equal(drumForNote(none), null, String(none));
});

test('pads are listened to on channel 10 unless another is chosen, and 0 is none', () => {
  assert.equal(DEFAULT_DRUM_CHANNEL, 10);
  assert.equal(asDrumChannel(0), 0);
  assert.equal(asDrumChannel(16), 16);
  for (const odd of [17, -1, 2.5, '10', null, undefined]) assert.equal(asDrumChannel(odd), 10);
});
