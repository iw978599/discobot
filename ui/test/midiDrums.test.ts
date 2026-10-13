import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRUM_CHANNEL, PAD_DRUMS, asDrumChannel, asPadMap, defaultPads, drumForNote, padNoteLabel, padsAreDefault, storePads, storedPads, withPad } from '../src/services/midiDrums.ts';
import { MAX_MIDI_DEVICES, MIDI_DESTINATIONS, asMidiDestinations, destinationFor, destinationLane, storeMidiDestinations, storedMidiDestinations, withDestination } from '../src/services/midiDevices.ts';
import { DRUM_NOTE_MAP, createMidiFile } from '../src/utils/midiExport.ts';
import { DRUM_INSTRUMENTS } from '../src/services/drumKits.ts';
import type { DrumState } from '../src/types.ts';

const withStorage = (run: (data: Map<string, string>) => void) => {
  const data = new Map<string, string>();
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  } });
  try { run(data); } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
};

test('the notes a MIDI export writes for the drums come back to the lanes they were written from', () => {
  for (const instrument of DRUM_INSTRUMENTS) assert.equal(drumForNote(DRUM_NOTE_MAP[instrument]), instrument);
  assert.deepEqual(defaultPads(), DRUM_NOTE_MAP);
  assert.deepEqual([...PAD_DRUMS].sort(), [...DRUM_INSTRUMENTS].sort(), 'the panel lists every drum once');
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

test('a learned pad is its drum\'s alone: the drum that had the note is left with none', () => {
  const start = defaultPads();
  const learned = withPad(start, 'clap', 36);
  assert.deepEqual(start, DRUM_NOTE_MAP, 'the map handed in is not changed');
  assert.equal(learned.clap, 36);
  assert.equal(learned.kick, null);
  assert.equal(drumForNote(36, learned), 'clap');
  assert.equal(drumForNote(39, learned), null, 'the clap left its old note');
  assert.equal(drumForNote(35, learned), null, 'a drum with no note has no notes near it either');
  assert.equal(drumForNote(38, learned), 'snare', 'the others are as they were');
  assert.equal(drumForNote(40, learned), 'snare');
  assert.ok(!padsAreDefault(learned));

  // A note no drum had, and a note that was only near a drum.
  const far = withPad(learned, 'kick', 60);
  assert.equal(drumForNote(60, far), 'kick');
  assert.equal(drumForNote(35, far), null, 'a drum given a note by hand answers to that note alone');
  const near = withPad(start, 'crash', 40);
  assert.equal(drumForNote(40, near), 'crash', 'a learned note comes before a nearby one');
  assert.equal(drumForNote(38, near), 'snare');
  assert.equal(drumForNote(49, near), null);

  // Learning a drum its own note changes nothing, and every note has one drum at most.
  assert.deepEqual(withPad(start, 'kick', 36), start);
  let map = start;
  for (const [index, drum] of PAD_DRUMS.entries()) map = withPad(map, drum, 36 + (index % 3));
  const notes = PAD_DRUMS.map(drum => map[drum]).filter(note => note !== null);
  assert.equal(new Set(notes).size, notes.length);
  for (const odd of [-1, 128, 2.5, Number.NaN]) assert.deepEqual(withPad(start, 'kick', odd), start, String(odd));
  assert.deepEqual(withPad(start, 'cowbell' as never, 60), start);
});

test('a stored pad map is made safe, and reset is the General MIDI notes', () => {
  for (const odd of [null, undefined, 7, 'kick', [], [36, 38]]) assert.deepEqual(asPadMap(odd), DRUM_NOTE_MAP, JSON.stringify(odd));
  assert.deepEqual(asPadMap({ kick: 60, snare: null, clap: '39', openHH: 200, ride: 2.5, cowbell: 56 }), { ...DRUM_NOTE_MAP, kick: 60, snare: null });
  // Two drums given one note: the first in the grid keeps it.
  assert.deepEqual(asPadMap({ kick: 38, snare: 38 }), { ...DRUM_NOTE_MAP, kick: 38, snare: null });
  // A drum that is missing has its usual note unless another drum was given it.
  assert.deepEqual(asPadMap({ crash: 36 }), { ...DRUM_NOTE_MAP, crash: 36, kick: null });
  assert.ok(padsAreDefault(asPadMap({})));

  withStorage(data => {
    assert.deepEqual(storedPads(), DRUM_NOTE_MAP, 'nothing stored is the General MIDI notes');
    const learned = withPad(defaultPads(), 'ride', 36);
    storePads(learned);
    assert.deepEqual(storedPads(), learned);
    assert.deepEqual([...data.keys()], ['discobot_midi_pads_v1']);
    storePads(defaultPads());
    assert.ok(padsAreDefault(storedPads()));
    data.set('discobot_midi_pads_v1', '{not json');
    assert.deepEqual(storedPads(), DRUM_NOTE_MAP);
  });
  assert.deepEqual(storedPads(), DRUM_NOTE_MAP, 'and with no storage at all');
});

test('a pad\'s note is written as its number and its name', () => {
  assert.equal(padNoteLabel(36), '36 (C2)');
  assert.equal(padNoteLabel(60), '60 (C4)');
  assert.equal(padNoteLabel(49), '49 (C#3)');
  assert.equal(padNoteLabel(0), '0 (C-1)');
  assert.equal(padNoteLabel(null), 'none');
});

test('a MIDI export writes the General MIDI drum notes whatever the pads have learned', () => {
  withStorage(() => {
    const drums = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [instrument, {
      steps: Array.from({ length: 16 }, (_, step) => step === 0), stepVelocities: Array(16).fill(1), muted: false, solo: false,
      settings: { volume: 1, tone: .5, extra: .5 },
    }])) as DrumState;
    const file = () => createMidiFile({ tempo: 120, drumState: drums, drumMasterVolume: 1, synthLanes: [] });
    const before = file();
    storePads(withPad(withPad(defaultPads(), 'kick', 60), 'clap', 36));
    const after = file();
    assert.deepEqual(Array.from(after), Array.from(before));
    const struck = new Set<number>();
    for (let i = 0; i + 2 < after.length; i += 1) if (after[i] === 0x99 && after[i + 2] > 0) struck.add(after[i + 1]);
    for (const instrument of DRUM_INSTRUMENTS) assert.ok(struck.has(DRUM_NOTE_MAP[instrument]), instrument);
    assert.ok(!struck.has(60), 'the learned note is not written');
  });
});

test('a device is sent as before until it is given a place, and a stored list is made safe', () => {
  assert.deepEqual(MIDI_DESTINATIONS.map(place => place.id), ['default', 'open', 'synth:1', 'synth:2', 'synth:3', 'drums', 'off']);
  assert.equal(MIDI_DESTINATIONS[0].label, 'As set above');
  const none = asMidiDestinations(null);
  assert.equal(destinationFor(none, 'Launchkey'), 'default');
  for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(destinationFor(none, inherited), 'default', inherited);

  for (const odd of [undefined, 7, 'drums', [], ['drums']]) assert.deepEqual(asMidiDestinations(odd), {}, JSON.stringify(odd));
  assert.deepEqual(asMidiDestinations({ Keys: 'synth:2', Pads: 'drums', Old: 'default', Odd: 'synth:4', Worse: 7, None: null, '': 'drums', ['x'.repeat(121)]: 'off', Quiet: 'off', Open: 'open' }),
    { Keys: 'synth:2', Pads: 'drums', Quiet: 'off', Open: 'open' });
  const many = Object.fromEntries(Array.from({ length: MAX_MIDI_DEVICES + 10 }, (_, index) => [`Device ${index}`, 'drums']));
  assert.equal(Object.keys(asMidiDestinations(many)).length, MAX_MIDI_DEVICES);
});

test('a device\'s place is looked up by its name, changed, and put back', () => {
  let places = withDestination({}, 'Keys', 'synth:2');
  places = withDestination(places, 'Pads', 'drums');
  assert.equal(destinationFor(places, 'Keys'), 'synth:2');
  assert.equal(destinationFor(places, 'Pads'), 'drums');
  assert.equal(destinationFor(places, 'keys'), 'default', 'the name as the device says it');
  places = withDestination(places, 'Keys', 'off');
  assert.deepEqual(places, { Keys: 'off', Pads: 'drums' });
  places = withDestination(places, 'Keys', 'default');
  assert.deepEqual(places, { Pads: 'drums' }, 'as before is not kept');
  assert.deepEqual(withDestination(places, 'Pads', 'nowhere' as never), {}, 'a place that is not one is as before');

  assert.equal(destinationLane('synth:1'), 1);
  assert.equal(destinationLane('synth:3'), 3);
  for (const place of ['default', 'open', 'drums', 'off'] as const) assert.equal(destinationLane(place), null, place);

  withStorage(data => {
    assert.deepEqual(storedMidiDestinations(), {});
    storeMidiDestinations({ Keys: 'synth:2', Pads: 'drums' });
    assert.deepEqual(storedMidiDestinations(), { Keys: 'synth:2', Pads: 'drums' });
    assert.deepEqual([...data.keys()], ['discobot_midi_devices_v1']);
    data.set('discobot_midi_devices_v1', '[1, 2');
    assert.deepEqual(storedMidiDestinations(), {});
  });
  assert.deepEqual(storedMidiDestinations(), {}, 'and with no storage at all');
});
