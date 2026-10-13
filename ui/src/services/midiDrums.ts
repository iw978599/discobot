import type { DrumInstrument } from '../types';
import { DRUM_NOTE_MAP } from '../utils/midiExport';

// The channel drum pads send on unless they are told otherwise, as General MIDI has it.
export const DEFAULT_DRUM_CHANNEL = 10;

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
const EXPORTED = new Map(Object.entries(DRUM_NOTE_MAP).map(([instrument, note]) => [note, instrument as DrumInstrument]));

// The drum lane a note played on the drum channel is for, or nothing for a note that is no drum here.
// The eight notes a MIDI export writes come back to the lanes they were written from.
export function drumForNote(note: number): DrumInstrument | null {
  return EXPORTED.get(note) ?? NEIGHBOURS[note] ?? null;
}

// The channel incoming drum notes are taken from: 1 to 16, or 0 for none.
export function asDrumChannel(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 16 ? value as number : DEFAULT_DRUM_CHANNEL;
}
