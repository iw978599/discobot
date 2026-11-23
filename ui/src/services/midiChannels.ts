// Which part of Discobot each incoming MIDI channel plays, and which channel each part sends on.
// A channel plays one part at most, so a controller switched to channel 2 plays exactly one thing
// (or nothing, and its notes go straight on to the outputs with Thru on). A part is the open lane
// ('open'), a synth lane by its number, or the drums. Kept in this browser, not in the project.
import { MAX_LANES } from './lanes';
import { MIDI_DRUM_CHANNEL, outChannel, type MidiOutChannels } from './midiOutput';

export type MidiPart = 'open' | number | 'drums';
// The channel each part hears, by `String(part)`. A part that is not here hears nothing.
export type MidiInChannels = Partial<Record<string, number>>;

// As before parts had channels of their own: the keyboard on channel 1 plays Synth 1, pads on 10 play the drums.
export const DEFAULT_IN_CHANNELS: MidiInChannels = { 1: 1, drums: MIDI_DRUM_CHANNEL };

const KEY = 'discobot_midi_channels_v1';
const isChannel = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 16;
const PART_KEYS = ['open', ...Array.from({ length: MAX_LANES }, (_, i) => String(i + 1)), 'drums'];

// A stored map made safe: known parts only, real channels only, and no channel held by two parts
// (the first in `PART_KEYS` order keeps it).
export function asMidiInChannels(value: unknown): MidiInChannels {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_IN_CHANNELS };
  const source = value as Record<string, unknown>, kept: MidiInChannels = {}, taken = new Set<number>();
  for (const part of PART_KEYS) {
    const channel = source[part];
    if (!isChannel(channel) || taken.has(channel)) continue;
    taken.add(channel);
    kept[part] = channel;
  }
  return kept;
}

export function asMidiOutChannels(value: unknown): MidiOutChannels {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>, kept: MidiOutChannels = {};
  for (const part of PART_KEYS) {
    if (part === 'open' || !isChannel(source[part])) continue;
    // Only a channel other than the part's usual one is kept.
    if (source[part] !== outChannel({}, part === 'drums' ? 'drums' : Number(part))) kept[part] = source[part] as number;
  }
  return kept;
}

export function storedMidiChannels(): { in: MidiInChannels; out: MidiOutChannels } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { in: { ...DEFAULT_IN_CHANNELS }, out: {} };
    const parsed = JSON.parse(raw);
    return { in: asMidiInChannels(parsed?.in), out: asMidiOutChannels(parsed?.out) };
  } catch { return { in: { ...DEFAULT_IN_CHANNELS }, out: {} }; }
}

export function storeMidiChannels(channels: { in: MidiInChannels; out: MidiOutChannels }) {
  try { localStorage.setItem(KEY, JSON.stringify({ in: asMidiInChannels(channels.in), out: asMidiOutChannels(channels.out) })); } catch { /* kept for this visit */ }
}

export const inChannelOf = (channels: MidiInChannels, part: MidiPart): number => channels[String(part)] ?? 0;

// Gives a part a channel (0 for none). The part that had the channel before is left with none.
export function withInChannel(channels: MidiInChannels, part: MidiPart, channel: number): MidiInChannels {
  const next: MidiInChannels = {};
  for (const [key, held] of Object.entries(channels)) if (key !== String(part) && held !== channel) next[key] = held;
  if (isChannel(channel)) next[String(part)] = channel;
  return asMidiInChannels(next);
}

// When a message last came in on each channel, for the panel's lamps. Read outside React.
export const midiHeardAt = new Map<number, number>();

// The part a channel plays, or null when no part hears it.
export function partOfChannel(channels: MidiInChannels, channel: number): MidiPart | null {
  for (const [key, held] of Object.entries(channels)) {
    if (held !== channel) continue;
    return key === 'open' || key === 'drums' ? key : Number(key);
  }
  return null;
}
