import test from 'node:test';
import assert from 'node:assert/strict';
import { CYMBAL_TYPES, type CymbalType, type DrumSettings } from '@discobot/engine';
import { DrumCore, type DrumSample } from '../../engine/src/drums/DrumCore.ts';
import { BUNDLED_WAVES } from './helpers/presetAudit.ts';

const SR = 48000;
const KITS = ['clean-analog', 'punchy-modern', 'lofi-dirty', 'tr-808', 'tr-909', 'linndrum', 'dmx', 'tr-707'];
const settings = (patch: Partial<DrumSettings> = {}): DrumSettings => ({ volume: 1, tone: 0.5, extra: 1, tune: 0, humanize: 0, pan: 0, ...patch });
const cymbals = () => Object.fromEntries(CYMBAL_TYPES.map(kind => {
  const found = BUNDLED_WAVES.get(`cymbal-${kind}`);
  assert.ok(found, `the wave file has a ${kind}`);
  return [kind, { data: found.data, rate: found.rate }];
})) as Record<CymbalType, DrumSample>;

function hit(core: DrumCore, patch: Partial<DrumSettings> = {}, kitId = 'clean-analog', seconds = 1) {
  core.trigger({ instrument: 'crash', settings: settings(patch), velocity: 1, kitId });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  core.process(left, right);
  return left;
}
const recorded = () => { const core = new DrumCore(SR); core.setCymbals(cymbals()); return core; };
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((value, index) => value === b[index]);
const loudness = (samples: Float32Array) => 10 * Math.log10(Math.max(1e-30, samples.reduce((sum, value) => sum + value * value, 0) / samples.length));
// How much of a sound is in its sample-to-sample change: high for something bright.
const brightness = (samples: Float32Array) => samples.reduce((sum, value, index) => sum + (index ? (value - samples[index - 1]) ** 2 : 0), 0) / samples.reduce((sum, value) => sum + value * value, 1e-30);

test('the cymbal lane plays a recording of the cymbal chosen, the same one in every kit', () => {
  const synthesized = hit(new DrumCore(SR));
  const heard = new Map(CYMBAL_TYPES.map(kind => [kind, hit(recorded(), { cymbalType: kind })]));
  for (const [kind, samples] of heard) {
    assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1), kind);
    assert.ok(loudness(samples.subarray(0, SR / 10)) > -30, `${kind} is heard`);
    assert.ok(!same(samples, synthesized), `${kind} is not the synthesized cymbal`);
  }
  // Four different cymbals, and a lane with no kind chosen is the crash, as it always was.
  for (const a of CYMBAL_TYPES) for (const b of CYMBAL_TYPES) if (a < b) assert.ok(!same(heard.get(a)!, heard.get(b)!), `${a} and ${b} differ`);
  assert.ok(same(hit(recorded()), heard.get('crash')!));
  // A recording is not the kit's voice: it is not coloured by the kit.
  for (const kit of KITS) assert.ok(same(hit(recorded(), { cymbalType: 'ride' }, kit), heard.get('ride')!), kit);
  // It is the recording itself: the start of the crash is the start of the file, at the hit's level.
  const crash = cymbals().crash, played = heard.get('crash')!;
  const frame = 3000, at = frame * crash.rate / SR, index = Math.floor(at);
  const expected = (crash.data[index] + (crash.data[index + 1] - crash.data[index]) * (at - index)) * 0.7 * Math.SQRT1_2;
  assert.ok(Math.abs(played[frame] - expected) < 1e-3, `${played[frame]} against ${expected}`);
});

test('Decay shortens a cymbal, Tone darkens it, and the other knobs still work', () => {
  const full = hit(recorded(), { extra: 1 }, 'clean-analog', 2);
  const middle = hit(recorded(), { extra: 0.5 }, 'clean-analog', 2);
  const choked = hit(recorded(), { extra: 0 }, 'clean-analog', 2);
  const tail = (samples: Float32Array) => loudness(samples.subarray(SR * 0.5, SR * 0.7));
  assert.ok(tail(choked) < tail(middle) - 20 && tail(middle) < tail(full), `${tail(choked).toFixed(1)}, ${tail(middle).toFixed(1)}, ${tail(full).toFixed(1)} dB`);
  assert.ok(tail(full) - tail(middle) < 6, 'the middle of the knob is still a long cymbal');
  assert.ok(Math.abs(loudness(choked.subarray(0, 480)) - loudness(full.subarray(0, 480))) < 1.5, 'the strike itself is as loud');
  assert.ok(choked.subarray(SR).every(value => value === 0), 'a choked cymbal ends');

  const open = hit(recorded(), { tone: 0.5 }), top = hit(recorded(), { tone: 1 }), dark = hit(recorded(), { tone: 0 });
  assert.ok(same(open, top), 'from the middle up it is the recording as it is');
  assert.ok(brightness(dark) < brightness(open) * 0.5, `${brightness(dark).toFixed(3)} against ${brightness(open).toFixed(3)}`);

  const quiet = hit(recorded(), { volume: 0.5 });
  assert.ok(Math.abs(loudness(quiet) - loudness(open) + 6.02) < 0.1);
  const up = hit(recorded(), { tune: 1 });
  assert.ok(brightness(up) > brightness(open), 'tuned up it plays faster and brighter');
});

test('without the recordings the cymbal is the synthesized one it was, and an imported sample still comes first', () => {
  for (const cymbalType of ['crash', 'ride'] as const) {
    const before = hit(new DrumCore(SR), { cymbalType });
    const emptied = new DrumCore(SR);
    emptied.setCymbals(cymbals());
    emptied.setCymbals(null);
    assert.ok(same(hit(emptied, { cymbalType }), before), cymbalType);
  }
  // A kind with no recording, or nonsense handed over, falls back and does not fail.
  const partial = new DrumCore(SR);
  partial.setCymbals({ ride: cymbals().ride, bell: { data: new Float32Array(1), rate: 32000 }, crash: { data: new Float32Array(100), rate: 0 } });
  assert.ok(same(hit(partial, { cymbalType: 'crash' }), hit(new DrumCore(SR), { cymbalType: 'crash' })));
  assert.ok(loudness(hit(partial, { cymbalType: 'bell' })) > -40);

  const own: DrumSample = { data: Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index / 5) * 0.5), rate: SR };
  const imported = recorded();
  imported.setSample('crash', own);
  const alone = new DrumCore(SR);
  alone.setSample('crash', own);
  assert.ok(same(hit(imported, { cymbalType: 'ride', extra: 0 }), hit(alone, { cymbalType: 'ride', extra: 0 })), 'and Decay does not touch an imported sample');
  // The other lanes are not cymbals.
  const other = (core: DrumCore) => { core.trigger({ instrument: 'ride', settings: settings(), velocity: 1, kitId: 'clean-analog' }); const left = new Float32Array(4800); core.process(left, new Float32Array(4800)); return left; };
  assert.ok(same(other(recorded()), other(new DrumCore(SR))));
});
