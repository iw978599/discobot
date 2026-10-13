import { parseTarget } from './paramTargets';

// A controller's knob tied to a parameter: which knob (its channel and controller number) and
// which parameter (a name from paramTargets). The ties are this browser's, kept between visits, so
// a controller works the same in every project.
export interface MidiTie {
  channel: number;
  controller: number;
  target: string;
}

const KEY = 'discobot_midi_ties_v1';
export const MAX_MIDI_TIES = 64;

export function asMidiTies(value: unknown): MidiTie[] {
  if (!Array.isArray(value)) return [];
  const ties: MidiTie[] = [];
  for (const entry of value) {
    const tie = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const { channel, controller, target } = tie;
    if (!Number.isInteger(channel) || (channel as number) < 1 || (channel as number) > 16) continue;
    if (!Number.isInteger(controller) || (controller as number) < 0 || (controller as number) > 127) continue;
    if (typeof target !== 'string' || !parseTarget(target)) continue;
    if (ties.some(other => other.channel === channel && other.controller === controller)) continue;
    ties.push({ channel: channel as number, controller: controller as number, target });
    if (ties.length >= MAX_MIDI_TIES) break;
  }
  return ties;
}

export function storedMidiTies(): MidiTie[] {
  try { return asMidiTies(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}

export function storeMidiTies(ties: MidiTie[]) {
  try { localStorage.setItem(KEY, JSON.stringify(asMidiTies(ties))); } catch { /* the ties last for this visit */ }
}

// The ties with this knob given to this parameter. A knob turns one thing and a parameter has one
// knob, so whatever either was tied to before is let go.
export function withTie(ties: MidiTie[], tie: MidiTie): MidiTie[] {
  return asMidiTies([tie, ...ties.filter(other => other.target !== tie.target && !(other.channel === tie.channel && other.controller === tie.controller))]);
}

export const withoutTie = (ties: MidiTie[], target: string) => ties.filter(tie => tie.target !== target);

export function tieFor(ties: MidiTie[], channel: number, controller: number): MidiTie | undefined {
  return ties.find(tie => tie.channel === channel && tie.controller === controller);
}
