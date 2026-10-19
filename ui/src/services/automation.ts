import { createDefaultSynthParameters, toVoiceParams, type VoiceParams } from '@discobot/engine';
import type { Automation, FxSendLevels, SynthParameters } from '../types';
import { LANE_PARAMS, type ParamRange } from './paramTargets';
import { copyBar, layAlong, resizeBars, resizeEachBar } from './patternLength';

// A lane's automation is kept with its pattern: for each automated parameter, a value for every
// step or nothing for a step that has none. A step with a value plays the parameter at that
// value from the step's start until the next step; a step with none plays the sound's own
// setting. Values are held for the step, not ramped. Everything here is a plain function: what a
// step plays (the scheduler and the exporter both ask `stepVoiceParams`), and what every edit
// that moves, copies or resizes a lane's steps does to the automation beside them.

// What can be automated: a lane's own numbers that the voice plays, and its sends. A model's four
// macros are not (they are several parameters each), and neither is the duck, which the kick sets.
// The sends are levels in the mixer, outside the voice: they are sent at a step's time on their own
// path (`stepSends`), live and in export alike.
const IN_THE_MIXER = ['duck'];
export const SEND_PARAMS = ['reverbSend', 'delaySend', 'chorusSend', 'auxASend', 'auxBSend'];
export const AUTOMATABLE: string[] = Object.keys(LANE_PARAMS).filter(key => LANE_PARAMS[key].path && !IN_THE_MIXER.includes(key));
// How many of a lane's parameters can have automation at once.
export const MAX_AUTOMATED = 8;

type Values = Array<number | null>;

export const automatedKeys = (automation: Automation | undefined): string[] => AUTOMATABLE.filter(key => automation?.[key]?.some(value => value !== null));
export const hasAutomation = (automation: Automation | undefined): boolean => automatedKeys(automation).length > 0;
// Whether another parameter can be given automation on this lane.
export const canAutomate = (automation: Automation | undefined, key: string): boolean =>
  AUTOMATABLE.includes(key) && (automatedKeys(automation).includes(key) || automatedKeys(automation).length < MAX_AUTOMATED);

const held = (range: ParamRange, value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const inside = Math.max(range.min, Math.min(range.max, value));
  return range.whole ? Math.round(inside) : inside;
};

// Automation from storage, a file or an edit: only parameters that can be automated, no more of
// them than a lane may have, every value inside its parameter's range, and each list exactly as
// long as the pattern. A parameter left with no value at all is dropped, and with none left the
// answer is nothing, so a pattern without automation is stored as it always was.
export function sanitizeAutomation(value: unknown, length: number): Automation | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Automation = {};
  for (const key of AUTOMATABLE) {
    const values = Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined;
    if (!Array.isArray(values) || Object.keys(result).length >= MAX_AUTOMATED) continue;
    const kept = Array.from({ length }, (_, step) => held(LANE_PARAMS[key], values[step]));
    if (kept.some(entry => entry !== null)) result[key] = kept;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// What a pattern write is sent for a lane's automation. The store keeps what it has when none is
// sent, so "none" is sent as an empty list of parameters.
export const sentAutomation = (automation: Automation | undefined): Automation => automation ?? {};

// Every parameter's values changed the same way. One left with no value is dropped.
function each(automation: Automation | undefined, change: (values: Values) => Values): Automation | undefined {
  const result: Automation = {};
  for (const key of automatedKeys(automation)) {
    const values = change(automation![key]);
    if (values.some(value => value !== null)) result[key] = values;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
const none = () => null;

// The same edits a lane's steps have, made to its automation.
// More or fewer bars: growing repeats what is there, shrinking keeps the first bars.
export const resizeAutomationBars = (automation: Automation | undefined, perBar: number, bars: number) => each(automation, values => resizeBars(values, perBar, bars, none));
// A longer or shorter bar (a new time signature, or finer steps): each bar keeps its values from
// its start, loses those past its new end and gains empty steps there.
export const resizeAutomationEachBar = (automation: Automation | undefined, perBar: number, nextPerBar: number) => each(automation, values => resizeEachBar(values, perBar, nextPerBar, none));
// One bar laid over others.
export const copyAutomationBar = (automation: Automation | undefined, perBar: number, from: number, to: number[]) => each(automation, values => copyBar(values, perBar, from, to));
// Laid along another length, going round again or stopping short.
export const layAutomationAlong = (automation: Automation | undefined, length: number) => each(automation, values => layAlong(values, length));
// Held to a length: cut off, or given empty steps at the end.
export const fitAutomation = (automation: Automation | undefined, length: number) => each(automation, values => Array.from({ length }, (_, step) => values[step] ?? null));

// One parameter's value set on some steps of a pattern `length` steps long, or taken off them
// with null. A value is held to the parameter's range. A parameter that is not automated yet is
// not started when the lane already has as many as it may.
export function withAutomationValues(automation: Automation | undefined, key: string, steps: number[], value: number | null, length: number): Automation | undefined {
  if (!AUTOMATABLE.includes(key) || (value !== null && !canAutomate(automation, key))) return automation;
  const kept = value === null ? null : held(LANE_PARAMS[key], value);
  const values = Array.from({ length }, (_, step) => automation?.[key]?.[step] ?? null);
  for (const step of steps) if (Number.isInteger(step) && step >= 0 && step < length) values[step] = kept;
  const { [key]: _old, ...rest } = automation ?? {};
  const next = values.some(entry => entry !== null) ? { ...rest, [key]: values } : rest;
  return Object.keys(next).length > 0 ? next : undefined;
}

// A parameter's automation taken away altogether.
export function withoutAutomation(automation: Automation | undefined, key: string): Automation | undefined {
  const { [key]: _gone, ...rest } = automation ?? {};
  return Object.keys(rest).length > 0 ? rest : undefined;
}

// The values a step has, by parameter. A parameter with none on this step is not in the answer.
export function automationAt(automation: Automation | undefined, step: number): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of automatedKeys(automation)) {
    const value = automation![key][step];
    if (typeof value === 'number') values[key] = value;
  }
  return values;
}

const setAt = (object: unknown, path: string[], value: number): unknown =>
  (path.length === 0 ? value : { ...(object as Record<string, unknown>), [path[0]]: setAt((object as Record<string, unknown> | undefined)?.[path[0]], path.slice(1), value) });

// A sound with some of its parameters at other values. The sound handed in is not changed.
export function withParamValues(params: SynthParameters, values: Record<string, number>): SynthParameters {
  return Object.entries(values).reduce<SynthParameters>((sound, [key, value]) => {
    const path = LANE_PARAMS[key]?.path;
    return path && AUTOMATABLE.includes(key) ? setAt(sound, path, value) as SynthParameters : sound;
  }, params);
}

// The sound a step plays: the lane's own, with the step's automated values over it.
export const automatedParams = (params: SynthParameters, automation: Automation | undefined, step: number): SynthParameters => withParamValues(params, automationAt(automation, step));

// Which of the voice's flat parameters each automatable parameter is, found by moving it from one
// end of its range to the other and seeing what changes.
const voiceKeys = new Map<string, Array<keyof VoiceParams>>();
export function voiceKeysOf(key: string): Array<keyof VoiceParams> {
  let found = voiceKeys.get(key);
  if (!found) {
    const range = LANE_PARAMS[key], sound = createDefaultSynthParameters();
    const low = toVoiceParams(withParamValues(sound, { [key]: range.min })), high = toVoiceParams(withParamValues(sound, { [key]: range.max }));
    found = (Object.keys(low) as Array<keyof VoiceParams>).filter(name => low[name] !== high[name]);
    voiceKeys.set(key, found);
  }
  return found;
}

// What the voice is sent at the start of a step: every automated parameter of the lane, at the
// step's value or, where the step has none, at the sound's own. Null for a lane with no
// automation, which is sent nothing. `held` is values a person is recording right now, which
// play in place of whatever the pattern holds. Live playback and export both ask this, so a
// rendered sweep is the one that was heard.
export function stepVoiceParams(params: SynthParameters, automation: Automation | undefined, step: number, tempo: number, held: Record<string, number> = {}): Partial<VoiceParams> | null {
  const keys = AUTOMATABLE.filter(key => automation?.[key]?.some(value => value !== null) || typeof held[key] === 'number');
  if (keys.length === 0) return null;
  const voice = toVoiceParams(withParamValues(params, { ...automationAt(automation, step), ...held }), tempo) as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.flatMap(key => voiceKeysOf(key)).map(name => [name, voice[name]])) as Partial<VoiceParams>;
}

// A lane's send levels at the start of a step, when any send is automated: each at the step's value
// or, where the step has none, the sound's own. Null when no send is, and the sound's sends stand.
export function stepSends(params: SynthParameters, automation: Automation | undefined, step: number, held: Record<string, number> = {}): FxSendLevels | null {
  if (!SEND_PARAMS.some(key => automation?.[key]?.some(value => value !== null) || typeof held[key] === 'number')) return null;
  return withParamValues(params, { ...automationAt(automation, step), ...held }).fxSends;
}

// What the voice is sent when one step's automated parameters follow another's: the step's own,
// and the sound's own value for any parameter the step before set and this one does not (another
// scene's automation, or automation that has been taken away), so that nothing is left where
// automation put it. Null when there is nothing to send.
export function automationChange(before: Partial<VoiceParams> | null, now: Partial<VoiceParams> | null, sound: VoiceParams): Partial<VoiceParams> | null {
  const left = Object.keys(before ?? {}).filter(name => !now || !(name in now)) as Array<keyof VoiceParams>;
  if (!now && left.length === 0) return null;
  return { ...Object.fromEntries(left.map(name => [name, sound[name]])), ...now } as Partial<VoiceParams>;
}

const leaf = (object: unknown, path: string[]): unknown => path.reduce<unknown>((inner, name) => (inner !== null && typeof inner === 'object' ? (inner as Record<string, unknown>)[name] : undefined), object);

// A change to a lane's sound, as a knob sends it, split in two: the automatable parameters it
// moves away from where the sound has them (`moved`), and the rest of the change with those put
// back (`rest`), or null when nothing else in it differs from the sound. A knob sends the whole
// of the part of the sound it is in, so what moved is found by comparing with the sound. A
// parameter that is not `allowed` (the lane has as many automated as it may) stays in the rest.
export function splitAutomated(patch: unknown, sound: SynthParameters, allowed: (key: string) => boolean = () => true): { moved: Record<string, number>; rest: Record<string, unknown> | null } {
  const moved: Record<string, number> = {};
  let rest = patch as Record<string, unknown>;
  for (const key of AUTOMATABLE) {
    const path = LANE_PARAMS[key].path!, value = leaf(patch, path), current = leaf(sound, path);
    if (typeof value !== 'number' || !Number.isFinite(value) || typeof current !== 'number' || value === current || !allowed(key)) continue;
    moved[key] = value;
    rest = setAt(rest, path, current) as Record<string, unknown>;
  }
  const differs = (part: unknown, from: unknown): boolean => (part !== null && typeof part === 'object' && !Array.isArray(part)
    ? Object.entries(part).some(([name, inner]) => inner !== undefined && differs(inner, (from as Record<string, unknown> | undefined)?.[name]))
    : JSON.stringify(part) !== JSON.stringify(from));
  return { moved, rest: differs(rest, sound) ? rest : null };
}

// The steps from the one after `from` up to and including `to`, going round the end of the
// pattern: what a recording fills when a knob has been still for a while. All of them when the
// pattern has been round once or more since.
export function stepsThrough(from: number, to: number, length: number, wholePass = false): number[] {
  if (length <= 0) return [];
  if (wholePass) return Array.from({ length }, (_, step) => step);
  const count = ((to - from) % length + length) % length;
  return Array.from({ length: count }, (_, index) => (from + 1 + index) % length);
}

// A value as a share of its parameter's range, 0 to 1, the way a knob's travel is: what the
// height of a bar in the strip shows. The other way is `fromUnit` in paramTargets.
export function toUnit(range: ParamRange, value: number): number {
  const inside = Math.max(range.min, Math.min(range.max, value));
  return range.curve === 'log' ? Math.log(inside / range.min) / Math.log(range.max / range.min) : (inside - range.min) / (range.max - range.min);
}

// A value as it is read out beside the strip.
export function describeValue(key: string, value: number): string {
  const range = LANE_PARAMS[key];
  if (range.whole) return `${Math.round(value)}`;
  if (range.max <= 2 && range.min >= -1) return `${Math.round(value * 100)}%`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Number(value.toPrecision(3))}`;
}
