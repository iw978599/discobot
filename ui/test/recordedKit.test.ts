import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CYMBAL_TYPES, type DrumInstrument, type DrumRecordings, type DrumSettings } from '@discobot/engine';
import { DrumCore, RECORDED_KITS, type DrumSample } from '../../engine/src/drums/DrumCore.ts';
import { BUNDLED_WAVES } from './helpers/presetAudit.ts';
import { type ExportArrangement, renderDrums } from '../src/services/wavExport.ts';
import { DRUM_KITS } from '../src/services/drumKits.ts';
import { KIT_FILES, KIT_RECORDINGS, parseWaveBundle } from '../src/services/builtInWaves.ts';
import { sanitizeKit } from '../src/services/projectSanitization.ts';

const SR = 48000;
const DRUMS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const OLD_KITS = ['clean-analog', 'punchy-modern', 'lofi-dirty', 'tr-808', 'tr-909', 'linndrum', 'oberheim-dmx', 'tr-707'];
const settings = (patch: Partial<DrumSettings> = {}): DrumSettings => ({ volume: 1, tone: 0.5, extra: 1, tune: 0, humanize: 0, pan: 0, ...patch });

// What the app hands the core: the cymbals by kind and the recorded kit's drums.
const recordings = (): DrumRecordings => {
  const all: DrumRecordings = {};
  for (const kind of CYMBAL_TYPES) all[kind] = BUNDLED_WAVES.get(`cymbal-${kind}`);
  for (const drum of KIT_RECORDINGS) {
    const found = BUNDLED_WAVES.get(`kit-${drum}`);
    assert.ok(found, `the wave file has a recording for ${drum}`);
    all[`kit-${drum}`] = { data: found.data, rate: found.rate };
  }
  return all;
};
const withRecordings = () => { const core = new DrumCore(SR); core.setCymbals(recordings()); return core; };
function hit(core: DrumCore, instrument: DrumInstrument, patch: Partial<DrumSettings> = {}, kitId = 'recorded', seconds = 1.2) {
  core.trigger({ instrument, settings: settings(patch), velocity: 1, kitId });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left;
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((value, index) => value === b[index]);
const loudness = (samples: Float32Array) => 10 * Math.log10(Math.max(1e-30, samples.reduce((sum, value) => sum + value * value, 0) / samples.length));
const brightness = (samples: Float32Array) => samples.reduce((sum, value, index) => sum + (index ? (value - samples[index - 1]) ** 2 : 0), 0) / samples.reduce((sum, value) => sum + value * value, 1e-30);

test('the recorded kit is in the kit list, and a stored kit id is read back', () => {
  const kit = DRUM_KITS.find(entry => entry.id === 'recorded');
  assert.equal(kit?.name, 'Recorded');
  assert.equal(sanitizeKit('recorded'), 'recorded');
  assert.equal(sanitizeKit('nonsense'), 'clean-analog');
  assert.equal(DRUM_KITS[0].id, 'clean-analog');
});

test('every other kit sounds as it did, whether or not the recordings are loaded', () => {
  for (const kit of OLD_KITS) for (const drum of DRUMS) {
    const before = hit(new DrumCore(SR), drum, {}, kit);
    if (drum === 'crash') continue;
    assert.ok(same(hit(withRecordings(), drum, {}, kit), before), `${kit} ${drum}`);
  }
  // With nothing loaded the recorded kit is the synthesized voice, not silence.
  for (const drum of DRUMS) assert.ok(same(hit(new DrumCore(SR), drum, {}, 'recorded'), hit(new DrumCore(SR), drum, {}, 'clean-analog')), drum);
});

test('in the recorded kit every drum plays its own recording', () => {
  const heard = new Map<string, Float32Array>();
  for (const drum of DRUMS) {
    const samples = hit(withRecordings(), drum);
    heard.set(drum, samples);
    assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1), drum);
    assert.ok(loudness(samples.subarray(0, SR / 10)) > -35, `${drum} is heard`);
    if (drum !== 'crash') assert.ok(!same(samples, hit(new DrumCore(SR), drum, {}, 'clean-analog')), `${drum} is not the synthesized voice`);
  }
  for (const a of DRUMS) for (const b of DRUMS) if (a < b) assert.ok(!same(heard.get(a)!, heard.get(b)!), `${a} and ${b} differ`);
  // It is the recording itself at the hit's level.
  const kick = BUNDLED_WAVES.get('kit-kick')!, frame = 600, at = frame * kick.rate / SR, index = Math.floor(at);
  const expected = (kick.data[index] + (kick.data[index + 1] - kick.data[index]) * (at - index)) * 0.7 * Math.SQRT1_2;
  assert.ok(Math.abs(heard.get('kick')![frame] - expected) < 1e-3);
  // The cymbal lane is the same in this kit as in any other.
  assert.ok(same(heard.get('crash')!, hit(withRecordings(), 'crash', {}, 'tr-909')));
});

test('Tune, Decay and Tone act on a recording, and are untouched at the top and middle', () => {
  for (const drum of ['kick', 'snare', 'openHH', 'snare2'] as const) {
    const darkens = drum !== 'kick';
    const plain = hit(withRecordings(), drum);
    assert.ok(same(plain, hit(withRecordings(), drum, { tone: 1 })), `${drum}: Tone above the middle is the recording`);
    const short = hit(withRecordings(), drum, { extra: 0 });
    assert.ok(loudness(short.subarray(SR * 0.3, SR * 0.5)) < loudness(plain.subarray(SR * 0.3, SR * 0.5)) - 6, `${drum}: Decay shortens it`);
    assert.ok(darkens ? brightness(hit(withRecordings(), drum, { tone: 0 })) < brightness(plain) * 0.7 : !same(hit(withRecordings(), drum, { tone: 0 }), plain), `${drum}: Tone darkens it`);
    assert.ok(brightness(hit(withRecordings(), drum, { tune: 1 })) > brightness(plain), `${drum}: Tune up plays faster`);
    assert.ok(Math.abs(loudness(hit(withRecordings(), drum, { volume: 0.5 })) - loudness(plain) + 6.02) < 0.1, `${drum}: Volume`);
  }
});

test('pan, choke and an imported sample behave as for any drum', () => {
  const left = hit(withRecordings(), 'snare', { pan: -1 });
  const core = withRecordings();
  core.trigger({ instrument: 'snare', settings: settings({ pan: 1 }), velocity: 1, kitId: 'recorded' });
  const l = new Float32Array(4800), r = new Float32Array(4800);
  core.process(l, r);
  assert.ok(loudness(l) < -60 && loudness(r) > -40 && loudness(left) > -40);

  const choke = withRecordings();
  const tail = new Float32Array(SR), junk = new Float32Array(SR);
  choke.trigger({ instrument: 'openHH', settings: settings(), velocity: 1, kitId: 'recorded' });
  choke.process(new Float32Array(2400), new Float32Array(2400));
  choke.trigger({ instrument: 'closedHH', settings: settings({ volume: 0 }), velocity: 1, kitId: 'recorded' });
  choke.trigger({ instrument: 'closedHH', settings: settings(), velocity: 1, kitId: 'recorded' });
  choke.process(tail, junk);
  assert.ok(loudness(tail.subarray(SR * 0.6)) < -80 || tail.subarray(SR * 0.6).every(value => Math.abs(value) < 0.002), 'the open hat is cut by the closed one');

  const own: DrumSample = { data: Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index / 5) * 0.5), rate: SR };
  const imported = withRecordings(), alone = new DrumCore(SR);
  imported.setSample('kick', own);
  alone.setSample('kick', own);
  assert.ok(same(hit(imported, 'kick', { extra: 0 }), hit(alone, 'kick', { extra: 0 }, 'recorded')));
});

test('an export renders the recorded kit as the live core does', () => {
  const steps = (on: number[]) => Array.from({ length: 16 }, (_, index) => on.includes(index));
  const track = (on: number[]) => ({ steps: steps(on), muted: false, solo: false, settings: settings() });
  const drumState = Object.fromEntries(DRUMS.map(drum => [drum, track(drum === 'kick' ? [0] : drum === 'snare' ? [4] : [])])) as unknown as ExportArrangement['drumState'];
  const arrangement = { tempo: 120, drumState, drumKitId: 'recorded', drumMasterVolume: 1, drumSwing: 0, drumCymbals: recordings() } as unknown as ExportArrangement;
  const frames = SR * 2;
  const [exported] = renderDrums(arrangement, frames, SR);
  const core = withRecordings();
  const live = new Float32Array(frames), liveR = new Float32Array(frames);
  core.trigger({ instrument: 'kick', settings: settings(), velocity: 1, kitId: 'recorded' });
  core.process(live.subarray(0, SR / 2), liveR.subarray(0, SR / 2));
  assert.ok(exported.some(value => Math.abs(value) > 0.01));
  assert.ok(same(exported.subarray(0, 4000), live.subarray(0, 4000)), 'the first hit is the live hit');
  const without = renderDrums({ ...arrangement, drumCymbals: undefined }, frames, SR)[0];
  assert.ok(!same(without, exported), 'and without the recordings it is the synthesized kit');
});

// The recorded kits after the first, each from a file of its own (scripts/build-waves.mjs, `KITS`).
const kitFile = (kit: string) => {
  const bytes = readFileSync(`ui/public/${KIT_FILES[kit as keyof typeof KIT_FILES]}`);
  return parseWaveBundle(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const LATER_KITS = Object.keys(RECORDED_KITS).filter(kit => kit !== 'recorded');

test('the later recorded kits are listed, read back, and each has a small file of its own drums', () => {
  assert.deepEqual(LATER_KITS, ['gogodze', 'swirly']);
  assert.deepEqual(Object.keys(KIT_FILES).sort(), [...LATER_KITS].sort());
  for (const kit of LATER_KITS) {
    assert.ok(DRUM_KITS.find(entry => entry.id === kit)?.name.startsWith('Recorded: '), kit);
    assert.equal(sanitizeKit(kit), kit);
    const waves = kitFile(kit);
    // Every drum but the clap and the cymbal, which play the first kit's and the cymbal recordings.
    assert.deepEqual([...waves.keys()].sort(), KIT_RECORDINGS.filter(drum => drum !== 'clap').map(drum => `${kit}-${drum}`).sort());
    assert.ok(statSync(`ui/public/${KIT_FILES[kit as keyof typeof KIT_FILES]}`).size < 300_000, `${kit} is small`);
  }
});

test('a later recorded kit plays its own drums, and the first kit\'s for one it lacks or has not loaded', () => {
  for (const kit of LATER_KITS) {
    const own = recordings();
    for (const [id, sample] of kitFile(kit)) own[id] = { data: sample.data, rate: sample.rate };
    const core = () => { const made = new DrumCore(SR); made.setCymbals(own); return made; };
    for (const drum of DRUMS) {
      const heard = hit(core(), drum, {}, kit), first = hit(withRecordings(), drum, {}, 'recorded');
      assert.ok(heard.every(value => Number.isFinite(value) && Math.abs(value) <= 1), `${kit} ${drum}`);
      assert.ok(loudness(heard.subarray(0, SR / 10)) > -35, `${kit} ${drum} is heard`);
      if (drum === 'clap' || drum === 'crash') assert.ok(same(heard, first), `${kit} ${drum} is the first kit's`);
      else assert.ok(!same(heard, first), `${kit} ${drum} is its own`);
      // Before its file has arrived the kit plays the first kit's recordings.
      assert.ok(same(hit(withRecordings(), drum, {}, kit), first), `${kit} ${drum} before its file`);
    }
  }
});
