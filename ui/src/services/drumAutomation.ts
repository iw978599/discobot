import type { Automation, DrumSettings, DrumTrack } from '../types';
import { DRUM_PARAMS, type ParamRange } from './paramTargets';
import { EXTRA_DRUMS } from '@discobot/engine';
import { DRUM_INSTRUMENTS } from './drumKits';
import { copyBar, resizeBars, resizeEachBar } from './patternLength';

// A drum row's automation (docs/DRUM_AUTOMATION_PLAN.md) is kept beside its steps, as its velocities
// are: for each automated setting, a value for every step of the drum grid or null for a step that
// has none. A hit on a step with a value plays with it in place of the drum's own setting (and so do
// its repeats); a step with none plays the drum's own. Values are held for the step, not ramped. The
// drum's settings are never changed by it. Live playback and export both ask `hitSettings`, so a
// rendered sweep is the one that was heard.

// The settings of a drum that ride on a hit and can be automated: the same names `DrumSettings` has
// and the same ranges the knobs have (`DRUM_PARAMS`). Not humanize, percType or cymbalType.
export const DRUM_AUTOMATABLE: string[] = ['volume', 'tone', 'extra', 'tune', 'pan', 'delaySend', 'reverbSend'];

type Values = Array<number | null>;

export const drumAutomatedKeys = (automation: Automation | undefined): string[] => DRUM_AUTOMATABLE.filter(key => automation?.[key]?.some(value => value !== null));
export const hasDrumAutomation = (automation: Automation | undefined): boolean => drumAutomatedKeys(automation).length > 0;

const held = (range: ParamRange, value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(range.min, Math.min(range.max, value));
};

// Automation from storage, a file or an edit: only the settings that can be automated, every value
// inside its knob's range, and each list exactly as long as the steps. A setting left with no value
// is dropped, and with none left the answer is nothing, so a drum without automation is stored as
// it always was.
export function sanitizeDrumAutomation(value: unknown, length: number): Automation | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Automation = {};
  for (const key of DRUM_AUTOMATABLE) {
    const values = Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined;
    if (!Array.isArray(values)) continue;
    const kept = Array.from({ length }, (_, step) => held(DRUM_PARAMS[key], values[step]));
    if (kept.some(entry => entry !== null)) result[key] = kept;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// Every setting's values changed the same way. One left with no value is dropped.
function each(automation: Automation | undefined, change: (values: Values) => Values): Automation | undefined {
  const result: Automation = {};
  for (const key of drumAutomatedKeys(automation)) {
    const values = change(automation![key]);
    if (values.some(value => value !== null)) result[key] = values;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
const none = () => null;

// The same edits a drum's steps have, made to its automation.
export const resizeDrumAutomationBars = (automation: Automation | undefined, perBar: number, bars: number) => each(automation, values => resizeBars(values, perBar, bars, none));
export const resizeDrumAutomationEachBar = (automation: Automation | undefined, perBar: number, nextPerBar: number) => each(automation, values => resizeEachBar(values, perBar, nextPerBar, none));
export const copyDrumAutomationBar = (automation: Automation | undefined, perBar: number, from: number, to: number[]) => each(automation, values => copyBar(values, perBar, from, to));
// Laid along another length, going round again or stopping short, as a drum's steps are when copied to a scene.
export const layDrumAutomationAlong = (automation: Automation | undefined, length: number) =>
  each(automation, values => Array.from({ length }, (_, step) => values[step % values.length] ?? null));
// Steps moved within one bar: step `base + column` takes what was at `base + sourceFor(column)`.
export const rearrangeDrumAutomation = (automation: Automation | undefined, base: number, perBar: number, sourceFor: (column: number) => number) =>
  each(automation, values => values.map((value, step) => (step >= base && step < base + perBar ? values[base + sourceFor(step - base)] ?? null : value)));

// Some steps of one setting given values (one for each step named), or taken off them with null. A
// value is held to the knob's range. An unknown setting changes nothing.
export function withDrumAutomationValues(automation: Automation | undefined, key: string, steps: number[], values: Values, length: number): Automation | undefined {
  if (!DRUM_AUTOMATABLE.includes(key)) return automation;
  const list = Array.from({ length }, (_, step) => automation?.[key]?.[step] ?? null);
  steps.forEach((step, index) => { if (Number.isInteger(step) && step >= 0 && step < length) list[step] = held(DRUM_PARAMS[key], values[index]); });
  const { [key]: _old, ...rest } = automation ?? {};
  const next = list.some(entry => entry !== null) ? { ...rest, [key]: list } : rest;
  return Object.keys(next).length > 0 ? next : undefined;
}

// A setting's automation taken away altogether.
export function withoutDrumAutomation(automation: Automation | undefined, key: string): Automation | undefined {
  const { [key]: _gone, ...rest } = automation ?? {};
  return Object.keys(rest).length > 0 ? rest : undefined;
}

// What a hit on this step plays with: the drum's settings, with the step's automated values over
// them, and `heldValues` (what a person is recording right now) over those. The track's own
// settings are handed back as they are when there is nothing to put over them.
export function hitSettings(track: Pick<DrumTrack, 'settings' | 'stepAutomation'>, step: number, heldValues?: Record<string, number>): DrumSettings {
  let settings = track.settings;
  for (const key of DRUM_AUTOMATABLE) {
    const value = heldValues?.[key] ?? track.stepAutomation?.[key]?.[step];
    if (typeof value === 'number') settings = { ...settings, [key]: value };
  }
  return settings;
}

// Where a pass of Auto recording on a drum is kept among the lanes' (`autoPassRef`, which is keyed by a
// lane's number): below zero, so that the places never meet, and every pass is ended together.
export const drumPassKey = (row: string): number => -1 - ([...DRUM_INSTRUMENTS, ...EXTRA_DRUMS] as string[]).indexOf(row);

// What a setting is when the drum has not set it, which is what a knob shows.
const RESTING: Record<string, number> = { tune: 0, pan: 0, delaySend: 1, reverbSend: 1 };

// A change to a drum's settings, as a knob sends it, split in two: the automatable settings it moves
// away from where the drum has them (`moved`), and the rest of the change (`rest`), or null when
// there is none. With nothing moved the change is all rest.
export function splitDrumAutomated(patch: Partial<DrumSettings>, settings: DrumSettings): { moved: Record<string, number>; rest: Partial<DrumSettings> | null } {
  const moved: Record<string, number> = {}, rest: Record<string, unknown> = { ...patch };
  for (const key of DRUM_AUTOMATABLE) {
    const value = (patch as Record<string, unknown>)[key], current = (settings as unknown as Record<string, number | undefined>)[key] ?? RESTING[key];
    if (typeof value === 'number' && Number.isFinite(value) && value !== current) moved[key] = value;
  }
  if (Object.keys(moved).length > 0) for (const key of DRUM_AUTOMATABLE) delete rest[key];
  return { moved, rest: Object.keys(rest).length > 0 ? rest as Partial<DrumSettings> : null };
}
