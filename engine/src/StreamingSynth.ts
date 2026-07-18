import { SynthParameters, OscillatorType } from './types';
import { clamp, noteToFrequency as utilNoteToFrequency } from './utils';
import { AUDIO_MIXING } from './constants';

interface VoiceState {
  active: boolean;
  frequency: number;
  targetFrequency: number;
  velocity: number;
  oscPhase: number;
  lfo1Phase: number;
  lfo2Phase: number;
  envStage: 'attack' | 'decay' | 'sustain' | 'release' | 'off';
  envValue: number;
  noteOnTime: number;
  filterMemory: number;
}

export class StreamingSynth {
  private voices: VoiceState[] = [];
  private params: SynthParameters;
  private sampleRate: number;
  private maxVoices: number;

  private delayBufferL: Float32Array = new Float32Array(0);
  private delayBufferR: Float32Array = new Float32Array(0);
  private delayWriteIndex: number = 0;

  private combBuffers: Float32Array[] = [];
  private combIndices: number[] = [];
  private combFeedbacks: number[] = [];

  private phaserLfoPhase: number = 0;
  private phaserBuffers: Float32Array[] = [];
  private phaserWriteIndices: number[] = [];
  private phaserReadIndices: number[] = [];

  private noteOffQueue: Array<{ freq: number; releaseAtSample: number }> = [];
  private totalSamplesRendered: number = 0;

  constructor(sampleRate: number = 48000, maxVoices: number = 8) {
    this.sampleRate = sampleRate;
    this.maxVoices = maxVoices;
    this.params = this.getDefaultParams();
    this.initEffects();
    for (let i = 0; i < maxVoices; i++) {
      this.voices.push(this.createEmptyVoice());
    }
  }

  private getDefaultParams(): SynthParameters {
    return {
      hold: false,
      gain: 1.0,
      fxReturn: 0.85,
      pan: 0,
      portamento: { enabled: false, glide: 0.05 },
      arpeggiator: { enabled: false, mode: 'up', rate: '1/16', gate: 0.7 },
      oscillator: { type: 'sine', detune: 0 },
      lfo1: { enabled: false, target: 'pitch', waveform: 'sine', rate: 5, depth: 0.2 },
      lfo2: { enabled: false, target: 'filter', waveform: 'triangle', rate: 0.8, depth: 0.25 },
      filter: { frequency: 5000, q: 1, type: 'lowpass' },
      envelope: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 1.0 },
      fxSends: { reverb: 0.25, delay: 0.2, drive: 0.15, phaser: 0.1 },
      effects: {
        reverb: { enabled: false, wet: 0.3, decay: 1.5 },
        delay: { enabled: false, wet: 0.2, time: 0.25, feedback: 0.5 },
      },
    };
  }

  private createEmptyVoice(): VoiceState {
    return {
      active: false,
      frequency: 440,
      targetFrequency: 440,
      velocity: 0,
      oscPhase: 0,
      lfo1Phase: 0,
      lfo2Phase: 0,
      envStage: 'off',
      envValue: 0,
      noteOnTime: 0,
      filterMemory: 0,
    };
  }

  private initEffects() {
    const delaySamples = Math.max(1, Math.floor(this.params.effects.delay.time * this.sampleRate));
    this.delayBufferL = new Float32Array(delaySamples);
    this.delayBufferR = new Float32Array(delaySamples);
    this.delayWriteIndex = 0;

    const combDelays = [0.0297, 0.0371, 0.0411, 0.0437];
    this.combBuffers = combDelays.map(len => new Float32Array(Math.max(1, Math.floor(len * this.sampleRate))));
    this.combIndices = new Array(combDelays.length).fill(0);
    this.combFeedbacks = combDelays.map(() => clamp(0.55 + this.params.effects.reverb.decay * 0.035, 0.5, 0.92));

    const phaserDelays = [0.002, 0.003, 0.004, 0.005];
    this.phaserBuffers = phaserDelays.map(len => new Float32Array(Math.max(1, Math.floor(len * this.sampleRate))));
    this.phaserWriteIndices = new Array(phaserDelays.length).fill(0);
    this.phaserReadIndices = new Array(phaserDelays.length).fill(0);
  }

  private updateDelayBuffer() {
    const newLength = Math.max(1, Math.floor(this.params.effects.delay.time * this.sampleRate));
    if (newLength !== this.delayBufferL.length) {
      const newBufL = new Float32Array(newLength);
      const newBufR = new Float32Array(newLength);
      const copyLen = Math.min(newLength, this.delayBufferL.length);
      for (let i = 0; i < copyLen; i++) {
        const idx = (this.delayWriteIndex - copyLen + i + newLength * 2) % newLength;
        newBufL[i] = this.delayBufferL[(this.delayWriteIndex - copyLen + i + this.delayBufferL.length * 2) % this.delayBufferL.length];
        newBufR[i] = this.delayBufferR[(this.delayWriteIndex - copyLen + i + this.delayBufferR.length * 2) % this.delayBufferR.length];
      }
      this.delayBufferL = newBufL;
      this.delayBufferR = newBufR;
      this.delayWriteIndex = copyLen % newLength;
    }
  }

  private lfoValue(type: OscillatorType, phase: number): number {
    const frac = phase - Math.floor(phase);
    switch (type) {
      case 'sine': return Math.sin(2 * Math.PI * phase);
      case 'square': return frac < 0.5 ? 1 : -1;
      case 'sawtooth': return 2 * frac - 1;
      case 'triangle': return 1 - 4 * Math.abs(frac - 0.5);
      default: return 0;
    }
  }

  private computeWaveshaperCurve(amount: number): Float32Array {
    const samples = 256;
    const curve = new Float32Array(samples);
    const k = amount * 18;
    if (k === 0) {
      for (let i = 0; i < samples; i++) curve[i] = (i * 2) / samples - 1;
      return curve;
    }
    const limit = Math.tanh(k);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * k) / limit;
    }
    return curve;
  }

  renderChunk(samplesPerChannel: number): { left: Float32Array; right: Float32Array } {
    while (this.noteOffQueue.length > 0 && this.noteOffQueue[0].releaseAtSample <= this.totalSamplesRendered) {
      const entry = this.noteOffQueue.shift()!;
      const voice = this.voices.find(v => v.active && Math.abs(v.frequency - entry.freq) < 0.5);
      if (voice && voice.envStage !== 'release') {
        voice.envStage = 'release';
      }
    }

    const left = new Float32Array(samplesPerChannel);
    const right = new Float32Array(samplesPerChannel);
    const p = this.params;
    const dt = 1 / this.sampleRate;
    const PITCH_LFO_MAX = 1200;
    const FILTER_LFO_MAX = 2;
    const FxReturn = clamp(p.fxReturn ?? 0.85, 0, 1);
    const globalPan = clamp(p.pan ?? 0, -1, 1);
    const spread = clamp(p.spread ?? 0, 0, 1);

    const driveCurve = p.fxSends.drive > 0 ? this.computeWaveshaperCurve(p.fxSends.drive * 0.8) : null;

    for (let i = 0; i < samplesPerChannel; i++) {
      let dryL = 0;
      let dryR = 0;

      for (let v = 0; v < this.voices.length; v++) {
        const voice = this.voices[v];
        if (!voice.active || voice.envStage === 'off') continue;

        const env = this.processEnvelope(voice, dt);
        if (env <= 0.0001) continue;

        if (p.portamento.enabled && Math.abs(voice.frequency - voice.targetFrequency) > 0.5) {
          const glideRate = p.portamento.glide > 0 ? dt / Math.max(0.001, p.portamento.glide) : 1;
          voice.frequency += (voice.targetFrequency - voice.frequency) * Math.min(glideRate, 1);
        }

        const lfo1Val = p.lfo1.enabled ? this.lfoValue(p.lfo1.waveform, voice.lfo1Phase) : 0;
        const lfo2Val = p.lfo2.enabled ? this.lfoValue(p.lfo2.waveform, voice.lfo2Phase) : 0;

        const pitchMod = (p.lfo1.enabled && p.lfo1.target === 'pitch' ? lfo1Val * p.lfo1.depth : 0)
          + (p.lfo2.enabled && p.lfo2.target === 'pitch' ? lfo2Val * p.lfo2.depth : 0);
        const currentFreq = voice.frequency * Math.pow(2, p.oscillator.detune / 1200) * Math.pow(2, (pitchMod * PITCH_LFO_MAX) / 1200);

        voice.oscPhase += currentFreq / this.sampleRate;
        voice.oscPhase -= Math.floor(voice.oscPhase);

        let sample: number;
        const frac = voice.oscPhase;
        switch (p.oscillator.type) {
          case 'sine': sample = Math.sin(2 * Math.PI * voice.oscPhase); break;
          case 'square': sample = frac < 0.5 ? 1 : -1; break;
          case 'sawtooth': sample = 2 * frac - 1; break;
          case 'triangle': sample = 4 * Math.abs(frac - 0.5) - 1; break;
          default: sample = Math.sin(2 * Math.PI * voice.oscPhase);
        }

        const filterMod = (p.lfo1.enabled && p.lfo1.target === 'filter' ? lfo1Val * p.lfo1.depth : 0)
          + (p.lfo2.enabled && p.lfo2.target === 'filter' ? lfo2Val * p.lfo2.depth : 0);
        const modulatedCutoff = clamp(
          p.filter.frequency * Math.pow(2, clamp(filterMod, -1, 1) * FILTER_LFO_MAX),
          20, 20000
        );
        const rc = 1 / (2 * Math.PI * modulatedCutoff);
        const alpha = dt / (rc + dt);
        voice.filterMemory = voice.filterMemory + alpha * (sample - voice.filterMemory);
        const filtered = voice.filterMemory;

        const vol = env * voice.velocity * clamp(p.gain, 0, 2) * AUDIO_MIXING.SYNTH_MASTER_VOLUME;
        const out = filtered * vol;

        const freqNorm = clamp((Math.log2(voice.frequency) - Math.log2(80)) / (Math.log2(8000) - Math.log2(80)), 0, 1);
        const spreadPan = spread > 0 ? (freqNorm * 2 - 1) * spread : 0;
        const voicePan = clamp(globalPan + spreadPan, -1, 1);
        const voicePanAngle = (voicePan + 1) * Math.PI / 4;
        const voicePanL = Math.cos(voicePanAngle);
        const voicePanR = Math.sin(voicePanAngle);
        dryL += out * voicePanL;
        dryR += out * voicePanR;

        voice.lfo1Phase += p.lfo1.rate * dt;
        voice.lfo2Phase += p.lfo2.rate * dt;
      }

      let wetL = 0;
      let wetR = 0;

      if (p.effects.delay.enabled && p.effects.delay.wet > 0) {
        const delayLen = this.delayBufferL.length;
        const readIdx = (this.delayWriteIndex - 1 + delayLen * 2) % delayLen;
        const delayedL = this.delayBufferL[readIdx];
        const delayedR = this.delayBufferR[readIdx];
        this.delayBufferL[this.delayWriteIndex] = dryL + delayedL * p.effects.delay.feedback;
        this.delayBufferR[this.delayWriteIndex] = dryR + delayedR * p.effects.delay.feedback;
        this.delayWriteIndex = (this.delayWriteIndex + 1) % delayLen;
        const dw = p.effects.delay.wet;
        wetL += delayedL * dw;
        wetR += delayedR * dw;
      } else {
        this.delayBufferL[this.delayWriteIndex] = 0;
        this.delayBufferR[this.delayWriteIndex] = 0;
        this.delayWriteIndex = (this.delayWriteIndex + 1) % Math.max(1, this.delayBufferL.length);
      }

      if (p.effects.reverb.enabled && p.effects.reverb.wet > 0) {
        const dw = p.effects.reverb.wet;
        let reverbAccum = 0;
        for (let c = 0; c < this.combBuffers.length; c++) {
          const buf = this.combBuffers[c];
          const idx = this.combIndices[c];
          const delayed = buf[idx];
          buf[idx] = (dryL + dryR) * 0.5 + delayed * this.combFeedbacks[c];
          this.combIndices[c] = (idx + 1) % buf.length;
          reverbAccum += delayed;
        }
        const revOut = reverbAccum / this.combBuffers.length;
        wetL += revOut * dw;
        wetR += revOut * dw;
      }

      if (driveCurve && p.fxSends.drive > 0) {
        const driveMix = p.fxSends.drive;
        const driveWet = driveMix * FxReturn;
        if (driveWet > 0) {
          const driveInL = dryL * 0.5 + dryR * 0.5;
          const driveInR = driveInL;
          const idxL = clamp(Math.floor((driveInL * 0.5 + 0.5) * (driveCurve.length - 1)), 0, driveCurve.length - 1);
          const idxR = clamp(Math.floor((driveInR * 0.5 + 0.5) * (driveCurve.length - 1)), 0, driveCurve.length - 1);
          wetL += driveCurve[idxL] * driveWet;
          wetR += driveCurve[idxR] * driveWet;
        }
      }

      if (p.fxSends.phaser > 0) {
        const phaserMix = p.fxSends.phaser * FxReturn;
        if (phaserMix > 0) {
          this.phaserLfoPhase += 0.45 * dt;
          const lfoVal = Math.sin(2 * Math.PI * this.phaserLfoPhase);

          let phaserL = dryL;
          let phaserR = dryR;

          for (let s = 0; s < 4; s++) {
            const baseDelay = 0.001 + s * 0.0015;
            const modDepth = 0.002 * (s + 1);
            const delayTime = baseDelay + lfoVal * modDepth;
            const delaySamples = Math.max(1, Math.floor(delayTime * this.sampleRate));
            const buf = this.phaserBuffers[s];
            const bufLen = buf.length;

            buf[this.phaserWriteIndices[s]] = phaserL;
            const readPos = (this.phaserWriteIndices[s] - delaySamples + bufLen * 2) % bufLen;
            const readIdx = Math.floor(readPos);
            const frac = readPos - readIdx;
            const delayed = buf[readIdx] * (1 - frac) + buf[(readIdx + 1) % bufLen] * frac;

            const feedback = 0.3;
            phaserL = delayed * feedback + phaserL * (1 - feedback);
            phaserR = delayed * feedback + phaserR * (1 - feedback);

            this.phaserWriteIndices[s] = (this.phaserWriteIndices[s] + 1) % bufLen;
          }

          wetL += phaserL * phaserMix * 0.5;
          wetR += phaserR * phaserMix * 0.5;
        }
      }

      let outL = dryL + wetL;
      let outR = dryR + wetR;

      if (outL > 1) outL = 1 + (1 - outL) * 0.2;
      else if (outL < -1) outL = -1 + (1 + outL) * 0.2;
      if (outR > 1) outR = 1 + (1 - outR) * 0.2;
      else if (outR < -1) outR = -1 + (1 + outR) * 0.2;

      left[i] = outL;
      right[i] = outR;
    }

    this.totalSamplesRendered += samplesPerChannel;
    return { left, right };
  }

  private processEnvelope(voice: VoiceState, dt: number): number {
    const env = this.params.envelope;
    switch (voice.envStage) {
      case 'attack': {
        voice.envValue += dt / Math.max(0.001, env.attack);
        if (voice.envValue >= 1) {
          voice.envValue = 1;
          voice.envStage = 'decay';
        }
        break;
      }
      case 'decay': {
        voice.envValue -= dt / Math.max(0.001, env.decay) * (1 - env.sustain);
        if (voice.envValue <= env.sustain) {
          voice.envValue = env.sustain;
          voice.envStage = 'sustain';
        }
        break;
      }
      case 'sustain': {
        voice.envValue = env.sustain;
        break;
      }
      case 'release': {
        voice.envValue -= dt / Math.max(0.001, env.release) * voice.envValue;
        if (voice.envValue <= 0.001) {
          voice.envValue = 0;
          voice.envStage = 'off';
          voice.active = false;
        }
        break;
      }
    }
    return voice.envValue;
  }

  noteOn(note: string, velocity: number = 0.7) {
    const freq = utilNoteToFrequency(note);
    let voice = this.voices.find(v => v.active && v.frequency === freq);
    if (voice) {
      voice.velocity = velocity;
      voice.envStage = 'attack';
      voice.envValue = 0;
      voice.noteOnTime = 0;
      return;
    }
    voice = this.voices.find(v => !v.active);
    if (!voice) {
      voice = this.voices[0];
    }
    voice.active = true;
    voice.targetFrequency = freq;
    if (this.params.portamento.enabled && this.voices.some(v => v.active && v !== voice)) {
      voice.frequency = voice.frequency || freq;
    } else {
      voice.frequency = freq;
    }
    voice.velocity = clamp(velocity, 0, 1);
    voice.oscPhase = 0;
    voice.lfo1Phase = 0;
    voice.lfo2Phase = 0;
    voice.envStage = 'attack';
    voice.envValue = 0;
    voice.noteOnTime = 0;
    voice.filterMemory = 0;
  }

  noteOff(note: string) {
    const freq = utilNoteToFrequency(note);
    const voice = this.voices.find(v => v.active && v.frequency === freq);
    if (voice && voice.envStage !== 'release') {
      voice.envStage = 'release';
    }
  }

  scheduleNoteOff(note: string, delaySamples: number) {
    const freq = utilNoteToFrequency(note);
    this.noteOffQueue.push({ freq, releaseAtSample: this.totalSamplesRendered + delaySamples });
  }

  allNotesOff() {
    for (const voice of this.voices) {
      voice.active = false;
      voice.envStage = 'off';
      voice.envValue = 0;
    }
    this.noteOffQueue.length = 0;
  }

  updateParameters(params: Partial<SynthParameters>) {
    const oldDelayTime = this.params.effects.delay.time;
    const oldReverbDecay = this.params.effects.reverb.decay;

    if (params.oscillator) this.params.oscillator = { ...this.params.oscillator, ...params.oscillator };
    if (params.filter) this.params.filter = { ...this.params.filter, ...params.filter };
    if (params.envelope) this.params.envelope = { ...this.params.envelope, ...params.envelope };
    if (params.lfo1) this.params.lfo1 = { ...this.params.lfo1, ...params.lfo1 };
    if (params.lfo2) this.params.lfo2 = { ...this.params.lfo2, ...params.lfo2 };
    if (params.gain !== undefined) this.params.gain = params.gain;
    if (params.fxReturn !== undefined) this.params.fxReturn = params.fxReturn;
    if (params.pan !== undefined) this.params.pan = params.pan;
    if (params.portamento) this.params.portamento = { ...this.params.portamento, ...params.portamento };
    if (params.fxSends) this.params.fxSends = { ...this.params.fxSends, ...params.fxSends };
    if (params.effects) {
      if (params.effects.delay) this.params.effects.delay = { ...this.params.effects.delay, ...params.effects.delay };
      if (params.effects.reverb) this.params.effects.reverb = { ...this.params.effects.reverb, ...params.effects.reverb };
    }

    if (this.params.effects.delay.time !== oldDelayTime) this.updateDelayBuffer();
    if (this.params.effects.reverb.decay !== oldReverbDecay) {
      this.combFeedbacks = this.combFeedbacks.map(() =>
        clamp(0.55 + this.params.effects.reverb.decay * 0.035, 0.5, 0.92)
      );
    }
  }

  getParameters(): SynthParameters {
    return { ...this.params };
  }

  dispose() {
    this.allNotesOff();
  }
}
