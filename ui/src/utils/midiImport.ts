import { Midi } from '@tonejs/midi';
import { stepNotes, withStepNotes } from '../services/noteScheduling';
import { Pattern, SequencerStep, DrumInstrument } from '../types';
import { DRUM_INSTRUMENTS } from '../services/drumKits';

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
  detectedStepCount: number;
}

function quantizeTickToStep(tick: number, ppq: number, stepsPerBar: number): number {
  const ticksPerStep = (ppq * 4) / stepsPerBar;
  return Math.round(tick / ticksPerStep);
}

function detectStepCount(notes: { ticks: number }[], ppq: number): number {
  const sixteenth = ppq / 4;
  return notes.some(note => Math.abs(note.ticks / sixteenth - Math.round(note.ticks / sixteenth)) > .05) ? 32 : 16;
}

// The drum grid is always one bar of sixteenths, whatever resolution the synth lanes use.
function parseDrumTrack(notes: { midi: number; ticks: number; velocity: number }[], ppq: number): DrumImportState {
  const state = Object.fromEntries(DRUM_INSTRUMENTS.map(instrument => [
    instrument, { steps: Array(DRUM_STEPS).fill(false), stepVelocities: Array(DRUM_STEPS).fill(1) },
  ])) as DrumImportState;
  const ticksPerStep = ppq / 4;
  for (const note of notes) {
    const instrument = GM_DRUM_NOTE_MAP[note.midi];
    if (!instrument) continue;
    // Swung hits land late, never early, so bias towards the step they were delayed from.
    const stepIndex = Math.floor(note.ticks / ticksPerStep + 0.2);
    if (stepIndex < 0 || stepIndex >= DRUM_STEPS || state[instrument].steps[stepIndex]) continue;
    state[instrument].steps[stepIndex] = true;
    state[instrument].stepVelocities[stepIndex] = Math.max(0.1, Math.min(1, note.velocity));
  }
  return state;
}

function parseSynthTrack(notes: { midi: number; ticks: number; velocity: number; durationTicks?: number }[], ppq: number): SequencerStep[] {
  const stepCount = detectStepCount(notes, ppq);
  const ticksPerStep = (ppq * 4) / stepCount;
  const steps: SequencerStep[] = Array.from({ length: stepCount }, () => ({ active: false, velocity: 0.7 }));
  for (const note of notes) {
    const stepIndex = quantizeTickToStep(note.ticks, ppq, stepCount);
    if (stepIndex < 0 || stepIndex >= stepCount) continue;
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

  const tracks: MidiImportTrack[] = [];
  for (const track of midi.tracks) {
    const noteOns = track.notes.filter(n => n.velocity > 0);
    if (noteOns.length === 0) continue;

    const name = track.name || `Track ${tracks.length + 1}`;
    const base = { name, noteCount: noteOns.length, channel: track.channel };
    if (track.channel === MIDI_DRUM_CHANNEL) {
      tracks.push({ ...base, drums: parseDrumTrack(noteOns, ppq) });
      continue;
    }
    tracks.push({
      ...base,
      pattern: { id: `midi-import-${Date.now()}-${tracks.length}`, name, steps: parseSynthTrack(noteOns, ppq), tempo: detectedTempo },
    });
  }

  return {
    tracks,
    detectedTempo,
    detectedStepCount: tracks.find(track => track.pattern)?.pattern!.steps.length ?? DRUM_STEPS,
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
