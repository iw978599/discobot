import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import type { SynthParameters } from '../src/types.ts';

const SR = 48000;
type Layer = NonNullable<SynthParameters['layer']>;
const layer = (extra: Partial<Layer> = {}): Layer => ({ enabled: true, mix: 0.5, detune: 0, brightness: 0, attack: 0, width: 0, ...extra });
// A4, and where a second layer tuned 50 cents over it sounds.
const FIRST = 440, SECOND = 440 * 2 ** (50 / 1200);

function core(patch: Partial<SynthParameters>): SynthCore {
  const base = createDefaultSynthParameters();
  const made = new SynthCore(SR);
  made.setParams(toVoiceParams({ ...base, envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.1 }, ...patch }));
  return made;
}
function play(patch: Partial<SynthParameters>, seconds = 1, skip = SR / 10): [Float32Array, Float32Array] {
  const made = core(patch);
  made.noteOn({ note: 'A4', velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  made.process(left, right);
  return [left.subarray(skip), right.subarray(skip)];
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((sample, index) => sample === b[index]);
function level(samples: Float32Array, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / SR);
  let s1 = 0, s2 = 0;
  for (const sample of samples) { const s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return 20 * Math.log10(Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / samples.length);
}
const loudness = (samples: Float32Array) => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return 10 * Math.log10(Math.max(1e-30, sum / samples.length));
};
const sounding = (made: SynthCore) => made.voices.filter(voice => voice.active).length;
const saw = { type: 'sawtooth' as const, detune: 0, pulseWidth: 0.5 };

test('a sound saved before there could be a second layer plays exactly as it did', () => {
  const [plain] = play({ oscillator: saw });
  // Switched off, nothing the layer is set to is heard.
  const [off] = play({ oscillator: saw, layer: layer({ enabled: false, mix: 0.9, detune: 40, brightness: 2, attack: 3, width: 1 }) });
  assert.ok(same(plain, off));
  const defaults = createDefaultSynthParameters();
  const old = structuredClone(defaults) as unknown as Record<string, unknown>;
  delete old.layer;
  const loaded = sanitizeSynthParams(old, defaults);
  assert.deepEqual(loaded.layer, { enabled: false, mix: 0.5, detune: 8, brightness: 0, attack: 0, width: 0 });
  assert.equal(toVoiceParams(old as unknown as SynthParameters).layerEnabled, false, 'and a sound with none stored has one layer');
  const hostile = sanitizeSynthParams({ ...defaults, layer: { enabled: 'yes', mix: 9, detune: -4000, brightness: 99, attack: 1e9, width: Number.NaN } }, defaults);
  assert.deepEqual(hostile.layer, { enabled: false, mix: 1, detune: -50, brightness: 3, attack: 5, width: 0 });
});

test('a layered note is two voices, the second tuned against the first, and the mix sets how much of each', () => {
  const [both] = play({ layer: layer({ detune: 50 }) });
  assert.ok(level(both, FIRST) > -40 && level(both, SECOND) > -40, 'both pitches are there');
  assert.ok(Math.abs(level(both, FIRST) - level(both, SECOND)) < 1, 'and as loud as each other at the middle');
  const [first] = play({ layer: layer({ detune: 50, mix: 0 }) });
  assert.ok(level(first, SECOND) < level(first, FIRST) - 30, 'at one end only the first');
  const [second] = play({ layer: layer({ detune: 50, mix: 1 }) });
  assert.ok(level(second, FIRST) < level(second, SECOND) - 30, 'at the other only the second');
  // Tuned apart, the two together are about as loud as the one was.
  const [one] = play({});
  assert.ok(Math.abs(loudness(both) - loudness(one)) < 1.5, `two layers ${loudness(both).toFixed(1)} dB, one ${loudness(one).toFixed(1)} dB`);
});

test('the second layer can be brighter, slower to arrive, and to one side', () => {
  const dark = { ...createDefaultSynthParameters().filter, frequency: 500 };
  const harmonics = (samples: Float32Array) => { let sum = 0; for (let n = 6; n <= 12; n++) sum += 10 ** (level(samples, FIRST * n) / 10); return 10 * Math.log10(sum); };
  const [level0] = play({ oscillator: saw, filter: dark, layer: layer({ mix: 1 }) });
  const [brighter] = play({ oscillator: saw, filter: dark, layer: layer({ mix: 1, brightness: 2 }) });
  const [darker] = play({ oscillator: saw, filter: dark, layer: layer({ mix: 1, brightness: -2 }) });
  assert.ok(harmonics(brighter) > harmonics(level0) + 10 && harmonics(darker) < harmonics(level0) - 10);
  // The first layer's filter does not move with it.
  const [firstOnly] = play({ oscillator: saw, filter: dark, layer: layer({ mix: 0, brightness: 2 }) });
  const [firstPlain] = play({ oscillator: saw, filter: dark, layer: layer({ mix: 0 }) });
  assert.ok(same(firstOnly, firstPlain));

  // Swell: a twentieth of a second in, the second layer has hardly begun. A second later it has arrived.
  const early = (samples: Float32Array) => loudness(samples.subarray(SR * 0.03, SR * 0.06));
  const [quick] = play({ layer: layer({ mix: 1 }) }, 3, 0);
  const [slow] = play({ layer: layer({ mix: 1, attack: 2 }) }, 3, 0);
  assert.ok(early(slow) < early(quick) - 20, `${(early(quick) - early(slow)).toFixed(1)} dB quieter at the start`);
  assert.ok(Math.abs(loudness(slow.subarray(SR * 2.7)) - loudness(quick.subarray(SR * 2.7))) < 1, 'and as loud once it is in');
  const [firstSlow] = play({ layer: layer({ mix: 0, attack: 2 }) }, 3, 0);
  assert.ok(Math.abs(early(firstSlow) - early(quick)) < 1, 'the first layer comes in when it always did');

  // Width: the first layer on the left and the second on the right.
  const [left, right] = play({ layer: layer({ detune: 50, width: 1 }) });
  assert.ok(level(left, FIRST) > level(left, SECOND) + 30 && level(right, SECOND) > level(right, FIRST) + 30);
  const [together, alsoTogether] = play({ layer: layer({ detune: 50 }) });
  assert.ok(Math.abs(level(together, SECOND) - level(alsoTogether, SECOND)) < 0.1, 'with no width both are in the middle');
});

test('two layers take two voices a note, a note ends on both, and a mono lane slides both', () => {
  const poly = core({ layer: layer() });
  const buffer = () => [new Float32Array(256), new Float32Array(256)] as const;
  poly.noteOn({ note: 'C4', id: 1 });
  assert.equal(sounding(poly), 2);
  for (const [index, note] of ['E4', 'G4', 'B4'].entries()) poly.noteOn({ note, id: index + 2 });
  assert.equal(sounding(poly), 8, 'four notes fill all eight voices');
  // A fifth takes both voices of the oldest note, not one voice each of two.
  poly.noteOn({ note: 'D5', id: 6 });
  const notes = poly.voices.map(voice => voice.note).sort();
  assert.deepEqual(notes, ['B4', 'B4', 'D5', 'D5', 'E4', 'E4', 'G4', 'G4']);
  // Played again while it sounds, a note takes its own two voices back.
  poly.noteOn({ note: 'E4', id: 7 });
  assert.deepEqual(poly.voices.map(voice => voice.note).sort(), notes);
  poly.noteOff('E4');
  assert.equal(poly.voices.filter(voice => voice.note === 'E4' && voice.amp.stage === 'release').length, 2);
  poly.allNotesOff(0.005);
  for (let block = 0; block < 400 && !poly.idle; block++) poly.process(...buffer());
  assert.ok(poly.idle);

  const mono = core({ voiceMode: 'mono', layer: layer({ detune: 50 }) });
  mono.noteOn({ note: 'A3', id: 1 });
  mono.process(...buffer());
  mono.noteOn({ note: 'A4', id: 2 });
  assert.equal(sounding(mono), 2);
  assert.deepEqual(mono.voices.slice(0, 2).map(voice => [voice.note, voice.layer]), [['A4', 0], ['A4', 1]]);
  assert.deepEqual(mono.voices.slice(0, 2).map(voice => voice.amp.stage === 'release'), [false, false], 'neither is struck again');

  // One layer, and the same five notes each have a voice of their own.
  const single = core({});
  for (const [index, note] of ['C4', 'E4', 'G4', 'B4', 'D5'].entries()) single.noteOn({ note, id: index });
  assert.equal(sounding(single), 5);
});
