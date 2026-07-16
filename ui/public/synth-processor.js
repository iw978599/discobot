class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = new Array(8).fill(null).map(() => ({
      active: false,
      frequency: 0,
      targetFrequency: 0,
      velocity: 0,
      oscPhase: 0,
      lfo1Phase: 0,
      lfo2Phase: 0,
      envStage: 'off',
      envValue: 0,
      filterMemory: 0,
    }));
    this.params = {
      oscType: 'sine',
      detune: 0,
      filterFreq: 5000,
      filterQ: 1,
      attack: 0.1,
      decay: 0.2,
      sustain: 0.5,
      release: 1.0,
      gain: 1.0,
      pan: 0,
      portamentoEnabled: false,
      portamentoGlide: 0.05,
      lfo1Enabled: false,
      lfo1Target: 'pitch',
      lfo1Waveform: 'sine',
      lfo1Rate: 5,
      lfo1Depth: 0.2,
      lfo2Enabled: false,
      lfo2Target: 'filter',
      lfo2Waveform: 'triangle',
      lfo2Rate: 0.8,
      lfo2Depth: 0.25,
    };
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'noteOn') {
        this.handleNoteOn(msg.note, msg.velocity);
      } else if (msg.type === 'noteOff') {
        this.handleNoteOff(msg.note);
      } else if (msg.type === 'allNotesOff') {
        this.allNotesOff();
      } else if (msg.type === 'params') {
        Object.assign(this.params, msg.params);
      }
    };
  }

  handleNoteOn(note, velocity) {
    const freq = this.noteToFrequency(note);
    let voice = this.voices.find(v => v.active && Math.abs(v.frequency - freq) < 0.1);
    if (voice) {
      voice.velocity = velocity;
      voice.envStage = 'attack';
      voice.envValue = 0;
      return;
    }
    voice = this.voices.find(v => !v.active);
    if (!voice) voice = this.voices[0];
    voice.active = true;
    voice.targetFrequency = freq;
    if (this.params.portamentoEnabled && this.voices.some(v => v.active && v !== voice)) {
      voice.frequency = voice.frequency || freq;
    } else {
      voice.frequency = freq;
    }
    voice.velocity = velocity;
    voice.oscPhase = 0;
    voice.lfo1Phase = 0;
    voice.lfo2Phase = 0;
    voice.envStage = 'attack';
    voice.envValue = 0;
    voice.filterMemory = 0;
  }

  handleNoteOff(note) {
    const freq = this.noteToFrequency(note);
    const voice = this.voices.find(v => v.active && Math.abs(v.frequency - freq) < 0.1);
    if (voice && voice.envStage !== 'release') {
      voice.envStage = 'release';
    }
  }

  allNotesOff() {
    for (const v of this.voices) {
      v.active = false;
      v.envStage = 'off';
      v.envValue = 0;
    }
  }

  noteToFrequency(note) {
    const noteMap = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
    const match = note.match(/^([A-G]#?b?)(-?\d+)$/);
    if (!match) return 440;
    const semitone = noteMap[match[1]] ?? 0;
    const octave = parseInt(match[2], 10);
    const midiNote = (octave + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  lfoValue(type, phase) {
    const frac = phase - Math.floor(phase);
    switch (type) {
      case 'sine': return Math.sin(2 * Math.PI * phase);
      case 'square': return frac < 0.5 ? 1 : -1;
      case 'sawtooth': return 2 * frac - 1;
      case 'triangle': return 1 - 4 * Math.abs(frac - 0.5);
      default: return 0;
    }
  }

  processEnvelope(voice, dt) {
    const p = this.params;
    switch (voice.envStage) {
      case 'attack': {
        voice.envValue += dt / Math.max(0.001, p.attack);
        if (voice.envValue >= 1) { voice.envValue = 1; voice.envStage = 'decay'; }
        break;
      }
      case 'decay': {
        voice.envValue -= dt / Math.max(0.001, p.decay) * (1 - p.sustain);
        if (voice.envValue <= p.sustain) { voice.envValue = p.sustain; voice.envStage = 'sustain'; }
        break;
      }
      case 'sustain': {
        voice.envValue = p.sustain;
        break;
      }
      case 'release': {
        voice.envValue -= dt / Math.max(0.001, p.release) * voice.envValue;
        if (voice.envValue <= 0.001) { voice.envValue = 0; voice.envStage = 'off'; voice.active = false; }
        break;
      }
    }
    return voice.envValue;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const len = left.length;
    const dt = 1 / sampleRate;
    const p = this.params;
    const pan = Math.max(-1, Math.min(1, p.pan));
    const panAngle = (pan + 1) * Math.PI / 4;
    const panL = Math.cos(panAngle);
    const panR = Math.sin(panAngle);

    for (let i = 0; i < len; i++) {
      let dryL = 0;
      let dryR = 0;

      for (let v = 0; v < this.voices.length; v++) {
        const voice = this.voices[v];
        if (!voice.active || voice.envStage === 'off') continue;

        const env = this.processEnvelope(voice, dt);
        if (env <= 0.0001 && voice.envStage === 'off') continue;

        if (p.portamentoEnabled && Math.abs(voice.frequency - voice.targetFrequency) > 0.5) {
          const glideRate = p.portamentoGlide > 0 ? dt / Math.max(0.001, p.portamentoGlide) : 1;
          voice.frequency += (voice.targetFrequency - voice.frequency) * Math.min(glideRate, 1);
        }

        const lfo1Val = p.lfo1Enabled ? this.lfoValue(p.lfo1Waveform, voice.lfo1Phase) : 0;
        const lfo2Val = p.lfo2Enabled ? this.lfoValue(p.lfo2Waveform, voice.lfo2Phase) : 0;

        const pitchMod = (p.lfo1Enabled && p.lfo1Target === 'pitch' ? lfo1Val * p.lfo1Depth : 0)
          + (p.lfo2Enabled && p.lfo2Target === 'pitch' ? lfo2Val * p.lfo2Depth : 0);
        const currentFreq = voice.frequency * Math.pow(2, p.detune / 1200) * Math.pow(2, (pitchMod * 1200) / 1200);

        voice.oscPhase += currentFreq / sampleRate;
        voice.oscPhase -= Math.floor(voice.oscPhase);

        let sample;
        const frac = voice.oscPhase;
        switch (p.oscType) {
          case 'sine': sample = Math.sin(2 * Math.PI * voice.oscPhase); break;
          case 'square': sample = frac < 0.5 ? 1 : -1; break;
          case 'sawtooth': sample = 2 * frac - 1; break;
          case 'triangle': sample = 4 * Math.abs(frac - 0.5) - 1; break;
          default: sample = Math.sin(2 * Math.PI * voice.oscPhase);
        }

        const filterMod = (p.lfo1Enabled && p.lfo1Target === 'filter' ? lfo1Val * p.lfo1Depth : 0)
          + (p.lfo2Enabled && p.lfo2Target === 'filter' ? lfo2Val * p.lfo2Depth : 0);
        const clampedFilterMod = Math.max(-1, Math.min(1, filterMod));
        const modulatedCutoff = Math.max(20, Math.min(20000,
          p.filterFreq * Math.pow(2, clampedFilterMod * 2)
        ));
        const rc = 1 / (2 * Math.PI * modulatedCutoff);
        const alpha = dt / (rc + dt);
        voice.filterMemory = voice.filterMemory + alpha * (sample - voice.filterMemory);

        const vol = env * voice.velocity * Math.max(0, Math.min(1, p.gain)) * 0.5;
        const out = voice.filterMemory * vol;
        dryL += out * panL;
        dryR += out * panR;

        voice.lfo1Phase += p.lfo1Rate * dt;
        voice.lfo2Phase += p.lfo2Rate * dt;
      }

      left[i] = dryL;
      right[i] = dryR;
    }

    return true;
  }
}

registerProcessor('synth-processor', SynthProcessor);
