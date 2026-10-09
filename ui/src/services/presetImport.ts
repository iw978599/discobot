import type { OscillatorType, SynthParameters } from '../types';
import { sanitizeSynthParams } from './projectSanitization';

// Importing synth presets made in other synthesizers.
//
// There is no common format for synth presets: every synth saves its own parameter names,
// units and ranges. So each format gets a translator of its own here, written from that
// synth's actual definitions, and a file that matches none of them is refused instead of
// guessed at. A translator returns the nearest Discobot sound and a plain list of what did
// not carry over. Two engines given the same numbers do not sound the same: the result is
// a starting point.

export interface ImportedPreset {
  name: string;
  // Where the file came from, for the report.
  source: string;
  params: SynthParameters;
  // What could not be carried over, or was only approximated.
  notes: string[];
}
export type PresetImport = { ok: true; preset: ImportedPreset } | { ok: false; error: string };

export const PRESET_FILE_FORMAT = 'discobot-preset';

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose => (value && typeof value === 'object' && !Array.isArray(value) ? value as Loose : {});
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const noteToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);
const fileName = (name: unknown, fallback: string) => (typeof name === 'string' && name.trim() ? name.trim() : fallback).slice(0, 60);
const WAVE_NAMES: Record<string, OscillatorType> = { sine: 'sine', triangle: 'triangle', saw: 'sawtooth', sawtooth: 'sawtooth', square: 'square', pulse: 'square' };
const ARP_RATES = ['1/4', '1/8', '1/16', '1/32'] as const;

// ---- VAST G1-J8 (vast.status201.com): files marked `format: "websynth-preset"`.
// Ranges and meanings are from the synth's own parameter table.

const VAST_WAVES: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
const VAST_LFO_TARGETS = ['off', 'filter', 'pitch', 'amp', 'pulseWidth', 'pan', 'shape'] as const;
const VAST_ARP_MODES = ['up', 'down', 'updown', 'random', 'up'] as const;

function fromVast(file: Loose, defaults: SynthParameters): ImportedPreset {
  const p = record(file.params);
  const get = (key: string, fallback: number) => num(p[key], fallback);
  const notes: string[] = [];
  const params = structuredClone(defaults);

  params.voiceMode = get('voicing.mode', 1) < 0.5 ? 'mono' : 'poly';
  params.oscillator = {
    type: VAST_WAVES[clamp(Math.round(get('osc1.wave', 2)), 0, 3)], detune: get('osc1.detune', 0), pulseWidth: clamp(get('osc1.pulseWidth', 0.5), 0.05, 0.95),
  };
  const level1 = get('osc1.level', 0.7), level2 = get('osc2.level', 0.5);
  const octave1 = Math.round(get('osc1.octave', 0)), octave2 = Math.round(get('osc2.octave', 0));
  params.oscillator2 = {
    enabled: level2 > 0.001, type: VAST_WAVES[clamp(Math.round(get('osc2.wave', 2)), 0, 3)],
    // Discobot's first oscillator has no octave of its own; the second keeps its distance from it.
    semitones: (octave2 - octave1) * 12, detune: get('osc2.detune', 7),
    level: clamp(level1 > 0.001 ? level2 / level1 : 1, 0, 1),
  };
  if (octave1 !== 0) notes.push(`Oscillator 1 was ${octave1 > 0 ? '+' : ''}${octave1} octave${Math.abs(octave1) === 1 ? '' : 's'}. Use the lane's Oct buttons, or play that much ${octave1 < 0 ? 'lower' : 'higher'}, to match.`);
  if (level1 < 0.001 && level2 > 0.001) notes.push('Oscillator 1 was silent in the original; here it still sounds.');
  if (Math.abs(get('osc2.pulseWidth', 0.5) - params.oscillator.pulseWidth!) > 0.01) notes.push('Oscillator 2 had its own pulse width; Discobot uses one for both.');
  params.mixer = { sub: clamp(get('sub.level', 0), 0, 1), noise: clamp(get('mixer.noise', 0), 0, 1) };
  if (params.mixer.sub > 0 && (Math.round(get('sub.wave', 0)) !== 0 || Math.round(get('sub.octave', -1)) !== -1)) notes.push('The sub oscillator\'s wave and octave are fixed in Discobot.');
  params.unison = { voices: clamp(Math.round(get('unison.voices', 1)), 1, 4), detune: clamp(get('unison.detune', 12) / 50, 0, 1) };
  const glide = get('mixer.glide', 0), glideMode = Math.round(get('glide.mode', 1));
  params.portamento = { enabled: glideMode > 0 && glide > 0.001, glide: clamp(glide, 0, 1) };
  if (glideMode === 2 && params.portamento.enabled) notes.push('Glide was legato-only; in Discobot a mono lane glides on slides and a poly lane on every note.');
  if (get('analog.drift', 0) > 0.001) notes.push('Analog drift is not carried over.');

  // Cutoff is stored as a note number; resonance as ladder feedback, where about 4 self-oscillates.
  const model = Math.round(get('filter.model', 0)), shape = clamp(Math.round(get('filter.shape', 0) * 3), 0, 3);
  const [type, slope] = model === 0 ? ['lowpass', 24] as const : ([['lowpass', 24], ['lowpass', 12], ['bandpass', 12], ['highpass', 24]] as const)[shape];
  params.filter = {
    type, slope,
    frequency: clamp(noteToHz(get('filter.cutoff', 90)), 20, 20000),
    q: clamp(0.707 + (clamp(get('filter.resonance', 0.5), 0, 4.2) / 4.2) ** 1.5 * 15, 0.1, 30),
    // Semitones there; here 1 is five octaves.
    envAmount: clamp(get('filter.envAmount', 24) / 60, -1, 1),
    keyTracking: clamp(get('filter.keytrack', 0), 0, 1),
    drive: clamp((get('filter.drive', 1.2) - 1) / 5, 0, 1),
  };
  notes.push('The filter is a different design, so resonance and drive are matched by feel, not exactly.');
  params.velocity = { amp: 1, filter: clamp(get('filter.velAmount', 0), 0, 1) };
  params.envelope = { attack: get('env.amp.attack', 0.005), decay: get('env.amp.decay', 0.2), sustain: get('env.amp.sustain', 0.8), release: get('env.amp.release', 0.4) };
  params.filterEnvelope = { attack: get('env.fil.attack', 0.005), decay: get('env.fil.decay', 0.6), sustain: get('env.fil.sustain', 0.2), release: get('env.fil.release', 0.4) };

  for (const [key, slot] of [['lfo', 'lfo1'], ['lfo2', 'lfo2']] as const) {
    const amount = clamp(get(`${key}.amount`, 0), 0, 1);
    const target = VAST_LFO_TARGETS[clamp(Math.round(get(`${key}.dest`, 0)), 0, VAST_LFO_TARGETS.length - 1)];
    const usable = target === 'filter' || target === 'pitch' || target === 'amp' || target === 'pulseWidth';
    params[slot] = {
      ...params[slot], enabled: usable && amount > 0.0005, target: usable ? target : params[slot].target,
      waveform: VAST_WAVES[clamp(Math.round(get(`${key}.wave`, 0)), 0, 3)], rate: clamp(get(`${key}.rate`, 4), 0.05, 20),
      // Full depth is two octaves of cutoff or one of pitch in both synths.
      depth: amount, sync: false,
    };
    if (amount > 0.0005 && !usable && target !== 'off') notes.push(`LFO ${slot === 'lfo1' ? 1 : 2} moved the ${target === 'pan' ? 'pan' : 'filter shape'}, which Discobot's LFOs cannot.`);
    if (amount > 0.0005 && usable && Math.round(get(`${key}.sync`, 0)) > 0) notes.push(`LFO ${slot === 'lfo1' ? 1 : 2} was synced to the tempo; it is imported at its free rate.`);
  }

  params.arpeggiator = {
    enabled: get('arp.on', 0) > 0.5, mode: VAST_ARP_MODES[clamp(Math.round(get('arp.pattern', 0)), 0, 4)],
    rate: ARP_RATES[clamp(Math.round(get('arp.rate', 2)), 0, 3)], gate: clamp(get('arp.gate', 0.5), 0.1, 1),
  };

  // Its effects are one rack for the whole synth; here they become sends to the shared effects.
  const on = (key: string) => get(`${key}.on`, 0) > 0.5;
  params.fxSends = {
    reverb: on('fx.reverb') ? clamp(get('fx.reverb.mix', 0.25), 0, 1) : 0,
    delay: on('fx.delay') ? clamp(get('fx.delay.mix', 0.3), 0, 1) : 0,
    drive: on('fx.dist') ? clamp(get('fx.dist.mix', 1) * get('fx.dist.drive', 0.3), 0, 1) : 0,
    phaser: on('fx.phaser') ? clamp(get('fx.phaser.mix', 0.5), 0, 1) : 0,
  };
  const effects = ['reverb', 'delay', 'dist', 'phaser'].filter(name => on(`fx.${name}`));
  if (effects.length) notes.push('Its reverb, delay, distortion and phaser become send levels to Discobot\'s shared effects. Set the effects themselves (times, sizes) in the Effects unit.');
  const dropped = [on('fx.eq') && 'EQ', on('fx.wah') && 'wah', on('fx.duck') && 'ducking'].filter(Boolean);
  if (dropped.length) notes.push(`Not carried over: ${dropped.join(', ')}.`);
  if (Object.keys(p).some(key => /^mod\.\d+\.amt$/.test(key) && Math.abs(num(p[key], 0)) > 0.0005)) notes.push('Its modulation matrix is not carried over.');
  if (Object.keys(p).some(key => key.startsWith('seq.') || key.startsWith('drum.') || key.startsWith('sampler.') || key.startsWith('motion.'))) {
    notes.push('Only the synth sound is imported. The file\'s sequence, drums, sampler and tempo are left out.');
  }
  return { name: fileName(file.name, 'VAST preset'), source: 'VAST G1-J8', params, notes };
}

// ---- WebSynth Studio (github.com/szabadkai/synth-demo). Its patch file is the bare `Patch`
// object with no format marker, so it is recognised by shape. Meanings are from its
// `types.ts`, `Voice.ts` and `engine.ts`: detune is in cents; only oscillator 1 uses `octave`
// and `detuneFine`; `mix` is a straight crossfade; an LFO's amount is up to 2000 Hz of cutoff,
// 50 cents of pitch or 80% of the level.

const STUDIO_LFO_TARGETS: Record<string, SynthParameters['lfo1']['target']> = { filter: 'filter', pitch: 'vibrato', amp: 'amp' };

function fromStudioPatch(file: Loose, defaults: SynthParameters, name: string): ImportedPreset {
  const notes: string[] = [];
  const params = structuredClone(defaults);
  const osc1 = record(file.osc1), osc2 = record(file.osc2);
  const wave = (value: unknown, fallback: OscillatorType) => WAVE_NAMES[String(value)] ?? fallback;
  const mix = clamp(num(file.mix, 0), 0, 1);
  // Cents from the played note. Oscillator 1 is moved by whole semitones only in the report;
  // what is left of its detune stays on it, and oscillator 2 is placed relative to it.
  const cents1 = clamp(Math.round(num(osc1.octave, 0)), -3, 3) * 1200 + num(osc1.detune, 0) + num(osc1.detuneFine, 0);
  const shift = Math.round(cents1 / 100);
  const apart = num(osc2.detune, 0) - shift * 100;
  const semitones = clamp(Math.round(apart / 100), -36, 36);
  params.oscillator = { type: wave(osc1.wave, 'sawtooth'), detune: cents1 - shift * 100, pulseWidth: 0.5 };
  params.oscillator2 = {
    enabled: mix > 0.001, type: wave(osc2.wave, 'square'), semitones, detune: clamp(apart - semitones * 100, -100, 100),
    // `mix` is the balance between the two; here oscillator 1 stays at full level.
    level: clamp(mix >= 0.5 ? 1 : mix / (1 - mix), 0, 1),
  };
  if (shift !== 0) notes.push(`Oscillator 1 was transposed ${shift > 0 ? '+' : ''}${shift} semitones. Use the lane's Oct buttons or play it at that pitch to match.`);
  if (mix > 0.5) notes.push('Oscillator 2 was louder than oscillator 1; here they are equal.');
  let noise = 0;
  for (const [label, osc, share] of [['Oscillator 1', osc1, 1 - mix], ['Oscillator 2', osc2, mix]] as const) {
    if (typeof osc.mode === 'string' && osc.mode !== 'analog') notes.push(`${label} used a "${osc.mode}" source, which Discobot does not have. It is imported as a plain ${WAVE_NAMES[String(osc.wave)] ?? 'sawtooth'} wave.`);
    else if (osc.wave === 'noise') { noise = Math.max(noise, share); notes.push(`${label} was noise. Discobot's noise level is turned up in its place; the oscillator itself still plays a plain wave.`); }
    else if (osc.wave === 'sample') notes.push(`${label} played a sample, which is not carried over.`);
  }
  const sub = record(file.sub);
  params.mixer = { sub: sub.enabled === true ? clamp(num(sub.level, 0), 0, 1) : 0, noise: clamp(noise, 0, 1) };
  if (sub.enabled === true && num(sub.level, 0) > 0 && (num(sub.octave, 1) >= 2 || (typeof sub.wave === 'string' && sub.wave !== 'square'))) {
    notes.push('Its sub oscillator was two octaves down or not a square wave. Discobot\'s is a square one octave down.');
  }
  const fm = record(file.fm);
  if (fm.enabled === true && num(fm.amount, 0) > 0) {
    params.engine = 'fm';
    params.fm = { ...params.fm!, ratio: clamp(num(fm.ratio, 2), 0.25, 16), index: clamp(num(fm.amount, 0) / 400, 0, 1) };
    notes.push('It used frequency modulation between its oscillators. Discobot\'s FM engine is used in its place; the amount is matched roughly.');
  }
  if (record(file.ring).enabled === true) notes.push('Ring modulation is not carried over.');

  const filter = record(file.filter);
  const type = ['lowpass', 'highpass', 'bandpass', 'notch'].includes(String(filter.type)) ? filter.type as BiquadFilterType : 'lowpass';
  params.filter = { ...params.filter, type, frequency: clamp(num(filter.cutoff, 20000), 20, 20000), q: clamp(num(filter.q, 1), 0.1, 30), envAmount: 0, slope: 12 };
  const envelope = record(file.envelope);
  params.envelope = { attack: num(envelope.attack, 0.01), decay: num(envelope.decay, 0.1), sustain: num(envelope.sustain, 0.7), release: num(envelope.release, 0.3) };

  for (const slot of ['lfo1', 'lfo2'] as const) {
    const lfo = record(file[slot]), target = STUDIO_LFO_TARGETS[String(lfo.dest)];
    const amount = Math.max(0, num(lfo.amount, 0)), wanted = lfo.enabled === true && amount > 0;
    // Discobot's depth at full is two octaves of cutoff, a semitone of vibrato, or the level down to nothing.
    const depth = target === 'filter' ? Math.log2(1 + amount * 2000 / params.filter.frequency) / 2
      : target === 'vibrato' ? amount * 50 / 100
        : amount * 1.6;
    params[slot] = {
      ...params[slot], enabled: wanted && target !== undefined, target: target ?? params[slot].target,
      waveform: wave(lfo.wave, 'sine'), rate: clamp(num(lfo.rateHz, 1), 0.05, 20), depth: clamp(depth, 0, 1), sync: false,
    };
    if (wanted && target === undefined) notes.push(`LFO ${slot === 'lfo1' ? 1 : 2} moved "${String(lfo.dest)}", which Discobot's LFOs cannot.`);
    else if (wanted && lfo.wave === 'noise') notes.push(`LFO ${slot === 'lfo1' ? 1 : 2} was random noise; here it is a sine wave.`);
  }

  const arp = record(file.arp);
  const mode = ['up', 'down', 'updown', 'downup', 'random', 'converge', 'diverge'].includes(String(arp.mode)) ? arp.mode as SynthParameters['arpeggiator']['mode'] : 'up';
  const rate = ARP_RATES.find(entry => entry === arp.division) ?? '1/8';
  params.arpeggiator = { enabled: arp.enabled === true, mode, rate, gate: clamp(num(arp.gate, 0.6), 0.1, 1) };
  if (arp.enabled === true && (arp.bpmSync !== true || arp.mode !== mode || arp.division !== rate)) notes.push('Its arpeggiator ran at its own speed or in a pattern Discobot does not have; here it follows the tempo.');

  const effects = record(file.effects), delay = record(effects.delay), reverb = record(effects.reverb);
  params.fxSends = {
    reverb: reverb.enabled === true ? clamp(num(reverb.mix, 0), 0, 1) : 0, delay: delay.enabled === true ? clamp(num(delay.mix, 0), 0, 1) : 0, drive: 0, phaser: 0,
  };
  if (reverb.enabled === true || delay.enabled === true) notes.push('Its reverb and delay become send levels to Discobot\'s shared effects.');
  if (Array.isArray(file.modMatrix) && file.modMatrix.length > 0) notes.push('Its modulation matrix is not carried over.');
  if (record(file.sequencer).enabled === true) notes.push('Its sequence is not imported, only the sound.');
  if (typeof file.engineMode === 'string' && file.engineMode !== 'classic') notes.push(`It was made in "${file.engineMode}" mode, which Discobot does not have.`);
  return { name, source: 'WebSynth Studio', params, notes };
}

const looksLikeStudioPatch = (file: Loose) => typeof record(file.osc1).wave === 'string' && typeof record(file.osc2).wave === 'string'
  && typeof record(file.filter).cutoff === 'number' && typeof record(file.envelope).attack === 'number';

// Reads a preset file's contents. `suggestedName` is used when the file does not name the sound.
export function importPreset(file: unknown, defaults: SynthParameters, suggestedName = 'Imported preset'): PresetImport {
  const input = record(file);
  let preset: ImportedPreset;
  try {
    if (input.format === PRESET_FILE_FORMAT) {
      if (input.version !== 1) return { ok: false, error: 'This preset was saved by a newer version of Discobot.' };
      preset = { name: fileName(input.name, suggestedName), source: 'Discobot', params: record(input.params) as unknown as SynthParameters, notes: [] };
    } else if (input.format === 'websynth-preset') {
      if (input.version !== 1) return { ok: false, error: 'This is a newer kind of VAST preset than Discobot knows how to read.' };
      preset = fromVast(input, defaults);
    } else if (looksLikeStudioPatch(input)) {
      preset = fromStudioPatch(input, defaults, fileName(input.name, suggestedName));
    } else if (input.format === 'discobot-project') {
      return { ok: false, error: 'This is a whole Discobot project, not a preset. Use Project → Import Project.' };
    } else {
      return { ok: false, error: 'Discobot does not recognise this preset file. It can read its own presets, VAST G1-J8 presets, and WebSynth Studio patches. There is no common format for synth presets, so each kind has to be added.' };
    }
  } catch {
    return { ok: false, error: 'The preset file could not be read.' };
  }
  // Whatever the translator produced, and whatever a file claimed, is clamped like any stored sound.
  return { ok: true, preset: { ...preset, params: sanitizeSynthParams(preset.params, defaults) } };
}

// A Discobot sound as a file another Discobot can import.
export function exportPreset(name: string, params: SynthParameters) {
  return { format: PRESET_FILE_FORMAT, version: 1, name: name.slice(0, 60), params };
}
