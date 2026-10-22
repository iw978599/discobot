import type { RateSync, SynthParameters } from '../types';
import type { InsertSettings } from './inserts';

// The flat parameter set a SynthCore runs on. Live playback posts it to the worklet;
// offline export hands it to the same core directly.
export interface VoiceParams extends InsertSettings, FlatRoutes {
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
  osc2Sync: boolean;
  ringLevel: number;
  oscLevel: number;
  subLevel: number;
  noiseLevel: number;
  unisonVoices: number;
  unisonDetune: number;
  unisonMix: number;
  sampleRoot: number;
  sampleLoop: boolean;
  sampleStart: number;
  sampleLoopStart: number;
  sampleLoopEnd: number;
  sampleScan: number;
  sampleFade: number;
  layerEnabled: boolean;
  layerMix: number;
  layerDetune: number;
  layerBrightness: number;
  layerAttack: number;
  layerWidth: number;
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
  filterModel: string;
  filterHighpass: number;
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
  portamentoFingered: boolean;
  portamentoSpeed: boolean;
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

// The routes, flattened for the voice, which takes plain values: an empty source means the place
// is not used. There are MAX_MOD_ROUTES places.
type RouteNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type FlatRoutes = { [N in RouteNumber as `mod${N}Source`]: string } & { [N in RouteNumber as `mod${N}Destination`]: string } & { [N in RouteNumber as `mod${N}Depth`]: number };
export type VoiceRouteParams = FlatRoutes;

export function createDefaultSynthParameters(): SynthParameters {
  return {
    hold: false,
    gain: 1,
    fxReturn: 0.85,
    pan: 0,
    spread: 0,
    engine: 'subtractive',
    voiceMode: 'poly',
    portamento: { enabled: false, glide: 0.05, fingered: false, speed: false },
    arpeggiator: { enabled: false, mode: 'up', rate: '1/16', gate: 0.7 },
    oscillator: { type: 'sine', detune: 0, pulseWidth: 0.5 },
    oscillator2: { enabled: false, type: 'sawtooth', semitones: 0, detune: 7, level: 0.7, sync: false },
    mixer: { sub: 0, noise: 0, osc: 1, ring: 0 },
    unison: { voices: 1, detune: 0.3, mix: 1 },
    sample: { root: 60, loop: false },
    layer: { enabled: false, mix: 0.5, detune: 8, brightness: 0, attack: 0, width: 0 },
    duck: 0,
    lfo1: { enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.2, sync: false, retrigger: true },
    lfo2: { enabled: false, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.25, sync: false, retrigger: true },
    modMatrix: [],
    filter: { frequency: 20000, q: 1, type: 'lowpass', envAmount: 0, keyTracking: 0, drive: 0, slope: 12, model: 'svf', highpass: 0 },
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

const RATE_SYNC_BEATS: Record<Exclude<RateSync, 'off'>, number> = {
  '8bar': 32, '4bar': 16, '2bar': 8, '1bar': 4, '1/2': 2, '1/4d': 1.5, '1/4': 1, '1/4t': 2 / 3,
  '1/8d': 0.75, '1/8': 0.5, '1/8t': 1 / 3, '1/16': 0.25, '1/16t': 1 / 6,
};

// How many times a second something set to a note value comes round at this tempo, or null when it
// is not set to one. Every rate that can follow the tempo, apart from the LFOs and the delay which
// came first and have their own, goes through this, live and in an export.
export function syncedRateHz(sync: unknown, bpm: number): number | null {
  const beats = typeof sync === 'string' ? RATE_SYNC_BEATS[sync as Exclude<RateSync, 'off'>] : undefined;
  return beats === undefined ? null : Math.max(20, Math.min(400, bpm)) / 60 / beats;
}

// How long a glide takes, in seconds: its note value at the tempo when it follows the tempo.
function glideSeconds(portamento: Partial<SynthParameters['portamento']> | undefined, bpm: number): number {
  const beats = portamento?.sync && portamento.sync !== 'off' ? RATE_SYNC_BEATS[portamento.sync] : undefined;
  return beats === undefined ? portamento?.glide ?? 0 : beats * 60 / Math.max(20, Math.min(400, bpm));
}

function flatRoutes(routes: SynthParameters['modMatrix']): FlatRoutes {
  const flat: Record<string, string | number> = {};
  for (let n = 1; n <= 8; n++) {
    const route = routes?.[n - 1];
    flat[`mod${n}Source`] = route?.source ?? '';
    flat[`mod${n}Destination`] = route?.destination ?? '';
    flat[`mod${n}Depth`] = route?.depth ?? 0;
  }
  return flat as FlatRoutes;
}

function flatInserts(inserts: SynthParameters['inserts'], bpm: number): InsertSettings {
  const chorus = inserts?.chorus, delay = inserts?.delay;
  const beat = syncedRateHz(delay?.sync, bpm);
  return {
    insDrive: inserts?.drive ?? 0, insTone: inserts?.tone ?? 0,
    insChorusMix: chorus?.mix ?? 0, insChorusDepth: chorus?.depth ?? 0, insChorusRate: syncedRateHz(chorus?.sync, bpm) ?? chorus?.rate ?? 0.6,
    insDelayMix: delay?.mix ?? 0, insDelayTime: beat ? 1 / beat : delay?.time ?? 0.25, insDelayFeedback: delay?.feedback ?? 0.3,
  };
}

export function toVoiceParams(p: SynthParameters, bpm = 120): VoiceParams {
  const d = createDefaultSynthParameters();
  const osc2 = p.oscillator2 ?? d.oscillator2!;
  const mixer = p.mixer ?? d.mixer!;
  const filterEnvelope = p.filterEnvelope ?? d.filterEnvelope!;
  const velocity = p.velocity ?? d.velocity!;
  const fm = p.fm ?? d.fm!;
  const unison = p.unison ?? d.unison!;
  const layer = p.layer ?? d.layer!;
  const lfoRate = (lfo: SynthParameters['lfo1']) => lfo.sync ? syncedLfoHz(lfo.rate, bpm) : lfo.rate;
  return {
    engine: p.engine ?? 'subtractive', voiceMode: p.voiceMode ?? 'poly',
    oscType: p.oscillator.type, detune: p.oscillator.detune, pulseWidth: p.oscillator.pulseWidth ?? 0.5,
    osc2Enabled: osc2.enabled, osc2Type: osc2.type, osc2Semitones: osc2.semitones, osc2Detune: osc2.detune, osc2Level: osc2.level,
    osc2Sync: osc2.sync ?? false, ringLevel: mixer.ring ?? 0,
    oscLevel: mixer.osc ?? 1, subLevel: mixer.sub, noiseLevel: mixer.noise,
    unisonVoices: unison.voices, unisonDetune: unison.detune, unisonMix: unison.mix ?? 1,
    sampleRoot: p.sample?.root ?? 60, sampleLoop: p.sample?.loop ?? false,
    sampleStart: p.sample?.start ?? 0, sampleLoopStart: p.sample?.loopStart ?? 0, sampleLoopEnd: p.sample?.loopEnd ?? 1,
    sampleScan: syncedRateHz(p.sample?.sync, bpm) ?? p.sample?.scan ?? 2, sampleFade: p.sample?.fade ?? 1,
    layerEnabled: layer.enabled, layerMix: layer.mix, layerDetune: layer.detune,
    layerBrightness: layer.brightness, layerAttack: layer.attack, layerWidth: layer.width,
    fmAlgorithm: fm.algorithm, fmRatio: fm.ratio, fmIndex: fm.index, fmDecay: fm.decay, fmFeedback: fm.feedback,
    filterType: p.filter.type, filterFreq: p.filter.frequency, filterQ: p.filter.q,
    filterEnvAmount: p.filter.envAmount ?? 0, filterKeyTracking: p.filter.keyTracking ?? 0, filterDrive: p.filter.drive ?? 0,
    filterSlope: p.filter.slope ?? 12, filterModel: p.filter.model ?? 'svf', filterHighpass: p.filter.highpass ?? 0,
    attack: p.envelope.attack, decay: p.envelope.decay, sustain: p.envelope.sustain, release: p.envelope.release,
    filterAttack: filterEnvelope.attack, filterDecay: filterEnvelope.decay,
    filterSustain: filterEnvelope.sustain, filterRelease: filterEnvelope.release,
    velocityAmp: velocity.amp, velocityFilter: velocity.filter,
    gain: p.gain, pan: p.pan ?? 0, spread: p.spread ?? 0,
    // A synced glide lasts its note value at the tempo.
    portamentoEnabled: p.portamento?.enabled ?? false, portamentoGlide: glideSeconds(p.portamento, bpm),
    portamentoFingered: p.portamento?.fingered === true, portamentoSpeed: p.portamento?.speed === true,
    lfo1Enabled: p.lfo1.enabled, lfo1Target: p.lfo1.target, lfo1Waveform: p.lfo1.waveform,
    lfo1Rate: lfoRate(p.lfo1), lfo1Depth: p.lfo1.depth, lfo1Retrigger: p.lfo1.retrigger ?? true,
    lfo2Enabled: p.lfo2.enabled, lfo2Target: p.lfo2.target, lfo2Waveform: p.lfo2.waveform,
    lfo2Rate: lfoRate(p.lfo2), lfo2Depth: p.lfo2.depth, lfo2Retrigger: p.lfo2.retrigger ?? true,
    ...flatRoutes(p.modMatrix),
    ...flatInserts(p.inserts, bpm),
  };
}
