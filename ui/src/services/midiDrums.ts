import type { DrumInstrument } from '../types';
import { DRUM_NOTE_MAP } from '../utils/midiExport';

// The channel drum pads send on unless they are told otherwise, as General MIDI has it.
export const DEFAULT_DRUM_CHANNEL = 10;

// The drums in the order the grid has them.
export const PAD_DRUMS: DrumInstrument[] = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride', 'crash'];

// The note each drum answers to, or null for a drum that has none. A note has one drum and a drum
// one note. It is this browser's, kept between visits like the knob ties, and never the project's:
// a MIDI export goes on writing the General MIDI notes whatever is here.
export type PadMap = Record<DrumInstrument, number | null>;

const KEY = 'discobot_midi_pads_v1';

export const defaultPads = (): PadMap => ({ ...DRUM_NOTE_MAP });

const isNote = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 127;

// A stored map made safe. A drum that is missing or holds something odd has its General MIDI
// note; of two drums given one note the first in the grid keeps it and the other has none.
export function asPadMap(value: unknown): PadMap {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const said = new Set<number>(), pads = {} as PadMap;
  for (const drum of PAD_DRUMS) {
    const note = source[drum];
    if (note !== null && !isNote(note)) continue;
    pads[drum] = note === null || said.has(note) ? null : note;
    if (note !== null) said.add(note);
  }
  for (const drum of PAD_DRUMS) {
    if (drum in pads) continue;
    const note = DRUM_NOTE_MAP[drum];
    pads[drum] = said.has(note) ? null : note;
    said.add(note);
  }
  return pads;
}

export function storedPads(): PadMap {
  try { return asPadMap(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return defaultPads(); }
}

export function storePads(pads: PadMap) {
  try { localStorage.setItem(KEY, JSON.stringify(asPadMap(pads))); } catch { /* the map lasts for this visit */ }
}

// The map with this note given to this drum. The drum that had the note is left with none.
export function withPad(pads: PadMap, drum: DrumInstrument, note: number): PadMap {
  if (!isNote(note) || !PAD_DRUMS.includes(drum)) return pads;
  const next = { ...pads };
  for (const other of PAD_DRUMS) if (next[other] === note) next[other] = null;
  next[drum] = note;
  return next;
}

export const padsAreDefault = (pads: PadMap) => PAD_DRUMS.every(drum => pads[drum] === DRUM_NOTE_MAP[drum]);

// General MIDI drum notes that are not the eight a MIDI export writes, each given to the lane
// nearest to it. A pad controller's sixteen pads (notes 36 to 51) all land somewhere.
const NEIGHBOURS: Record<number, DrumInstrument> = {
  35: 'kick',
  37: 'snare', 40: 'snare',
  41: 'snare2', 43: 'snare2',
  44: 'closedHH',
  47: 'ride', 48: 'ride',
  51: 'crash', 52: 'crash', 53: 'crash', 55: 'crash', 57: 'crash', 59: 'crash',
};
const DEFAULT_PADS = defaultPads();

// The drum lane a pad's note is for, or nothing for a note that is no drum here. A note in the
// map is its drum's. A General MIDI note near a drum's own plays that drum too, but only while
// the drum still has its General MIDI note: a drum that has been given a note by hand answers to
// that note alone, and one whose note was taken answers to nothing.
export function drumForNote(note: number, pads: PadMap = DEFAULT_PADS): DrumInstrument | null {
  if (!isNote(note)) return null;
  const own = PAD_DRUMS.find(drum => pads[drum] === note);
  if (own) return own;
  const near = NEIGHBOURS[note];
  return near && pads[near] === DRUM_NOTE_MAP[near] ? near : null;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// How a pad's note is written in the panel: the number a controller's manual gives, and its name.
export const padNoteLabel = (note: number | null) => note === null ? 'none' : `${note} (${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1})`;

// The channel incoming drum notes are taken from: 1 to 16, or 0 for none.
export function asDrumChannel(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 16 ? value as number : DEFAULT_DRUM_CHANNEL;
}
