import type { DrumState, EffectsLoopState, FxSendLevels, Pattern, SavedPatternFull, Scene, SceneMutes, Song, SynthParameters, SynthModelParams } from '../types';
import { DELAY_SYNCS } from './delayTime';
import { CHORUS_DEFAULT, EQ_RANGE_DB, MAX_PRE_DELAY } from './effectSettings';
import { MAX_STEP_NOTES, MAX_STEP_OFFSET } from './noteScheduling';
import { BAR_CHOICES, DRUM_STEPS_PER_BAR, MAX_BARS, clampLengths, laneBars } from './patternLength';
import { sanitizeGuestMix, sanitizeSceneGuests } from './guests';
import { MAX_REPEATS, MAX_SONG_ENTRIES } from './songPlayback';
import { normalizeSynthModelId } from '../synthModels';
import { noteNameToMidi } from '../utils/midiExport';
import { DRUM_INSTRUMENTS, DRUM_KITS } from './drumKits';
import { MAX_RATCHET } from './drumScheduling';

export const record = (value: unknown): Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function sanitizeShape<T>(value: unknown, defaults: T): T {
  const input = record(value);
  return Object.fromEntries(Object.entries(defaults as object).map(([key, fallback]) => {
    const candidate = input[key];
    const result = fallback !== null && typeof fallback === 'object'
      ? sanitizeShape(candidate, fallback)
      : typeof fallback === 'number' ? number(candidate, fallback, -1e6, 1e6)
        : typeof candidate === typeof fallback ? candidate : fallback;
    return [key, result];
  })) as T;
}

export function matchesShape(value: unknown, defaults: unknown): boolean {
  if (Array.isArray(defaults)) {
    return Array.isArray(value) && defaults.every((fallback, index) => matchesShape(value[index], fallback));
  }
  if (defaults !== null && typeof defaults === 'object') {
    const input = record(value);
    return Object.entries(defaults).every(([key, fallback]) => matchesShape(input[key], fallback));
  }
  return typeof value === typeof defaults && (typeof value !== 'number' || Number.isFinite(value));
}

export function sanitizeSends(value: unknown, defaults: FxSendLevels): FxSendLevels {
  const input = record(value);
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, number(input[key], fallback, 0, 1)])) as unknown as FxSendLevels;
}

export function sanitizeSynthParams(value: unknown, defaults: SynthParameters): SynthParameters {
  const input = record(value);
  const params = sanitizeShape(input, defaults);
  params.gain = number(input.gain, defaults.gain, 0, 2);
  params.pan = number(input.pan, defaults.pan, -1, 1);
  params.fxReturn = number(input.fxReturn, defaults.fxReturn, 0, 1);
  if (input.spread !== undefined) params.spread = number(input.spread, defaults.spread ?? 0, 0, 1);
  params.fxSends = sanitizeSends(input.fxSends, defaults.fxSends);
  const waves = ['sine', 'square', 'sawtooth', 'triangle'];
  if (!waves.includes(params.oscillator.type)) params.oscillator.type = defaults.oscillator.type;
  params.oscillator.detune = number(params.oscillator.detune, defaults.oscillator.detune, -1200, 1200);
  for (const key of ['lfo1', 'lfo2'] as const) {
    const raw = record(input[key]), lfo = params[key];
    if (!waves.includes(lfo.waveform)) lfo.waveform = defaults[key].waveform;
    if (!['pitch', 'filter', 'amp', 'pulseWidth', 'vibrato'].includes(lfo.target)) lfo.target = defaults[key].target;
    lfo.rate = number(lfo.rate, defaults[key].rate, .01, raw.sync === true ? 64 : 30);
    lfo.depth = number(lfo.depth, defaults[key].depth, 0, 1);
    if (raw.sync !== undefined) lfo.sync = raw.sync === true;
    lfo.retrigger = raw.retrigger !== false;
  }
  params.engine = input.engine === 'fm' ? 'fm' : 'subtractive';
  params.voiceMode = input.voiceMode === 'mono' ? 'mono' : 'poly';
  params.oscillator.pulseWidth = number(params.oscillator.pulseWidth, .5, .05, .95);
  const osc2 = params.oscillator2!, osc2Defaults = defaults.oscillator2!;
  if (!waves.includes(osc2.type)) osc2.type = osc2Defaults.type;
  osc2.semitones = Math.round(number(osc2.semitones, osc2Defaults.semitones, -36, 36));
  osc2.detune = number(osc2.detune, osc2Defaults.detune, -100, 100);
  osc2.level = number(osc2.level, osc2Defaults.level, 0, 1);
  params.mixer = { sub: number(params.mixer!.sub, 0, 0, 1), noise: number(params.mixer!.noise, 0, 0, 1) };
  params.unison = {
    voices: Math.round(number(params.unison!.voices, 1, 1, 5)), detune: number(params.unison!.detune, defaults.unison!.detune, 0, 1),
  };
  params.duck = number(input.duck, 0, 0, 1);
  params.velocity = { amp: number(params.velocity!.amp, 1, 0, 1), filter: number(params.velocity!.filter, 0, 0, 1) };
  const fm = params.fm!, fmDefaults = defaults.fm!;
  params.fm = {
    algorithm: Math.round(number(fm.algorithm, fmDefaults.algorithm, 0, 3)), ratio: number(fm.ratio, fmDefaults.ratio, .25, 16),
    index: number(fm.index, fmDefaults.index, 0, 1), decay: number(fm.decay, fmDefaults.decay, .01, 10),
    feedback: number(fm.feedback, fmDefaults.feedback, 0, 1),
  };
  const filterEnvelope = params.filterEnvelope!, filterEnvelopeDefaults = defaults.filterEnvelope!;
  for (const key of ['attack', 'decay', 'release'] as const) filterEnvelope[key] = number(filterEnvelope[key], filterEnvelopeDefaults[key], 0, 10);
  filterEnvelope.sustain = number(filterEnvelope.sustain, filterEnvelopeDefaults.sustain, 0, 1);
  const filter = params.filter;
  if (!['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'].includes(filter.type)) filter.type = defaults.filter.type;
  filter.frequency = number(filter.frequency, defaults.filter.frequency, 20, 20000);
  filter.q = number(filter.q, defaults.filter.q, .1, 30);
  filter.envAmount = number(filter.envAmount, 0, -1, 1);
  filter.keyTracking = number(filter.keyTracking, 0, 0, 1);
  filter.drive = number(filter.drive, 0, 0, 1);
  filter.slope = filter.slope === 24 ? 24 : 12;
  for (const key of ['attack', 'decay', 'release'] as const) params.envelope[key] = number(params.envelope[key], defaults.envelope[key], 0, 10);
  params.envelope.sustain = number(params.envelope.sustain, defaults.envelope.sustain, 0, 1);
  params.portamento.glide = number(params.portamento.glide, defaults.portamento.glide, 0, 2);
  if (!['up', 'down', 'updown', 'downup', 'random', 'converge', 'diverge'].includes(params.arpeggiator.mode)) params.arpeggiator.mode = defaults.arpeggiator.mode;
  if (!['1/4', '1/8', '1/16', '1/32'].includes(params.arpeggiator.rate)) params.arpeggiator.rate = defaults.arpeggiator.rate;
  params.arpeggiator.gate = number(params.arpeggiator.gate, defaults.arpeggiator.gate, .1, 1);
  params.effects.reverb.wet = number(params.effects.reverb.wet, defaults.effects.reverb.wet, 0, 1);
  params.effects.reverb.decay = number(params.effects.reverb.decay, defaults.effects.reverb.decay, .1, 8);
  params.effects.delay.wet = number(params.effects.delay.wet, defaults.effects.delay.wet, 0, 1);
  params.effects.delay.time = number(params.effects.delay.time, defaults.effects.delay.time, .01, 1.5);
  params.effects.delay.feedback = number(params.effects.delay.feedback, defaults.effects.delay.feedback, 0, .85);
  return params;
}

// `bars` is how many bars the steps cover; without it they are one bar of 16 or 32 steps.
export function sanitizeSteps(value: unknown, bars: unknown = 1): Pattern['steps'] {
  const input = Array.isArray(value) ? value : [];
  const count = laneBars(input.length, bars);
  const perBar = count > 1 ? input.length / count : (input.length > 16 ? 32 : 16);
  return clampLengths(Array.from({ length: perBar * count }, (_, index) => {
    const step = record(input[index]);
    const note = typeof step.note === 'string' && noteNameToMidi(step.note) !== null ? step.note : undefined;
    const extras = note && Array.isArray(step.notes)
      ? [...new Set((step.notes as unknown[]).filter((entry): entry is string => typeof entry === 'string' && noteNameToMidi(entry) !== null && entry !== note))].slice(0, MAX_STEP_NOTES - 1)
      : [];
    const length = note && Number.isInteger(step.length) ? Math.max(1, Math.min(32 * MAX_BARS, step.length)) : 1;
    return {
      active: step.active === true && Boolean(note), ...(note ? { note } : {}), velocity: number(step.velocity, .7, 0, 1),
      ...(step.slide === true ? { slide: true } : {}),
      ...(extras.length ? { notes: extras } : {}), ...(length > 1 ? { length } : {}),
      ...(note && typeof step.probability === 'number' && step.probability >= 0 && step.probability < 1 ? { probability: step.probability } : {}),
      ...(note && Number.isInteger(step.ratchet) && step.ratchet > 1 ? { ratchet: Math.min(4, step.ratchet) } : {}),
      ...(note && typeof step.offset === 'number' && step.offset > 0 ? { offset: Math.min(MAX_STEP_OFFSET, step.offset) } : {}),
    };
  }));
}

export function sanitizePattern(value: unknown, tempo: number): Pattern | null {
  const input = record(value);
  if (typeof input.id !== 'string' || !input.id || !Array.isArray(input.steps)) return null;
  return {
    id: input.id.slice(0, 200), name: typeof input.name === 'string' ? input.name.slice(0, 200) : 'Recovered pattern',
    tempo, steps: sanitizeSteps(input.steps, input.bars),
    ...(laneBars(input.steps.length, input.bars) > 1 ? { bars: laneBars(input.steps.length, input.bars) } : {}),
  };
}

export function sanitizeDrums(value: unknown, defaults: DrumState): DrumState {
  const input = record(value);
  // Every drum lane is as long as the kick's.
  const kickSteps = record(input.kick).steps;
  const total = DRUM_STEPS_PER_BAR * (BAR_CHOICES.find(choice => Array.isArray(kickSteps) && kickSteps.length === choice * DRUM_STEPS_PER_BAR) ?? 1);
  return Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => {
    const track = record(input[instrument]), settings = record(track.settings), base = defaults[instrument];
    const state = {
      steps: Array.from({ length: total }, (_, i) => Array.isArray(track.steps) && track.steps[i] === true),
      muted: track.muted === true, solo: track.solo === true,
      ...(typeof track.sampleId === 'string' && /^[0-9a-f-]{36}$/.test(track.sampleId) ? { sampleId: track.sampleId } : {}),
      settings: {
        volume: number(settings.volume, base.settings.volume, 0, 1),
        tone: number(settings.tone, base.settings.tone, 0, 1),
        extra: number(settings.extra, base.settings.extra, 0, 1),
        tune: number(settings.tune, base.settings.tune ?? 0, -1, 1),
        humanize: number(settings.humanize, base.settings.humanize ?? .35, 0, 1),
        pan: number(settings.pan, base.settings.pan ?? 0, -1, 1),
        ...(settings.cymbalType === 'ride' || settings.cymbalType === 'crash' ? { cymbalType: settings.cymbalType } : {}),
      },
      ...(Array.isArray(track.stepVelocities) ? {
        stepVelocities: Array.from({ length: total }, (_, i) => number(track.stepVelocities[i], 1, 0, 1)),
      } : {}),
      ...(Array.isArray(track.stepProbabilities) ? {
        stepProbabilities: Array.from({ length: total }, (_, i) => number(track.stepProbabilities[i], 1, 0, 1)),
      } : {}),
      ...(Array.isArray(track.stepRatchets) ? {
        stepRatchets: Array.from({ length: total }, (_, i) => Math.round(number(track.stepRatchets[i], 1, 1, MAX_RATCHET))),
      } : {}),
    };
    return [instrument, state];
  })) as DrumState;
}

export const MAX_SCENES = 64;

// Scenes and the song from storage or a file. Returns null when there is no usable scene,
// which tells the caller to build one from the live project instead.
// A scene's mutes and solos, for the lanes and drums that exist. Absent when the scene has none.
export function sanitizeSceneMutes(value: unknown): SceneMutes | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = record(value), flags = (entry: unknown) => ({ muted: record(entry).muted === true, solo: record(entry).solo === true });
  const lanes = Object.fromEntries([1, 2, 3].filter(id => record(input.lanes)[id] !== undefined).map(id => [id, flags(record(input.lanes)[id])]));
  const drums = Object.fromEntries(DRUM_INSTRUMENTS.filter(instrument => record(input.drums)[instrument] !== undefined).map(instrument => [instrument, flags(record(input.drums)[instrument])]));
  return { lanes, drums };
}

export function sanitizeScenes(value: unknown, defaults: DrumState): Scene[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const scenes = value.slice(0, MAX_SCENES).flatMap((entry: unknown) => {
    const input = record(entry);
    if (typeof input.id !== 'string' || !input.id || seen.has(input.id)) return [];
    seen.add(input.id);
    const lanes: Scene['lanes'] = {};
    const lengths: Record<number, number> = {};
    for (const id of [1, 2, 3]) {
      const steps = record(input.lanes)[id];
      if (!Array.isArray(steps)) continue;
      const bars = laneBars(steps.length, record(input.laneBars)[id]);
      lanes[id] = sanitizeSteps(steps, bars);
      if (bars > 1) lengths[id] = bars;
    }
    const drums = sanitizeDrums(input.drums, defaults);
    return [{
      id: input.id.slice(0, 200),
      name: (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Scene').slice(0, 40),
      lanes,
      ...(Object.keys(lengths).length ? { laneBars: lengths } : {}),
      ...(sanitizeSceneGuests(input.guests) ? { guests: sanitizeSceneGuests(input.guests) } : {}),
      ...(sanitizeGuestMix(input.guestMix) ? { guestMix: sanitizeGuestMix(input.guestMix) } : {}),
      ...(sanitizeSceneMutes(input.mutes) ? { mutes: sanitizeSceneMutes(input.mutes) } : {}),
      drums: Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => {
        const { steps, stepVelocities, stepProbabilities, stepRatchets } = drums[instrument];
        return [instrument, {
          steps, ...(stepVelocities ? { stepVelocities } : {}), ...(stepProbabilities ? { stepProbabilities } : {}),
          ...(stepRatchets ? { stepRatchets } : {}),
        }];
      })) as Scene['drums'],
    }];
  });
  return scenes.length > 0 ? scenes : null;
}

// A song can only refer to scenes that exist; an empty song plays the first scene once.
export function sanitizeSong(value: unknown, scenes: Scene[]): Song {
  const input = record(value);
  const ids = new Set(scenes.map(scene => scene.id));
  const entries = (Array.isArray(input.entries) ? input.entries : []).slice(0, MAX_SONG_ENTRIES).flatMap((entry: unknown) => {
    const item = record(entry);
    if (typeof item.sceneId !== 'string' || !ids.has(item.sceneId)) return [];
    return [{ sceneId: item.sceneId, repeats: Math.round(number(item.repeats, 1, 1, MAX_REPEATS)) }];
  });
  return { entries: entries.length > 0 ? entries : [{ sceneId: scenes[0].id, repeats: 1 }], loop: input.loop === true };
}

export function sanitizeEffects(value: unknown, defaults: EffectsLoopState): EffectsLoopState {
  const state = sanitizeShape(value, defaults);
  state.returns.synth = number(state.returns.synth, defaults.returns.synth, 0, 1);
  state.returns.drums = number(state.returns.drums, defaults.returns.drums, 0, 1);
  state.drive.amount = number(state.drive.amount, defaults.drive.amount, 0, 1);
  state.drive.tone = number(state.drive.tone, defaults.drive.tone, 0, 1);
  state.phaser.rate = number(state.phaser.rate, defaults.phaser.rate, .05, 8);
  state.phaser.depth = number(state.phaser.depth, defaults.phaser.depth, 0, 1);
  state.phaser.feedback = number(state.phaser.feedback, defaults.phaser.feedback, 0, .75);
  state.phaser.mix = number(state.phaser.mix, defaults.phaser.mix, 0, 1);
  state.delay.time = number(state.delay.time, defaults.delay.time, .01, 1.5);
  state.delay.feedback = number(state.delay.feedback, defaults.delay.feedback, 0, .85);
  state.delay.mix = number(state.delay.mix, defaults.delay.mix, 0, 1);
  // Optional, so projects saved before it existed still match the expected shape.
  const sync = record(record(value).delay).sync;
  if (DELAY_SYNCS.includes(sync) && sync !== 'off') state.delay.sync = sync;
  else delete state.delay.sync;
  state.reverb.decay = number(state.reverb.decay, defaults.reverb.decay, .2, 8);
  state.reverb.mix = number(state.reverb.mix, defaults.reverb.mix, 0, 1);
  const raw = record(value), reverb = record(raw.reverb);
  const preDelay = number(reverb.preDelay, 0, 0, MAX_PRE_DELAY), damping = number(reverb.damping, 0, 0, 1);
  if (preDelay > 0) state.reverb.preDelay = preDelay;
  if (damping > 0) state.reverb.damping = damping;
  if (raw.chorus !== null && typeof raw.chorus === 'object') {
    const chorus = record(raw.chorus);
    state.chorus = {
      enabled: chorus.enabled === true, rate: number(chorus.rate, CHORUS_DEFAULT.rate, .05, 8),
      depth: number(chorus.depth, CHORUS_DEFAULT.depth, 0, 1), mix: number(chorus.mix, CHORUS_DEFAULT.mix, 0, 1),
    };
  }
  if (raw.eq !== null && typeof raw.eq === 'object') {
    const eq = record(raw.eq), band = (level: unknown) => number(level, 0, -EQ_RANGE_DB, EQ_RANGE_DB);
    state.eq = { enabled: eq.enabled === true, low: band(eq.low), mid: band(eq.mid), high: band(eq.high) };
  }
  return state;
}

export function sanitizeModelParams(value: unknown): SynthModelParams {
  const input = record(value);
  return { macro1: number(input.macro1, .5, 0, 1), macro2: number(input.macro2, .5, 0, 1), macro3: number(input.macro3, .5, 0, 1), macro4: number(input.macro4, .5, 0, 1) };
}
export const sanitizeKit = (value: unknown) => DRUM_KITS.find(kit => kit.id === value)?.id ?? 'clean-analog';

export function sanitizeSaved(value: unknown, defaults: { synthParams: SynthParameters; drumState: DrumState; effectsLoop: EffectsLoopState; drumFx: { sends: FxSendLevels; returnLevel: number } }): SavedPatternFull | null {
  const input = record(value);
  if (typeof input.id !== 'string' || !input.id || typeof input.name !== 'string' || !input.name.trim() || !Array.isArray(input.steps)) return null;
  const seen = new Set<number>();
  const synths = Array.isArray(input.synths) ? input.synths.flatMap((value: unknown) => {
    const synth = record(value);
    if (!Number.isInteger(synth.id) || synth.id < 1 || synth.id > 3 || seen.has(synth.id) || !Array.isArray(synth.steps)) return [];
    seen.add(synth.id);
    return [{
      id: synth.id, steps: sanitizeSteps(synth.steps), synthParams: sanitizeSynthParams(synth.synthParams, defaults.synthParams),
      synthModelId: normalizeSynthModelId(synth.synthModelId), synthModelParams: sanitizeModelParams(synth.synthModelParams),
      muted: synth.muted === true, solo: synth.solo === true, octaveShift: Math.round(number(synth.octaveShift, 0, -2, 2)),
      keyboardMode: (synth.keyboardMode === 'piano-roll' ? 'piano-roll' : 'keyboard') as 'piano-roll' | 'keyboard',
    }];
  }) : undefined;
  const scenes = sanitizeScenes(input.scenes, defaults.drumState);
  return {
    id: input.id.slice(0, 200), name: input.name.trim().slice(0, 200),
    createdAt: number(input.createdAt, Date.now(), 0, 1e15), updatedAt: number(input.updatedAt, Date.now(), 0, 1e15),
    tempo: number(input.tempo, 120, 20, 400), steps: sanitizeSteps(input.steps),
    synthParams: sanitizeSynthParams(input.synthParams, defaults.synthParams),
    synthModelId: normalizeSynthModelId(input.synthModelId), synthModelParams: sanitizeModelParams(input.synthModelParams),
    drumState: sanitizeDrums(input.drumState, defaults.drumState), drumKitId: sanitizeKit(input.drumKitId),
    drumMasterVolume: number(input.drumMasterVolume, 1, 0, 1), drumSwing: number(input.drumSwing, 0, 0, .75),
    drumFx: {
      sends: sanitizeSends(record(input.drumFx).sends, defaults.drumFx.sends),
      returnLevel: number(record(input.drumFx).returnLevel, defaults.drumFx.returnLevel, 0, 1),
    },
    effectsLoop: sanitizeEffects(input.effectsLoop, defaults.effectsLoop),
    ...(synths?.length ? { synths } : {}),
    ...(scenes ? {
      scenes, song: sanitizeSong(input.song, scenes),
      currentSceneId: scenes.some(scene => scene.id === input.currentSceneId) ? input.currentSceneId : scenes[0].id,
    } : {}),
  };
}
