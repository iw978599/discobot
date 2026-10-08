import test from 'node:test';
import assert from 'node:assert/strict';
import { Synthesizer } from '../src/Synthesizer';
import { StreamingSynth } from '../src/StreamingSynth';
import { DrumSynthesizer } from '../src/DrumSynthesizer';
import { ResonantFilter, oscillator } from '../src/dsp';
import type { DrumInstrument } from '../src/types';

const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const finite = (samples: Float32Array) => assert.ok(samples.every(Number.isFinite), 'all samples must be finite');
const deterministic = <T>(run: () => T): T => {
  const original = Math.random;
  let seed = 12345;
  Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  try { return run(); } finally { Math.random = original; }
};

test('all resonant filter modes remain stable at high cutoff and resonance', () => {
  for (const type of ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass']) {
    const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i * 2 * Math.PI * 1000 / 48000));
    const output = Synthesizer.applyFilterType(input, 48000, 21000, 20, type);
    finite(output);
    assert.ok(rms(output) < 10, type);
  }
  const lowQ = new ResonantFilter(), highQ = new ResonantFilter();
  const low = new Float32Array(4800), high = new Float32Array(4800);
  for (let i = 0; i < low.length; i++) {
    const input = Math.sin(i * 2 * Math.PI * 1000 / 48000);
    low[i] = lowQ.process(input, 48000, 1000, 0.5, 'lowpass');
    high[i] = highQ.process(input, 48000, 1000, 5, 'lowpass');
  }
  assert.ok(rms(high) > rms(low) * 3, 'Q must audibly change resonance');
});

test('band-limited saw reduces alias energy compared with a naive saw', () => {
  const length = 4800, frequency = 7500, step = frequency / 48000;
  const naive = new Float32Array(length), bandlimited = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const phase = (i * step) % 1;
    naive[i] = 2 * phase - 1;
    bandlimited[i] = oscillator('sawtooth', phase, step);
  }
  const magnitude = (samples: Float32Array, hz: number) => {
    let real = 0, imaginary = 0;
    for (let i = 0; i < length; i++) {
      real += samples[i] * Math.cos(i * 2 * Math.PI * hz / 48000);
      imaginary += samples[i] * Math.sin(i * 2 * Math.PI * hz / 48000);
    }
    return Math.hypot(real, imaginary);
  };
  assert.ok(magnitude(bandlimited, 18000) < magnitude(naive, 18000) * 0.6);
});

test('short synth notes start and end at silence without losing the whole note', () => {
  const synth = new Synthesizer();
  for (const type of ['lowpass', 'highpass', 'bandpass', 'notch'] as const) {
    const params = synth.getParameters();
    synth.updateParameters({ filter: { ...params.filter, type, q: 10 }, envelope: { attack: 0, decay: 0.02, sustain: 0.8, release: 1 } });
    const pcm = synth.renderNote('C4', 0.08, 1, 48000, { applyInsertEffects: false });
    finite(pcm);
    assert.equal(Math.abs(pcm[0]), 0);
    assert.equal(Math.abs(pcm[pcm.length - 1]), 0);
    assert.ok(rms(pcm) > 0.0001, type);
    assert.ok(pcm.every(value => Math.abs(value) <= 1));
  }
});

test('streaming release finds gliding notes and scheduled note-off is sample accurate', () => {
  const synth = new StreamingSynth(48000);
  const params = synth.getParameters();
  synth.updateParameters({
    portamento: { enabled: true, glide: 0.5 },
    envelope: { attack: 0.002, decay: 0.002, sustain: 1, release: 0.01 },
    fxSends: { reverb: 0, delay: 0, drive: 0, phaser: 0 },
    effects: { delay: { ...params.effects.delay, enabled: false }, reverb: { ...params.effects.reverb, enabled: false } },
  });
  synth.noteOn('C4');
  synth.scheduleNoteOff('C4', 240);
  const chunk = synth.renderChunk(3000);
  finite(chunk.left);
  assert.ok(rms(chunk.left.subarray(0, 240)) > 0.001);
  assert.equal(rms(chunk.left.subarray(800)), 0);
  synth.noteOn('G5');
  synth.renderChunk(200);
  synth.noteOff('G5');
  assert.equal(rms(synth.renderChunk(2000).left.subarray(1000)), 0);
});

test('old scheduled releases never kill a retriggered streaming note', () => {
  const synth = new StreamingSynth(48000);
  synth.updateParameters({ fxSends: { reverb: 0, delay: 0, drive: 0, phaser: 0 } });
  synth.noteOn('A4'); synth.scheduleNoteOff('A4', 100);
  synth.noteOn('A4');
  assert.ok(rms(synth.renderChunk(12000).left.subarray(6000)) > 0.001);
});

test('every drum has bounded headroom, silent endpoints and genuine zero velocity', () => {
  const instruments: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
  const settings = { volume: 1, tone: 0.5, extra: 0.5, tune: 0, humanize: 0 };
  for (const instrument of instruments) {
    const pcm = deterministic(() => DrumSynthesizer.renderHit(instrument, settings, 24000, { velocity: 1 }));
    finite(pcm);
    assert.ok(rms(pcm) > 0.001, instrument);
    assert.equal(Math.abs(pcm[0]), 0);
    assert.equal(Math.abs(pcm[pcm.length - 1]), 0);
    assert.ok(pcm.every(value => Math.abs(value) <= 0.700001));
    const silent = deterministic(() => DrumSynthesizer.renderHit(instrument, settings, 24000, { velocity: 0 }));
    assert.equal(rms(silent), 0, instrument);
    const quiet = deterministic(() => DrumSynthesizer.renderHit(instrument, settings, 24000, { velocity: 0.25 }));
    assert.ok(rms(quiet) < rms(pcm) * 0.5, instrument);
    for (const key of ['tone', 'extra', 'tune'] as const) {
      const changed = deterministic(() => DrumSynthesizer.renderHit(instrument, { ...settings, [key]: key === 'tune' ? 0.8 : 1 }, 24000, { velocity: 1 }));
      assert.notDeepEqual(changed, pcm, `${instrument} ${key} must be audible`);
    }
  }
});

test('drum rendering rejects non-finite settings without poisoning PCM', () => {
  finite(DrumSynthesizer.renderHit('kick', { volume: NaN, tone: Infinity, extra: NaN }, NaN));
});
