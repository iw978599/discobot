import { Adsr, Noise, Svf, approachCoefficient, finiteClamp as clamp, lfoShape, noteFrequency, oscillator, svfCoefficient } from '../dsp';
import { VoiceParams, createDefaultSynthParameters, toVoiceParams } from './voiceParams';

export interface NoteOnMessage {
  note: string;
  velocity?: number;
  id?: number;
  // seconds the gate stays open; omitted means held until noteOff
  duration?: number;
  // absolute start in seconds on the core's clock; omitted or past means now
  time?: number;
}

interface Voice {
  active: boolean;
  note: string;
  id: number | undefined;
  frequency: number;
  targetFrequency: number;
  velocity: number;
  keyOctaves: number;
  // one phase per unison copy; a single voice only uses the first
  phase1: Float64Array;
  phase2: Float64Array;
  phaseSub: number;
  fmPhase: [number, number, number, number];
  fmFeedback: number;
  fmEnv: number;
  lfoPhase: [number, number];
  amp: Adsr;
  filterEnv: Adsr;
  filter: Svf;
  filter2: Svf;
  previousInput: number;
  last: number;
  transition: number;
  transitionSamples: number;
  age: number;
  remaining: number;
  releaseOverride: number;
}

const TWO_PI = 2 * Math.PI;
const VOICE_LEVEL = 0.18;
const MIDDLE_C = 261.6256;
const MAX_UNISON = 5;
// The second stage of the 24 dB filter is not resonant; the first stage supplies the peak.
const SECOND_STAGE_DAMPING = Math.SQRT2;

// The one synth voice implementation. The AudioWorklet runs it block by block for live
// playback and the WAV exporter runs it offline, so both produce the same audio.
export class SynthCore {
  readonly voices: Voice[];
  frame = 0;
  private params: VoiceParams = toVoiceParams(createDefaultSynthParameters());
  private smoothed = { gain: 1, pan: 0, spread: 0, detune: 0, filterFreq: 20000, filterQ: 1, pulseWidth: 0.5 };
  private derived = {
    attack: 0, decay: 0, sustain: 0.7, release: 0,
    filterAttack: 0, filterDecay: 0, filterSustain: 0.2, filterRelease: 0,
    glide: 1, osc2Ratio: 1, mixScale: 1, fmDecay: 0, driveGain: 1, driveMakeup: 1,
    unisonCount: 1, unisonRatios: new Float64Array(MAX_UNISON).fill(1), twoStage: false,
  };
  private pending: Array<NoteOnMessage & { frame: number }> = [];
  private globalLfoPhase: [number, number] = [0, 0];
  private noise = new Noise();
  private age = 0;
  private lastFrequency = 440;
  private readonly smoothing: number;
  private readonly transitionLength: number;

  constructor(readonly sampleRate: number, voiceCount = 8) {
    this.smoothing = approachCoefficient(0.01, sampleRate, 1);
    this.transitionLength = Math.ceil(sampleRate * 0.005);
    this.voices = Array.from({ length: voiceCount }, () => ({
      active: false, note: '', id: undefined, frequency: 440, targetFrequency: 440, velocity: 0, keyOctaves: 0,
      phase1: new Float64Array(MAX_UNISON), phase2: new Float64Array(MAX_UNISON), phaseSub: 0,
      fmPhase: [0, 0, 0, 0], fmFeedback: 0, fmEnv: 0, lfoPhase: [0, 0],
      amp: new Adsr(), filterEnv: new Adsr(), filter: new Svf(), filter2: new Svf(), previousInput: 0,
      last: 0, transition: 0, transitionSamples: 0, age: 0, remaining: Infinity, releaseOverride: 0,
    }));
    this.refreshDerived();
    Object.assign(this.smoothed, {
      gain: this.params.gain, filterFreq: this.params.filterFreq, filterQ: this.params.filterQ,
    });
  }

  setParams(update: Partial<Record<keyof VoiceParams, unknown>> | null | undefined): void {
    if (!update) return;
    const p = this.params as unknown as Record<string, unknown>;
    const signature = () => `${p.oscType}|${p.filterType}|${p.engine}|${p.osc2Type}|${p.filterSlope}|${p.unisonVoices}`;
    const before = signature();
    for (const [key, value] of Object.entries(update)) {
      if (!(key in p)) continue;
      const current = p[key];
      if (typeof current === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) p[key] = value;
      } else if (typeof current === 'boolean') {
        if (typeof value === 'boolean') p[key] = value;
      } else if (typeof value === 'string') p[key] = value;
    }
    if (before !== signature()) {
      // Switching waveform, filter mode, unison or engine jumps the signal; crossfade from the last sample.
      for (const voice of this.voices) {
        voice.transition = voice.last;
        voice.transitionSamples = this.transitionLength;
      }
    }
    this.refreshDerived();
  }

  private refreshDerived(): void {
    const p = this.params, d = this.derived, sr = this.sampleRate;
    // The attack aims above 1 so it arrives in the stated time; decay and release settle to 1% and 0.1%.
    d.attack = approachCoefficient(clamp(p.attack, 0.001, 10, 0.01), sr, 1.47);
    d.decay = approachCoefficient(clamp(p.decay, 0.002, 10, 0.2), sr, 4.6);
    d.sustain = clamp(p.sustain, 0, 1, 0.5);
    d.release = approachCoefficient(clamp(p.release, 0.005, 10, 0.3), sr, 6.9);
    d.filterAttack = approachCoefficient(clamp(p.filterAttack, 0.001, 10, 0.005), sr, 1.47);
    d.filterDecay = approachCoefficient(clamp(p.filterDecay, 0.002, 10, 0.25), sr, 4.6);
    d.filterSustain = clamp(p.filterSustain, 0, 1, 0.2);
    d.filterRelease = approachCoefficient(clamp(p.filterRelease, 0.005, 10, 0.3), sr, 6.9);
    d.glide = p.portamentoEnabled ? approachCoefficient(clamp(p.portamentoGlide, 0.001, 2, 0.05), sr, 1) : 1;
    d.osc2Ratio = 2 ** (clamp(p.osc2Semitones, -36, 36, 0) / 12 + clamp(p.osc2Detune, -100, 100, 0) / 1200);
    const osc2 = p.osc2Enabled ? clamp(p.osc2Level, 0, 1) : 0;
    const sub = clamp(p.subLevel, 0, 1), noise = clamp(p.noiseLevel, 0, 1);
    d.unisonCount = Math.round(clamp(p.unisonVoices, 1, MAX_UNISON, 1));
    // Copies are spread evenly across plus and minus the detune amount, up to 50 cents each way.
    const spreadCents = clamp(p.unisonDetune, 0, 1) * 50;
    for (let u = 0; u < MAX_UNISON; u++) {
      const position = d.unisonCount > 1 ? (u / (d.unisonCount - 1)) * 2 - 1 : 0;
      d.unisonRatios[u] = 2 ** (position * spreadCents / 1200);
    }
    d.mixScale = 1 / Math.sqrt(d.unisonCount * (1 + osc2 * osc2) + sub * sub + noise * noise);
    d.twoStage = p.filterSlope >= 24 && (p.filterType === 'lowpass' || p.filterType === 'highpass' || p.filterType === 'bandpass');
    d.fmDecay = approachCoefficient(clamp(p.fmDecay, 0.01, 10, 0.6), sr, 4.6);
    const drive = clamp(p.filterDrive, 0, 1);
    d.driveGain = 1 + drive * 5;
    d.driveMakeup = 1 / (1 + drive * 1.6);
  }

  noteOn(message: NoteOnMessage): void {
    if (Number.isFinite(message.time) && message.time! * this.sampleRate > this.frame) {
      this.pending.push({ ...message, frame: Math.round(message.time! * this.sampleRate) });
      this.pending.sort((a, b) => a.frame - b.frame);
      return;
    }
    this.startNote(message);
  }

  private startNote(message: NoteOnMessage): void {
    const frequency = noteFrequency(message.note);
    const velocity = clamp(message.velocity ?? 1, 0, 1, 1);
    if (!frequency || velocity === 0) return;
    const p = this.params;
    const remaining = Number.isFinite(message.duration)
      ? Math.max(1, Math.round(message.duration! * this.sampleRate)) : Infinity;
    const keyOctaves = Math.log2(frequency / MIDDLE_C);

    if (p.voiceMode === 'mono') {
      const voice = this.voices[0];
      for (let i = 1; i < this.voices.length; i++) this.release(this.voices[i]);
      if (voice.active && voice.amp.stage !== 'release') {
        // Legato: move the pitch without retriggering the envelopes. This is what a slide is.
        voice.note = message.note;
        voice.id = message.id;
        voice.targetFrequency = frequency;
        if (!p.portamentoEnabled) voice.frequency = frequency;
        voice.keyOctaves = keyOctaves;
        voice.remaining = remaining;
        this.lastFrequency = frequency;
        return;
      }
      this.trigger(voice, message, frequency, frequency, velocity, remaining, keyOctaves);
      return;
    }

    let voice = this.voices.find(v => v.active && v.note === message.note)
      || this.voices.find(v => !v.active);
    if (!voice) voice = this.voices.reduce((oldest, v) => v.age < oldest.age ? v : oldest);
    this.trigger(voice, message, frequency, p.portamentoEnabled ? this.lastFrequency : frequency, velocity, remaining, keyOctaves);
  }

  private trigger(voice: Voice, message: NoteOnMessage, frequency: number, startFrequency: number, velocity: number, remaining: number, keyOctaves: number): void {
    if (!voice.active) {
      // Unison copies start out of phase with each other, or the note would open with a spike.
      for (let u = 0; u < MAX_UNISON; u++) {
        voice.phase1[u] = (u * 0.37) % 1;
        voice.phase2[u] = (u * 0.61) % 1;
      }
      voice.phaseSub = 0;
      voice.fmPhase = [0, 0, 0, 0];
      voice.fmFeedback = 0;
      voice.filter.reset();
      voice.filter2.reset();
      voice.previousInput = 0;
      voice.amp.reset();
      voice.filterEnv.reset();
    }
    // A voice that is still sounding keeps its phase and envelope level, so stealing it cannot click.
    voice.active = true;
    voice.note = message.note;
    voice.id = message.id;
    voice.frequency = startFrequency;
    voice.targetFrequency = frequency;
    voice.velocity = velocity;
    voice.keyOctaves = keyOctaves;
    voice.lfoPhase = [0, 0];
    voice.fmEnv = 1;
    voice.amp.gateOn();
    voice.filterEnv.gateOn();
    voice.age = ++this.age;
    voice.remaining = remaining;
    voice.releaseOverride = 0;
    this.lastFrequency = frequency;
  }

  noteOff(note: string, id?: number): void {
    this.pending = this.pending.filter(entry => entry.note !== note || (id !== undefined && entry.id !== id));
    for (const voice of this.voices) {
      if (voice.active && voice.note === note && (id === undefined || id === voice.id)) this.release(voice);
    }
  }

  allNotesOff(release = 0.03): void {
    this.pending = [];
    const coefficient = approachCoefficient(clamp(release, 0.005, 2, 0.03), this.sampleRate, 6.9);
    for (const voice of this.voices) this.release(voice, coefficient);
  }

  private release(voice: Voice, override = 0): void {
    if (!voice.active || voice.amp.stage === 'release') return;
    voice.releaseOverride = override;
    voice.amp.gateOff();
    voice.filterEnv.gateOff();
  }

  get idle(): boolean {
    return this.pending.length === 0 && this.voices.every(voice => !voice.active);
  }

  process(left: Float32Array, right: Float32Array): void {
    const p = this.params, s = this.smoothed, d = this.derived, sr = this.sampleRate, k = this.smoothing;
    const maxCutoff = Math.min(20000, sr * 0.45);
    const fm = p.engine === 'fm';
    const osc2Level = p.osc2Enabled ? clamp(p.osc2Level, 0, 1) : 0;
    const subLevel = clamp(p.subLevel, 0, 1), noiseLevel = clamp(p.noiseLevel, 0, 1);
    const lfoRates = [clamp(p.lfo1Rate, 0, 100) / sr, clamp(p.lfo2Rate, 0, 100) / sr];
    const lfoDepths = [p.lfo1Enabled ? clamp(p.lfo1Depth, 0, 1) : 0, p.lfo2Enabled ? clamp(p.lfo2Depth, 0, 1) : 0];
    const lfoTargets = [p.lfo1Target, p.lfo2Target];
    const lfoWaves = [p.lfo1Waveform, p.lfo2Waveform];
    const lfoRetrigger = [p.lfo1Retrigger, p.lfo2Retrigger];
    const velocityAmp = clamp(p.velocityAmp, 0, 1, 1), velocityFilter = clamp(p.velocityFilter, 0, 1);
    const envAmount = clamp(p.filterEnvAmount, -1, 1), keyTracking = clamp(p.filterKeyTracking, 0, 1);
    const fmRatio = clamp(p.fmRatio, 0.25, 16, 2), fmIndex = clamp(p.fmIndex, 0, 1), fmFeedback = clamp(p.fmFeedback, 0, 1);
    const algorithm = Math.round(clamp(p.fmAlgorithm, 0, 3));

    for (let i = 0; i < left.length; i++) {
      while (this.pending.length && this.pending[0].frame <= this.frame + i) this.startNote(this.pending.shift()!);
      s.gain += (clamp(p.gain, 0, 2, s.gain) - s.gain) * k;
      s.pan += (clamp(p.pan, -1, 1, s.pan) - s.pan) * k;
      s.spread += (clamp(p.spread, 0, 1, s.spread) - s.spread) * k;
      s.detune += (clamp(p.detune, -1200, 1200, s.detune) - s.detune) * k;
      s.filterFreq += (clamp(p.filterFreq, 20, maxCutoff, s.filterFreq) - s.filterFreq) * k;
      s.filterQ += (clamp(p.filterQ, 0.1, 20, s.filterQ) - s.filterQ) * k;
      s.pulseWidth += (clamp(p.pulseWidth, 0.05, 0.95, s.pulseWidth) - s.pulseWidth) * k;
      this.globalLfoPhase[0] = (this.globalLfoPhase[0] + lfoRates[0]) % 1;
      this.globalLfoPhase[1] = (this.globalLfoPhase[1] + lfoRates[1]) % 1;

      let l = 0, r = 0;
      for (let index = 0; index < this.voices.length; index++) {
        const v = this.voices[index];
        if (!v.active) continue;
        if (--v.remaining <= 0) this.release(v);
        const amp = v.amp.tick(d.attack, d.decay, d.sustain, v.releaseOverride || d.release);
        if (v.amp.stage === 'off') { v.active = false; v.last = 0; continue; }
        const filterEnv = v.filterEnv.tick(d.filterAttack, d.filterDecay, d.filterSustain, v.releaseOverride || d.filterRelease);
        v.frequency += (v.targetFrequency - v.frequency) * d.glide;

        let pitchMod = 0, filterMod = 0, ampMod = 1, pulseMod = 0;
        for (let n = 0; n < 2; n++) {
          if (lfoRetrigger[n]) v.lfoPhase[n] = (v.lfoPhase[n] + lfoRates[n]) % 1;
          if (lfoDepths[n] === 0) continue;
          const value = lfoShape(lfoWaves[n], lfoRetrigger[n] ? v.lfoPhase[n] : this.globalLfoPhase[n]) * lfoDepths[n];
          if (lfoTargets[n] === 'pitch') pitchMod += value;
          else if (lfoTargets[n] === 'filter') filterMod += value;
          else if (lfoTargets[n] === 'amp') ampMod *= 1 - (lfoDepths[n] - value) * 0.5;
          else if (lfoTargets[n] === 'pulseWidth') pulseMod += value * 0.45;
        }

        const step = clamp(v.frequency * 2 ** (s.detune / 1200 + pitchMod) / sr, 0.000001, 0.45);
        let source: number;
        if (fm) {
          v.fmEnv += (0.2 - v.fmEnv) * d.fmDecay;
          const depth = fmIndex * v.fmEnv * (0.4 + 0.6 * v.velocity);
          const ph = v.fmPhase;
          ph[0] = (ph[0] + step) % 1;
          ph[1] = (ph[1] + step * fmRatio) % 1;
          ph[2] = (ph[2] + step * 1.003) % 1;
          ph[3] = (ph[3] + step * fmRatio) % 1;
          const opD = Math.sin(TWO_PI * ph[3] + v.fmFeedback * fmFeedback * 2.5);
          v.fmFeedback = opD;
          if (algorithm === 0) {
            const opC = Math.sin(TWO_PI * (ph[2] + depth * 0.5 * opD));
            const opB = Math.sin(TWO_PI * (ph[1] + depth * opC));
            source = Math.sin(TWO_PI * (ph[0] + depth * opB));
          } else if (algorithm === 1) {
            source = 0.5 * (Math.sin(TWO_PI * (ph[0] + depth * Math.sin(TWO_PI * ph[1])))
              + Math.sin(TWO_PI * (ph[2] + depth * opD)));
          } else if (algorithm === 2) {
            source = Math.sin(TWO_PI * (ph[0] + depth * (Math.sin(TWO_PI * ph[1]) + Math.sin(TWO_PI * ph[2]) + opD) / 2));
          } else {
            source = 0.4 * (Math.sin(TWO_PI * ph[0]) + Math.sin(TWO_PI * ph[2])
              + depth * (Math.sin(TWO_PI * ph[1]) + opD));
          }
        } else {
          const pulseWidth = clamp(s.pulseWidth + pulseMod, 0.05, 0.95, 0.5);
          source = 0;
          for (let u = 0; u < d.unisonCount; u++) {
            const step1 = clamp(step * d.unisonRatios[u], 0.000001, 0.45);
            v.phase1[u] = (v.phase1[u] + step1) % 1;
            source += oscillator(p.oscType, v.phase1[u], step1, pulseWidth);
            if (osc2Level > 0) {
              const step2 = clamp(step1 * d.osc2Ratio, 0.000001, 0.45);
              v.phase2[u] = (v.phase2[u] + step2) % 1;
              source += oscillator(p.osc2Type, v.phase2[u], step2) * osc2Level;
            }
          }
          if (subLevel > 0) {
            v.phaseSub = (v.phaseSub + step * 0.5) % 1;
            source += oscillator('square', v.phaseSub, step * 0.5) * subLevel;
          }
          if (noiseLevel > 0) source += this.noise.next() * noiseLevel;
          source *= d.mixScale;
        }

        if (d.driveGain > 1) source = Math.tanh(source * d.driveGain) * d.driveMakeup;
        const octaves = clamp(filterMod, -1, 1) * 2 + envAmount * 5 * filterEnv
          + keyTracking * v.keyOctaves + velocityFilter * 3 * (v.velocity - 0.5);
        // Run the filter twice per sample: cheap 2x oversampling keeps resonance clean near Nyquist.
        const g = svfCoefficient(clamp(s.filterFreq * 2 ** octaves, 20, maxCutoff, 1000), sr * 2);
        const damping = 1 / s.filterQ;
        const midpoint = (v.previousInput + source) * 0.5;
        v.filter.tick(midpoint, g, damping);
        if (d.twoStage) v.filter2.tick(v.filter.output(p.filterType, midpoint, damping), g, SECOND_STAGE_DAMPING);
        v.filter.tick(source, g, damping);
        v.previousInput = source;
        let filtered = v.filter.output(p.filterType, source, damping);
        if (d.twoStage) {
          v.filter2.tick(filtered, g, SECOND_STAGE_DAMPING);
          filtered = v.filter2.output(p.filterType, filtered, SECOND_STAGE_DAMPING);
        }

        const velocityGain = 1 - velocityAmp * (1 - v.velocity);
        let value = filtered * amp * ampMod * velocityGain * s.gain * VOICE_LEVEL;
        if (v.transitionSamples > 0) {
          const blend = v.transitionSamples / this.transitionLength;
          value = value * (1 - blend) + v.transition * blend;
          v.transitionSamples--;
        }
        v.last = value;
        const angle = (clamp(s.pan + clamp(v.keyOctaves / 3 - 0.25, -1, 1) * s.spread, -1, 1) + 1) * Math.PI / 4;
        l += value * Math.cos(angle);
        r += value * Math.sin(angle);
      }
      left[i] = Math.tanh(l);
      right[i] = Math.tanh(r);
    }
    this.frame += left.length;
  }
}
