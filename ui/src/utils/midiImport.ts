import { Midi } from '@tonejs/midi';
import { Pattern, SequencerStep } from '../types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiNoteToName(midi: number): string {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export interface MidiImportResult {
  patterns: Pattern[];
  trackNames: string[];
  trackNoteCounts: number[];
  detectedTempo: number;
  detectedStepCount: number;
}

function quantizeTickToStep(tick: number, ppq: number, stepsPerBar: number): number {
  const ticksPerStep = (ppq * 4) / stepsPerBar;
  return Math.round(tick / ticksPerStep);
}

function detectStepCount(notes: { ticks: number }[], ppq: number): number {
  if (notes.length === 0) return 16;
  const maxTick = Math.max(...notes.map(n => n.ticks));
  const steps32 = (ppq * 4 * 2) / 32;
  const maxStep32 = Math.ceil(maxTick / steps32);
  return maxStep32 > 16 ? 32 : 16;
}

export function importMidiFile(buffer: ArrayBuffer): MidiImportResult {
  const midi = new Midi(buffer);
  const ppq = midi.header.ppq;
  const detectedTempo = midi.header.tempos.length > 0
    ? Math.round(midi.header.tempos[0].bpm)
    : 120;

  const trackNames: string[] = [];
  const trackNoteCounts: number[] = [];
  const patterns: Pattern[] = [];

  for (const track of midi.tracks) {
    const noteOns = track.notes.filter(n => n.velocity > 0);
    if (noteOns.length === 0) continue;

    const name = track.name || `Track ${patterns.length + 1}`;
    trackNames.push(name);
    trackNoteCounts.push(noteOns.length);

    const detectedStepCount = detectStepCount(noteOns, ppq);
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

  return { patterns, trackNames, trackNoteCounts, detectedTempo, detectedStepCount: patterns[0]?.steps.length || 16 };
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
