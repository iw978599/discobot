import { Midi } from '@tonejs/midi';
import { stepNotes, withStepNotes } from '../services/noteScheduling';
import { Pattern, SequencerStep, DrumInstrument } from '../types';
import { DRUM_INSTRUMENTS } from '../services/drumKits';
import { BAR_CHOICES, MAX_BARS } from '../services/patternLength';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 'snare2' and 'ride' are the low and high tom lanes. Notes 40 and 51 are what earlier
// versions exported for them, so files made before the change still import correctly.
const GM_DRUM_NOTE_MAP: Record<number, DrumInstrument> = {
  35: 'kick', 36: 'kick', 38: 'snare', 39: 'clap', 42: 'closedHH', 44: 'closedHH', 46: 'openHH',
  41: 'snare2', 43: 'snare2', 45: 'snare2', 40: 'snare2',
  47: 'ride', 48: 'ride', 50: 'ride', 51: 'ride',
  49: 'crash', 57: 'crash',
};

const MIDI_DRUM_CHANNEL = 9;
const DRUM_STEPS = 16;

function midiNoteToName(midi: number): string {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export type DrumImportState = Record<DrumInstrument, { steps: boolean[]; stepVelocities: number[] }>;

export interface MidiImportTrack {
  name: string;
  noteCount: number;
  channel: number;
  // Exactly one of these is set: channel 10 tracks map to the drum grid, the rest to a synth lane.
  pattern?: Pattern;
  drums?: DrumImportState;
}

export interface MidiImportResult {
  tracks: MidiImportTrack[];
  detectedTempo: number;
  // steps in one bar of the first synth track
  detectedStepCount: number;
  // how many bars the file is brought in as: 1, 2, 4 or 8
  bars: number;
  // true when the file is longer than that and the rest was left out
  truncated: boolean;
}

// The pattern length a file of this many ticks needs: the smallest of 1, 2, 4 or 8 bars that holds it.
export function barsFor(lastTick: number, ppq: number): { bars: number; truncated: boolean } {
  const needed = Math.max(1, Math.floor(Math.max(0, lastTick) / (ppq * 4) + 1e-6) + 1);
  return { bars: BAR_CHOICES.find(choice => choice >= needed) ?? MAX_BARS, truncated: needed > MAX_BARS };
}

function quantizeTickToStep(tick: number, ppq: number, stepsPerBar: number): number {
  const ticksPerStep = (ppq * 4) / stepsPerBar;
  return Math.round(tick / ticksPerStep);
}

function detectStepCount(notes: { ticks: number }[], ppq: number): number {
  const sixteenth = ppq / 4;
  return notes.some(note => Math.abs(note.ticks / sixteenth - Math.round(note.ticks / sixteenth)) > .05) ? 32 : 16;
}

// The drum grid is always sixteenths, whatever resolution the synth lanes use.
function parseDrumTrack(notes: { midi: number; ticks: number; velocity: number }[], ppq: number, bars: number): DrumImportState {
  const count = DRUM_STEPS * bars;
  const state = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [
    instrument, { steps: Array(count).fill(false), stepVelocities: Array(count).fill(1) },
  ])) as DrumImportState;
  const ticksPerStep = ppq / 4;
  for (const note of notes) {
    const instrument = GM_DRUM_NOTE_MAP[note.midi];
    if (!instrument) continue;
    // Swung hits land late, never early, so bias towards the step they were delayed from.
    const stepIndex = Math.floor(note.ticks / ticksPerStep + 0.2);
    if (stepIndex < 0 || stepIndex >= count || state[instrument].steps[stepIndex]) continue;
    state[instrument].steps[stepIndex] = true;
    state[instrument].stepVelocities[stepIndex] = Math.max(0.1, Math.min(1, note.velocity));
  }
  return state;
}

function parseSynthTrack(notes: { midi: number; ticks: number; velocity: number; durationTicks?: number }[], ppq: number, bars: number): SequencerStep[] {
  const perBar = detectStepCount(notes, ppq);
  const stepCount = perBar * bars;
  const ticksPerStep = (ppq * 4) / perBar;
  const steps: SequencerStep[] = Array.from({ length: stepCount }, () => ({ active: false, velocity: 0.7 }));
  for (const note of notes) {
    // A note close to a step lands on it. One clearly between two steps keeps its place,
    // as a late start on the step before.
    const position = note.ticks / ticksPerStep, nearest = Math.round(position);
    const between = Math.abs(position - nearest) >= 0.2;
    const stepIndex = between ? Math.floor(position) : quantizeTickToStep(note.ticks, ppq, perBar);
    if (stepIndex < 0 || stepIndex >= stepCount) continue;
    const offset = between ? Math.round((position - stepIndex) * 12) / 12 : 0;
    const existing = steps[stepIndex];
    // Notes that start together are a chord; the step takes the first one's velocity and length.
    if (existing.active) {
      steps[stepIndex] = withStepNotes(existing, [...stepNotes(existing), midiNoteToName(note.midi)]);
      continue;
    }
    const length = Math.max(1, Math.min(stepCount - stepIndex, Math.round((note.durationTicks ?? 0) / ticksPerStep)));
    steps[stepIndex] = {
      active: true,
      note: midiNoteToName(note.midi),
      velocity: Math.max(0.1, Math.min(1, note.velocity)),
      ...(length > 1 ? { length } : {}),
      ...(offset > 0 ? { offset } : {}),
    };
  }
  return steps;
}

export function importMidiFile(buffer: ArrayBuffer): MidiImportResult {
  const midi = new Midi(buffer);
  const ppq = midi.header.ppq;
  const detectedTempo = Math.max(20, Math.min(400, midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm)
    : 120));

  // Every track is brought in at the same length, so the lanes and the drums stay together.
  const lastTick = Math.max(0, ...midi.tracks.flatMap(track => track.notes.filter(n => n.velocity > 0).map(n => n.ticks)));
  const { bars, truncated } = barsFor(lastTick, ppq);

  const tracks: MidiImportTrack[] = [];
  for (const track of midi.tracks) {
    const noteOns = track.notes.filter(n => n.velocity > 0);
    if (noteOns.length === 0) continue;

    const name = track.name || `Track ${tracks.length + 1}`;
    const base = { name, noteCount: noteOns.length, channel: track.channel };
    if (track.channel === MIDI_DRUM_CHANNEL) {
      tracks.push({ ...base, drums: parseDrumTrack(noteOns, ppq, bars) });
      continue;
    }
    tracks.push({
      ...base,
      pattern: { id: `midi-import-${Date.now()}-${tracks.length}`, name, steps: parseSynthTrack(noteOns, ppq, bars), tempo: detectedTempo, ...(bars > 1 ? { bars } : {}) },
    });
  }

  return {
    tracks,
    detectedTempo,
    detectedStepCount: (tracks.find(track => track.pattern)?.pattern!.steps.length ?? DRUM_STEPS * bars) / bars,
    bars,
    truncated,
  };
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
