import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOD_SOURCES, SynthCore, createDefaultSynthParameters, toVoiceParams, type ModRoute } from '@discobot/engine';
import { parseMessage } from '../src/hooks/useMidiInput.ts';
import type { SynthParameters } from '../src/types.ts';

const SR = 48000;

function play(patch: Partial<SynthParameters>, live: { bend?: number; wheel?: number; late?: { bend?: number; wheel?: number; after: number } } = {}, seconds = 1): Float32Array {
  const core = new SynthCore(SR);
  core.setParams(toVoiceParams({
    ...createDefaultSynthParameters(), oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 },
    envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.1 }, ...patch,
  }));
  if (live.bend !== undefined) core.setBend(live.bend);
  if (live.wheel !== undefined) core.setWheel(live.wheel);
  core.noteOn({ note: 'A2', velocity: 1 });
  const total = Math.round(SR * seconds), left = new Float32Array(total), right = new Float32Array(total);
  const cut = live.late ? Math.round(SR * live.late.after) : total;
  core.process(left.subarray(0, cut), right.subarray(0, cut));
  if (live.late) {
    if (live.late.bend !== undefined) core.setBend(live.late.bend);
    if (live.late.wheel !== undefined) core.setWheel(live.late.wheel);
    core.process(left.subarray(cut), right.subarray(cut));
  }
  return left;
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((sample, index) => sample === b[index]);
const pitch = (samples: Float32Array) => {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  return crossings * SR / samples.length;
};
const route = (source: ModRoute['source'], destination: ModRoute['destination'], depth: number): ModRoute => ({ source, destination, depth });

test('with no bend and no wheel the core plays exactly as it did', () => {
  const plain = play({});
  assert.ok(same(play({}, { bend: 0, wheel: 0 }), plain));
  assert.ok(same(play({ modMatrix: [route('modWheel', 'pitch', 1)] }), plain), 'a wheel at rest moves nothing');
  const bent = play({}, { bend: 1 });
  assert.ok(!same(bent, plain));
});

test('pitch bend shifts the pitch by two semitones at full travel, either way, and returns', () => {
  const plain = pitch(play({}, {}, 1).subarray(6000));
  const up = pitch(play({}, { bend: 1 }, 1).subarray(6000));
  const down = pitch(play({}, { bend: -1 }, 1).subarray(6000));
  const half = pitch(play({}, { bend: 0.5 }, 1).subarray(6000));
  assert.ok(Math.abs(up / plain - 2 ** (2 / 12)) < 0.015, `up ${up / plain}`);
  assert.ok(Math.abs(down / plain - 2 ** (-2 / 12)) < 0.015, `down ${down / plain}`);
  assert.ok(Math.abs(half / plain - 2 ** (1 / 12)) < 0.015, `half ${half / plain}`);
  const back = play({}, { bend: 1, late: { bend: 0, after: 0.2 } }, 1);
  assert.ok(Math.abs(pitch(back.subarray(Math.round(SR * 0.7))) / plain - 1) < 0.01);
});

test('a stepped bend is smoothed, not a jump in pitch', () => {
  const stepped = play({}, { bend: 0, late: { bend: 1, after: 0.2 } }, 0.4);
  const plain = play({}, {}, 0.4);
  const at = Math.round(SR * 0.2);
  assert.ok(same(stepped.subarray(0, at), plain.subarray(0, at)));
  let moved = 0;
  for (let i = at; i < at + 48 && moved === 0; i++) if (stepped[i] !== plain[i]) moved = i - at + 1;
  assert.ok(moved > 0, 'the bend starts at once');
  assert.ok(Math.abs(stepped[at + 1] - plain[at + 1]) < 0.05, 'but gently');
});

test('the mod wheel moves a routed destination and a sound that does not route it ignores it', () => {
  const routed = { modMatrix: [route('modWheel', 'pitch', 0.5)] };
  const rest = play(routed, { wheel: 0 }, 0.5), full = play(routed, { wheel: 1 }, 0.5);
  assert.ok(Math.abs(pitch(full.subarray(2000)) / pitch(rest.subarray(2000)) - 2 ** 0.5) < 0.02);
  assert.ok(same(play({}, { wheel: 1 }), play({})), 'unrouted is bit-identical');
  assert.ok(same(play({ modMatrix: [route('velocity', 'pitch', 0.5)] }, { wheel: 1 }), play({ modMatrix: [route('velocity', 'pitch', 0.5)] })));
});

test('the new source is named in every place that lists the sources, in the same position', () => {
  assert.equal(MOD_SOURCES.indexOf('modWheel'), 7);
  const core = readFileSync(new URL('../../engine/src/synth/SynthCore.ts', import.meta.url), 'utf8');
  const list = /const MOD_SOURCES = \[([^\]]*)\]/.exec(core)![1].split(',').map(name => name.trim().replace(/'/g, ''));
  assert.deepEqual(list, MOD_SOURCES);
  const controls = readFileSync(new URL('../src/components/SynthControls.tsx', import.meta.url), 'utf8');
  for (const source of MOD_SOURCES) assert.ok(new RegExp(`\\b${source}: '`).test(controls), source);
  assert.ok(/modWheel: 'Mod wheel'/.test(controls));
});

test('a MIDI pitch bend message is read as -1 to 1 with the centre at rest', () => {
  const read = (low: number, high: number, status = 0xe0) => parseMessage({ data: new Uint8Array([status, low, high]) });
  assert.deepEqual(read(0, 64), { type: 'pitchBend', value: 0, channel: 1 });
  assert.deepEqual(read(127, 127), { type: 'pitchBend', value: 1, channel: 1 });
  assert.deepEqual(read(0, 0, 0xe2), { type: 'pitchBend', value: -1, channel: 3 });
  assert.deepEqual(parseMessage({ data: new Uint8Array([0xb0, 1, 100]) }), { type: 'controlChange', controller: 1, value: 100, channel: 1 });
});

test('aftertouch is a route source like the wheel: it moves what is routed and nothing else', () => {
  const press = (patch: Partial<SynthParameters>, pressure: number) => {
    const core = new SynthCore(SR);
    core.setParams(toVoiceParams({ ...createDefaultSynthParameters(), oscillator: { type: 'sawtooth', detune: 0, pulseWidth: 0.5 }, envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.1 }, ...patch }));
    core.setPressure(pressure);
    core.noteOn({ note: 'A2', velocity: 1 });
    const left = new Float32Array(SR / 2), right = new Float32Array(SR / 2);
    core.process(left, right);
    return left;
  };
  assert.equal(MOD_SOURCES.indexOf('pressure'), 8);
  const routed = { modMatrix: [route('pressure', 'pitch', 0.5)] };
  assert.ok(same(press(routed, 0), play(routed, {}, 0.5)), 'no pressure, no change');
  assert.ok(pitch(press(routed, 1).subarray(6000)) / pitch(press(routed, 0).subarray(6000)) > 1.3, 'full pressure lifts the pitch half an octave');
  assert.ok(same(press({}, 1), play({}, {}, 0.5)), 'unrouted is bit-identical');
});

test('MIDI aftertouch, of the channel or of one key, is read as 0 to 1, and a clock\'s real-time messages by kind', () => {
  assert.deepEqual(parseMessage({ data: new Uint8Array([0xd2, 127]) }), { type: 'pressure', value: 1, channel: 3 });
  assert.deepEqual(parseMessage({ data: new Uint8Array([0xa0, 60, 0]) }), { type: 'pressure', value: 0, channel: 1 });
  for (const [byte, type] of [[0xf8, 'clock'], [0xfa, 'start'], [0xfb, 'continue'], [0xfc, 'stop']] as const) {
    assert.deepEqual(parseMessage({ data: new Uint8Array([byte]), timeStamp: 12.5 }), { type, at: 12.5 });
  }
  assert.equal(parseMessage({ data: new Uint8Array([0xf9]) }), null, 'an undefined real-time byte is nothing');
  assert.equal(parseMessage({ data: new Uint8Array([]) }), null);
});
