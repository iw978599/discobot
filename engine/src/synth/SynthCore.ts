import { Adsr, Ladder, Noise, Svf, approachCoefficient, finiteClamp as clamp, halve, ladderFeedback, lfoShape, noteFrequency, oscillator, svfCoefficient } from '../dsp';
import { InsertChain } from './inserts';
import { VoiceParams, createDefaultSynthParameters, toVoiceParams } from './voiceParams';

type ParamUpdate = Partial<Record<keyof VoiceParams, unknown>>;

export interface NoteOnMessage {
  note: string;
  velocity?: number;
  id?: number;
  // seconds the gate stays open; omitted means held until noteOff
  duration?: number;
  // absolute start in seconds on the core's clock; omitted or past means now
  time?: number;
}

// A recording for the sample engine to play: one channel, at its own rate.
export interface SynthSample {
  data: Float32Array;
  rate: number;
  // The note the recording sounds at. Absent, the sound's own root setting says.
  root?: number;
  // More recordings of the same instrument at other notes. A note plays the one whose root is nearest,
  // among those whose key range holds it when any does.
  zones?: Array<SampleZone>;
  // A SoundFont's recordings bring their own loop, in frames, and the keys each is for. Absent, as in
  // every recording from before, the sound's own loop points say and every recording is for any key.
  loopStart?: number;
  loopEnd?: number;
  keyLow?: number;
  keyHigh?: number;
  // Set when `data` is not a recording but single cycles end to end, each this many samples long.
  // It is then played as an oscillator, and stepped through from one cycle to the next.
  frame?: number;
}

export interface SampleZone { data: Float32Array; rate: number; root: number; loopStart?: number; loopEnd?: number; keyLow?: number; keyHigh?: number }

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
  ladder: Ladder;
  highpass: Svf;
  previousInput: number;
  last: number;
  transition: number;
  transitionSamples: number;
  age: number;
  remaining: number;
  releaseOverride: number;
  // The value the random source is holding for this note, and where the LFO that steps it was last.
  random: number;
  randomPhase: number;
  // Which layer of a layered sound this voice is playing: 0, or 1 for the second.
  layer: number;
  // How far into the sample this voice has played, in the sample's own frames; for a table of
  // cycles, which cycle it has reached.
  samplePosition: number;
  // The recording chosen for this note out of an instrument's several, and its frames per cycle of
  // the note. Null for a sample with one recording and no root of its own, which is read as it is set.
  sampleData: Float32Array | null;
  sampleScale: number;
  // The loop of the recording this note plays, in its frames, when the recording has one of its own.
  sampleLoopFrames: [number, number] | null;
  // Which copy of the recording this voice reads: 0 is the recording, 1 one with its top octave
  // taken out, and so on. -1 until the note's first sample has chosen.
  sampleLevel: number;
}

const TWO_PI = 2 * Math.PI;
const VOICE_LEVEL = 0.18;
const MIDDLE_C = 261.6256;
const MAX_UNISON = 7;
// The second stage of the 24 dB filter is not resonant; the first stage supplies the peak.
const SECOND_STAGE_DAMPING = Math.SQRT2;
// The MS-20's filter. Its resonance is held back more the bigger its peak has grown, as the clipping in
// the instrument's feedback does: with the peak down it is the clean two-pole, and pushed, the peak stops
// growing and flattens, which is the distortion it is known for. This is how fast the holding back comes on.
const MS20_HOLD = 0.1;
const MOD_SOURCES = ['lfo1', 'lfo2', 'ampEnv', 'filterEnv', 'velocity', 'key', 'random', 'modWheel'];
const MOD_DESTINATIONS = ['pitch', 'osc2Pitch', 'filter', 'amp', 'pulseWidth', 'pan', 'fmIndex'];
const MOD_ROUTES = 4;
const BEND_SEMITONES = 2;

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
    layerAttack: 0, layerRatio: 1, layerFirst: 1, layerSecond: 1,
    glide: 1, osc2Ratio: 1, mixScale: 1, fmDecay: 0, driveGain: 1, driveMakeup: 1,
    unisonCount: 1, unisonRatios: new Float64Array(MAX_UNISON).fill(1), unisonLevels: new Float64Array(MAX_UNISON).fill(1), twoStage: false,
  };
  private pending: Array<NoteOnMessage & { frame: number }> = [];
  // Parameter changes that have a time of their own, soonest first: a pattern's automation.
  private scheduled: Array<{ frame: number; update: ParamUpdate }> = [];
  private globalLfoPhase: [number, number] = [0, 0];
  private inserts: InsertChain;
  private noise = new Noise();
  // The random source has a sequence of its own, so routing it never changes what the noise oscillator plays.
  private chance = new Noise(0x9e3779b9);
  private routeSource = new Int8Array(MOD_ROUTES);
  private routeDestination = new Int8Array(MOD_ROUTES);
  private routeDepth = new Float64Array(MOD_ROUTES);
  private routeCount = 0;
  // Live playing gestures from a controller, not part of the sound: the wheel (0 to 1) and the bend (-1 to 1, a BEND_SEMITONES range each way). Each moves to its target over a few milliseconds.
  private bendTarget = 0;
  private bend = 0;
  private wheelTarget = 0;
  private wheel = 0;
  private sample: SynthSample | null = null;
  // Each recording's copies at half, a quarter and an eighth of its rate, for notes played two,
  // four and eight times faster than it was recorded: read as it is, a recording played that
  // fast holds more than the output can, and the rest comes back as tones that were never in it.
  private sampleCopies = new WeakMap<Float32Array, Float32Array[]>();
  private age = 0;
  private lastFrequency = 440;
  private readonly smoothing: number;
  private readonly transitionLength: number;

  constructor(readonly sampleRate: number, voiceCount = 8) {
    this.smoothing = approachCoefficient(0.01, sampleRate, 1);
    this.inserts = new InsertChain(sampleRate);
    this.transitionLength = Math.ceil(sampleRate * 0.005);
    this.voices = Array.from({ length: voiceCount }, () => ({
      active: false, note: '', id: undefined, frequency: 440, targetFrequency: 440, velocity: 0, keyOctaves: 0,
      phase1: new Float64Array(MAX_UNISON), phase2: new Float64Array(MAX_UNISON), phaseSub: 0,
      fmPhase: [0, 0, 0, 0], fmFeedback: 0, fmEnv: 0, lfoPhase: [0, 0],
      amp: new Adsr(), filterEnv: new Adsr(), filter: new Svf(), filter2: new Svf(), ladder: new Ladder(), highpass: new Svf(), previousInput: 0,
      last: 0, transition: 0, transitionSamples: 0, age: 0, remaining: Infinity, releaseOverride: 0,
      random: 0, randomPhase: 0, layer: 0, samplePosition: 0, sampleData: null, sampleScale: 0, sampleLoopFrames: null, sampleLevel: -1,
    }));
    this.refreshDerived();
    Object.assign(this.smoothed, {
      gain: this.params.gain, filterFreq: this.params.filterFreq, filterQ: this.params.filterQ,
    });
  }

  // Gives the sample engine its recording, or with null takes it away. A lane set to the sample
  // engine with no recording plays its oscillators.
  setSample(sample: SynthSample | null): void {
    this.sample = sample && sample.data.length > 1 && sample.rate > 0 ? sample : null;
    if (this.sample && !this.sample.frame) {
      for (const data of [this.sample.data, ...(this.sample.zones ?? []).map(zone => zone.data)]) {
        if (this.sampleCopies.has(data)) continue;
        const copies: Float32Array[] = [];
        for (let from = data; copies.length < 3 && from.length > 128;) copies.push(from = halve(from));
        this.sampleCopies.set(data, copies);
      }
    }
    for (const voice of this.voices) voice.sampleData = null;
    if (this.params.engine !== 'sample') return;
    for (const voice of this.voices) {
      voice.samplePosition = 0;
      voice.transition = voice.last;
      voice.transitionSamples = this.transitionLength;
    }
  }

  // With a time (seconds on the core's clock) that has not come yet, the change waits for it and
  // is made on that sample; without one, or with one that has passed, it is made now.
  setParams(update: ParamUpdate | null | undefined, time?: number): void {
    if (!update) return;
    if (Number.isFinite(time) && time! * this.sampleRate > this.frame) {
      const frame = Math.round(time! * this.sampleRate);
      let at = this.scheduled.length;
      while (at > 0 && this.scheduled[at - 1].frame > frame) at--;
      this.scheduled.splice(at, 0, { frame, update });
      return;
    }
    const p = this.params as unknown as Record<string, unknown>;
    const signature = () => `${p.oscType}|${p.filterType}|${p.engine}|${p.osc2Type}|${p.filterSlope}|${p.unisonVoices}|${p.filterModel}|${p.layerEnabled}`;
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
    // The second layer of a layered sound: a slower way in and its own tuning. The two layers share
    // the level between them, so that at any balance they are together as loud as one.
    d.layerAttack = approachCoefficient(clamp(clamp(p.attack, 0.001, 10, 0.01) + clamp(p.layerAttack, 0, 5, 0), 0.001, 10, 0.01), sr, 1.47);
    d.layerRatio = 2 ** (clamp(p.layerDetune, -50, 50, 0) / 1200);
    const balance = clamp(p.layerMix, 0, 1, 0.5) * Math.PI / 2;
    d.layerFirst = Math.cos(balance);
    d.layerSecond = Math.sin(balance);
    d.filterAttack = approachCoefficient(clamp(p.filterAttack, 0.001, 10, 0.005), sr, 1.47);
    d.filterDecay = approachCoefficient(clamp(p.filterDecay, 0.002, 10, 0.25), sr, 4.6);
    d.filterSustain = clamp(p.filterSustain, 0, 1, 0.2);
    d.filterRelease = approachCoefficient(clamp(p.filterRelease, 0.005, 10, 0.3), sr, 6.9);
    d.glide = p.portamentoEnabled ? approachCoefficient(clamp(p.portamentoGlide, 0.001, 2, 0.05), sr, 1) : 1;
    d.osc2Ratio = 2 ** (clamp(p.osc2Semitones, -36, 36, 0) / 12 + clamp(p.osc2Detune, -100, 100, 0) / 1200);
    const osc2 = p.osc2Enabled ? clamp(p.osc2Level, 0, 1) : 0;
    const osc1 = clamp(p.oscLevel, 0, 1, 1), sub = clamp(p.subLevel, 0, 1), noise = clamp(p.noiseLevel, 0, 1);
    const ring = p.osc2Enabled ? clamp(p.ringLevel, 0, 1, 0) : 0;
    d.unisonCount = Math.round(clamp(p.unisonVoices, 1, MAX_UNISON, 1));
    // Copies are spread evenly across plus and minus the detune amount, up to 50 cents each way.
    const spreadCents = clamp(p.unisonDetune, 0, 1) * 50;
    // The copy in the middle, in tune, is always at full level; the ones either side can be turned down.
    const side = clamp(p.unisonMix, 0, 1, 1);
    let copies = 0;
    for (let u = 0; u < MAX_UNISON; u++) {
      const position = d.unisonCount > 1 ? (u / (d.unisonCount - 1)) * 2 - 1 : 0;
      d.unisonRatios[u] = 2 ** (position * spreadCents / 1200);
      d.unisonLevels[u] = position === 0 ? 1 : side;
      if (u < d.unisonCount) copies += d.unisonLevels[u] * d.unisonLevels[u];
    }
    // Sources added together are brought back down to the level of one. With the first oscillator
    // at full level, as it always was, the sum is never under one, so this is what it always was.
    // Turned down with nothing else on, it is simply quieter: nothing is brought back up.
    // With the side copies at full level, as they always were, `copies` is their number.
    const power = copies * (osc1 * osc1 + osc2 * osc2 + ring * ring) + sub * sub + noise * noise;
    d.mixScale = power > 1 ? 1 / Math.sqrt(power) : 1;
    d.twoStage = p.filterSlope >= 24 && (p.filterType === 'lowpass' || p.filterType === 'highpass' || p.filterType === 'bandpass');
    d.fmDecay = approachCoefficient(clamp(p.fmDecay, 0.01, 10, 0.6), sr, 4.6);
    // The routes in use, as numbers the voice loop can switch on.
    const flat = p as unknown as Record<string, unknown>;
    this.routeCount = 0;
    for (let n = 1; n <= MOD_ROUTES; n++) {
      const source = MOD_SOURCES.indexOf(String(flat[`mod${n}Source`]));
      const destination = MOD_DESTINATIONS.indexOf(String(flat[`mod${n}Destination`]));
      const depth = clamp(Number(flat[`mod${n}Depth`]), -1, 1, 0);
      if (source < 0 || destination < 0 || depth === 0) continue;
      this.routeSource[this.routeCount] = source;
      this.routeDestination[this.routeCount] = destination;
      this.routeDepth[this.routeCount++] = depth;
    }
    const drive = clamp(p.filterDrive, 0, 1);
    d.driveGain = 1 + drive * 5;
    d.driveMakeup = 1 / (1 + drive * 1.6);
  }

  setBend(value: number): void {
    this.bendTarget = clamp(value, -1, 1, 0);
  }

  setWheel(value: number): void {
    this.wheelTarget = clamp(value, 0, 1, 0);
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

    // A layered sound plays every note on two voices, one for each layer.
    const layers = p.layerEnabled ? Math.min(2, this.voices.length) : 1;

    if (p.voiceMode === 'mono') {
      for (let i = layers; i < this.voices.length; i++) this.release(this.voices[i]);
      for (let layer = 0; layer < layers; layer++) {
        const voice = this.voices[layer];
        if (voice.active && voice.amp.stage !== 'release') {
          // Legato: move the pitch without retriggering the envelopes. This is what a slide is.
          voice.note = message.note;
          voice.id = message.id;
          voice.targetFrequency = frequency;
          if (!p.portamentoEnabled) voice.frequency = frequency;
          voice.keyOctaves = keyOctaves;
          voice.remaining = remaining;
          this.lastFrequency = frequency;
          continue;
        }
        this.trigger(voice, message, frequency, frequency, velocity, remaining, keyOctaves, layer);
      }
      return;
    }

    const from = p.portamentoEnabled ? this.lastFrequency : frequency;
    for (let layer = 0; layer < layers; layer++) {
      let voice = this.voices.find(v => v.active && v.note === message.note && (layers === 1 || v.layer === layer))
        || this.voices.find(v => !v.active);
      if (!voice) voice = this.voices.reduce((oldest, v) => v.age < oldest.age ? v : oldest);
      this.trigger(voice, message, frequency, from, velocity, remaining, keyOctaves, layer);
    }
  }

  private trigger(voice: Voice, message: NoteOnMessage, frequency: number, startFrequency: number, velocity: number, remaining: number, keyOctaves: number, layer: number): void {
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
      voice.ladder.reset();
      voice.highpass.reset();
      voice.previousInput = 0;
      voice.amp.reset();
      voice.filterEnv.reset();
    } else if (this.params.engine === 'sample' && this.sample) {
      // A recording starts again from its beginning, so the jump is crossfaded.
      voice.transition = voice.last;
      voice.transitionSamples = this.transitionLength;
    }
    voice.samplePosition = 0;
    voice.sampleData = null;
    voice.sampleLoopFrames = null;
    voice.sampleLevel = -1;
    const sample = this.sample;
    let recording = sample && !sample.frame ? sample.data : null;
    if (sample && !sample.frame && (sample.zones || sample.root !== undefined)) {
      // The recording made nearest this note.
      const midi = 69 + 12 * Math.log2(frequency / 440);
      const { data, rate, loopStart, loopEnd, keyLow, keyHigh } = sample;
      const first: SampleZone = { data, rate, root: sample.root ?? clamp(this.params.sampleRoot, 0, 127, 60), loopStart, loopEnd, keyLow, keyHigh };
      const all = [first, ...(sample.zones ?? [])], key = Math.round(midi);
      // A SoundFont's recordings are each for a range of keys: a note takes one whose range holds it,
      // the nearest root among them. With no ranges, as before, it is the nearest root of them all.
      const holding = all.filter(zone => zone.keyLow !== undefined && zone.keyHigh !== undefined && key >= zone.keyLow && key <= zone.keyHigh);
      const pool = holding.length ? holding : all;
      let chosen = pool[0];
      for (const zone of pool) if (Math.abs(zone.root - midi) < Math.abs(chosen.root - midi)) chosen = zone;
      voice.sampleData = chosen.data;
      voice.sampleScale = chosen.rate / (440 * 2 ** ((chosen.root - 69) / 12));
      voice.sampleLoopFrames = chosen.loopStart !== undefined && chosen.loopEnd !== undefined && chosen.loopEnd - chosen.loopStart >= 2 ? [chosen.loopStart, chosen.loopEnd] : null;
      recording = chosen.data;
    }
    // A note begins where the sound says, as a share of whichever recording it plays.
    const start = clamp(this.params.sampleStart, 0, 1, 0);
    if (recording && start > 0) voice.samplePosition = start * (recording.length - 1);
    // A voice that is still sounding keeps its phase and envelope level, so stealing it cannot click.
    voice.active = true;
    voice.note = message.note;
    voice.id = message.id;
    voice.frequency = startFrequency;
    voice.targetFrequency = frequency;
    voice.velocity = velocity;
    voice.keyOctaves = keyOctaves;
    voice.layer = layer;
    voice.lfoPhase = [0, 0];
    voice.random = this.chance.next();
    voice.randomPhase = 0;
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

  // Forgets the parameter changes still waiting for their time: the transport has stopped.
  clearScheduledParams(): void {
    this.scheduled = [];
  }

  get idle(): boolean {
    return this.pending.length === 0 && this.voices.every(voice => !voice.active);
  }

  // With no parameter change waiting this is one call to `render`, as it always was. A change
  // due inside the block cuts it there: what is before is rendered, the change is made, and the
  // rest follows.
  process(left: Float32Array, right: Float32Array): void {
    if (this.scheduled.length === 0) { this.render(left, right); return; }
    for (let at = 0; at < left.length;) {
      while (this.scheduled.length && this.scheduled[0].frame <= this.frame) this.setParams(this.scheduled.shift()!.update);
      const end = this.scheduled.length ? Math.min(left.length, at + this.scheduled[0].frame - this.frame) : left.length;
      this.render(left.subarray(at, end), right.subarray(at, end));
      at = end;
    }
  }

  private render(left: Float32Array, right: Float32Array): void {
    const p = this.params, s = this.smoothed, d = this.derived, sr = this.sampleRate, k = this.smoothing;
    const maxCutoff = Math.min(20000, sr * 0.45);
    const fm = p.engine === 'fm';
    // The sample engine, when it has a recording. Without one the lane plays its oscillators.
    const sample = p.engine === 'sample' ? this.sample : null;
    const sampleLoop = p.sampleLoop;
    // The part that goes round, as shares of the recording. The whole of it unless the sound says.
    const loopFrom = clamp(p.sampleLoopStart, 0, 1, 0), loopTo = Math.max(loopFrom, clamp(p.sampleLoopEnd, 0, 1, 1));
    // The longest a loop's end is faded into what comes before its start: a hundredth of a second.
    const loopFade = sample ? sample.rate * 0.01 : 0;
    // How many of the recording's frames one cycle of a note is worth, at the note it was recorded at.
    const sampleScale = sample ? sample.rate / (440 * 2 ** ((clamp(sample.root ?? p.sampleRoot, 0, 127, 60) - 69) / 12)) : 0;
    // A table of single cycles: how long each is, how many there are, how fast they are stepped
    // through, and how much of each step is a crossfade into the next.
    const tableFrame = sample?.frame ? Math.floor(sample.frame) : 0;
    const tableFrames = tableFrame > 1 ? Math.floor(sample!.data.length / tableFrame) : 0;
    const tableScan = clamp(p.sampleScan, 0, 40, 2) / sr, tableFade = clamp(p.sampleFade, 0, 1, 1);
    const osc2Level = p.osc2Enabled ? clamp(p.osc2Level, 0, 1) : 0;
    const oscLevel = clamp(p.oscLevel, 0, 1, 1), subLevel = clamp(p.subLevel, 0, 1), noiseLevel = clamp(p.noiseLevel, 0, 1);
    // Ring modulation and sync both need the second oscillator running, whether or not it is heard itself.
    const ringLevel = p.osc2Enabled ? clamp(p.ringLevel, 0, 1, 0) : 0;
    const sync = p.osc2Enabled && p.osc2Sync;
    const secondRuns = osc2Level > 0 || ringLevel > 0;
    const lfoRates = [clamp(p.lfo1Rate, 0, 100) / sr, clamp(p.lfo2Rate, 0, 100) / sr];
    const lfoDepths = [p.lfo1Enabled ? clamp(p.lfo1Depth, 0, 1) : 0, p.lfo2Enabled ? clamp(p.lfo2Depth, 0, 1) : 0];
    const lfoTargets = [p.lfo1Target, p.lfo2Target];
    const lfoWaves = [p.lfo1Waveform, p.lfo2Waveform];
    const lfoRetrigger = [p.lfo1Retrigger, p.lfo2Retrigger];
    const velocityAmp = clamp(p.velocityAmp, 0, 1, 1), velocityFilter = clamp(p.velocityFilter, 0, 1);
    const envAmount = clamp(p.filterEnvAmount, -1, 1), keyTracking = clamp(p.filterKeyTracking, 0, 1);
    const fmRatio = clamp(p.fmRatio, 0.25, 16, 2), fmIndex = clamp(p.fmIndex, 0, 1), fmFeedback = clamp(p.fmFeedback, 0, 1);
    const algorithm = Math.round(clamp(p.fmAlgorithm, 0, 3));
    const ladder = p.filterModel === 'ladder' && p.filterType === 'lowpass';
    const ms20 = p.filterModel === 'ms20' && p.filterType === 'lowpass';
    // A high-pass before the filter. Under 20 Hz there is none, and the sound is what it was before there could be.
    const highpassCutoff = clamp(p.filterHighpass, 0, maxCutoff, 0);
    const highpassG = highpassCutoff >= 20 ? svfCoefficient(highpassCutoff, sr) : 0;
    // The second layer. With one layer nothing here is used, and the sound is what it was before there could be two.
    const layered = p.layerEnabled;
    const layerBrightness = clamp(p.layerBrightness, -3, 3, 0), layerWidth = clamp(p.layerWidth, 0, 1, 0);

    for (let i = 0; i < left.length; i++) {
      while (this.pending.length && this.pending[0].frame <= this.frame + i) this.startNote(this.pending.shift()!);
      s.gain += (clamp(p.gain, 0, 2, s.gain) - s.gain) * k;
      s.pan += (clamp(p.pan, -1, 1, s.pan) - s.pan) * k;
      s.spread += (clamp(p.spread, 0, 1, s.spread) - s.spread) * k;
      s.detune += (clamp(p.detune, -1200, 1200, s.detune) - s.detune) * k;
      s.filterFreq += (clamp(p.filterFreq, 20, maxCutoff, s.filterFreq) - s.filterFreq) * k;
      s.filterQ += (clamp(p.filterQ, 0.1, 20, s.filterQ) - s.filterQ) * k;
      s.pulseWidth += (clamp(p.pulseWidth, 0.05, 0.95, s.pulseWidth) - s.pulseWidth) * k;
      if (this.bend !== this.bendTarget) this.bend = Math.abs(this.bendTarget - this.bend) < 1e-5 ? this.bendTarget : this.bend + (this.bendTarget - this.bend) * k;
      if (this.wheel !== this.wheelTarget) this.wheel = Math.abs(this.wheelTarget - this.wheel) < 1e-5 ? this.wheelTarget : this.wheel + (this.wheelTarget - this.wheel) * k;
      const bendOctaves = this.bend * BEND_SEMITONES / 12;
      this.globalLfoPhase[0] = (this.globalLfoPhase[0] + lfoRates[0]) % 1;
      this.globalLfoPhase[1] = (this.globalLfoPhase[1] + lfoRates[1]) % 1;

      let l = 0, r = 0;
      for (let index = 0; index < this.voices.length; index++) {
        const v = this.voices[index];
        if (!v.active) continue;
        if (--v.remaining <= 0) this.release(v);
        const second = layered && v.layer === 1;
        const amp = v.amp.tick(second ? d.layerAttack : d.attack, d.decay, d.sustain, v.releaseOverride || d.release);
        if (v.amp.stage === 'off') { v.active = false; v.last = 0; continue; }
        const filterEnv = v.filterEnv.tick(d.filterAttack, d.filterDecay, d.filterSustain, v.releaseOverride || d.filterRelease);
        v.frequency += (v.targetFrequency - v.frequency) * d.glide;

        let pitchMod = 0, filterMod = 0, ampMod = 1, pulseMod = 0;
        for (let n = 0; n < 2; n++) {
          if (lfoRetrigger[n]) v.lfoPhase[n] = (v.lfoPhase[n] + lfoRates[n]) % 1;
          if (lfoDepths[n] === 0) continue;
          const value = lfoShape(lfoWaves[n], lfoRetrigger[n] ? v.lfoPhase[n] : this.globalLfoPhase[n]) * lfoDepths[n];
          if (lfoTargets[n] === 'pitch') pitchMod += value;
          else if (lfoTargets[n] === 'vibrato') pitchMod += value / 12;
          else if (lfoTargets[n] === 'filter') filterMod += value;
          else if (lfoTargets[n] === 'amp') ampMod *= 1 - (lfoDepths[n] - value) * 0.5;
          else if (lfoTargets[n] === 'pulseWidth') pulseMod += value * 0.45;
        }

        // The routes. With none, every sum here is nothing and every product one, and the sound is what it was.
        let osc2Mod = 1, fmMod = 0, panMod = 0, routedFilter = 0;
        if (this.routeCount > 0) {
          let osc2Octaves = 0;
          for (let r = 0; r < this.routeCount; r++) {
            const source = this.routeSource[r], depth = this.routeDepth[r];
            // Each source as it swings (-1 to 1) and as an amount (0 to 1).
            let swing: number, amount: number;
            if (source <= 1) {
              swing = lfoShape(lfoWaves[source], lfoRetrigger[source] ? v.lfoPhase[source] : this.globalLfoPhase[source]);
              amount = (swing + 1) * 0.5;
            } else if (source === 2) { amount = amp; swing = amp; }
            else if (source === 3) { amount = filterEnv; swing = filterEnv; }
            else if (source === 4) { amount = v.velocity; swing = v.velocity; }
            else if (source === 5) { swing = clamp(v.keyOctaves * 0.5, -1, 1); amount = (swing + 1) * 0.5; }
            else if (source === 7) { swing = this.wheel; amount = this.wheel; }
            else {
              // Random: a new value each time the first LFO comes round, held until the next.
              const phase = lfoRetrigger[0] ? v.lfoPhase[0] : this.globalLfoPhase[0];
              if (phase < v.randomPhase) v.random = this.chance.next();
              v.randomPhase = phase;
              swing = v.random;
              amount = (swing + 1) * 0.5;
            }
            const destination = this.routeDestination[r];
            if (destination === 0) pitchMod += depth * swing;
            else if (destination === 1) osc2Octaves += depth * 3 * swing;
            else if (destination === 2) routedFilter += depth * 4 * swing;
            else if (destination === 3) ampMod *= 1 - Math.abs(depth) * (1 - (depth >= 0 ? amount : 1 - amount));
            else if (destination === 4) pulseMod += depth * 0.45 * swing;
            else if (destination === 5) panMod += depth * swing;
            else fmMod += depth * swing;
          }
          if (osc2Octaves !== 0) osc2Mod = 2 ** osc2Octaves;
        }

        const step = clamp((second ? v.frequency * d.layerRatio : v.frequency) * 2 ** (s.detune / 1200 + pitchMod + bendOctaves) / sr, 0.000001, 0.45);
        let source: number;
        if (fm) {
          v.fmEnv += (0.2 - v.fmEnv) * d.fmDecay;
          const depth = (fmMod === 0 ? fmIndex : clamp(fmIndex + fmMod, 0, 1)) * v.fmEnv * (0.4 + 0.6 * v.velocity);
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
        } else if (sample) {
          if (tableFrames > 0) {
            const data = sample.data;
            v.phase1[0] = (v.phase1[0] + step) % 1;
            const place = v.phase1[0] * tableFrame, index = Math.floor(place), next = (index + 1) % tableFrame, part = place - index;
            const position = v.samplePosition, cycle = Math.floor(position) % tableFrames, first = cycle * tableFrame;
            source = data[first + index] + (data[first + next] - data[first + index]) * part;
            if (tableFrames > 1) {
              // Each cycle is held, then crossfaded into the next over the last part of its turn.
              const turn = position - Math.floor(position);
              const blend = tableFade <= 0 ? 0 : clamp((turn - (1 - tableFade)) / tableFade, 0, 1, 0);
              if (blend > 0) {
                const after = ((cycle + 1) % tableFrames) * tableFrame;
                source += (data[after + index] + (data[after + next] - data[after + index]) * part - source) * blend;
              }
              v.samplePosition = (position + tableScan) % tableFrames;
            }
          } else {
            const data = v.sampleData ?? sample.data, end = data.length - 1;
            const advance = step * (v.sampleData ? v.sampleScale : sampleScale);
            // Within an octave above its own pitch the recording is read as it is. Faster than
            // that, a copy with its top taken out is read, and the copy is changed only once the
            // speed is plainly past the next octave, so a vibrato across one does not flicker.
            const wanted = advance < 2 ? 0 : advance < 4 ? 1 : advance < 8 ? 2 : 3;
            if (wanted !== v.sampleLevel && (v.sampleLevel < 0 || advance >= 2.2 * 2 ** v.sampleLevel || advance < 0.9 * 2 ** v.sampleLevel)) v.sampleLevel = wanted;
            const copy = v.sampleLevel > 0 ? this.sampleCopies.get(data)?.[v.sampleLevel - 1] : undefined;
            const read = copy ?? data, shrink = copy ? 1 / 2 ** v.sampleLevel : 1;
            let at = v.samplePosition, lead = -1, leadMix = 0;
            if (sampleLoop) {
              // A loop too short to hold a sample is the whole recording. A recording with a loop of its
              // own (a SoundFont's) goes round that, unless the sound's loop points have been moved.
              const own = v.sampleLoopFrames && loopFrom === 0 && loopTo === 1 ? v.sampleLoopFrames : null;
              const whole = !own && (loopTo - loopFrom) * end < 2;
              const from = own ? own[0] : whole ? 0 : loopFrom * end, round = own ? Math.min(own[1], end) : whole ? end : loopTo * end;
              if (at >= round) at = from + (at - round) % (round - from);
              // The last of the loop is faded into what the recording has just before the loop's
              // start, which is what leads into the start, so the join does not click. A loop from
              // the very beginning has nothing before it and goes round as it is.
              const fade = Math.min(from, (round - from) / 2, loopFade);
              if (fade >= 1 && at > round - fade) {
                leadMix = (at - (round - fade)) / fade;
                lead = at - (round - from);
              }
            }
            if (at < end) {
              const place = at * shrink, index = Math.floor(place), here = read[index];
              source = here + ((read[index + 1] ?? here) - here) * (place - index);
              if (lead >= 0) {
                const led = lead * shrink, before = Math.floor(led), then = read[before];
                source += (then + ((read[before + 1] ?? then) - then) * (led - before) - source) * leadMix;
              }
            } else {
              // Played once and finished: the voice is let go, so a held key does not keep it from
              // another note. With the second oscillator sounding beside it, the note goes on.
              source = 0;
              if (!secondRuns) this.release(v);
            }
            v.samplePosition = at + advance;
          }
          source *= oscLevel;
          if (secondRuns) {
            const step2 = clamp(step * d.osc2Ratio * osc2Mod, 0.000001, 0.45);
            v.phase2[0] = (v.phase2[0] + step2) % 1;
            source += oscillator(p.osc2Type, v.phase2[0], step2) * osc2Level;
          }
        } else {
          const pulseWidth = clamp(s.pulseWidth + pulseMod, 0.05, 0.95, 0.5);
          source = 0;
          for (let u = 0; u < d.unisonCount; u++) {
            const step1 = clamp(step * d.unisonRatios[u], 0.000001, 0.45);
            v.phase1[u] = (v.phase1[u] + step1) % 1;
            const level = d.unisonLevels[u];
            const first = oscillator(p.oscType, v.phase1[u], step1, pulseWidth);
            source += first * oscLevel * level;
            if (secondRuns) {
              const step2 = clamp(step1 * d.osc2Ratio * osc2Mod, 0.000001, 0.45);
              // Synced, it starts again when the first has just come round, as far into its wave as the
              // first is past the start of its own, so the restart does not jitter from sample to sample.
              v.phase2[u] = sync && v.phase1[u] < step1 ? (v.phase1[u] / step1 * step2) % 1 : (v.phase2[u] + step2) % 1;
              const second = oscillator(p.osc2Type, v.phase2[u], step2);
              source += second * osc2Level * level;
              if (ringLevel > 0) source += first * second * ringLevel * level;
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
        let octaves = clamp(filterMod, -1, 1) * 2 + envAmount * 5 * filterEnv
          + keyTracking * v.keyOctaves + velocityFilter * 3 * (v.velocity - 0.5) + routedFilter;
        if (second) octaves += layerBrightness;
        // Run the filter twice per sample: cheap 2x oversampling keeps resonance clean near Nyquist.
        const g = svfCoefficient(clamp(s.filterFreq * 2 ** octaves, 20, maxCutoff, 1000), sr * 2);
        const damping = 1 / s.filterQ;
        if (highpassG > 0) {
          // The MS-20's high-pass has the same peak as its low-pass and distorts the same way; any other is plain.
          v.highpass.tick(source, highpassG, ms20 ? damping + MS20_HOLD * v.highpass.bp * v.highpass.bp : Math.SQRT2);
          source = v.highpass.hp;
        }
        const midpoint = (v.previousInput + source) * 0.5;
        let filtered: number;
        if (ladder) {
          const feedback = ladderFeedback(s.filterQ);
          v.ladder.tick(midpoint, g, feedback);
          filtered = v.ladder.tick(source, g, feedback);
          v.previousInput = source;
        } else if (ms20) {
          v.filter.tick(midpoint, g, damping + MS20_HOLD * v.filter.bp * v.filter.bp);
          v.filter.tick(source, g, damping + MS20_HOLD * v.filter.bp * v.filter.bp);
          v.previousInput = source;
          filtered = v.filter.lp;
        } else {
          v.filter.tick(midpoint, g, damping);
          if (d.twoStage) v.filter2.tick(v.filter.output(p.filterType, midpoint, damping), g, SECOND_STAGE_DAMPING);
          v.filter.tick(source, g, damping);
          v.previousInput = source;
          filtered = v.filter.output(p.filterType, source, damping);
          if (d.twoStage) {
            v.filter2.tick(filtered, g, SECOND_STAGE_DAMPING);
            filtered = v.filter2.output(p.filterType, filtered, SECOND_STAGE_DAMPING);
          }
        }

        const velocityGain = 1 - velocityAmp * (1 - v.velocity);
        let value = filtered * amp * ampMod * velocityGain * s.gain * VOICE_LEVEL;
        let place = panMod;
        if (layered) {
          value *= second ? d.layerSecond : d.layerFirst;
          place += second ? layerWidth : -layerWidth;
        }
        if (v.transitionSamples > 0) {
          const blend = v.transitionSamples / this.transitionLength;
          value = value * (1 - blend) + v.transition * blend;
          v.transitionSamples--;
        }
        v.last = value;
        const angle = (clamp(s.pan + clamp(v.keyOctaves / 3 - 0.25, -1, 1) * s.spread + place, -1, 1) + 1) * Math.PI / 4;
        l += value * Math.cos(angle);
        r += value * Math.sin(angle);
      }
      left[i] = Math.tanh(l);
      right[i] = Math.tanh(r);
    }
    // The lane's own effects. With none switched on this is one comparison and the block is as it was.
    this.inserts.process(left, right, p);
    this.frame += left.length;
  }
}
