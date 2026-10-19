import test from 'node:test';
import assert from 'node:assert/strict';
import { PERC_CHOICES, type DrumInstrument, type DrumRecordings, type DrumSettings, type PercType } from '@discobot/engine';
import { DrumCore } from '../../engine/src/drums/DrumCore.ts';
import { BUNDLED_WAVES } from './helpers/presetAudit.ts';
import { PERC_TYPES } from '../src/services/builtInWaves.ts';
import { DRUM_INSTRUMENTS, DRUM_KITS } from '../src/services/drumKits.ts';
import { sanitizeDrums } from '../src/services/projectSanitization.ts';
import { renderDrums, type ExportArrangement } from '../src/services/wavExport.ts';

const SR = 48000;
const settings = (patch: Partial<DrumSettings> = {}): DrumSettings => ({ volume: 1, tone: 0.5, extra: 1, tune: 0, humanize: 0, pan: 0, ...patch });
const recordings = (): DrumRecordings => {
  const all: DrumRecordings = {};
  for (const kind of PERC_TYPES) {
    const found = BUNDLED_WAVES.get(`perc-${kind}`);
    assert.ok(found, `the wave file has ${kind}`);
    all[`perc-${kind}`] = { data: found.data, rate: found.rate };
  }
  return all;
};
const core = (withRecordings = true) => { const c = new DrumCore(SR); if (withRecordings) c.setCymbals(recordings()); return c; };
function hit(c: DrumCore, instrument: DrumInstrument, patch: Partial<DrumSettings> = {}, kitId = 'clean-analog') {
  c.trigger({ instrument, settings: settings(patch), velocity: 1, kitId });
  const left = new Float32Array(SR), right = new Float32Array(SR);
  c.process(left, right);
  return left;
}
const same = (a: Float32Array, b: Float32Array) => a.every((value, index) => value === b[index]);
const loudness = (samples: Float32Array) => 10 * Math.log10(Math.max(1e-30, samples.reduce((sum, value) => sum + value * value, 0) / samples.length));

test('each percussion choice plays its recording on its lane, in any kit', () => {
  for (const [lane, kinds] of Object.entries(PERC_CHOICES) as Array<[DrumInstrument, PercType[]]>) {
    for (const percType of kinds) for (const kit of DRUM_KITS.map(entry => entry.id)) {
      const heard = hit(core(), lane, { percType }, kit);
      assert.ok(loudness(heard.subarray(0, SR / 10)) > -35, `${percType} in ${kit} is heard`);
      assert.ok(heard.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
      assert.ok(same(heard, hit(core(), lane, { percType }, 'tr-909')), `${percType} is the same in every kit`);
      assert.ok(!same(heard, hit(core(), lane, {}, kit)), `${percType} is not the lane's own drum`);
    }
  }
  const clap = ['tambourine', 'shaker', 'cowbell'].map(percType => hit(core(), 'clap', { percType: percType as PercType }));
  assert.ok(!same(clap[0], clap[1]) && !same(clap[1], clap[2]) && !same(clap[0], clap[2]));
});

test('a lane without a choice, a choice for another lane, or no recordings is what it was', () => {
  for (const lane of DRUM_INSTRUMENTS) for (const kit of DRUM_KITS.map(entry => entry.id)) {
    assert.ok(same(hit(core(), lane, {}, kit), hit(core(false), lane, {}, kit)), `${lane} in ${kit}`);
  }
  assert.ok(same(hit(core(), 'kick', { percType: 'conga' }), hit(core(false), 'kick')), 'a choice the lane does not have is ignored');
  assert.ok(same(hit(core(false), 'clap', { percType: 'cowbell' }), hit(core(false), 'clap')), 'without the recording the lane plays its own');
});

test('Tune, Decay, Tone and volume act on a percussion recording, and an imported sample comes first', () => {
  const plain = hit(core(), 'clap', { percType: 'cowbell' });
  assert.ok(same(plain, hit(core(), 'clap', { percType: 'cowbell', tone: 1 })));
  assert.ok(!same(plain, hit(core(), 'clap', { percType: 'cowbell', tune: 1 })));
  assert.ok(!same(plain, hit(core(), 'clap', { percType: 'cowbell', extra: 0 })));
  assert.ok(!same(plain, hit(core(), 'clap', { percType: 'cowbell', tone: 0 })));
  assert.ok(Math.abs(loudness(hit(core(), 'clap', { percType: 'cowbell', volume: 0.5 })) - loudness(plain) + 6.02) < 0.1);
  const own = { data: Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index / 5) * 0.5), rate: SR };
  const imported = core(), alone = new DrumCore(SR);
  imported.setSample('clap', own);
  alone.setSample('clap', own);
  assert.ok(same(hit(imported, 'clap', { percType: 'cowbell' }), hit(alone, 'clap')));
});

test('a choice is stored only for a lane that has it, and only when it is not the lane\'s own drum', () => {
  const state = (instrument: DrumInstrument, percType: unknown) => {
    const defaults = Object.fromEntries(DRUM_INSTRUMENTS.map(lane => [lane, { steps: Array(16).fill(false), muted: false, solo: false, settings: settings() }]));
    const input = structuredClone(defaults) as Record<string, { settings: Record<string, unknown> }>;
    input[instrument].settings.percType = percType;
    return sanitizeDrums(input, defaults as never)[instrument].settings.percType;
  };
  assert.equal(state('clap', 'tambourine'), 'tambourine');
  assert.equal(state('snare2', 'conga'), 'conga');
  assert.equal(state('clap', 'conga'), undefined);
  assert.equal(state('clap', 'default'), undefined);
  assert.equal(state('kick', 'shaker'), undefined);
  assert.equal(state('clap', 7), undefined);
});

test('an export renders a percussion choice as the live core does', () => {
  const track = (on: number[], patch: Partial<DrumSettings> = {}) => ({ steps: Array.from({ length: 16 }, (_, index) => on.includes(index)), muted: false, solo: false, settings: settings(patch) });
  const drumState = Object.fromEntries(DRUM_INSTRUMENTS.map(lane => [lane, track(lane === 'clap' ? [0] : [], lane === 'clap' ? { percType: 'tambourine' } : {})])) as unknown as ExportArrangement['drumState'];
  const arrangement = { tempo: 120, drumState, drumKitId: 'clean-analog', drumMasterVolume: 1, drumSwing: 0, drumCymbals: recordings() } as unknown as ExportArrangement;
  const [exported] = renderDrums(arrangement, SR, SR);
  const live = hit(core(), 'clap', { percType: 'tambourine' });
  assert.ok(exported.some(value => Math.abs(value) > 0.01));
  assert.ok(same(exported.subarray(0, 4000), live.subarray(0, 4000)));
  assert.ok(!same(renderDrums({ ...arrangement, drumCymbals: undefined }, SR, SR)[0], exported));
});
