import type { DrumInstrument } from '../types';
import { DRUM_INSTRUMENTS } from './drumKits';

// One way of naming a parameter anywhere in the project, so that something outside the screen (a
// controller's knob today, automation later) can say which one it means. A name is a short string:
//   lane:1:cutoff      a synth lane's parameter, by the lane's id
//   lane:open:cutoff   the same parameter on whichever lane is open
//   drum:kick:volume   one drum's setting
//   drums:master       the drums as a whole
//   fx:delay.feedback  a shared effect's setting
//   tempo
// Each has a range, and `fromUnit` turns a position from 0 to 1 (a knob's travel) into a value in it.

export interface ParamRange {
  label: string;
  min: number;
  max: number;
  // a frequency or a time is spread evenly by ratio, not by difference
  curve?: 'log';
  // whole numbers only
  whole?: boolean;
}

// A lane's parameters, and where each is in its sound. `macro` ones are the model's four knobs.
export const LANE_PARAMS: Record<string, ParamRange & { path?: string[]; macro?: 'macro1' | 'macro2' | 'macro3' | 'macro4' }> = {
  macro1: { label: 'Knob 1', min: 0, max: 1, macro: 'macro1' },
  macro2: { label: 'Knob 2', min: 0, max: 1, macro: 'macro2' },
  macro3: { label: 'Knob 3', min: 0, max: 1, macro: 'macro3' },
  macro4: { label: 'Knob 4', min: 0, max: 1, macro: 'macro4' },
  level: { label: 'Level', min: 0, max: 2, path: ['gain'] },
  pan: { label: 'Pan', min: -1, max: 1, path: ['pan'] },
  cutoff: { label: 'Cutoff', min: 20, max: 20000, curve: 'log', path: ['filter', 'frequency'] },
  resonance: { label: 'Resonance', min: 0.1, max: 20, curve: 'log', path: ['filter', 'q'] },
  filterEnv: { label: 'Filter envelope amount', min: -1, max: 1, path: ['filter', 'envAmount'] },
  drive: { label: 'Filter drive', min: 0, max: 1, path: ['filter', 'drive'] },
  attack: { label: 'Attack', min: 0.001, max: 5, curve: 'log', path: ['envelope', 'attack'] },
  decay: { label: 'Decay', min: 0.005, max: 5, curve: 'log', path: ['envelope', 'decay'] },
  sustain: { label: 'Sustain', min: 0, max: 1, path: ['envelope', 'sustain'] },
  release: { label: 'Release', min: 0.005, max: 5, curve: 'log', path: ['envelope', 'release'] },
  lfo1Rate: { label: 'LFO 1 rate', min: 0.1, max: 20, curve: 'log', path: ['lfo1', 'rate'] },
  lfo1Depth: { label: 'LFO 1 depth', min: 0, max: 1, path: ['lfo1', 'depth'] },
  lfo2Rate: { label: 'LFO 2 rate', min: 0.1, max: 20, curve: 'log', path: ['lfo2', 'rate'] },
  lfo2Depth: { label: 'LFO 2 depth', min: 0, max: 1, path: ['lfo2', 'depth'] },
  detune: { label: 'Detune', min: -100, max: 100, whole: true, path: ['oscillator', 'detune'] },
  pulseWidth: { label: 'Pulse width', min: 0.05, max: 0.95, path: ['oscillator', 'pulseWidth'] },
  sub: { label: 'Sub level', min: 0, max: 1, path: ['mixer', 'sub'] },
  noise: { label: 'Noise level', min: 0, max: 1, path: ['mixer', 'noise'] },
  glide: { label: 'Glide', min: 0.001, max: 2, curve: 'log', path: ['portamento', 'glide'] },
  reverbSend: { label: 'Reverb send', min: 0, max: 1, path: ['fxSends', 'reverb'] },
  delaySend: { label: 'Delay send', min: 0, max: 1, path: ['fxSends', 'delay'] },
  chorusSend: { label: 'Chorus send', min: 0, max: 1, path: ['fxSends', 'chorus'] },
  duck: { label: 'Duck', min: 0, max: 1, path: ['duck'] },
};

export const DRUM_PARAMS: Record<string, ParamRange> = {
  volume: { label: 'Volume', min: 0, max: 1 },
  tone: { label: 'Tone', min: 0, max: 1 },
  extra: { label: 'Second knob', min: 0, max: 1 },
  tune: { label: 'Tune', min: -1, max: 1 },
  pan: { label: 'Pan', min: -1, max: 1 },
};

// A shared effect's setting: which effect, and which of its numbers.
export const FX_PARAMS: Record<string, ParamRange> = {
  'drive.amount': { label: 'Drive amount', min: 0, max: 1 },
  'drive.tone': { label: 'Drive tone', min: 0, max: 1 },
  'phaser.rate': { label: 'Phaser rate', min: 0.05, max: 8, curve: 'log' },
  'phaser.depth': { label: 'Phaser depth', min: 0, max: 1 },
  'phaser.mix': { label: 'Phaser mix', min: 0, max: 1 },
  'delay.time': { label: 'Delay time', min: 0.01, max: 1.5, curve: 'log' },
  'delay.feedback': { label: 'Delay feedback', min: 0, max: 0.95 },
  'delay.mix': { label: 'Delay mix', min: 0, max: 1 },
  'reverb.decay': { label: 'Reverb decay', min: 0.2, max: 8, curve: 'log' },
  'reverb.mix': { label: 'Reverb mix', min: 0, max: 1 },
  'returns.synth': { label: 'Synth return', min: 0, max: 1 },
  'returns.drums': { label: 'Drum return', min: 0, max: 1 },
};

const TOP: Record<string, ParamRange> = {
  tempo: { label: 'Tempo', min: 60, max: 180, whole: true },
  'drums:master': { label: 'Drums: master volume', min: 0, max: 1 },
  'drums:swing': { label: 'Drums: swing', min: 0, max: 1 },
};

export type ParsedTarget =
  | { kind: 'lane'; lane: number | 'open'; key: string; range: ParamRange }
  | { kind: 'drum'; instrument: DrumInstrument; key: string; range: ParamRange }
  | { kind: 'fx'; effect: string; field: string; range: ParamRange }
  | { kind: 'tempo' | 'drumsMaster' | 'drumsSwing'; range: ParamRange };

// What a name means, or null for one that names nothing here.
export function parseTarget(id: unknown): ParsedTarget | null {
  if (typeof id !== 'string') return null;
  if (id === 'tempo') return { kind: 'tempo', range: TOP.tempo };
  if (id === 'drums:master') return { kind: 'drumsMaster', range: TOP[id] };
  if (id === 'drums:swing') return { kind: 'drumsSwing', range: TOP[id] };
  const [kind, second, third, extra] = id.split(':');
  if (extra !== undefined) return null;
  if (kind === 'lane' && Object.hasOwnProperty.call(LANE_PARAMS, third ?? '')) {
    const lane = second === 'open' ? 'open' : /^[1-9]$/.test(second ?? '') ? Number(second) : null;
    return lane === null ? null : { kind: 'lane', lane, key: third, range: LANE_PARAMS[third] };
  }
  if (kind === 'drum' && DRUM_INSTRUMENTS.includes(second as DrumInstrument) && Object.hasOwnProperty.call(DRUM_PARAMS, third ?? '')) {
    return { kind: 'drum', instrument: second as DrumInstrument, key: third, range: DRUM_PARAMS[third] };
  }
  if (kind === 'fx' && third === undefined && Object.hasOwnProperty.call(FX_PARAMS, second ?? '')) {
    const [effect, field] = second.split('.');
    return { kind: 'fx', effect, field, range: FX_PARAMS[second] };
  }
  return null;
}

// A value in a parameter's range for a position along a knob's travel, 0 to 1.
export function fromUnit(range: ParamRange, unit: number): number {
  const at = Math.max(0, Math.min(1, Number.isFinite(unit) ? unit : 0));
  const value = range.curve === 'log' ? range.min * (range.max / range.min) ** at : range.min + (range.max - range.min) * at;
  return range.whole ? Math.round(value) : Number(value.toPrecision(6));
}

// The change to a lane's sound that sets one of its parameters: the value at its place, nested as
// the sound is, which is what the store merges.
export function lanePatch(key: string, value: number): Record<string, unknown> | null {
  const path = LANE_PARAMS[key]?.path;
  if (!path) return null;
  return path.reduceRight<unknown>((inner, name) => ({ [name]: inner }), value) as Record<string, unknown>;
}

const DRUM_NAMES: Record<DrumInstrument, string> = {
  kick: 'Kick', snare: 'Snare', clap: 'Clap', closedHH: 'Closed Hat', openHH: 'Open Hat', snare2: 'Low Tom', ride: 'High Tom', crash: 'Cymbal',
};

// Every name there is, in the groups a menu shows them in.
export function listTargets(laneIds: number[]): Array<{ group: string; targets: Array<{ id: string; label: string }> }> {
  const lane = (who: number | 'open', name: string) => ({
    group: name, targets: Object.entries(LANE_PARAMS).map(([key, range]) => ({ id: `lane:${who}:${key}`, label: range.label })),
  });
  return [
    lane('open', 'The open lane'),
    ...laneIds.map(id => lane(id, `Synth ${id}`)),
    { group: 'Drums', targets: [
      { id: 'drums:master', label: 'Master volume' }, { id: 'drums:swing', label: 'Swing' },
      ...DRUM_INSTRUMENTS.flatMap(instrument => Object.entries(DRUM_PARAMS).map(([key, range]) => ({ id: `drum:${instrument}:${key}`, label: `${DRUM_NAMES[instrument]}: ${range.label}` }))),
    ] },
    { group: 'Effects', targets: Object.entries(FX_PARAMS).map(([key, range]) => ({ id: `fx:${key}`, label: range.label })) },
    { group: 'Song', targets: [{ id: 'tempo', label: 'Tempo' }] },
  ];
}

// What a name is called where it is shown by itself.
export function targetLabel(id: string): string {
  const parsed = parseTarget(id);
  if (!parsed) return 'Something this version does not have';
  if (parsed.kind === 'lane') return `${parsed.lane === 'open' ? 'The open lane' : `Synth ${parsed.lane}`}: ${parsed.range.label}`;
  if (parsed.kind === 'drum') return `${DRUM_NAMES[parsed.instrument]}: ${parsed.range.label}`;
  return parsed.range.label;
}
