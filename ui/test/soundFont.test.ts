import test from 'node:test';
import assert from 'node:assert/strict';
import { readSoundFont, soundFontZones } from '../src/services/soundFont.ts';

import { KEY, COARSE, keys, buildSoundFont, INSTRUMENT, SAMPLE_ID, MODES, ROOT, FINE, START, END, LOOP_START, LOOP_END, type FontSpec } from './helpers/soundFontFile.ts';

const ramp = (n: number, step = 1000) => Array.from({ length: n }, (_, i) => (i + 1) * step);

function simple(overrides: Partial<FontSpec> = {}): FontSpec {
  return {
    samples: [
      { data: ramp(8), rate: 22050, pitch: 48 },
      { data: ramp(6, -2000), rate: 32000, pitch: 72 },
    ],
    instruments: [{
      name: 'Pair',
      zones: [
        { gens: [keys(0, 59), [SAMPLE_ID, 0]] },
        { gens: [keys(60, 127), [SAMPLE_ID, 1], [ROOT, 70], [COARSE, 2]] },
      ],
    }],
    presets: [
      { name: 'Zed', bank: 1, program: 3, zones: [{ gens: [[INSTRUMENT, 0]] }] },
      { name: 'Alpha', bank: 0, program: 9, zones: [{ gens: [[INSTRUMENT, 0]] }] },
      { name: 'Beta', bank: 0, program: 2, zones: [{ gens: [[INSTRUMENT, 0]] }] },
    ],
    ...overrides,
  };
}

test('lists presets by bank then program, with the file name', () => {
  const font = readSoundFont(buildSoundFont(simple()));
  assert.ok(font);
  assert.equal(font.name, 'Test font');
  assert.deepEqual(font.presets.map(p => [p.name, p.bank, p.program, p.index]), [
    ['Beta', 0, 2, 2],
    ['Alpha', 0, 9, 1],
    ['Zed', 1, 3, 0],
  ]);
});

test('a preset with two instrument zones gives two zones with their roots, rates and data', () => {
  const zones = soundFontZones(buildSoundFont(simple()), 1);
  assert.equal(zones.length, 2);
  assert.equal(zones[0].keyLow, 0);
  assert.equal(zones[0].keyHigh, 59);
  assert.equal(zones[0].root, 48);
  assert.equal(zones[0].rate, 22050);
  assert.equal(zones[0].data.length, 8);
  assert.equal(zones[0].data[0], 1000 / 32768);
  assert.equal(zones[0].data[7], 8000 / 32768);
  assert.equal(zones[0].loopStart, undefined);
  assert.equal(zones[1].keyLow, 60);
  assert.equal(zones[1].keyHigh, 127);
  assert.equal(zones[1].root, 68);
  assert.equal(zones[1].rate, 32000);
  assert.equal(zones[1].data.length, 6);
  assert.equal(zones[1].data[0], -2000 / 32768);
});

test('fine tune and pitch correction move the root by cents', () => {
  const spec = simple({
    samples: [{ data: ramp(4), pitch: 60, correction: 10 }],
    instruments: [{ name: 'I', zones: [{ gens: [[SAMPLE_ID, 0], [FINE, 40]] }] }],
  });
  const [zone] = soundFontZones(buildSoundFont(spec), 0);
  assert.ok(Math.abs(zone.root - 59.5) < 1e-9);
});

test('a global instrument zone fills in what the others leave out', () => {
  const spec = simple({
    instruments: [{
      name: 'G',
      zones: [
        { gens: [[ROOT, 55], [MODES, 0]] },
        { gens: [keys(0, 63), [SAMPLE_ID, 0]] },
        { gens: [keys(64, 127), [SAMPLE_ID, 1], [ROOT, 80]] },
      ],
    }],
  });
  const zones = soundFontZones(buildSoundFont(spec), 0);
  assert.deepEqual(zones.map(z => z.root), [55, 80]);
});

test('the preset zone key range is intersected with the instrument zones', () => {
  const spec = simple({
    presets: [{ name: 'P', bank: 0, program: 0, zones: [{ gens: [keys(40, 70), [INSTRUMENT, 0]] }] }],
  });
  const zones = soundFontZones(buildSoundFont(spec), 0);
  assert.deepEqual(zones.map(z => [z.keyLow, z.keyHigh]), [[40, 59], [60, 70]]);
});

test('a preset zone outside an instrument zone drops it', () => {
  const spec = simple({
    presets: [{ name: 'P', bank: 0, program: 0, zones: [{ gens: [keys(100, 110), [INSTRUMENT, 0]] }] }],
  });
  const zones = soundFontZones(buildSoundFont(spec), 0);
  assert.deepEqual(zones.map(z => [z.keyLow, z.keyHigh]), [[100, 110]]);
});

test('loop points follow sampleModes and the address offsets', () => {
  const spec = simple({
    samples: [{ data: ramp(40), loop: [10, 30] }],
    instruments: [{
      name: 'L',
      zones: [
        { gens: [keys(0, 49), [SAMPLE_ID, 0], [MODES, 1], [START, 4], [LOOP_START, 2], [LOOP_END, -3], [END, -2]] },
        { gens: [keys(50, 99), [SAMPLE_ID, 0], [MODES, 0]] },
        { gens: [keys(100, 127), [SAMPLE_ID, 0], [MODES, 3], [LOOP_END, 50]] },
      ],
    }],
  });
  const zones = soundFontZones(buildSoundFont(spec), 0);
  assert.equal(zones[0].data.length, 34);
  assert.equal(zones[0].data[0], 5000 / 32768);
  assert.equal(zones[0].loopStart, 8);
  assert.equal(zones[0].loopEnd, 23);
  assert.equal(zones[1].loopStart, undefined);
  assert.equal(zones[1].loopEnd, undefined);
  assert.equal(zones[2].loopStart, undefined);
});

test('ROM samples and samples under two frames are skipped', () => {
  const spec = simple({
    samples: [{ data: ramp(8), type: 0x8001 }, { data: [5] }, { data: ramp(4) }],
    instruments: [{
      name: 'S',
      zones: [
        { gens: [keys(0, 20), [SAMPLE_ID, 0]] },
        { gens: [keys(21, 40), [SAMPLE_ID, 1]] },
        { gens: [keys(41, 60), [SAMPLE_ID, 2]] },
      ],
    }],
  });
  const zones = soundFontZones(buildSoundFont(spec), 0);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].keyLow, 41);
});

test('bad input gives null or nothing and never throws', () => {
  const good = buildSoundFont(simple());
  assert.equal(readSoundFont(good.slice(0, good.byteLength - 20)), null);
  assert.deepEqual(soundFontZones(good.slice(0, good.byteLength - 20), 0), []);
  assert.equal(readSoundFont(good.slice(0, 10)), null);
  assert.equal(readSoundFont(new ArrayBuffer(0)), null);
  const notRiff = new Uint8Array(good.slice(0));
  notRiff[0] = 0x58;
  assert.equal(readSoundFont(notRiff.buffer), null);
  assert.deepEqual(soundFontZones(notRiff.buffer, 0), []);
  assert.deepEqual(soundFontZones(good, 3), []);
  assert.deepEqual(soundFontZones(good, -1), []);
  assert.deepEqual(soundFontZones(good, 1.5), []);
  for (let cut = 0; cut < good.byteLength; cut += 37) {
    readSoundFont(good.slice(0, cut));
    soundFontZones(good.slice(0, cut), 0);
  }
});
