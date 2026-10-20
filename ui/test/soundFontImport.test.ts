// An instrument imported from a SoundFont (roadmap 14a): kept in the format of the app's own
// instruments with each recording's loop and keys, read back, and played by the sample engine with a
// note taking the recording made for its key and going round that recording's own loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams, type SynthSample } from '@discobot/engine';
import { encodeWaveBundle, parseWaveBundle } from '../src/services/builtInWaves.ts';
import { readSoundFont } from '../src/services/soundFont.ts';
import { soundFontInstrument } from '../src/services/soundFontImport.ts';
import { INSTRUMENT_TYPE, isAudioFile } from '../src/services/sampleStore.ts';
import { INSTRUMENT, MODES, ROOT, SAMPLE_ID, buildSoundFont, keys } from './helpers/soundFontFile.ts';

const SR = 48000;
const tone = (frames: number, hz: number, rate: number, third = 0) => Float32Array.from({ length: frames }, (_, index) => 0.5 * Math.sin(2 * Math.PI * hz * index / rate) + third * Math.sin(2 * Math.PI * 3 * hz * index / rate));

test('an instrument is kept with each recording\'s loop and keys, and a loop or range that makes no sense is dropped', () => {
  const zones = [
    { data: tone(4000, 261.63, 44100), rate: 44100, root: 60, keyLow: 0, keyHigh: 64, loopStart: 1000, loopEnd: 3000 },
    { data: tone(4000, 523.25, 44100), rate: 44100, root: 72.25, keyLow: 65, keyHigh: 127 },
  ];
  const read = [...parseWaveBundle(encodeWaveBundle('instrument', zones)).values()][0];
  assert.ok(read);
  assert.deepEqual([read.root, read.keyLow, read.keyHigh, read.loopStart, read.loopEnd], [60, 0, 64, 1000, 3000]);
  assert.deepEqual([read.zones?.[0].root, read.zones?.[0].keyLow, read.zones?.[0].keyHigh, read.zones?.[0].loopStart], [72.25, 65, 127, undefined]);
  assert.ok(Math.abs(read.data[100] - zones[0].data[100]) < 1 / 16384, 'kept as 16-bit audio');
  const bad = [...parseWaveBundle(encodeWaveBundle('instrument', [{ ...zones[0], loopStart: 3000, loopEnd: 1000, keyLow: 90, keyHigh: 10 }])).values()][0];
  assert.deepEqual([bad.loopStart, bad.loopEnd, bad.keyLow, bad.keyHigh], [undefined, undefined, undefined, undefined]);
});

test('a SoundFont preset becomes one instrument file the sample store takes, its loops kept', () => {
  const font = buildSoundFont({
    name: 'Test font',
    samples: [
      { name: 'low', data: Array.from({ length: 2000 }, (_, i) => Math.round(8000 * Math.sin(i / 10))), rate: 22050, pitch: 48, loop: [500, 1500] },
      { name: 'high', data: Array.from({ length: 2000 }, (_, i) => Math.round(8000 * Math.sin(i / 5))), rate: 22050, pitch: 72, loop: [500, 1500] },
    ],
    instruments: [{ name: 'Keys', zones: [{ gens: [keys(0, 59), [MODES, 1], [SAMPLE_ID, 0]] }, { gens: [keys(60, 127), [MODES, 1], [ROOT, 70], [SAMPLE_ID, 1]] }] }],
    presets: [{ name: 'Keys', bank: 0, program: 4, zones: [{ gens: [[INSTRUMENT, 0]] }] }],
  });
  const file = readSoundFont(font);
  assert.ok(file);
  const made = soundFontInstrument(font, file.presets[0]);
  assert.ok(made.ok);
  assert.equal(made.file.type, INSTRUMENT_TYPE);
  assert.equal(made.file.name, 'Keys.instrument');
  assert.equal(made.loops, true);
  assert.ok(isAudioFile(made.file), 'the store and project files take it');
});

test('a preset with nothing playable is refused with a reason, not stored', () => {
  const font = buildSoundFont({ samples: [], instruments: [], presets: [{ name: 'Empty', bank: 0, program: 0, zones: [] }] });
  const made = soundFontInstrument(font, { name: 'Empty', bank: 0, program: 0, index: 0 });
  assert.equal(made.ok, false);
  if (!made.ok) assert.match(made.error, /no recordings/);
});

function render(sample: SynthSample, note: string, loop: boolean, seconds = 1) {
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({ ...createDefaultSynthParameters(), engine: 'sample', sample: { root: 60, loop }, envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.05 } }));
  core.setSample(sample);
  core.noteOn({ note, velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left;
}
function level(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SR);
  let s1 = 0, s2 = 0;
  for (const value of samples) { const s0 = value + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return 20 * Math.log10(Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / samples.length);
}
const loudness = (samples: Float32Array) => 10 * Math.log10(Math.max(1e-30, samples.reduce((sum, value) => sum + value * value, 0) / samples.length));

test('a note plays the recording made for its key, even when another\'s root is nearer, and goes round its own loop', () => {
  const rate = 44100, F4 = 349.23;
  // A pure tone for the keys up to E4, and one with a strong third harmonic from F4.
  const instrument: SynthSample = {
    data: tone(rate * 2, 261.63, rate), rate, root: 60, keyLow: 0, keyHigh: 64,
    zones: [{ data: tone(rate * 2, 523.25, rate, 0.5), rate, root: 72, keyLow: 65, keyHigh: 127 }],
  };
  const played = render(instrument, 'F4', false, 0.5);
  assert.ok(level(played, 3 * F4) > level(played, F4) - 12, 'F4 is in the second recording\'s keys, though C4 is the nearer root');
  const withoutRanges: SynthSample = { data: instrument.data, rate, root: 60, zones: [{ ...instrument.zones![0], keyLow: undefined, keyHigh: undefined }] };
  const nearest = render(withoutRanges, 'F4', false, 0.5);
  assert.ok(level(nearest, 3 * F4) < level(nearest, F4) - 30, 'with no ranges, the nearest root as before');

  // Sound only in the first half, with a loop of its own over that half.
  const half = rate / 2, data = new Float32Array(rate);
  data.set(tone(half, 261.63, rate));
  const looped = render({ data, rate, root: 60, loopStart: 0, loopEnd: half }, 'C4', true, 2);
  const whole = render({ data, rate, root: 60 }, 'C4', true, 2);
  const late = (samples: Float32Array) => loudness(samples.subarray(SR, 2 * SR));
  assert.ok(late(looped) - late(whole) > 2, 'its own loop keeps sounding; the whole recording goes round its silent half too');
});
