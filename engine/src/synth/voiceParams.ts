import type { SynthParameters } from '../types';

// The flat parameter set a SynthCore runs on. Live playback posts it to the worklet;
// offline export hands it to the same core directly.
export interface VoiceParams {
  engine: string;
  voiceMode: string;
  oscType: string;
  detune: number;
  pulseWidth: number;
  osc2Enabled: boolean;
  osc2Type: string;
  osc2Semitones: number;
  osc2Detune: number;
  osc2Level: number;
  subLevel: number;
  noiseLevel: number;
  unisonVoices: number;
  unisonDetune: number;
  fmAlgorithm: number;
  fmRatio: number;
  fmIndex: number;
  fmDecay: number;
  fmFeedback: number;
  filterType: string;
  filterFreq: number;
  filterQ: number;
  filterEnvAmount: number;
  filterKeyTracking: number;
  filterDrive: number;
  filterSlope: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterAttack: number;
  filterDecay: number;
  filterSustain: number;
  filterRelease: number;
  velocityAmp: number;
  velocityFilter: number;
  gain: number;
  pan: number;
  spread: number;
  portamentoEnabled: boolean;
  portamentoGlide: number;
  lfo1Enabled: boolean;
  lfo1Target: string;
  lfo1Waveform: string;
  lfo1Rate: number;
  lfo1Depth: number;
  lfo1Retrigger: boolean;
  lfo2Enabled: boolean;
  lfo2Target: string;
  lfo2Waveform: string;
  lfo2Rate: number;
  lfo2Depth: number;
  lfo2Retrigger: boolean;
}

export function createDefaultSynthParameters(): SynthParameters {
  return {
    hold: false,
    gain: 1,
    fxReturn: 0.85,
    pan: 0,
    spread: 0,
    engine: 'subtractive',
    voiceMode: 'poly',
    portamento: { enabled: false, glide: 0.05 },
    arpeggiator: { enabled: false, mode: 'up', rate: '1/16', gate: 0.7 },
    oscillator: { type: 'sine', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: false, type: 'sawtooth', semitones: 0, detune: 7, level: 0.7 },
    mixer: { sub: 0, noise: 0 },
    unison: { voices: 1, detune: 0.3 },
    duck: 0,
    lfo1: { enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.2, sync: false, retrigger: true },
    lfo2: { enabled: false, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.25, sync: false, retrigger: true },
    filter: { frequency: 20000, q: 1, type: 'lowpass', envAmount: 0, keyTracking: 0, drive: 0, slope: 12 },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
    filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.3 },
    velocity: { amp: 1, filter: 0 },
    fm: { algorithm: 1, ratio: 2, index: 0.4, decay: 0.6, feedback: 0 },
    fxSends: { reverb: 0.25, delay: 0.2, drive: 0.15, phaser: 0.1, chorus: 0 },
    effects: {
      reverb: { enabled: false, wet: 0.3, decay: 2 },
      delay: { enabled: false, wet: 0.3, time: 0.25, feedback: 0.3 },
    },
  };
}

// A synced rate N means one LFO cycle per 1/N note, so 1/4 at 120 BPM is 2 Hz.
export function syncedLfoHz(rate: number, bpm: number): number {
  return Math.max(20, Math.min(400, bpm)) * Math.max(1, Math.round(rate)) / 240;
}

export function toVoiceParams(p: SynthParameters, bpm = 120): VoiceParams {
  const d = createDefaultSynthParameters();
  const osc2 = p.oscillator2 ?? d.oscillator2!;
  const mixer = p.mixer ?? d.mixer!;
  const filterEnvelope = p.filterEnvelope ?? d.filterEnvelope!;
  const velocity = p.velocity ?? d.velocity!;
  const fm = p.fm ?? d.fm!;
  const unison = p.unison ?? d.unison!;
  const lfoRate = (lfo: SynthParameters['lfo1']) => lfo.sync ? syncedLfoHz(lfo.rate, bpm) : lfo.rate;
  return {
    engine: p.engine ?? 'subtractive', voiceMode: p.voiceMode ?? 'poly',
    oscType: p.oscillator.type, detune: p.oscillator.detune, pulseWidth: p.oscillator.pulseWidth ?? 0.5,
    osc2Enabled: osc2.enabled, osc2Type: osc2.type, osc2Semitones: osc2.semitones, osc2Detune: osc2.detune, osc2Level: osc2.level,
    subLevel: mixer.sub, noiseLevel: mixer.noise,
    unisonVoices: unison.voices, unisonDetune: unison.detune,
    fmAlgorithm: fm.algorithm, fmRatio: fm.ratio, fmIndex: fm.index, fmDecay: fm.decay, fmFeedback: fm.feedback,
    filterType: p.filter.type, filterFreq: p.filter.frequency, filterQ: p.filter.q,
    filterEnvAmount: p.filter.envAmount ?? 0, filterKeyTracking: p.filter.keyTracking ?? 0, filterDrive: p.filter.drive ?? 0,
    filterSlope: p.filter.slope ?? 12,
    attack: p.envelope.attack, decay: p.envelope.decay, sustain: p.envelope.sustain, release: p.envelope.release,
    filterAttack: filterEnvelope.attack, filterDecay: filterEnvelope.decay,
    filterSustain: filterEnvelope.sustain, filterRelease: filterEnvelope.release,
    velocityAmp: velocity.amp, velocityFilter: velocity.filter,
    gain: p.gain, pan: p.pan ?? 0, spread: p.spread ?? 0,
    portamentoEnabled: p.portamento?.enabled ?? false, portamentoGlide: p.portamento?.glide ?? 0,
    lfo1Enabled: p.lfo1.enabled, lfo1Target: p.lfo1.target, lfo1Waveform: p.lfo1.waveform,
    lfo1Rate: lfoRate(p.lfo1), lfo1Depth: p.lfo1.depth, lfo1Retrigger: p.lfo1.retrigger ?? true,
    lfo2Enabled: p.lfo2.enabled, lfo2Target: p.lfo2.target, lfo2Waveform: p.lfo2.waveform,
    lfo2Rate: lfoRate(p.lfo2), lfo2Depth: p.lfo2.depth, lfo2Retrigger: p.lfo2.retrigger ?? true,
  };
}
