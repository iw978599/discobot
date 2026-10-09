import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore } from '../src/synth/SynthCore';
import { createDefaultSynthParameters, syncedLfoHz, toVoiceParams } from '../src/synth/voiceParams';
import type { VoiceParams } from '../src/synth/voiceParams';
import { DrumCore } from '../src/drums/DrumCore';
import { Adsr, Svf, approachCoefficient, oscillator, svfCoefficient } from '../src/dsp';
import type { DrumInstrument, DrumSettings } from '../src/types';

const SR = 48000;
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / (samples.length || 1));
const peak = (samples: Float32Array) => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const finite = (samples: Float32Array) => assert.ok(samples.every(Number.isFinite), 'all samples must be finite');

function synth(params: Partial<VoiceParams> = {}) {
  const core = new SynthCore(SR);
  core.setParams({ ...toVoiceParams(createDefaultSynthParameters()), attack: 0.002, ...params });
  const render = (count: number) => {
    const left = new Float32Array(count), right = new Float32Array(count);
    core.process(left, right);
    finite(left); finite(right);
    return [left, right] as const;
  };
  return { core, render };
}

test('the state-variable filter stays stable at extreme cutoff and resonance in every mode', () => {
  for (const type of ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass']) {
    const filter = new Svf(), output = new Float32Array(SR);
    const g = svfCoefficient(21000, SR), k = 1 / 20;
    for (let i = 0; i < output.length; i++) {
      const input = Math.sin(i * 2 * Math.PI * 1000 / SR);
      filter.tick(input, g, k);
      output[i] = filter.output(type, input, k);
    }
    finite(output);
    assert.ok(rms(output) < 10, type);
  }
  const response = (q: number) => {
    const filter = new Svf(), output = new Float32Array(4800), g = svfCoefficient(1000, SR);
    for (let i = 0; i < output.length; i++) {
      filter.tick(Math.sin(i * 2 * Math.PI * 1000 / SR), g, 1 / q);
      output[i] = filter.lp;
    }
    return rms(output);
  };
  assert.ok(response(5) > response(0.5) * 3, 'Q must audibly change resonance');
});

test('band-limited saw reduces alias energy compared with a naive saw', () => {
  const length = 4800, frequency = 7500, step = frequency / SR;
  const naive = new Float32Array(length), bandlimited = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const phase = (i * step) % 1;
    naive[i] = 2 * phase - 1;
    bandlimited[i] = oscillator('sawtooth', phase, step);
  }
  const magnitude = (samples: Float32Array, hz: number) => {
    let real = 0, imaginary = 0;
    for (let i = 0; i < length; i++) {
      real += samples[i] * Math.cos(i * 2 * Math.PI * hz / SR);
      imaginary += samples[i] * Math.sin(i * 2 * Math.PI * hz / SR);
    }
    return Math.hypot(real, imaginary);
  };
  assert.ok(magnitude(bandlimited, 18000) < magnitude(naive, 18000) * 0.6);
});

test('envelope segments are exponential and arrive in the stated time', () => {
  const env = new Adsr();
  const attack = approachCoefficient(0.01, SR, 1.47), decay = approachCoefficient(0.1, SR, 4.6);
  const release = approachCoefficient(0.05, SR, 6.9);
  env.gateOn();
  let samples = 0;
  while (env.stage === 'attack') { env.tick(attack, decay, 0, release); samples++; }
  assert.ok(Math.abs(samples / SR - 0.01) < 0.002, 'attack reaches full level in about the attack time');
  for (let i = 0; i < SR * 0.05; i++) env.tick(attack, decay, 0, release);
  assert.ok(env.level < 0.2, 'halfway through an exponential decay the level is well under the linear midpoint');
  env.level = 1;
  env.gateOff();
  samples = 0;
  while (env.stage !== 'off') { env.tick(attack, decay, 0, release); samples++; }
  assert.ok(Math.abs(samples / SR - 0.05) < 0.005, 'release ends at the release time');
});

test('tempo-synced LFO rate is a note value: one cycle per 1/N note', () => {
  assert.equal(syncedLfoHz(4, 120), 2);
  assert.equal(syncedLfoHz(16, 120), 8);
  const params = createDefaultSynthParameters();
  params.lfo1.sync = true; params.lfo1.rate = 4;
  assert.equal(toVoiceParams(params, 120).lfo1Rate, 2);
});

test('an idle synth is silent and malformed notes never sound', () => {
  const { core, render } = synth();
  assert.equal(rms(render(4800)[0]), 0);
  core.noteOn({ note: 'bad', velocity: 1 });
  core.noteOn({ note: 'C4', velocity: 0 });
  assert.equal(rms(render(480)[0]), 0);
  assert.ok(core.idle);
});

test('scheduled notes start on the requested frame and a timed gate ends in silence', () => {
  const { core, render } = synth({ release: 0.01 });
  core.noteOn({ note: 'A4', velocity: 1, time: 500 / SR, duration: 0.01 });
  const pcm = render(4000)[0];
  assert.equal(rms(pcm.subarray(0, 500)), 0);
  assert.ok(rms(pcm.subarray(520, 980)) > 0.005);
  assert.equal(rms(pcm.subarray(2000)), 0);
  assert.ok(core.idle);
  core.noteOn({ note: 'G4', velocity: 1, time: 1 });
  core.allNotesOff();
  assert.equal(rms(render(SR)[0]), 0, 'stopping clears notes that have not started yet');
});

test('a stale note-off never releases a retriggered note, and all-notes-off fades without a click', () => {
  const { core, render } = synth({ decay: 0.002, sustain: 1, release: 0.005 });
  core.noteOn({ note: 'A4', velocity: 1, id: 1, duration: 0.01 });
  render(2000);
  core.noteOn({ note: 'A4', velocity: 1, id: 2 });
  core.noteOff('A4', 1);
  assert.ok(rms(render(3000)[0].subarray(1000)) > 0.01);
  const before = render(301)[0];
  core.allNotesOff(0.01);
  const after = render(2000)[0];
  assert.ok(Math.abs(after[0] - before[300]) < 0.03);
  assert.equal(rms(after.subarray(900)), 0);
});

test('nine notes on eight voices at hostile settings stay finite and inside full scale', () => {
  const { core, render } = synth();
  core.setParams({ gain: Infinity, filterQ: NaN, filterFreq: 21000, oscType: 'square', attack: 0, sustain: 1, filterDrive: 1, osc2Enabled: true, subLevel: 1, noiseLevel: 1, filterEnvAmount: 1 });
  for (const note of ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4']) core.noteOn({ note, velocity: 1 });
  assert.ok(render(12000).every(channel => channel.every(value => Math.abs(value) <= 1)));
  assert.equal(core.voices.filter(voice => voice.active).length, 8);
});

test('switching waveform, filter mode and engine mid-note keeps the output continuous', () => {
  const { core, render } = synth({ decay: 0.002, sustain: 1 });
  core.noteOn({ note: 'A4', velocity: 1 });
  const before = render(301)[0];
  core.setParams({ oscType: 'square', filterType: 'highpass', engine: 'fm', gain: 0.4, pan: 1 });
  assert.ok(Math.abs(before[300] - render(1000)[0][0]) < 0.01);
});

test('every synthesis parameter changes the rendered audio', () => {
  const sound = (parameters: Partial<VoiceParams>, notes = ['C3'], velocity = 1) => {
    const { core, render } = synth({ oscType: 'sawtooth', filterFreq: 1000, decay: 0.05, sustain: 0.7, ...parameters });
    for (const note of notes) core.noteOn({ note, velocity });
    return render(6000);
  };
  const base = sound({});
  const variations: Partial<VoiceParams>[] = [
    { oscType: 'square' }, { detune: 50 }, { attack: 0.1 }, { decay: 0.2 }, { sustain: 0.1 },
    { gain: 0.3 }, { filterFreq: 300 }, { filterQ: 8 }, { filterType: 'highpass' }, { filterType: 'bandpass' },
    { filterType: 'notch' }, { pan: 1 },
    { osc2Enabled: true }, { subLevel: 0.6 }, { noiseLevel: 0.5 }, { filterDrive: 0.8 },
    { filterEnvAmount: 0.6 }, { filterEnvAmount: -0.4 }, { filterKeyTracking: 1 },
    { lfo1Enabled: true, lfo1Depth: 0.5, lfo1Rate: 12, lfo1Target: 'pitch' },
    { lfo2Enabled: true, lfo2Depth: 0.5, lfo2Rate: 12, lfo2Target: 'filter' },
    { lfo1Enabled: true, lfo1Depth: 0.8, lfo1Rate: 12, lfo1Target: 'amp' },
    { engine: 'fm' }, { portamentoEnabled: true, portamentoGlide: 0.5 },
  ];
  for (const parameters of variations) assert.notDeepEqual(sound(parameters), base, JSON.stringify(parameters));

  const pulse = (parameters: Partial<VoiceParams>) => sound({ oscType: 'square', ...parameters });
  assert.notDeepEqual(pulse({ pulseWidth: 0.15 }), pulse({}));
  assert.notDeepEqual(pulse({ lfo1Enabled: true, lfo1Depth: 1, lfo1Rate: 9, lfo1Target: 'pulseWidth' }), pulse({}));
  const osc2 = (parameters: Partial<VoiceParams>) => sound({ osc2Enabled: true, ...parameters });
  for (const parameters of [{ osc2Type: 'square' }, { osc2Semitones: 12 }, { osc2Detune: 30 }, { osc2Level: 0.2 }]) {
    assert.notDeepEqual(osc2(parameters), osc2({}), JSON.stringify(parameters));
  }
  const fm = (parameters: Partial<VoiceParams>) => sound({ engine: 'fm', ...parameters });
  for (const parameters of [{ fmRatio: 7 }, { fmIndex: 0.9 }, { fmDecay: 0.05 }, { fmFeedback: 0.8 }, { fmAlgorithm: 0 }, { fmAlgorithm: 2 }, { fmAlgorithm: 3 }]) {
    assert.notDeepEqual(fm(parameters), fm({}), JSON.stringify(parameters));
  }
  assert.notDeepEqual(sound({ filterEnvAmount: 0.6, filterDecay: 0.02 }), sound({ filterEnvAmount: 0.6 }));
  assert.notDeepEqual(sound({ spread: 1 }, ['C3', 'G5']), sound({ spread: 0 }, ['C3', 'G5']));
  assert.ok(rms(sound({ velocityAmp: 1 }, ['C3'], 0.3)[0]) < rms(sound({ velocityAmp: 0 }, ['C3'], 0.3)[0]) * 0.5,
    'velocity sensitivity scales loudness');
  assert.notDeepEqual(sound({ velocityFilter: 1 }, ['C3'], 1), sound({ velocityFilter: 0 }, ['C3'], 1), 'accent opens the filter');
});

test('mono mode slides between tied notes without retriggering, and retriggers after a gap', () => {
  const { core, render } = synth({ voiceMode: 'mono', portamentoEnabled: true, portamentoGlide: 0.05, decay: 0.05, sustain: 0.2 });
  core.noteOn({ note: 'C3', velocity: 1 });
  render(SR / 4);
  const settled = core.voices[0].amp.level;
  core.noteOn({ note: 'C4', velocity: 1 });
  assert.equal(core.voices[0].amp.stage, 'sustain', 'a tied note leaves the envelope where it was');
  render(64);
  assert.ok(Math.abs(core.voices[0].amp.level - settled) < 0.01);
  assert.ok(core.voices[0].frequency < 200, 'pitch is still gliding up from the previous note');
  render(SR / 2);
  assert.ok(Math.abs(core.voices[0].frequency - 261.63) < 1);
  assert.equal(core.voices.filter(voice => voice.active).length, 1);
  core.noteOff('C4');
  render(SR);
  core.noteOn({ note: 'E3', velocity: 1 });
  assert.equal(core.voices[0].amp.stage, 'attack');
  assert.ok(Math.abs(core.voices[0].frequency - 164.81) < 1, 'a new phrase starts on pitch');
});

test('a free-running LFO ignores note starts while a retriggered one restarts with each note', () => {
  const second = (retrigger: boolean) => {
    const { core, render } = synth({ lfo1Enabled: true, lfo1Target: 'amp', lfo1Depth: 1, lfo1Rate: 3, lfo1Retrigger: retrigger, sustain: 1, decay: 0.002, release: 0.005 });
    core.noteOn({ note: 'A3', velocity: 1, duration: 0.05 });
    render(7000);
    core.noteOn({ note: 'A3', velocity: 1, duration: 0.05 });
    return render(2400)[0];
  };
  const first = (() => {
    const { core, render } = synth({ lfo1Enabled: true, lfo1Target: 'amp', lfo1Depth: 1, lfo1Rate: 3, lfo1Retrigger: true, sustain: 1, decay: 0.002, release: 0.005 });
    core.noteOn({ note: 'A3', velocity: 1, duration: 0.05 });
    return render(2400)[0];
  })();
  assert.ok(Math.abs(rms(second(true)) - rms(first)) < rms(first) * 0.05, 'retriggered notes sound alike');
  assert.ok(Math.abs(rms(second(false)) - rms(first)) > rms(first) * 0.1, 'a free LFO is at a different point for the second note');
});

test('noise is seeded, so the same performance renders identical audio every time', () => {
  const run = () => {
    const { core, render } = synth({ noiseLevel: 0.8, oscType: 'sawtooth' });
    core.noteOn({ note: 'C3', velocity: 1 });
    return render(4800)[0];
  };
  assert.deepEqual(run(), run());
  const drums = () => {
    const core = new DrumCore(SR), left = new Float32Array(9600), right = new Float32Array(9600);
    core.trigger({ instrument: 'snare', settings: { volume: 1, tone: 0.5, extra: 0.5, humanize: 1 }, velocity: 1 });
    core.process(left, right);
    return left;
  };
  assert.deepEqual(drums(), drums());
});

const INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
const SETTINGS: DrumSettings = { volume: 1, tone: 0.5, extra: 0.5, tune: 0, humanize: 0, pan: 0 };

function drum(hits: Array<{ instrument: DrumInstrument; settings?: Partial<DrumSettings>; velocity?: number; time?: number; kitId?: string }>, seconds = 5, sampleRate = SR) {
  const core = new DrumCore(sampleRate);
  for (const hit of hits) core.trigger({ velocity: 1, ...hit, settings: { ...SETTINGS, ...hit.settings } });
  const left = new Float32Array(Math.round(seconds * sampleRate)), right = new Float32Array(left.length);
  core.process(left, right);
  finite(left); finite(right);
  return { left, right, core };
}

test('every drum sounds, starts and ends in silence, and responds to its controls', () => {
  for (const instrument of INSTRUMENTS) {
    const { left, core } = drum([{ instrument }], 8);
    assert.ok(rms(left) > 0.001, instrument);
    assert.ok(Math.abs(left[0]) < 0.05, `${instrument} starts near zero`);
    assert.ok(peak(left) <= 0.6, `${instrument} leaves headroom`);
    assert.ok(core.idle, `${instrument} finishes`);
    assert.equal(rms(left.subarray(left.length - 4800)), 0);
    assert.equal(rms(drum([{ instrument, velocity: 0 }], 1).left), 0, `${instrument} zero velocity`);
    assert.equal(rms(drum([{ instrument, settings: { volume: 0 } }], 1).left), 0, `${instrument} zero volume`);
    for (const settings of [{ tone: 1 }, { extra: 1 }, { tune: 0.8 }]) {
      assert.notDeepEqual(drum([{ instrument, settings }], 1).left, drum([{ instrument }], 1).left, `${instrument} ${JSON.stringify(settings)}`);
    }
  }
  assert.notDeepEqual(drum([{ instrument: 'crash', settings: { cymbalType: 'ride' } }], 1).left, drum([{ instrument: 'crash' }], 1).left);
  const right = drum([{ instrument: 'snare', settings: { pan: 1 } }], 1);
  assert.equal(rms(right.left) < rms(right.right) * 0.001, true, 'pan moves the hit');
});

test('volume and velocity scale a drum hit exactly, with no saturation in between', () => {
  for (const instrument of INSTRUMENTS) {
    const full = drum([{ instrument }], 1).left;
    const halfVolume = drum([{ instrument, settings: { volume: 0.5 } }], 1).left;
    const halfVelocity = drum([{ instrument, velocity: 0.5 }], 1).left;
    for (let i = 0; i < full.length; i += 37) {
      assert.ok(Math.abs(halfVolume[i] - full[i] * 0.5) < 1e-6, `${instrument} volume`);
      assert.ok(Math.abs(halfVelocity[i] - full[i] * 0.5) < 1e-6, `${instrument} velocity`);
    }
  }
});

test('drums struck together each keep their full level instead of ducking one another', () => {
  const alone = drum([{ instrument: 'kick' }], 1).left;
  const others = INSTRUMENTS.filter(instrument => instrument !== 'kick' && instrument !== 'closedHH');
  const together = drum([{ instrument: 'kick' }, ...others.map(instrument => ({ instrument }))], 1).left;
  const rest = drum(others.map(instrument => ({ instrument })), 1).left;
  let difference = 0;
  for (let i = 0; i < alone.length; i++) difference = Math.max(difference, Math.abs(together[i] - alone[i] - rest[i]));
  assert.ok(difference < 1e-6, `the mix is the plain sum of its hits (max difference ${difference})`);
  const everything = drum(INSTRUMENTS.map(instrument => ({ instrument })), 1).left;
  assert.ok(peak(everything) > peak(alone) * 1.5, 'eight simultaneous hits are louder than one, not squashed to the same level');
});

test('a closed hat cuts an open hat that is ringing, but not one struck on the same step', () => {
  const ringing = drum([{ instrument: 'openHH', settings: { extra: 1 } }], 1).left;
  const choked = drum([{ instrument: 'openHH', settings: { extra: 1 } }, { instrument: 'closedHH', settings: { volume: 0.001 }, time: 0.1 }], 1).left;
  const window = (samples: Float32Array) => rms(samples.subarray(Math.round(SR * 0.2), Math.round(SR * 0.4)));
  assert.ok(window(choked) < window(ringing) * 0.05);
  const sameStep = drum([{ instrument: 'openHH', settings: { extra: 1 } }, { instrument: 'closedHH', settings: { volume: 0.001 } }], 1).left;
  assert.ok(window(sameStep) > window(ringing) * 0.8);
});

test('kits change the sound, the voices behave the same at any sample rate, and bad settings are safe', () => {
  const kits = ['clean-analog', 'punchy-modern', 'lofi-dirty', 'tr-808', 'tr-909', 'linndrum', 'oberheim-dmx', 'tr-707'];
  const renders = kits.map(kitId => drum([{ instrument: 'snare', kitId }], 0.5).left);
  for (let a = 0; a < renders.length; a++) for (let b = a + 1; b < renders.length; b++) {
    assert.notDeepEqual(renders[a], renders[b], `${kits[a]} vs ${kits[b]}`);
  }
  for (const instrument of INSTRUMENTS) {
    const duration = (sampleRate: number) => {
      const { left } = drum([{ instrument }], 6, sampleRate);
      let last = 0;
      for (let i = 0; i < left.length; i++) if (Math.abs(left[i]) > 0.001) last = i;
      return last / sampleRate;
    };
    const low = duration(32000), high = duration(96000);
    assert.ok(Math.abs(low - high) < Math.max(0.02, high * 0.2), `${instrument} lasts ${low.toFixed(3)}s at 32k and ${high.toFixed(3)}s at 96k`);
  }
  finite(drum([{ instrument: 'kick', settings: { volume: NaN, tone: Infinity, extra: NaN, tune: NaN, pan: NaN } }], 0.5).left);
});
