import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { flattenSynthParams } from '../src/hooks/useSynthAudio';
import { Synthesizer } from '../../engine/src/Synthesizer';
import { SYNTH_MODELS, mapSynthModelToEngineParams, normalizeSynthModelParams } from '../src/synthModels';

function processor() {
  let Processor: any;
  runInNewContext(readFileSync('ui/public/synth-processor.js', 'utf8'), {
    sampleRate: 48000,
    AudioWorkletProcessor: class { port = { onmessage: (_message: any) => {} }; },
    registerProcessor: (_name: string, implementation: any) => { Processor = implementation; },
  });
  const instance = new Processor();
  const send = (data: unknown) => instance.port.onmessage({ data });
  const render = (count = 128) => {
    const output = [new Float32Array(count), new Float32Array(count)];
    instance.process([], [output]);
    assert.ok(output.every(channel => channel.every(Number.isFinite)));
    return output;
  };
  return { instance, send, render };
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

test('tempo-synced LFO uses cycles per second, not beats per minute', () => {
  const params = new Synthesizer().getParameters();
  params.lfo1.sync = true; params.lfo1.rate = 4;
  assert.equal(flattenSynthParams(params, 120).lfo1Rate, 2);
  params.lfo1.rate = 16;
  assert.equal(flattenSynthParams(params, 120).lfo1Rate, 8);
});

test('worklet stops gliding notes by identity and releases within the requested time', () => {
  const { send, render, instance } = processor();
  send({ type: 'params', params: { portamentoEnabled: true, portamentoGlide: 0.5, attack: 0.002, release: 0.01 } });
  send({ type: 'noteOn', note: 'C3', velocity: 1, id: 1 });
  render(200);
  send({ type: 'noteOff', note: 'C3', id: 1 });
  assert.equal(rms(render(2000)[0].subarray(700)), 0);
  assert.ok(instance.voices.every((voice: any) => !voice.active));
});

test('sample-accurate gate and retriggered-note identity survive stale note-offs', () => {
  const { send, render } = processor();
  send({ type: 'params', params: { attack: 0.002, decay: 0.002, sustain: 1, release: 0.005 } });
  send({ type: 'noteOn', note: 'A4', velocity: 1, id: 1, duration: 0.01 });
  const pcm = render(2000)[0];
  assert.ok(rms(pcm.subarray(0, 450)) > 0.01);
  assert.equal(rms(pcm.subarray(800)), 0);
  send({ type: 'noteOn', note: 'A4', velocity: 1, id: 2 });
  send({ type: 'noteOff', note: 'A4', id: 1 });
  assert.ok(rms(render(3000)[0].subarray(1000)) > 0.01);
});

test('worklet all-notes-off fades instead of instantly cutting the waveform', () => {
  const { send, render } = processor();
  send({ type: 'params', params: { attack: 0.002, sustain: 1, decay: 0.002 } });
  send({ type: 'noteOn', note: 'A4', velocity: 1 });
  const before = render(301)[0];
  send({ type: 'allNotesOff', release: 0.01 });
  const after = render(1000)[0];
  assert.ok(Math.abs(after[0] - before[300]) < 0.03);
  assert.equal(rms(after.subarray(600)), 0);
});

test('every exposed worklet filter mode and resonance is audible', () => {
  const outputs = [];
  for (const filterType of ['lowpass', 'highpass', 'bandpass', 'notch']) {
    const { send, render } = processor();
    send({ type: 'params', params: { oscType: 'sawtooth', filterType, filterFreq: 1000, filterQ: 5, attack: 0.002, sustain: 1 } });
    send({ type: 'noteOn', note: 'A4', velocity: 1 });
    outputs.push(render(6000)[0]);
  }
  for (let i = 1; i < outputs.length; i++) assert.notDeepEqual(outputs[0], outputs[i]);
  const resonance = (filterQ: number) => {
    const { send, render } = processor();
    send({ type: 'params', params: { filterFreq: 440, filterQ, attack: 0.002, decay: 0.002, sustain: 1 } });
    send({ type: 'noteOn', note: 'A4', velocity: 1 });
    return rms(render(6000)[0].subarray(3000));
  };
  assert.ok(resonance(5) > resonance(0.5) * 2);
});

test('eight-voice extremes stay finite and below full scale; malformed notes are silent', () => {
  const { send, render } = processor();
  send({ type: 'noteOn', note: 'bad', velocity: 1 });
  assert.equal(rms(render()[0]), 0);
  send({ type: 'params', params: { gain: Infinity, filterQ: NaN, filterFreq: 21000, oscType: 'square', attack: 0, sustain: 1 } });
  for (const note of ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4']) send({ type: 'noteOn', note, velocity: 1 });
  assert.ok(render(12000).every(channel => channel.every(value => Math.abs(value) <= 1)));
});

test('all model macros alter actual synthesis parameters; normalization rejects NaN', () => {
  const defaults = { macro1: 0.5, macro2: 0.5, macro3: 0.5, macro4: 0.5 };
  assert.equal(normalizeSynthModelParams({ macro1: NaN }).macro1, 0.5);
  for (const model of SYNTH_MODELS.filter(model => model.id !== 'generic')) {
    const base = mapSynthModelToEngineParams(model.id, defaults);
    for (const macro of model.macros) {
      assert.notDeepEqual(mapSynthModelToEngineParams(model.id, { ...defaults, [macro.key]: 0.9 }), base, `${model.id} ${macro.key}`);
    }
  }
});

test('look-ahead note onsets occur at the requested frame and stop clears future notes', () => {
  const { send, render } = processor();
  send({ type: 'params', params: { attack: 0.002 } });
  send({ type: 'noteOn', note: 'A4', velocity: 1, time: 500 / 48000, duration: 0.01 });
  const pcm = render(900)[0];
  assert.equal(rms(pcm.subarray(0, 500)), 0);
  assert.ok(rms(pcm.subarray(520)) > 0.001);
  send({ type: 'allNotesOff', release: 0.005 });
  render(1000);
  send({ type: 'noteOn', note: 'G4', velocity: 1, time: 1 });
  send({ type: 'allNotesOff' });
  assert.equal(rms(render(50000)[0]), 0);
});

test('live oscillator/filter edits preserve output continuity', () => {
  const { send, render } = processor();
  send({ type: 'params', params: { attack: 0.002, decay: 0.002, sustain: 1 } });
  send({ type: 'noteOn', note: 'A4', velocity: 1 });
  const before = render(301)[0];
  send({ type: 'params', params: { oscType: 'square', filterType: 'highpass', gain: 0.4, pan: 1 } });
  const after = render(1000)[0];
  assert.ok(Math.abs(before[300] - after[0]) < 0.01);
});

test('oscillator, detune, envelopes, both LFOs, gain, pan and spread affect PCM', () => {
  const sound = (parameters: Record<string, unknown>, chord = false) => {
    const { send, render } = processor();
    send({ type: 'params', params: { oscType: 'sawtooth', filterFreq: 1000, attack: 0.002, decay: 0.05, sustain: 0.7, ...parameters } });
    send({ type: 'noteOn', note: 'C3', velocity: 1 });
    if (chord) send({ type: 'noteOn', note: 'G5', velocity: 1 });
    return render(5000);
  };
  const base = sound({});
  for (const parameters of [
    { oscType: 'square' }, { detune: 50 }, { attack: 0.1 }, { decay: 0.2 }, { sustain: 0.1 },
    { gain: 0.3 }, { filterFreq: 300 }, { pan: 1 },
    { lfo1Enabled: true, lfo1Depth: 0.5, lfo1Rate: 12, lfo1Target: 'pitch' },
    { lfo2Enabled: true, lfo2Depth: 0.5, lfo2Rate: 12, lfo2Target: 'filter' },
  ]) assert.notDeepEqual(sound(parameters), base, JSON.stringify(parameters));
  assert.notDeepEqual(sound({ spread: 1 }, true), sound({ spread: 0 }, true));
  assert.notDeepEqual(sound({ portamentoEnabled: true, portamentoGlide: 0.5 }), base);
});
