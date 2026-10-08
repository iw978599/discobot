import { Midi } from '@tonejs/midi';
import { Pattern, SequencerStep, DrumInstrument } from '../types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const GM_DRUM_NOTE_MAP: Record<number, DrumInstrument> = {
  36: 'kick', 38: 'snare', 46: 'openHH', 42: 'closedHH',
  51: 'ride', 49: 'crash', 40: 'snare2', 39: 'clap',
};

function midiNoteToName(midi: number): string {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export interface MidiImportResult {
  patterns: Pattern[];
  trackNames: string[];
  trackNoteCounts: number[];
  trackChannels: number[];
  detectedTempo: number;
  detectedStepCount: number;
  drumTracks: Array<{ name: string; noteCount: number; state: Record<DrumInstrument, { steps: boolean[]; stepVelocities: number[] }> }>;
}

function quantizeTickToStep(tick: number, ppq: number, stepsPerBar: number): number {
  const ticksPerStep = (ppq * 4) / stepsPerBar;
  return Math.round(tick / ticksPerStep);
}

function detectStepCount(notes: { ticks: number }[], ppq: number): number {
  const sixteenth = ppq / 4;
  return notes.some(note => Math.abs(note.ticks / sixteenth - Math.round(note.ticks / sixteenth)) > .05) ? 32 : 16;
}

function isDrumTrack(track: any): boolean {
  if (typeof track.channel === 'number') return track.channel === 9;
  return Array.isArray(track.notes) && track.notes.some((n: any) => typeof n?.channel === 'number' && n.channel === 9);
}

function parseDrumTrack(track: { name: string; notes: { midi: number; ticks: number; velocity: number }[] }, ppq: number, stepCount: number) {
  const state: Record<DrumInstrument, { steps: boolean[]; stepVelocities: number[] }> = {} as any;
  const instruments: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
  const ticksPerStep = (ppq * 4) / stepCount;
  for (const inst of instruments) {
    state[inst] = { steps: Array(stepCount).fill(false), stepVelocities: Array(stepCount).fill(1) };
  }
  for (const note of track.notes) {
    if (note.velocity <= 0) continue;
    const inst = GM_DRUM_NOTE_MAP[note.midi];
    if (!inst) continue;
    const stepIndex = Math.round(note.ticks / ticksPerStep);
    if (stepIndex < 0 || stepIndex >= stepCount) continue;
    state[inst].steps[stepIndex] = true;
    state[inst].stepVelocities[stepIndex] = Math.max(0.1, Math.min(1, note.velocity));
  }
  return state;
}

export function importMidiFile(buffer: ArrayBuffer): MidiImportResult {
  const midi = new Midi(buffer);
  const ppq = midi.header.ppq;
  const detectedTempo = Math.max(20, Math.min(400, midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm)
    : 120));

  const trackNames: string[] = [];
  const trackNoteCounts: number[] = [];
  const trackChannels: number[] = [];
  const patterns: Pattern[] = [];
  const drumTracks: MidiImportResult['drumTracks'] = [];

  for (const track of midi.tracks) {
    const noteOns = track.notes.filter(n => n.velocity > 0);
    if (noteOns.length === 0) continue;

    const name = track.name || `Track ${trackNames.length + 1}`;
    const detectedStepCount = detectStepCount(noteOns, ppq);

    if (isDrumTrack(track)) {
      trackNames.push(name);
      trackNoteCounts.push(noteOns.length);
      trackChannels.push(9);
      drumTracks.push({ name, noteCount: noteOns.length, state: parseDrumTrack(track, ppq, detectedStepCount) });
      continue;
    }

    trackNames.push(name);
    trackNoteCounts.push(noteOns.length);
    trackChannels.push(0);

    const steps: SequencerStep[] = Array.from({ length: detectedStepCount }, () => ({
      active: false,
      velocity: 0.7,
    }));

    for (const note of noteOns) {
      const stepIndex = quantizeTickToStep(note.ticks, ppq, detectedStepCount);
      if (stepIndex < 0 || stepIndex >= detectedStepCount) continue;

      if (!steps[stepIndex].active) {
        steps[stepIndex] = {
          active: true,
          note: midiNoteToName(note.midi),
          velocity: Math.max(0.1, Math.min(1, note.velocity)),
        };
      }
    }

    patterns.push({
      id: `midi-import-${Date.now()}-${patterns.length}`,
      name,
      steps,
      tempo: detectedTempo,
    });
  }

  return {
    patterns, trackNames, trackNoteCounts, trackChannels,
    detectedTempo,
    detectedStepCount: patterns[0]?.steps.length || drumTracks[0]?.state.kick.steps.length || 16,
    drumTracks,
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
