// Several recordings as one instrument (roadmap 22): the note each file's name says, and the
// instrument they make, which the sample engine reads back as zones at those notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECORDINGS, instrumentName, noteFromName, noteLabel, recordingsInstrument, toRecording } from '../src/services/multiSample.ts';
import { parseWaveBundle } from '../src/services/builtInWaves.ts';
import { INSTRUMENT_TYPE } from '../src/services/sampleStore.ts';

test('a file name says its note: sharps, flats, the octave, and the last note named', () => {
  const cases: Array<[string, number | undefined]> = [
    ['Piano C4.wav', 60], ['harp_a#3.flac', 58], ['Cello-Bb2-soft.wav', 46], ['Fs5.wav', 78], ['violin E♭4.mp3', 63],
    ['Grand C-1.wav', 0], ['Strings G9.wav', 127], ['Kit 2 C3 D4.wav', 62],
    ['Vibe.wav', undefined], ['take2.wav', undefined], ['bass2.wav', undefined], ['note 60.wav', undefined], ['Bell G#9.wav', undefined],
  ];
  for (const [name, note] of cases) assert.equal(noteFromName(name), note, name);
  assert.deepEqual([0, 60, 61, 127].map(noteLabel), ['C-1', 'C4', 'C#4', 'G9']);
});

test('the instrument is named for what its files share', () => {
  assert.equal(instrumentName(['Piano C4.wav', 'Piano C5.wav', 'Piano G4.wav']), 'Piano');
  assert.equal(instrumentName(['Vibe_C3.wav', 'Vibe_E3.wav']), 'Vibe');
  assert.equal(instrumentName(['one.wav', 'two.wav']), 'one');
});

test('recordings become one instrument, lowest first, each at its note, and the sample engine reads them back', async () => {
  const tone = (length: number, rate = 44100) => toRecording('x', [Float32Array.from({ length }, (_, i) => Math.sin(i / 10) / 2)], rate);
  const made = recordingsInstrument('Piano', [
    { ...tone(1000), name: 'Piano C5.wav', note: 72 },
    { ...tone(800, 48000), name: 'Piano C3.wav', note: 48 },
  ]);
  assert.ok(made.ok);
  if (!made.ok) return;
  assert.equal(made.file.type, INSTRUMENT_TYPE);
  assert.equal(made.file.name, 'Piano.instrument');
  const waves = parseWaveBundle(await made.file.arrayBuffer());
  // The first recording is the sample itself and the rest are its zones, as the bundled pianos are.
  const sample = waves.get('instrument')!;
  const zones = [sample, ...(sample.zones ?? [])];
  assert.deepEqual(zones.map(zone => [zone.root, zone.rate, zone.data.length]), [[48, 48000, 800], [72, 44100, 1000]]);
  assert.ok(zones.every(zone => zone.keyLow === undefined), 'no key ranges: a note plays the nearest recording');
});

test('two recordings of one note, a missing note, silence or too many are refused, and nothing is made', () => {
  const one = toRecording('a.wav', [new Float32Array(100)], 44100);
  const refused = (result: ReturnType<typeof recordingsInstrument>) => (result.ok ? '' : result.error);
  assert.match(refused(recordingsInstrument('x', [{ ...one, note: 60 }, { ...one, name: 'b.wav', note: 60 }])), /both C4/);
  assert.match(refused(recordingsInstrument('x', [{ ...one, note: Number.NaN }])), /needs a note/);
  assert.match(refused(recordingsInstrument('x', [{ ...one, data: new Float32Array(1), note: 60 }])), /no sound/);
  assert.match(refused(recordingsInstrument('x', Array.from({ length: MAX_RECORDINGS + 1 }, (_, note) => ({ ...one, note })))), /up to/);
  assert.match(refused(recordingsInstrument('x', [])), /no recordings/);
});

test('a file is mixed to one channel and cut to thirty seconds', () => {
  const left = new Float32Array(10).fill(1), right = new Float32Array(10).fill(0);
  assert.deepEqual([...toRecording('a', [left, right], 8000).data], new Array(10).fill(0.5));
  assert.equal(toRecording('long', [new Float32Array(100 * 31)], 100).data.length, 3000);
});
