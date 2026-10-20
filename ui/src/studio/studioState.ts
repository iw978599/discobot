// What useStudio keeps at module level: the shapes of its state, the defaults, and pure helpers
// that copy and tidy what the store hands it. Split out of useStudio.tsx.
import { Pattern, SynthParameters, DrumState, DrumInstrument, DrumKitId, EffectsLoopState, FxSendLevels, SynthModelId, SynthModelParams, TimeSignature } from '../types';
import { createDefaultSynthParameters } from '@discobot/engine';
import { DRUM_INSTRUMENTS, DRUM_SETTINGS_DEFAULT } from '../services/drumKits';
import { DRUM_FX_DEFAULT, EFFECTS_DEFAULT } from '../services/effectSettings';
import { sanitizeSynthParams } from '../services/projectSanitization';
import type { PresetKind } from '../services/presetKinds';
import { getAudioContext } from '../hooks/browserAudio';
import { normalizeSynthModelId, normalizeSynthModelParams } from '../synthModels';

export const DEFAULT_PARAMS: SynthParameters = createDefaultSynthParameters();

export const DEFAULT_DRUM_FX = DRUM_FX_DEFAULT;
export const DEFAULT_EFFECTS_LOOP = EFFECTS_DEFAULT;

export const DEFAULT_DRUM_KIT_ID: DrumKitId = 'clean-analog';
// How far ahead of its sound a step light may be lit. The scheduler always works this far ahead.
export const STEP_LIGHT_AHEAD = 0.1;
// MIDI keys pressed within this long of each other are one chord.
export const CHORD_WINDOW_MS = 60;

export interface SynthPreset {
  id: string;
  name: string;
  // What the preset is for. Built-in presets all have one; a person's own do not.
  kind?: PresetKind;
  params: SynthParameters;
  modelId: SynthModelId;
  modelParams: SynthModelParams;
  builtIn?: boolean;
}

export type PlayMode = 'pattern' | 'song';

// A scene's length in bars (the open one's from its live lanes) and its time signature.
export interface SceneInfo { bars: number; signature: TimeSignature | undefined; tempo?: number }
// What a unit that has `sceneInfo` hands the song helpers in place of the studio's functions.
export const sceneLengthIn = (info: Record<string, SceneInfo>) => (sceneId: string) => info[sceneId]?.bars ?? 1;
export const sceneSignatureIn = (info: Record<string, SceneInfo>) => (sceneId: string) => info[sceneId]?.signature;
export const sceneTempoIn = (info: Record<string, SceneInfo>) => (sceneId: string) => info[sceneId]?.tempo;

export interface SynthState {
  id: number;
  pattern: Pattern | null;
  patterns: Pattern[];
  synthParams: SynthParameters | null;
  synthModelId: SynthModelId;
  synthModelParams: SynthModelParams;
  isPlaying: boolean;
  selectedStep: number | null;
  keyboardMode: 'keyboard' | 'piano-roll';
  stepRecordPointer: number;
  octaveShift: number;
  muted: boolean;
  solo: boolean;
  swing?: boolean;
  name?: string;
  preset?: string;
  forceReleaseSignal: boolean;
}

export function createDefaultDrumState(): DrumState {
  return Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [
    instrument, { steps: new Array(16).fill(false), settings: { ...DRUM_SETTINGS_DEFAULT[instrument] }, muted: false, solo: false },
  ])) as unknown as DrumState;
}

export function clonePattern(pattern: Pattern): Pattern {
  return {
    ...pattern,
    steps: pattern.steps.map((step) => ({ ...step })),
  };
}

export function cloneDrumState(state: DrumState): DrumState {
  return Object.fromEntries(
    (Object.keys(state) as DrumInstrument[]).map((instrument) => [
      instrument,
      {
        ...state[instrument],
        settings: { ...state[instrument].settings },
        steps: [...state[instrument].steps],
        stepVelocities: state[instrument].stepVelocities ? [...state[instrument].stepVelocities!] : undefined,
        stepProbabilities: state[instrument].stepProbabilities ? [...state[instrument].stepProbabilities!] : undefined,
        stepRatchets: state[instrument].stepRatchets ? [...state[instrument].stepRatchets!] : undefined,
      },
    ])
  ) as DrumState;
}

export function cloneSynthParams(params: SynthParameters | null): SynthParameters | null {
  return params ? structuredClone(params) : null;
}

export function cloneSynthModelParams(params: SynthModelParams | null | undefined): SynthModelParams {
  const normalized = normalizeSynthModelParams(params);
  return {
    macro1: normalized.macro1,
    macro2: normalized.macro2,
    macro3: normalized.macro3,
    macro4: normalized.macro4,
  };
}

// User presets from browser storage or a project file; anything malformed is dropped.
export function parseUserPresets(value: unknown): SynthPreset[] {
  if (!Array.isArray(value)) return [];
  const parsed = value as Array<{
    id: string;
    name: string;
    params: SynthParameters;
    modelId?: SynthModelId;
    modelParams?: SynthModelParams;
  }>;
  return parsed
    .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && entry.params)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      // Presets saved before a parameter existed take its default instead of inheriting the lane's value.
      params: sanitizeSynthParams(entry.params, DEFAULT_PARAMS),
      modelId: normalizeSynthModelId(entry.modelId),
      modelParams: cloneSynthModelParams(entry.modelParams),
    }));
}

export function normalizeFxSends(sends: Partial<FxSendLevels> | undefined): FxSendLevels {
  return {
    reverb: Math.max(0, Math.min(1, sends?.reverb ?? DEFAULT_DRUM_FX.sends.reverb)),
    delay: Math.max(0, Math.min(1, sends?.delay ?? DEFAULT_DRUM_FX.sends.delay)),
    drive: Math.max(0, Math.min(1, sends?.drive ?? DEFAULT_DRUM_FX.sends.drive)),
    phaser: Math.max(0, Math.min(1, sends?.phaser ?? DEFAULT_DRUM_FX.sends.phaser)),
    chorus: Math.max(0, Math.min(1, sends?.chorus ?? 0)),
    // Always present here, so a send brought back to nothing reaches the store, which keeps no key for it.
    auxA: Math.max(0, Math.min(1, sends?.auxA ?? 0)),
    auxB: Math.max(0, Math.min(1, sends?.auxB ?? 0)),
  };
}

export function normalizeSynthParams(params: SynthParameters | null): SynthParameters | null {
  if (!params) return null;
  const allowedArpModes: SynthParameters['arpeggiator']['mode'][] = ['up', 'down', 'updown', 'downup', 'random', 'converge', 'diverge'];
  const allowedArpRates: SynthParameters['arpeggiator']['rate'][] = ['1/4', '1/8', '1/16', '1/32'];
  const mode = allowedArpModes.includes(params.arpeggiator?.mode as SynthParameters['arpeggiator']['mode'])
    ? params.arpeggiator.mode
    : DEFAULT_PARAMS.arpeggiator.mode;
  const rate = allowedArpRates.includes(params.arpeggiator?.rate as SynthParameters['arpeggiator']['rate'])
    ? params.arpeggiator.rate
    : DEFAULT_PARAMS.arpeggiator.rate;
  return {
    ...params,
    fxReturn: Math.max(0, Math.min(1, params.fxReturn ?? DEFAULT_PARAMS.fxReturn)),
    arpeggiator: {
      enabled: params.arpeggiator?.enabled ?? DEFAULT_PARAMS.arpeggiator.enabled,
      mode,
      rate,
      gate: Math.max(0.1, Math.min(1, params.arpeggiator?.gate ?? DEFAULT_PARAMS.arpeggiator.gate)),
      // Always present here, so choosing Auto reaches the store instead of being merged away.
      octaves: params.arpeggiator?.octaves ?? 0,
    },
    fxSends: normalizeFxSends(params.fxSends),
  };
}

export function normalizeDrumFx(fx: { sends?: Partial<FxSendLevels>; returnLevel?: number } | undefined) {
  return {
    sends: normalizeFxSends(fx?.sends),
    returnLevel: Math.max(0, Math.min(1, fx?.returnLevel ?? DEFAULT_DRUM_FX.returnLevel)),
  };
}

export function normalizeEffectsLoop(loop: Partial<EffectsLoopState> | undefined): EffectsLoopState {
  return {
    enabled: loop?.enabled ?? DEFAULT_EFFECTS_LOOP.enabled,
    returns: {
      synth: Math.max(0, Math.min(1, loop?.returns?.synth ?? DEFAULT_EFFECTS_LOOP.returns.synth)),
      drums: Math.max(0, Math.min(1, loop?.returns?.drums ?? DEFAULT_EFFECTS_LOOP.returns.drums)),
    },
    drive: {
      enabled: loop?.drive?.enabled ?? DEFAULT_EFFECTS_LOOP.drive.enabled,
      amount: Math.max(0, Math.min(1, loop?.drive?.amount ?? DEFAULT_EFFECTS_LOOP.drive.amount)),
      tone: Math.max(0, Math.min(1, loop?.drive?.tone ?? DEFAULT_EFFECTS_LOOP.drive.tone)),
      // Always present, so going back to Classic reaches the store, which keeps Classic as nothing.
      kind: (loop?.drive?.kind ?? 'classic') as EffectsLoopState['drive']['kind'],
    },
    phaser: {
      enabled: loop?.phaser?.enabled ?? DEFAULT_EFFECTS_LOOP.phaser.enabled,
      rate: Math.max(0.05, Math.min(8, loop?.phaser?.rate ?? DEFAULT_EFFECTS_LOOP.phaser.rate)),
      depth: Math.max(0, Math.min(1, loop?.phaser?.depth ?? DEFAULT_EFFECTS_LOOP.phaser.depth)),
      feedback: Math.max(0, Math.min(0.95, loop?.phaser?.feedback ?? DEFAULT_EFFECTS_LOOP.phaser.feedback)),
      mix: Math.max(0, Math.min(1, loop?.phaser?.mix ?? DEFAULT_EFFECTS_LOOP.phaser.mix)),
      // Always present here, like the delay's, so turning sync off reaches the store.
      sync: loop?.phaser?.sync ?? 'off',
    },
    delay: {
      enabled: loop?.delay?.enabled ?? DEFAULT_EFFECTS_LOOP.delay.enabled,
      time: Math.max(0.01, Math.min(1.5, loop?.delay?.time ?? DEFAULT_EFFECTS_LOOP.delay.time)),
      feedback: Math.max(0, Math.min(0.95, loop?.delay?.feedback ?? DEFAULT_EFFECTS_LOOP.delay.feedback)),
      mix: Math.max(0, Math.min(1, loop?.delay?.mix ?? DEFAULT_EFFECTS_LOOP.delay.mix)),
      // Always present here, so turning sync off reaches the store instead of being merged away.
      sync: loop?.delay?.sync ?? 'off',
      // The same for the colour and the wow: a 0 is sent, and the store keeps it as nothing.
      color: Math.max(0, Math.min(1, loop?.delay?.color ?? 0)),
      wow: Math.max(0, Math.min(1, loop?.delay?.wow ?? 0)),
    },
    reverb: {
      enabled: loop?.reverb?.enabled ?? DEFAULT_EFFECTS_LOOP.reverb.enabled,
      decay: Math.max(0.2, Math.min(8, loop?.reverb?.decay ?? DEFAULT_EFFECTS_LOOP.reverb.decay)),
      mix: Math.max(0, Math.min(1, loop?.reverb?.mix ?? DEFAULT_EFFECTS_LOOP.reverb.mix)),
      // Always present here, like the delay's sync, so setting them back to zero reaches the store.
      preDelay: loop?.reverb?.preDelay ?? 0,
      damping: loop?.reverb?.damping ?? 0,
      kind: loop?.reverb?.kind ?? 'room',
    },
    // Checked and clamped by the store; passed through as they are.
    ...(loop?.chorus ? { chorus: { ...loop.chorus } } : {}),
    ...(loop?.aux ? { aux: loop.aux.map(bus => ({ ...bus })) } : {}),
    ...(loop?.eq ? { eq: { ...loop.eq } } : {}),
  };
}

// A time on the audio clock as a Web MIDI time stamp, which counts from when the page loaded.
// It is where the sound leaves the speakers, so hardware plays with them and not ahead.
// The audio clock moves in small jumps, so the gap between the two clocks is averaged over
// many readings; otherwise MIDI clock pulses would wobble by a few milliseconds.
let midiClockGap: number | null = null;
export function midiTime(audioTime: number): number {
  const context = getAudioContext();
  const stamp = context.getOutputTimestamp?.();
  const gap = stamp?.contextTime && stamp.performanceTime
    ? stamp.performanceTime - stamp.contextTime * 1000
    : performance.now() - (context.currentTime - (context.outputLatency || 0)) * 1000;
  midiClockGap = midiClockGap === null ? gap : midiClockGap + (gap - midiClockGap) * 0.02;
  return midiClockGap + audioTime * 1000;
}

export function midiNoteToName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = notes[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

// The two clocks are measured afresh when the transport stops.
export function resetMidiClock() { midiClockGap = null; }
