// A drum kit from a SoundFont for the drum lanes (the owner, 2026-10-20): each key General MIDI names
// becomes a short audio file named for its drum, and each lane is offered the drum General MIDI has
// for it. The kit here is built in the test, so no file is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSoundFont } from '../src/services/soundFont.ts';
import { GM_DRUMS, LANE_DRUMS, isKit, soundFontKit } from '../src/services/soundFontKit.ts';
import { isAudioFile } from '../src/services/sampleStore.ts';
import { INSTRUMENT, SAMPLE_ID, buildSoundFont, keys } from './helpers/soundFontFile.ts';

const hit = (step: number) => Array.from({ length: 3000 }, (_, i) => Math.round(9000 * Math.sin(i / step) * (1 - i / 3000)));

function kitFont() {
  return buildSoundFont({
    name: 'Little kit',
    samples: [
      { name: 'kick', data: hit(20), rate: 22050, pitch: 36 },
      { name: 'snare', data: hit(6), rate: 22050, pitch: 38 },
      { name: 'hat', data: hit(2), rate: 22050, pitch: 42 },
      { name: 'tom', data: hit(10), rate: 22050, pitch: 50 },
      { name: 'piano', data: hit(8), rate: 22050, pitch: 60 },
    ],
    instruments: [
      { name: 'Kit', zones: [
        { gens: [keys(36, 36), [SAMPLE_ID, 0]] },
        { gens: [keys(38, 38), [SAMPLE_ID, 1]] },
        { gens: [keys(42, 42), [SAMPLE_ID, 2]] },
        { gens: [keys(47, 50), [SAMPLE_ID, 3]] },
      ] },
      { name: 'Piano', zones: [{ gens: [keys(0, 127), [SAMPLE_ID, 4]] }] },
    ],
    presets: [
      { name: 'Piano', bank: 0, program: 0, zones: [{ gens: [[INSTRUMENT, 1]] }] },
      { name: 'Standard', bank: 128, program: 0, zones: [{ gens: [[INSTRUMENT, 0]] }] },
    ],
  });
}

test('a kit gives a file for each drum it has, named for it, and each lane the drum General MIDI has for it', () => {
  const buffer = kitFont(), font = readSoundFont(buffer)!;
  const kit = font.presets.find(isKit)!;
  assert.equal(kit.name, 'Standard', 'a kit is found among the presets by its bank');
  const made = soundFontKit(buffer, kit);
  assert.ok(made.ok);
  if (!made.ok) return;
  // The tom is spread over keys 47 to 50, so it is also on 49, which General MIDI calls a crash: the kit says so.
  assert.deepEqual(made.files.map(file => file.name), [
    'Bass Drum 1 (C2).wav', 'Acoustic Snare (D2).wav', 'Closed Hi-Hat (F#2).wav', 'Low-Mid Tom (B2).wav', 'Hi-Mid Tom (C3).wav', 'Crash Cymbal 1 (C#3).wav', 'High Tom (D3).wav',
  ]);
  assert.ok(made.files.every(isAudioFile), 'each is audio the sample store takes');
  assert.deepEqual(made.choice, { kick: 0, snare: 1, closedHH: 2, snare2: 3, ride: 4, crash: 5 }, 'the clap and open hat, which the kit lacks, are left as they are');
});

test('a recording spread over several keys moves with the key; one for a single key plays as it is', async () => {
  const buffer = kitFont();
  const made = soundFontKit(buffer, readSoundFont(buffer)!.presets.find(isKit)!);
  assert.ok(made.ok);
  if (!made.ok) return;
  const rateOf = async (file: File) => new DataView(await file.arrayBuffer()).getUint32(24, true);
  assert.equal(await rateOf(made.files[0]), 22050, 'the kick, on a key of its own');
  // The tom is recorded for key 50 and spread from 47: three keys down is that much slower.
  assert.equal(await rateOf(made.files[3]), Math.round(22050 * 2 ** (-3 / 12)));
  assert.equal(await rateOf(made.files[6]), 22050, 'at its own key, as recorded');
});

test('a preset with nothing on the drum keys is not a kit, and every lane has a drum to look for', () => {
  const empty = buildSoundFont({
    name: 'Bells', samples: [{ name: 'bell', data: hit(4), rate: 22050, pitch: 96 }],
    instruments: [{ name: 'Bell', zones: [{ gens: [keys(90, 100), [SAMPLE_ID, 0]] }] }],
    presets: [{ name: 'Bell', bank: 0, program: 9, zones: [{ gens: [[INSTRUMENT, 0]] }] }],
  });
  const made = soundFontKit(empty, readSoundFont(empty)!.presets[0]);
  assert.ok(!made.ok && /not a drum kit/.test(made.error));
  for (const notes of Object.values(LANE_DRUMS)) assert.ok(notes.length > 0 && notes.every(note => GM_DRUMS[note]));
});
