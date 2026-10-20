// More from portamento (roadmap 18): a glide at the same speed for any distance, a poly lane gliding
// only from a held key, and a glide time that follows the tempo. A sine's pitch is read over time from
// its zero crossings while it glides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthCore, createDefaultSynthParameters, toVoiceParams } from '@discobot/engine';
import type { SynthParameters } from '../src/types.ts';

const SR = 48000;
type Glide = Partial<SynthParameters['portamento']>;

function sound(glide: Glide, bpm = 120) {
  const base = createDefaultSynthParameters();
  return toVoiceParams({
    ...base, voiceMode: 'poly',
    oscillator: { ...base.oscillator, type: 'sine' },
    filter: { ...base.filter, frequency: 18000, resonance: 0 },
    envelope: { attack: 0.001, decay: 0.05, sustain: 1, release: 0.005 },
    portamento: { ...base.portamento, enabled: true, glide: 0.1, ...glide },
  }, bpm);
}
// A4 played and let go, then `to` held: what the second note does, sample by sample.
function glideInto(to: string, glide: Glide, seconds = 0.6) {
  const core = new SynthCore(SR);
  core.setParams(sound(glide));
  const run = (length: number) => { const left = new Float32Array(Math.round(length * SR)), right = new Float32Array(left.length); core.process(left, right); return left; };
  core.noteOn({ note: 'A4', velocity: 1 });
  run(0.05);
  core.noteOff('A4');
  run(0.1);
  core.noteOn({ note: to, velocity: 1 });
  return run(seconds);
}
// The pitch over the window starting at `at` seconds, from the zero crossings in it.
function pitchAt(samples: Float32Array, at: number, window = 0.02) {
  const from = Math.round(at * SR), to = Math.min(samples.length - 1, from + Math.round(window * SR));
  const crossings: number[] = [];
  for (let i = from; i < to; i++) if (samples[i] <= 0 && samples[i + 1] > 0) crossings.push(i + samples[i] / (samples[i] - samples[i + 1]));
  return crossings.length < 2 ? 0 : (crossings.length - 1) / ((crossings[crossings.length - 1] - crossings[0]) / SR);
}
// How long the glide takes to come within 3% of the note it is going to.
function arrival(samples: Float32Array, target: number) {
  for (let at = 0; at < samples.length / SR - 0.02; at += 0.002) if (pitchAt(samples, at) >= target * 0.97) return at;
  return Infinity;
}

test('a glide at the same speed takes twice as long for two octaves; a timed glide takes about as long for either', () => {
  const timed = [arrival(glideInto('A5', {}), 880), arrival(glideInto('A6', {}), 1760)];
  const steady = [arrival(glideInto('A5', { speed: true }), 880), arrival(glideInto('A6', { speed: true }), 1760)];
  assert.ok(timed[1] / timed[0] < 1.4, `timed: ${timed.map(t => t.toFixed(3))}`);
  assert.ok(steady[1] / steady[0] > 1.7, `same speed: ${steady.map(t => t.toFixed(3))}`);
  assert.ok(Math.abs(steady[0] - 0.1) < 0.03, `an octave in about the knob's 0.1 s: ${steady[0].toFixed(3)}`);
});

test('a poly lane gliding only from held keys does not glide into a note played after the last key was let go', () => {
  const always = glideInto('A5', {}), fingered = glideInto('A5', { fingered: true });
  assert.ok(pitchAt(always, 0.005) < 800, `without, it glides up from A4: ${pitchAt(always, 0.005).toFixed(0)} Hz`);
  assert.ok(Math.abs(pitchAt(fingered, 0.005) - 880) < 20, `held keys only, it starts on A5: ${pitchAt(fingered, 0.005).toFixed(0)} Hz`);
});

test('a glide that follows the tempo lasts its note value, and a sound with none of this is as it was', () => {
  assert.equal(sound({ sync: '1/16' }, 120).portamentoGlide, 0.125);
  assert.equal(sound({ sync: '1/8' }, 60).portamentoGlide, 0.5);
  assert.equal(sound({ sync: 'off', glide: 0.07 }).portamentoGlide, 0.07);
  // No new switches at all, and both at false: the same samples.
  const base = createDefaultSynthParameters();
  const before = { ...base, portamento: { enabled: true, glide: 0.1 } } as SynthParameters;
  const after = { ...base, portamento: { enabled: true, glide: 0.1, fingered: false, speed: false } };
  const play = (params: SynthParameters) => {
    const core = new SynthCore(SR);
    core.setParams(toVoiceParams(params, 120));
    core.noteOn({ note: 'C4', velocity: 1 });
    core.noteOn({ note: 'G4', velocity: 1 });
    const left = new Float32Array(SR / 4), right = new Float32Array(left.length);
    core.process(left, right);
    return left;
  };
  assert.deepEqual(play(before), play(after));
});
