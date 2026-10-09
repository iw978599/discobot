import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSynthParameters } from '../../engine/src/synth/voiceParams.ts';
import { exportPreset, importPreset } from '../src/services/presetImport.ts';

const defaults = createDefaultSynthParameters();
const near = (actual: number, expected: number, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
const imported = (file: unknown, name?: string) => {
  const result = importPreset(file, defaults, name);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.ok ? result.preset : (undefined as never);
};

// A VAST G1-J8 preset, with the meanings its own parameter table gives.
const vast = (params: Record<string, number>) => ({ format: 'websynth-preset', version: 1, name: '1985-1', params: {
  'voicing.mode': 0, 'osc1.wave': 2, 'osc1.octave': -1, 'osc1.detune': 0, 'osc1.level': 0.8, 'osc1.pulseWidth': 0.7,
  'osc2.wave': 3, 'osc2.octave': 0, 'osc2.detune': 5, 'osc2.level': 0.4, 'osc2.pulseWidth': 0.7, 'sub.wave': 0, 'sub.octave': -1, 'sub.level': 0.9,
  'unison.voices': 3, 'unison.detune': 25, 'analog.drift': 0.2, 'mixer.noise': 0.18, 'mixer.glide': 0.08, 'glide.mode': 1,
  'filter.cutoff': 69, 'filter.resonance': 2.1, 'filter.drive': 3.5, 'filter.envAmount': -30, 'filter.velAmount': 0.5, 'filter.model': 1, 'filter.shape': 0.66, 'filter.keytrack': 0.8,
  'env.amp.attack': 0.004, 'env.amp.decay': 0.25, 'env.amp.sustain': 1, 'env.amp.release': 0.14,
  'env.fil.attack': 0.07, 'env.fil.decay': 0.3, 'env.fil.sustain': 0.5, 'env.fil.release': 0.08,
  'lfo.rate': 5.2, 'lfo.amount': 0.25, 'lfo.wave': 1, 'lfo.dest': 1, 'lfo.sync': 3,
  'lfo2.rate': 4, 'lfo2.amount': 0.5, 'lfo2.wave': 0, 'lfo2.dest': 5, 'lfo2.sync': 0,
  'fx.reverb.on': 1, 'fx.reverb.mix': 0.25, 'fx.delay.on': 0, 'fx.delay.mix': 0.9, 'fx.phaser.on': 1, 'fx.phaser.mix': 0.5, 'fx.eq.on': 1,
  'arp.on': 1, 'arp.pattern': 1, 'arp.rate': 3, 'arp.gate': 0.5, 'mod.0.amt': 0.3, 'seq.0.len': 16, 'transport.bpm': 96, ...params,
} });

test('a VAST preset is translated using that synth\'s own meanings', () => {
  const { name, source, params, notes } = imported(vast({}));
  assert.deepEqual([name, source], ['1985-1', 'VAST G1-J8']);
  assert.equal(params.voiceMode, 'mono');
  assert.deepEqual(params.oscillator, { type: 'sawtooth', detune: 0, pulseWidth: 0.7 }, 'wave 2 is a saw');
  assert.equal(params.oscillator2!.type, 'square', 'wave 3 is a square');
  assert.deepEqual([params.oscillator2!.enabled, params.oscillator2!.semitones, params.oscillator2!.detune, params.oscillator2!.level], [true, 12, 5, 0.5], 'oscillator 2 keeps its octave and level relative to oscillator 1');
  assert.deepEqual(params.mixer, { sub: 0.9, noise: 0.18 });
  assert.deepEqual(params.unison, { voices: 3, detune: 0.5 }, 'cents become a share of the detune range');
  assert.deepEqual(params.portamento, { enabled: true, glide: 0.08 });

  near(params.filter.frequency, 440, 0.01);   // cutoff is a note number: 69 is A440
  assert.deepEqual([params.filter.type, params.filter.slope], ['bandpass', 12], 'the "poly" model\'s shape picks the filter type');
  near(params.filter.envAmount!, -0.5);       // semitones over five octaves
  near(params.filter.drive!, 0.5);
  assert.equal(params.filter.keyTracking, 0.8);
  assert.ok(params.filter.q > 3 && params.filter.q < 10, 'half resonance is a clear peak, not self-oscillation');
  assert.equal(params.velocity!.filter, 0.5);
  assert.deepEqual(params.envelope, { attack: 0.004, decay: 0.25, sustain: 1, release: 0.14 });
  assert.deepEqual(params.filterEnvelope, { attack: 0.07, decay: 0.3, sustain: 0.5, release: 0.08 });

  assert.deepEqual([params.lfo1.enabled, params.lfo1.target, params.lfo1.waveform, params.lfo1.rate, params.lfo1.depth, params.lfo1.sync], [true, 'filter', 'triangle', 5.2, 0.25, false]);
  assert.equal(params.lfo2.enabled, false, 'an LFO aimed at something Discobot cannot move is off');
  assert.deepEqual(params.fxSends, { reverb: 0.25, delay: 0, drive: 0, phaser: 0.5 }, 'an effect that was off sends nothing');
  assert.deepEqual(params.arpeggiator, { enabled: true, mode: 'down', rate: '1/32', gate: 0.5 });

  // What did not carry over is said, in plain words.
  const said = notes.join(' | ');
  for (const expected of ['Oscillator 1 was -1 octave', 'drift', 'LFO 2 moved the pan', 'LFO 1 was synced', 'EQ', 'modulation matrix', 'sequence, drums, sampler', 'different design']) {
    assert.ok(said.includes(expected), `missing a note about: ${expected}\n${said}`);
  }
});

test('VAST details: the ladder filter, silent parts, and out-of-range values', () => {
  const ladder = imported(vast({ 'filter.model': 0, 'filter.shape': 1, 'filter.cutoff': 135, 'filter.resonance': 99, 'osc2.level': 0, 'sub.level': 0, 'lfo.amount': 0, 'lfo2.amount': 0, 'glide.mode': 0, 'voicing.mode': 1, 'unison.voices': 9 })).params;
  assert.deepEqual([ladder.filter.type, ladder.filter.slope], ['lowpass', 24], 'the ladder is always a 24 dB low-pass');
  assert.ok(ladder.filter.frequency <= 20000 && ladder.filter.q <= 30, 'values past the synth\'s range are held to Discobot\'s');
  assert.equal(ladder.oscillator2!.enabled, false);
  assert.equal(ladder.portamento.enabled, false);
  assert.equal(ladder.voiceMode, 'poly');
  assert.equal(ladder.unison!.voices, 4);
  assert.equal(ladder.lfo1.enabled, false);

  const sparse = imported({ format: 'websynth-preset', version: 1, params: {} }, 'From a file name');
  assert.equal(sparse.name, 'VAST preset', 'a preset with no name gets one');
  assert.equal(sparse.params.oscillator.type, 'sawtooth', 'missing values take that synth\'s defaults');
  const junk = imported({ format: 'websynth-preset', version: 1, name: 7, params: { 'osc1.wave': 'x', 'filter.cutoff': null, 'env.amp.attack': 'fast', 'lfo.dest': 99 } });
  assert.ok(Number.isFinite(junk.params.filter.frequency) && junk.params.envelope.attack > 0);
  assert.equal(importPreset({ format: 'websynth-preset', version: 2, params: {} }, defaults).ok, false);
});

test('a nested two-oscillator patch is read by its shape', () => {
  const patch = {
    osc1: { wave: 'sawtooth', detune: 0, detuneFine: 4, octave: -1, mode: 'analog' },
    osc2: { wave: 'square', detune: 7, detuneFine: -3, octave: 0, mode: 'macro' },
    mix: 0.4, fm: { enabled: true, ratio: 2, amount: 180 }, sub: { enabled: true, level: 0.3 }, ring: { enabled: true, amount: 1 },
    filter: { type: 'bandpass', cutoff: 540, q: 2.8 }, envelope: { attack: 0.012, decay: 0.22, sustain: 0.4, release: 0.3 }, master: { gain: 0.24 },
    effects: { delay: { enabled: false, mix: 0.1 }, reverb: { enabled: true, mix: 0.12 } },
    lfo1: { enabled: true, wave: 'triangle', rateHz: 1.2, amount: 0.25, dest: 'filter' }, lfo2: { enabled: true, wave: 'sine', rateHz: 3, amount: 0.05, dest: 'ringAmount' },
    arp: { enabled: true, mode: 'updown', division: '1/8', gate: 0.6 }, sequencer: { enabled: true }, modMatrix: [{}], engineMode: 'classic',
  };
  const { name, params, notes } = imported(patch, 'patch');
  assert.equal(name, 'patch', 'the file name stands in when the file does not name the sound');
  assert.deepEqual(params.oscillator, { type: 'sawtooth', detune: 4, pulseWidth: 0.5 });
  assert.deepEqual([params.oscillator2!.type, params.oscillator2!.semitones, params.oscillator2!.detune], ['square', 19, -3], 'an octave and seven semitones above oscillator 1');
  near(params.oscillator2!.level, 0.4 / 0.6);
  assert.equal(params.mixer!.sub, 0.3);
  assert.deepEqual([params.filter.type, params.filter.frequency, params.filter.q], ['bandpass', 540, 2.8]);
  assert.deepEqual(params.envelope, { attack: 0.012, decay: 0.22, sustain: 0.4, release: 0.3 });
  assert.deepEqual([params.engine, params.fm!.ratio], ['fm', 2]);
  assert.deepEqual([params.lfo1.enabled, params.lfo1.target, params.lfo1.rate, params.lfo1.depth], [true, 'filter', 1.2, 0.25]);
  assert.equal(params.lfo2.enabled, false);
  assert.deepEqual(params.fxSends, { reverb: 0.12, delay: 0, drive: 0, phaser: 0 });
  assert.deepEqual(params.arpeggiator, { enabled: true, mode: 'updown', rate: '1/8', gate: 0.6 });
  const said = notes.join(' | ');
  for (const expected of ['-12 semitones', '"macro" source', 'frequency modulation', 'Ring modulation', 'LFO 2 moved "ringAmount"', 'modulation matrix', 'sequence']) {
    assert.ok(said.includes(expected), `missing a note about: ${expected}\n${said}`);
  }
});

test('a Discobot preset survives export and import, and is checked like any stored sound', () => {
  const sound = createDefaultSynthParameters();
  sound.filter.frequency = 1234; sound.oscillator.type = 'square'; sound.unison = { voices: 3, detune: 0.4 };
  const back = imported(JSON.parse(JSON.stringify(exportPreset('  My Lead  ', sound))));
  assert.deepEqual([back.name, back.source, back.notes], ['My Lead', 'Discobot', []]);
  assert.deepEqual(back.params, sound);

  const hostile = imported({ format: 'discobot-preset', version: 1, name: 'x'.repeat(200), params: { gain: 999, filter: { frequency: -5, q: 'loud', type: 'explode' }, oscillator: { type: 'noise', detune: 1e9 }, __proto__: { polluted: true } } });
  assert.equal(hostile.name.length, 60);
  assert.ok(hostile.params.gain <= 2 && hostile.params.filter.frequency >= 20 && hostile.params.filter.q <= 30 && Math.abs(hostile.params.oscillator.detune) <= 1200);
  assert.ok(['sine', 'square', 'sawtooth', 'triangle'].includes(hostile.params.oscillator.type));
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.equal(importPreset({ format: 'discobot-preset', version: 2, params: {} }, defaults).ok, false);
});

test('a file that matches no known format is refused, not guessed at', () => {
  for (const file of [{}, [], null, 'text', 5, { format: 'vital', settings: {} }, { osc1: { wave: 'saw' } }, { params: { 'osc1.wave': 2 } }]) {
    const result = importPreset(file, defaults);
    assert.equal(result.ok, false, JSON.stringify(file));
    if (!result.ok) assert.match(result.error, /does not recognise this preset file/);
  }
  const project = importPreset({ format: 'discobot-project', formatVersion: 1, project: {} }, defaults);
  assert.ok(!project.ok && /Import Project/.test(project.error), 'a whole project is pointed at the right menu');
});
