import { Noise, Svf, finiteClamp as clamp, oscillator, svfCoefficient } from '../dsp';
import type { DrumInstrument, DrumSettings } from '../types';

export interface DrumHitMessage {
  instrument: DrumInstrument;
  settings: DrumSettings;
  velocity?: number;
  kitId?: string;
  // absolute start in seconds on the core's clock; omitted or past means now
  time?: number;
}

// How a kit colours the shared voice models. The sample-based machines (LinnDrum, DMX, TR-707)
// are approximated by running the voices through their converter's bit depth and sample rate.
interface KitCharacter {
  machine: '808' | '909';
  drive: number;
  bits: number;
  rate: number;
  decay: number;
}

const KIT_CHARACTERS: Record<string, KitCharacter> = {
  'clean-analog': { machine: '808', drive: 0, bits: 0, rate: 0, decay: 1 },
  'punchy-modern': { machine: '909', drive: 0.4, bits: 0, rate: 0, decay: 0.9 },
  'lofi-dirty': { machine: '808', drive: 0.65, bits: 7, rate: 14000, decay: 0.9 },
  'tr-808': { machine: '808', drive: 0.12, bits: 0, rate: 0, decay: 1.35 },
  'tr-909': { machine: '909', drive: 0.2, bits: 0, rate: 0, decay: 1 },
  'linndrum': { machine: '909', drive: 0.1, bits: 8, rate: 28000, decay: 0.8 },
  'oberheim-dmx': { machine: '909', drive: 0.3, bits: 8, rate: 24000, decay: 0.7 },
  'tr-707': { machine: '909', drive: 0, bits: 8, rate: 25000, decay: 0.75 },
};

// The six detuned square oscillators the TR-808 uses for its hats and cymbal.
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];
const INSTRUMENTS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
// Brings every voice to a similar peak before the kit's drive, so drive colours all drums
// evenly and the volume knobs mean the same thing on every instrument.
const VOICE_TRIM: Record<DrumInstrument, number> = {
  kick: 0.89, snare: 0.78, clap: 1.03, closedHH: 2.55, openHH: 2.55, snare2: 0.9, ride: 0.9, crash: 1.77,
};
const HIT_LEVEL = 0.7;

interface DrumVoice {
  instrument: DrumInstrument;
  active: boolean;
  startFrame: number;
  age: number;
  machine: '808' | '909';
  ride: boolean;
  trim: number;
  gain: number;
  panL: number;
  panR: number;
  driveGain: number;
  driveNorm: number;
  quantize: number;
  holdLength: number;
  holdCount: number;
  holdValue: number;
  phase: Float64Array;
  step: Float64Array;
  env: Float64Array;
  rate: Float64Array;
  sweep: number;
  level: number;
  noiseLevel: number;
  burstLength: number;
  tailRate: number;
  filters: [Svf, Svf, Svf];
  g: [number, number, number];
  k: [number, number, number];
  choke: number;
  chokeRate: number;
  last: number;
  tail: number;
  tailSamples: number;
  noise: Noise;
}

// Streaming drum voices. One voice per instrument, mixed linearly: no per-hit or bus
// saturation, so simultaneous hits keep the levels their volume and velocity ask for.
export class DrumCore {
  frame = 0;
  private voices: Record<DrumInstrument, DrumVoice>;
  private pending: Array<DrumHitMessage & { frame: number }> = [];
  private humanizer = new Noise(0x51ed270b);
  private readonly fadeLength: number;
  private readonly attackLength: number;

  constructor(readonly sampleRate: number) {
    this.fadeLength = Math.max(1, Math.ceil(sampleRate * 0.003));
    this.attackLength = Math.max(1, Math.ceil(sampleRate * 0.0006));
    this.voices = Object.fromEntries(INSTRUMENTS.map((instrument, index) => [instrument, {
      instrument, active: false, startFrame: 0, age: 0, machine: '808', ride: false,
      trim: 1, gain: 0, panL: 0.7071, panR: 0.7071, driveGain: 1, driveNorm: 1,
      quantize: 0, holdLength: 1, holdCount: 0, holdValue: 0,
      phase: new Float64Array(7), step: new Float64Array(7), env: new Float64Array(4), rate: new Float64Array(4),
      sweep: 0, level: 1, noiseLevel: 0, burstLength: 0, tailRate: 1,
      filters: [new Svf(), new Svf(), new Svf()], g: [0, 0, 0], k: [1, 1, 1],
      choke: 1, chokeRate: 1, last: 0, tail: 0, tailSamples: 0,
      // Each drum has its own noise source, so one hit never changes how another sounds.
      noise: new Noise(0x1f123bb5 + index * 0x9e3779b1),
    }])) as Record<DrumInstrument, DrumVoice>;
  }

  trigger(message: DrumHitMessage): void {
    if (Number.isFinite(message.time) && message.time! * this.sampleRate > this.frame) {
      this.pending.push({ ...message, frame: Math.round(message.time! * this.sampleRate) });
      this.pending.sort((a, b) => a.frame - b.frame);
      return;
    }
    this.start(message, this.frame);
  }

  stopAll(): void {
    this.pending = [];
    for (const instrument of INSTRUMENTS) this.chokeVoice(this.voices[instrument]);
  }

  get idle(): boolean {
    return this.pending.length === 0 && INSTRUMENTS.every(instrument => !this.voices[instrument].active);
  }

  private chokeVoice(voice: DrumVoice): void {
    if (voice.active) voice.chokeRate = this.decayRate(0.004);
  }

  // Per-sample multiplier for an exponential decay with the given time constant.
  private decayRate(seconds: number): number {
    return Math.exp(-1 / (Math.max(0.0005, seconds) * this.sampleRate));
  }

  private setFilter(voice: DrumVoice, index: number, cutoff: number, q: number): void {
    voice.filters[index].reset();
    voice.g[index] = svfCoefficient(cutoff, this.sampleRate);
    voice.k[index] = 1 / q;
  }

  private start(message: DrumHitMessage, frame: number): void {
    const voice = this.voices[message.instrument];
    const settings = message.settings;
    const velocity = clamp(message.velocity ?? 1, 0, 1, 1);
    const volume = clamp(settings?.volume, 0, 1, 0);
    if (!voice || !settings || velocity === 0 || volume === 0) return;
    const character = KIT_CHARACTERS[message.kitId ?? ''] ?? KIT_CHARACTERS['clean-analog'];
    const sr = this.sampleRate;
    const tone = clamp(settings.tone, 0, 1, 0.5), extra = clamp(settings.extra, 0, 1, 0.5);
    const humanize = clamp(settings.humanize ?? 0, 0, 1);
    const pitch = 2 ** (clamp(settings.tune ?? 0, -1, 1) * 0.5) * (1 + this.humanizer.next() * 0.012 * humanize);
    const decay = character.decay * (1 + this.humanizer.next() * 0.08 * humanize);
    const is909 = character.machine === '909';

    if (voice.active) {
      // Retriggering the same drum crossfades from its previous tail instead of cutting it.
      voice.tail = voice.last;
      voice.tailSamples = this.fadeLength;
    } else voice.tailSamples = 0;
    // A closed hat cuts an open hat that is already ringing, but not one struck on the same step.
    if (message.instrument === 'closedHH') {
      const open = this.voices.openHH;
      if (open.active && open.startFrame < frame) this.chokeVoice(open);
    }

    voice.active = true;
    voice.startFrame = frame;
    voice.age = 0;
    voice.machine = character.machine;
    voice.ride = message.instrument === 'crash' && settings.cymbalType === 'ride';
    voice.trim = VOICE_TRIM[message.instrument];
    voice.gain = volume * velocity * HIT_LEVEL;
    const angle = (clamp(settings.pan ?? 0, -1, 1) + 1) * Math.PI / 4;
    voice.panL = Math.cos(angle);
    voice.panR = Math.sin(angle);
    voice.driveGain = 1 + character.drive * 3;
    voice.driveNorm = character.drive > 0 ? 1 / Math.tanh(voice.driveGain) : 1;
    voice.quantize = character.bits > 0 ? 2 ** (character.bits - 1) : 0;
    voice.holdLength = character.rate > 0 ? Math.max(1, Math.round(sr / character.rate)) : 1;
    voice.holdCount = 0;
    voice.holdValue = 0;
    voice.phase.fill(0);
    voice.env.fill(1);
    voice.rate.fill(1);
    voice.choke = 1;
    voice.chokeRate = 1;
    voice.noiseLevel = 0;
    voice.burstLength = 0;

    switch (message.instrument) {
      case 'kick': {
        voice.step[0] = (is909 ? 48 + tone * 30 : 42 + tone * 26) * pitch / sr;
        voice.sweep = is909 ? 4.2 + tone * 1.5 : 1.6 + tone * 0.8;
        voice.rate[0] = this.decayRate((is909 ? 0.1 + extra * 0.38 : 0.14 + extra * 0.6) * decay);
        voice.rate[1] = this.decayRate(is909 ? 0.022 : 0.012);
        voice.rate[2] = this.decayRate(0.0025);
        voice.noiseLevel = is909 ? 0.45 : 0.2;
        this.setFilter(voice, 0, is909 ? 5200 : 2600, 0.7);
        break;
      }
      case 'snare': {
        const tuning = (0.8 + tone * 0.45) * pitch;
        voice.step[0] = (is909 ? 190 : 180) * tuning / sr;
        voice.step[1] = 330 * tuning / sr;
        voice.sweep = is909 ? 0.75 : 0;
        voice.rate[0] = this.decayRate((is909 ? 0.075 : 0.055) * decay);
        voice.rate[1] = this.decayRate(is909 ? 0.012 : 0.03 * decay);
        voice.rate[2] = this.decayRate((0.06 + extra * 0.2) * decay);
        voice.noiseLevel = 0.4 + extra * 0.5;
        this.setFilter(voice, 0, is909 ? 700 : 1500 + tone * 900, 0.8);
        this.setFilter(voice, 1, is909 ? 9000 : 11000, 0.7);
        break;
      }
      case 'clap': {
        this.setFilter(voice, 0, (900 + tone * 900) * pitch, 2.2);
        this.setFilter(voice, 1, 500, 0.7);
        voice.burstLength = Math.round(sr * 0.011);
        voice.rate[0] = this.decayRate(0.0045);
        voice.tailRate = this.decayRate((0.05 + extra * 0.25) * decay);
        break;
      }
      case 'closedHH':
      case 'openHH':
      case 'crash': {
        const cymbal = message.instrument === 'crash';
        const stretch = pitch * (voice.ride ? 1.42 : 1);
        for (let n = 0; n < METAL_HZ.length; n++) voice.step[n] = Math.min(0.45, METAL_HZ[n] * stretch / sr);
        const q = voice.ride ? 6 : 3;
        this.setFilter(voice, 0, (voice.ride ? 5000 : 3440) * pitch, q);
        this.setFilter(voice, 1, (voice.ride ? 9000 : 7100) * pitch, q);
        this.setFilter(voice, 2, (cymbal ? 2500 + tone * 3000 : 5000 + tone * 4000) * (is909 ? 1.25 : 1), 0.7);
        voice.noiseLevel = (is909 ? 0.5 : 0.12) + (cymbal && !voice.ride ? 0.2 : 0);
        if (cymbal) {
          const length = (voice.ride ? 0.35 + extra * 1.1 : 0.25 + extra * 0.9) * decay;
          voice.rate[0] = this.decayRate(length);
          voice.rate[1] = this.decayRate(length * 0.55);
        } else {
          const length = message.instrument === 'openHH' ? 0.09 + extra * 0.5 : 0.012 + (1 - extra) * 0.06;
          voice.rate[0] = voice.rate[1] = this.decayRate(length * decay);
        }
        break;
      }
      case 'snare2':
      case 'ride': {
        const base = message.instrument === 'snare2' ? 85 + tone * 60 : 150 + tone * 110;
        voice.step[0] = base * pitch / sr;
        voice.sweep = is909 ? 0.9 : 0.55;
        voice.rate[0] = this.decayRate((0.1 + extra * 0.45) * decay);
        voice.rate[1] = this.decayRate(0.03);
        voice.rate[2] = this.decayRate(0.02);
        voice.noiseLevel = is909 ? 0.12 : 0.06;
        this.setFilter(voice, 0, 3000, 0.7);
        break;
      }
    }
  }

  private render(v: DrumVoice): number {
    const env = v.env, rate = v.rate, phase = v.phase, step = v.step;
    switch (v.instrument) {
      case 'kick': {
        phase[0] = (phase[0] + step[0] * (1 + v.sweep * env[1])) % 1;
        let body = Math.sin(2 * Math.PI * phase[0]) * env[0];
        if (v.machine === '909') body = Math.tanh(body * 1.8) * 0.78;
        v.filters[0].tick(v.noise.next(), v.g[0], v.k[0]);
        const out = body + v.filters[0].lp * env[2] * v.noiseLevel;
        v.level = env[0];
        env[0] *= rate[0]; env[1] *= rate[1]; env[2] *= rate[2];
        return out;
      }
      case 'snare': {
        phase[0] = (phase[0] + step[0] * (1 + v.sweep * env[1])) % 1;
        phase[1] = (phase[1] + step[1]) % 1;
        const body = v.machine === '909'
          ? Math.sin(2 * Math.PI * phase[0]) * env[0] * 0.7
          : Math.sin(2 * Math.PI * phase[0]) * env[0] * 0.5 + Math.sin(2 * Math.PI * phase[1]) * env[1] * 0.3;
        const noise = v.noise.next();
        v.filters[0].tick(noise, v.g[0], v.k[0]);
        v.filters[1].tick(v.filters[0].hp, v.g[1], v.k[1]);
        const out = body + v.filters[1].lp * env[2] * v.noiseLevel;
        v.level = Math.max(env[0], env[2]);
        env[0] *= rate[0]; env[1] *= rate[1]; env[2] *= rate[2];
        return out;
      }
      case 'clap': {
        // Three quick bursts, then the room tail: restart the burst envelope at each boundary.
        if (v.age > 0 && v.age <= v.burstLength * 3 && v.age % v.burstLength === 0) {
          env[0] = 1;
          if (v.age === v.burstLength * 3) rate[0] = v.tailRate;
        }
        v.filters[0].tick(v.noise.next(), v.g[0], v.k[0]);
        v.filters[1].tick(v.filters[0].bp * v.k[0], v.g[1], v.k[1]);
        const out = v.filters[1].hp * env[0] * 2.2;
        v.level = v.age < v.burstLength * 3 ? 1 : env[0];
        env[0] *= rate[0];
        return out;
      }
      case 'closedHH':
      case 'openHH':
      case 'crash': {
        let metal = 0;
        for (let n = 0; n < METAL_HZ.length; n++) {
          phase[n] = (phase[n] + step[n]) % 1;
          metal += oscillator('square', phase[n], step[n]);
        }
        const source = (metal / METAL_HZ.length + v.noise.next() * v.noiseLevel) / (1 + v.noiseLevel);
        v.filters[0].tick(source, v.g[0], v.k[0]);
        v.filters[1].tick(source, v.g[1], v.k[1]);
        const bands = v.filters[0].bp * v.k[0] * env[0] + v.filters[1].bp * v.k[1] * env[1];
        v.filters[2].tick(bands, v.g[2], v.k[2]);
        v.level = Math.max(env[0], env[1]);
        env[0] *= rate[0]; env[1] *= rate[1];
        return v.filters[2].hp * 2.4;
      }
      default: {
        phase[0] = (phase[0] + step[0] * (1 + v.sweep * env[1])) % 1;
        let body = Math.sin(2 * Math.PI * phase[0]) * env[0];
        if (v.machine === '909') body = Math.tanh(body * 1.5) * 0.85;
        v.filters[0].tick(v.noise.next(), v.g[0], v.k[0]);
        const out = body + v.filters[0].lp * env[2] * v.noiseLevel;
        v.level = env[0];
        env[0] *= rate[0]; env[1] *= rate[1]; env[2] *= rate[2];
        return out;
      }
    }
  }

  process(left: Float32Array, right: Float32Array): void {
    for (let i = 0; i < left.length; i++) {
      while (this.pending.length && this.pending[0].frame <= this.frame + i) {
        const hit = this.pending.shift()!;
        this.start(hit, hit.frame);
      }
      let l = 0, r = 0;
      for (let n = 0; n < INSTRUMENTS.length; n++) {
        const v = this.voices[INSTRUMENTS[n]];
        if (!v.active) continue;
        // A sub-millisecond ramp keeps the first sample from clicking.
        let value = this.render(v) * v.trim * Math.min(1, v.age / this.attackLength);
        v.age++;
        if (v.driveGain > 1) value = Math.tanh(value * v.driveGain) * v.driveNorm;
        if (v.holdLength > 1) {
          if (v.holdCount === 0) v.holdValue = value;
          v.holdCount = (v.holdCount + 1) % v.holdLength;
          value = v.holdValue;
        }
        if (v.quantize > 0) value = Math.round(value * v.quantize) / v.quantize;
        value *= v.gain * v.choke;
        v.choke *= v.chokeRate;
        if (v.tailSamples > 0) {
          value += v.tail * v.tailSamples / this.fadeLength;
          v.tailSamples--;
        }
        v.last = value;
        if (v.level * v.choke < 0.0005 && v.tailSamples === 0) { v.active = false; v.last = 0; continue; }
        l += value * v.panL;
        r += value * v.panR;
      }
      left[i] = l;
      right[i] = r;
    }
    this.frame += left.length;
  }
}
