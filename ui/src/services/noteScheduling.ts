import type { SynthParameters } from '../types';
import { transposeNote } from '../utils/midiExport';

export interface ScheduledNote {
  note: string;
  // seconds after the start of the step
  offset: number;
  duration: number;
}

const ARP_PATTERNS: Record<string, number[]> = {
  up: [0, 4, 7, 12],
  down: [12, 7, 4, 0],
  updown: [0, 4, 7, 12, 7, 4],
  downup: [12, 7, 4, 0, 4, 7],
  converge: [0, 12, 4, 7],
  diverge: [7, 4, 12, 0],
  random: [0, 4, 7, 12],
};

// What one sequencer step (or one live key press) actually plays. Live playback and WAV
// export both call this, so arpeggios and slides come out the same in each.
export function expandStep(
  note: string, params: SynthParameters, windowSeconds: number, tempo: number, slide = false,
): ScheduledNote[] {
  const arp = params.arpeggiator;
  if (!arp?.enabled) {
    // A slide holds the gate past the next step so a mono lane glides into it.
    return [{ note, offset: 0, duration: slide ? windowSeconds * 1.1 : Math.max(0.05, windowSeconds * 0.92) }];
  }
  const semitones = ARP_PATTERNS[arp.mode] ?? ARP_PATTERNS.up;
  const divisor = arp.rate === '1/4' ? 1 : arp.rate === '1/8' ? 2 : arp.rate === '1/16' ? 4 : 8;
  const interval = 60 / tempo / divisor;
  const duration = Math.max(0.03, interval * Math.max(0.1, Math.min(1, arp.gate)));
  const pulses = Math.max(1, Math.floor(Math.max(interval, windowSeconds) / interval));
  const notes: ScheduledNote[] = [];
  for (let pulse = 0; pulse < pulses; pulse++) {
    const index = arp.mode === 'random' ? Math.floor(Math.random() * semitones.length) : pulse % semitones.length;
    const transposed = transposeNote(note, semitones[index]);
    if (transposed) notes.push({ note: transposed, offset: interval * pulse, duration });
  }
  return notes;
}
