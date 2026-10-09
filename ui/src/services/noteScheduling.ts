import type { SequencerStep, SynthParameters } from '../types';
import { noteNameToMidi, transposeNote } from '../utils/midiExport';
import { MAX_RATCHET } from './drumScheduling';

// The synth has eight voices; six leaves room for the tail of the chord before.
export const MAX_STEP_NOTES = 6;

// Every note a step plays, lowest first. `note` is always the lowest.
export function stepNotes(step: SequencerStep | undefined): string[] {
  if (!step?.active || !step.note) return [];
  return [...new Set([step.note, ...(step.notes ?? [])])].slice(0, MAX_STEP_NOTES);
}

export const MAX_STEP_OFFSET = 0.95;
// How far into its step a step's notes start, as a fraction of a step.
export const stepOffset = (step: SequencerStep | undefined) => Math.max(0, Math.min(MAX_STEP_OFFSET, step?.offset ?? 0));

// The step with exactly these notes. No notes leaves an empty step.
export function withStepNotes(step: SequencerStep, notes: string[]): SequencerStep {
  const sorted = [...new Set(notes)].sort((a, b) => (noteNameToMidi(a) ?? 0) - (noteNameToMidi(b) ?? 0)).slice(0, MAX_STEP_NOTES);
  const { note: _note, notes: _notes, length, probability, ratchet, offset, ...rest } = step;
  if (sorted.length === 0) return { ...rest, active: false };
  return { ...rest, ...(offset && offset > 0 ? { offset } : {}), ...(probability !== undefined && probability < 1 ? { probability } : {}), ...(ratchet && ratchet > 1 ? { ratchet } : {}), active: true, note: sorted[0], ...(sorted.length > 1 ? { notes: sorted.slice(1) } : {}), ...(length && length > 1 ? { length } : {}) };
}

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

function chordOrder(intervals: number[], mode: string): number[] {
  const up = [...intervals].sort((a, b) => a - b), down = [...up].reverse();
  if (mode === 'down') return down;
  if (mode === 'updown') return up.length > 2 ? [...up, ...down.slice(1, -1)] : up;
  if (mode === 'downup') return up.length > 2 ? [...down, ...up.slice(1, -1)] : down;
  return up;
}

// What one sequencer step (or one live key press) actually plays. Live playback and WAV
// export both call this, so arpeggios and slides come out the same in each.
export function expandStep(
  note: string, params: SynthParameters, windowSeconds: number, tempo: number, slide = false, length = 1, chord?: string[],
): ScheduledNote[] {
  const arp = params.arpeggiator;
  const held = windowSeconds * (Math.max(1, length) - 1);
  if (!arp?.enabled) {
    // A slide holds the gate past the next step so a mono lane glides into it.
    return [{ note, offset: 0, duration: held + (slide ? windowSeconds * 1.1 : Math.max(0.05, windowSeconds * 0.92)) }];
  }
  windowSeconds += held;
  // A chord is arpeggiated through its own notes; a single note through a major chord above it.
  const semitones = chord && chord.length > 1
    ? chordOrder(chord.map(entry => (noteNameToMidi(entry) ?? 0) - (noteNameToMidi(note) ?? 0)), arp.mode)
    : ARP_PATTERNS[arp.mode] ?? ARP_PATTERNS.up;
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

// Everything a step plays: each note of its chord for the step's length, or, with the
// arpeggiator on, the chord's notes one after another.
// `random` decides steps with a chance below 100%. Exports pass a seeded one so a file is repeatable.
export function expandStepNotes(
  step: SequencerStep, params: SynthParameters, windowSeconds: number, tempo: number, random: () => number = Math.random,
): ScheduledNote[] {
  const notes = stepNotes(step);
  if (notes.length === 0) return [];
  const probability = step.probability ?? 1;
  if (probability < 1 && random() >= probability) return [];
  const late = stepOffset(step) * windowSeconds;
  return late > 0 ? onTheStep().map(note => ({ ...note, offset: note.offset + late })) : onTheStep();

  function onTheStep(): ScheduledNote[] {
  if (params.arpeggiator?.enabled) return expandStep(notes[0], params, windowSeconds, tempo, step.slide, step.length, notes);
  const repeats = Math.max(1, Math.min(MAX_RATCHET, Math.round(step.ratchet ?? 1)));
  if (repeats === 1) return notes.flatMap(note => expandStep(note, params, windowSeconds, tempo, step.slide, step.length));
  // Repeats split the step's whole length evenly; only the last one can slide on.
  const span = windowSeconds * Math.max(1, step.length ?? 1) / repeats;
  return Array.from({ length: repeats }, (_, index) => index).flatMap(index => notes.map(note => ({
    note, offset: span * index, duration: step.slide && index === repeats - 1 ? span * 1.1 : Math.max(0.03, span * 0.92),
  })));
  }
}
