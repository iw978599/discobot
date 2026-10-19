import { KIT_RECORDINGS } from '../src/services/builtInWaves.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CYMBAL_TYPES, SynthCore, createDefaultSynthParameters, toVoiceParams, type SynthSample } from '@discobot/engine';
import { BUILT_IN_WAVES, parseWaveBundle } from '../src/services/builtInWaves.ts';
import { sanitizeSynthParams } from '../src/services/projectSanitization.ts';
import { SYNTH_MODELS, enterSynthModel, mapSynthModelToEngineParams } from '../src/synthModels.ts';
import { BUNDLED_WAVES } from './helpers/presetAudit.ts';
import type { SynthModelId, SynthModelParams, SynthParameters } from '../src/types.ts';

const SR = 48000;
const file = readFileSync(new URL('../public/waves.bin', import.meta.url));
const bytes = (from = 0, to = file.byteLength) => file.buffer.slice(file.byteOffset + from, file.byteOffset + to) as ArrayBuffer;
const wave = (id: string): SynthSample => { const found = BUNDLED_WAVES.get(id); assert.ok(found, id); return found; };

function core(patch: Partial<SynthParameters>, sample: SynthSample | null): SynthCore {
  const made = new SynthCore(SR);
  made.setParams(toVoiceParams({
    ...createDefaultSynthParameters(), engine: 'sample', envelope: { attack: 0.002, decay: 0.1, sustain: 1, release: 0.05 }, ...patch,
  }));
  made.setSample(sample);
  return made;
}
function play(patch: Partial<SynthParameters>, sample: SynthSample | null, note = 'A4', seconds = 1): Float32Array {
  const made = core(patch, sample);
  made.noteOn({ note, velocity: 1 });
  const left = new Float32Array(Math.round(SR * seconds)), right = new Float32Array(left.length);
  made.process(left, right);
  return left;
}
function level(samples: Float32Array, frequency: number): number {
  let best = 0;
  // A recorded instrument is a few cents off, so the note is looked for a little either side.
  for (let hz = frequency * 0.985; hz <= frequency * 1.015; hz *= 1.003) {
    const coefficient = 2 * Math.cos(2 * Math.PI * hz / SR);
    let s1 = 0, s2 = 0;
    for (const value of samples) { const s0 = value + coefficient * s1 - s2; s2 = s1; s1 = s0; }
    best = Math.max(best, Math.sqrt(Math.max(1e-30, s1 * s1 + s2 * s2 - coefficient * s1 * s2)));
  }
  return 20 * Math.log10(best / samples.length);
}
const loudness = (samples: Float32Array) => {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return 10 * Math.log10(Math.max(1e-30, sum / samples.length));
};
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((value, index) => value === b[index]);
const sequence = (scan: number, fade: number) => ({ sample: { root: 60, loop: false, wave: 'seq-overtones', scan, fade } });

test('the wave file holds every sound the menu offers, is small, and a damaged one gives nothing', () => {
  assert.ok(file.byteLength < 1200 * 1024, `${Math.round(file.byteLength / 1024)} KB`);
  // Beside the sample engine's sounds it holds the drum machine's cymbals, one for each kind, and the recorded kit's drums.
  const cymbals = CYMBAL_TYPES.map(kind => `cymbal-${kind}`);
  assert.deepEqual([...BUNDLED_WAVES.keys()].sort(), [...BUILT_IN_WAVES.map(entry => entry.id), ...cymbals, ...KIT_RECORDINGS.map(drum => `kit-${drum}`)].sort());
  for (const id of cymbals) assert.ok(wave(id).data.length > wave(id).rate / 2 && wave(id).rate >= 32000, id);
  for (const entry of BUILT_IN_WAVES) {
    const found = wave(entry.id);
    for (const part of [found, ...(found.zones ?? [])]) {
      assert.ok(part.data.length > 1 && part.data.every(value => Number.isFinite(value) && Math.abs(value) <= 1), entry.id);
      assert.ok(part.data.some(value => Math.abs(value) > 0.5), `${entry.id} is not silent`);
    }
    // A sound the menu says can be stepped through is a table of that many cycles.
    assert.equal(found.frame ? found.data.length / found.frame : undefined, entry.steps, entry.id);
  }
  assert.equal(wave('piano').zones!.length, 4, 'the piano is five notes');
  assert.equal(parseWaveBundle(new ArrayBuffer(0)).size, 0);
  assert.equal(parseWaveBundle(new TextEncoder().encode('not a wave file at all').buffer as ArrayBuffer).size, 0);
  assert.equal(parseWaveBundle(bytes(0, 40)).size, 0, 'cut off inside its list');
  // Cut off inside its audio, the sounds that are whole are kept and the rest left out.
  const short = parseWaveBundle(bytes(0, Math.floor(file.byteLength / 2)));
  assert.ok(short.size < BUNDLED_WAVES.size);
});

test('a recorded instrument plays in tune across the keyboard, each note from the recording made nearest it', () => {
  const piano = wave('piano');
  for (const [note, hz] of [['A1', 55], ['A2', 110], ['A3', 220], ['A4', 440], ['A5', 880], ['A6', 1760]] as const) {
    const heard = play({}, piano, note, 0.6).subarray(SR / 50);
    // A piano's low notes have little at their fundamental, so the note is found by its harmonics.
    const partials = (base: number) => Math.max(...[1, 2, 3, 4, 5, 6].map(n => level(heard, base * n)));
    const off = Math.max(partials(hz * 2 ** (1 / 12)), partials(hz / 2 ** (1 / 12)));
    assert.ok(partials(hz) > off + 10, `${note}: ${partials(hz).toFixed(1)} dB at the note, ${off.toFixed(1)} dB a semitone away`);
  }
  // The other recorded sounds are at the note played too: their roots were measured, not read from a name.
  for (const id of ['mallet', 'attack-pluck', 'attack-bell', 'attack-breath', 'attack-mallet']) {
    const heard = play({}, wave(id), 'A4', 0.15);
    const off = Math.max(level(heard, 440 * 2 ** (2 / 12)), level(heard, 440 / 2 ** (2 / 12)), level(heard, 220), level(heard, 880));
    assert.ok(level(heard, 440) > off + 6, `${id}: ${level(heard, 440).toFixed(1)} dB at the note, ${off.toFixed(1)} dB elsewhere`);
  }
});

test('a single cycle is an oscillator: in tune at any note, and it does not run out', () => {
  for (const id of ['organ', 'choir']) {
    for (const [note, hz] of [['A2', 110], ['A4', 440], ['A5', 880]] as const) {
      const heard = play({}, wave(id), note, 1.5);
      const strongest = Math.max(...[1, 2, 3, 4, 5, 6].map(n => level(heard, hz * n)));
      assert.ok(strongest > -40 && strongest > level(heard, hz * 1.5 ** 0.5) + 20, `${id} ${note}`);
      assert.ok(Math.abs(loudness(heard.subarray(SR)) - loudness(heard.subarray(SR / 2, SR))) < 0.5, `${id} ${note} holds`);
    }
  }
});

test('a sequence steps through its waves at the speed set, abruptly or melting, and stays put at none', () => {
  const still = play(sequence(0, 0), wave('seq-overtones'), 'A3', 1);
  const stepped = play(sequence(4, 0), wave('seq-overtones'), 'A3', 1);
  const melted = play(sequence(4, 1), wave('seq-overtones'), 'A3', 1);
  // Four a second: for the first quarter of a second a stepped sequence is on its first wave, as a still one is.
  const firstTurn = Math.floor(SR * 0.24);
  assert.ok(same(stepped.subarray(0, firstTurn), still.subarray(0, firstTurn)));
  assert.ok(!same(stepped.subarray(firstTurn, firstTurn * 2 + 1000), still.subarray(firstTurn, firstTurn * 2 + 1000)), 'then it has moved on');
  assert.ok(!same(melted.subarray(SR * 0.05, firstTurn), still.subarray(SR * 0.05, firstTurn)), 'melting, the next wave is already coming in');
  // It is the same note throughout, and it comes round: eight waves at four a second is two seconds.
  const long = play(sequence(4, 0), wave('seq-overtones'), 'A3', 2.3);
  const harmonics = (samples: Float32Array) => [1, 2, 3, 4, 5, 6, 7, 8].map(n => Math.round(level(samples, 220 * n)));
  assert.deepEqual(harmonics(long.subarray(SR * 2 + 2400, SR * 2 + 9600)), harmonics(long.subarray(2400, 9600)), 'back at the first wave');
  assert.notDeepEqual(harmonics(long.subarray(SR + 2400, SR + 9600)), harmonics(long.subarray(2400, 9600)), 'and a different one in between');
  for (const samples of [still, stepped, melted]) assert.ok(samples.every(value => Math.abs(value) <= 1));
});

test('an oscillator can sound beside a recording, and then the note goes on after the recording ends', () => {
  const attack = wave('attack-breath');
  const alone = core({}, attack), beside = core({ oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 0, level: 0.6 } }, attack);
  const run = (made: SynthCore) => { made.noteOn({ note: 'A4', velocity: 1 }); const left = new Float32Array(SR), right = new Float32Array(SR); made.process(left, right); return left; };
  const short = run(alone), held = run(beside);
  assert.ok(alone.idle && loudness(short.subarray(SR / 2)) < -90, 'the attack alone is over');
  assert.ok(!beside.idle && loudness(held.subarray(SR / 2)) > -40, 'with the saw under it the note holds');
  assert.ok(level(held.subarray(SR / 2), 440) > -40);
  // The sample's level knob turns the recording down and leaves the oscillator.
  const quiet = core({ oscillator2: { enabled: true, type: 'sawtooth', semitones: 0, detune: 0, level: 0.6 }, mixer: { sub: 0, noise: 0, osc: 0 } }, attack);
  const sawOnly = run(quiet);
  assert.ok(same(sawOnly.subarray(SR / 2), held.subarray(SR / 2)));
  assert.ok(!same(sawOnly.subarray(0, SR / 10), held.subarray(0, SR / 10)));
});

test('a stored built-in sound is checked, and a sound saved before there were any is as it was', () => {
  const defaults = createDefaultSynthParameters();
  assert.deepEqual(sanitizeSynthParams(defaults, defaults).sample, { root: 60, loop: false });
  const kept = sanitizeSynthParams({ ...defaults, engine: 'sample', sample: { root: 60, loop: false, wave: 'seq-fm', scan: 900, fade: -3 } }, defaults);
  assert.deepEqual(kept.sample, { root: 60, loop: false, wave: 'seq-fm', scan: 40, fade: 0 });
  // A name from a later version is kept, and plays the oscillators here; anything that is not a name is dropped.
  assert.equal(sanitizeSynthParams({ ...defaults, sample: { root: 60, loop: false, wave: 'from-the-future' } }, defaults).sample!.wave, 'from-the-future');
  for (const bad of ['', '../waves', 'Has Spaces', 7, null]) {
    assert.equal('wave' in sanitizeSynthParams({ ...defaults, sample: { root: 60, loop: false, wave: bad, scan: 3 } }, defaults).sample!, false);
  }
});

const MIDDLE: SynthModelParams = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
const sound = (id: SynthModelId, macros: Partial<SynthModelParams> = {}) => mapSynthModelToEngineParams(id, { ...MIDDLE, ...macros });
const across = (id: SynthModelId, key: keyof SynthModelParams) => [0, 0.3, 0.6, 1].map(value => sound(id, { [key]: value }).sample!.wave);

test('the M1, the D-50 and the Wavestation play the app\'s own waves, and each knob does what it says', () => {
  const offered = new Set(BUILT_IN_WAVES.map(entry => entry.id));
  for (const [id, key] of [['m1', 'macro1'], ['d-50', 'macro2'], ['wavestation', 'macro1']] as const) {
    const chosen = across(id, key);
    assert.equal(new Set(chosen).size, 4, `${id}: four different sounds across the knob`);
    assert.ok(chosen.every(name => name && offered.has(name)), `${id}: ${chosen.join(', ')}`);
    assert.equal(sound(id).engine, 'sample');
    assert.equal(SYNTH_MODELS.find(model => model.id === id)!.group, 'Digital');
  }
  assert.ok(sound('m1', { macro2: 1 }).filter!.frequency > sound('m1', { macro2: 0 }).filter!.frequency);
  assert.ok(sound('m1', { macro3: 1 }).envelope!.attack > sound('m1', { macro3: 0 }).envelope!.attack);
  assert.ok(sound('m1', { macro4: 1 }).envelope!.release > sound('m1', { macro4: 0 }).envelope!.release);
  // The D-50: the first knob is the recorded attack's level over a saw that is always there.
  assert.deepEqual([sound('d-50', { macro1: 0 }).mixer!.osc, sound('d-50', { macro1: 1 }).mixer!.osc], [0, 1]);
  assert.ok(sound('d-50').oscillator2!.enabled && sound('d-50').oscillator2!.level > 0);
  assert.equal(sound('d-50', { macro4: 0 }).layer!.enabled, false);
  assert.ok(sound('d-50', { macro4: 1 }).layer!.detune > sound('d-50', { macro4: 0.5 }).layer!.detune);
  // The Wavestation: speed and crossfade.
  assert.ok(sound('wavestation', { macro2: 1 }).sample!.scan! > sound('wavestation', { macro2: 0 }).sample!.scan!);
  assert.deepEqual([sound('wavestation', { macro3: 0 }).sample!.fade, sound('wavestation', { macro3: 1 }).sample!.fade], [0, 1]);
  assert.ok(sound('wavestation', { macro4: 1 }).filter!.frequency > sound('wavestation', { macro4: 0 }).filter!.frequency);
  // Any other model takes the lane back to its oscillators.
  for (const other of SYNTH_MODELS.filter(model => !['generic', 'm1', 'd-50', 'wavestation'].includes(model.id))) {
    assert.notEqual(enterSynthModel(other.id, MIDDLE, 'm1').engine, 'sample', other.id);
  }
});
