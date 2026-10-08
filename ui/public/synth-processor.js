const clamp = (value, min, max, fallback = min) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = Array.from({ length: 8 }, () => ({
      active: false, note: '', id: 0, frequency: 440, targetFrequency: 440,
      velocity: 0, phase: 0, lfo1Phase: 0, lfo2Phase: 0,
      stage: 'off', envelope: 0, releaseStep: 0, z1: 0, z2: 0,
      last: 0, tail: 0, tailSamples: 0, transition: 0, transitionSamples: 0, age: 0, remaining: Infinity,
    }));
    this.params = {
      oscType: 'sine', detune: 0, filterFreq: 5000, filterQ: 0.707, filterType: 'lowpass',
      attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3, gain: 1, pan: 0, spread: 0,
      portamentoEnabled: false, portamentoGlide: 0.05,
      lfo1Enabled: false, lfo1Target: 'pitch', lfo1Waveform: 'sine', lfo1Rate: 5, lfo1Depth: 0,
      lfo2Enabled: false, lfo2Target: 'filter', lfo2Waveform: 'triangle', lfo2Rate: 0.8, lfo2Depth: 0,
    };
    this.smoothed = { gain: 1, pan: 0, spread: 0, detune: 0, filterFreq: 5000, filterQ: 0.707 };
    this.age = 0;
    this.lastFrequency = 440;
    this.frame = typeof currentFrame === 'number' ? currentFrame : 0;
    this.pending = [];
    this.port.onmessage = ({ data }) => {
      if (data.type === 'params') {
        if ((data.params?.oscType && data.params.oscType !== this.params.oscType)
          || (data.params?.filterType && data.params.filterType !== this.params.filterType)) {
          for (const voice of this.voices) {
            voice.transition = voice.last;
            voice.transitionSamples = Math.ceil(sampleRate * 0.005);
          }
        }
        for (const [key, value] of Object.entries(data.params || {})) {
          if (!(key in this.params)) continue;
          if (typeof this.params[key] === 'number' && !Number.isFinite(value)) continue;
          this.params[key] = value;
        }
      } else if (data.type === 'noteOn') {
        if (Number.isFinite(data.time) && data.time * sampleRate > this.frame) {
          this.pending.push({ ...data, frame: Math.round(data.time * sampleRate) });
          this.pending.sort((a, b) => a.frame - b.frame);
        } else this.noteOn(data);
      }
      else if (data.type === 'noteOff') {
        this.pending = this.pending.filter(note => note.note !== data.note || (data.id !== undefined && note.id !== data.id));
        for (const voice of this.voices) {
          if (voice.active && voice.note === data.note && (data.id === undefined || data.id === voice.id)) this.release(voice);
        }
      } else if (data.type === 'allNotesOff') {
        this.pending = [];
        this.voices.forEach(voice => this.release(voice, clamp(data.release, 0.005, 2, 0.03)));
      }
    };
  }

  noteFrequency(note) {
    if (typeof note !== 'string') return null;
    const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
    if (!match) return null;
    const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]]
      + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    const midi = (Number(match[3]) + 1) * 12 + semitone;
    return midi >= 0 && midi <= 127 ? 440 * 2 ** ((midi - 69) / 12) : null;
  }

  noteOn(message) {
    const frequency = this.noteFrequency(message.note);
    const velocity = clamp(message.velocity, 0, 1, 1);
    if (!frequency || velocity === 0) return;
    let voice = this.voices.find(v => v.active && v.note === message.note)
      || this.voices.find(v => !v.active);
    if (!voice) voice = this.voices.reduce((oldest, v) => v.age < oldest.age ? v : oldest);
    const stolen = voice.active;
    voice.tail = stolen ? voice.last : 0;
    voice.tailSamples = stolen ? Math.ceil(sampleRate * 0.005) : 0;
    voice.active = true;
    voice.note = message.note;
    voice.id = message.id;
    voice.frequency = this.params.portamentoEnabled ? this.lastFrequency : frequency;
    voice.targetFrequency = frequency;
    this.lastFrequency = frequency;
    voice.velocity = velocity;
    voice.phase = 0;
    voice.lfo1Phase = 0;
    voice.lfo2Phase = 0;
    voice.stage = 'attack';
    voice.envelope = 0;
    voice.z1 = voice.z2 = 0;
    voice.age = ++this.age;
    voice.remaining = Number.isFinite(message.duration) ? Math.max(1, Math.round(message.duration * sampleRate)) : Infinity;
  }

  release(voice, duration = this.params.release) {
    if (!voice.active || voice.stage === 'release') return;
    voice.stage = 'release';
    voice.releaseStep = voice.envelope / (sampleRate * clamp(duration, 0.005, 10, 0.3));
  }

  waveform(type, phase) {
    const p = phase - Math.floor(phase);
    if (type === 'square') return p < 0.5 ? 1 : -1;
    if (type === 'sawtooth') return 2 * p - 1;
    if (type === 'triangle') return 1 - 4 * Math.abs(p - 0.5);
    return Math.sin(2 * Math.PI * p);
  }

  blep(t, dt) {
    if (t < dt) { const x = t / dt; return 2 * x - x * x - 1; }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + 2 * x + 1; }
    return 0;
  }

  filter(voice, input, frequency, q, type) {
    const w = 2 * Math.PI * clamp(frequency, 20, sampleRate * 0.45, 5000) / sampleRate;
    const c = Math.cos(w), alpha = Math.sin(w) / (2 * clamp(q, 0.1, 20, 0.707));
    let b0 = (1 - c) / 2, b1 = 1 - c, b2 = b0;
    if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
    if (type === 'notch') { b0 = 1; b1 = -2 * c; b2 = 1; }
    if (type === 'allpass') { b0 = 1 - alpha; b1 = -2 * c; b2 = 1 + alpha; }
    const a0 = 1 + alpha, a1 = -2 * c / a0, a2 = (1 - alpha) / a0;
    const output = b0 / a0 * input + voice.z1;
    voice.z1 = b1 / a0 * input - a1 * output + voice.z2;
    voice.z2 = b2 / a0 * input - a2 * output;
    if (!Number.isFinite(output)) { voice.z1 = voice.z2 = 0; return 0; }
    return output;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const left = output[0], right = output[1] || left, p = this.params, s = this.smoothed;
    const smoothing = 1 - Math.exp(-1 / (sampleRate * 0.01));
    for (let i = 0; i < left.length; i++) {
      while (this.pending.length && this.pending[0].frame <= this.frame + i) this.noteOn(this.pending.shift());
      for (const key of Object.keys(s)) s[key] += (clamp(p[key],
        key === 'pan' ? -1 : key === 'detune' ? -1200 : key === 'filterFreq' ? 20 : 0,
        key === 'filterFreq' ? sampleRate * 0.45 : key === 'filterQ' ? 20 : key === 'detune' ? 1200 : key === 'gain' ? 2 : 1,
        s[key]) - s[key]) * smoothing;
      let l = 0, r = 0;
      for (let index = 0; index < this.voices.length; index++) {
        const v = this.voices[index];
        if (!v.active) continue;
        if (--v.remaining <= 0) this.release(v);
        if (v.stage === 'attack') {
          v.envelope += 1 / (sampleRate * clamp(p.attack, 0.002, 10, 0.01));
          if (v.envelope >= 1) { v.envelope = 1; v.stage = 'decay'; }
        } else if (v.stage === 'decay') {
          v.envelope -= (1 - clamp(p.sustain, 0, 1, 0.5)) / (sampleRate * clamp(p.decay, 0.002, 10, 0.2));
          if (v.envelope <= clamp(p.sustain, 0, 1, 0.5)) { v.envelope = clamp(p.sustain, 0, 1, 0.5); v.stage = 'sustain'; }
        } else if (v.stage === 'sustain') v.envelope += (clamp(p.sustain, 0, 1, 0.5) - v.envelope) * smoothing;
        else if (v.stage === 'release') {
          v.envelope = Math.max(0, v.envelope - v.releaseStep);
          if (v.envelope === 0 && v.tailSamples === 0) { v.active = false; v.stage = 'off'; continue; }
        }
        v.frequency += (v.targetFrequency - v.frequency) * (p.portamentoEnabled ? 1 - Math.exp(-1 / (sampleRate * clamp(p.portamentoGlide, 0.001, 2, 0.05))) : 1);
        const lfo1 = p.lfo1Enabled ? this.waveform(p.lfo1Waveform, v.lfo1Phase) * clamp(p.lfo1Depth, 0, 1) : 0;
        const lfo2 = p.lfo2Enabled ? this.waveform(p.lfo2Waveform, v.lfo2Phase) * clamp(p.lfo2Depth, 0, 1) : 0;
        const pitch = (p.lfo1Target === 'pitch' ? lfo1 : 0) + (p.lfo2Target === 'pitch' ? lfo2 : 0);
        const step = clamp(v.frequency * 2 ** (s.detune / 1200 + pitch) / sampleRate, 0.000001, 0.45);
        v.phase = (v.phase + step) % 1;
        let wave = this.waveform(p.oscType, v.phase);
        if (p.oscType === 'sawtooth') wave -= this.blep(v.phase, step);
        if (p.oscType === 'square') wave += this.blep(v.phase, step) - this.blep((v.phase + 0.5) % 1, step);
        const mod = (p.lfo1Target === 'filter' ? lfo1 : 0) + (p.lfo2Target === 'filter' ? lfo2 : 0);
        let value = this.filter(v, wave, s.filterFreq * 2 ** (clamp(mod, -1, 1) * 2), s.filterQ, p.filterType)
          * v.envelope * v.velocity * s.gain * 0.18;
        if (v.tailSamples > 0) {
          value += v.tail * v.tailSamples / Math.ceil(sampleRate * 0.005);
          v.tailSamples--;
        }
        if (v.transitionSamples > 0) {
          const blend = v.transitionSamples / Math.ceil(sampleRate * 0.005);
          value = value * (1 - blend) + v.transition * blend;
          v.transitionSamples--;
        }
        v.last = value;
        const spreadPan = clamp(Math.log2(v.targetFrequency / 440) / 3, -1, 1) * s.spread;
        const angle = (clamp(s.pan + spreadPan, -1, 1) + 1) * Math.PI / 4;
        l += value * Math.cos(angle); r += value * Math.sin(angle);
        v.lfo1Phase = (v.lfo1Phase + clamp(p.lfo1Rate, 0, 100) / sampleRate) % 1;
        v.lfo2Phase = (v.lfo2Phase + clamp(p.lfo2Rate, 0, 100) / sampleRate) % 1;
      }
      left[i] = Math.tanh(l);
      right[i] = Math.tanh(r);
    }
    this.frame += left.length;
    return true;
  }
}

registerProcessor('synth-processor', SynthProcessor);
