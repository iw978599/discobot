import { DrumInstrument, DrumState, Pattern } from '../types';

interface MidiSynthLane {
  id: number;
  pattern: Pattern;
}

interface MidiExportPayload {
  tempo: number;
  synthLanes: MidiSynthLane[];
  drumState: DrumState;
}

interface MidiEvent {
  tick: number;
  data: number[];
}

const PPQ = 480;
const TICKS_PER_STEP = PPQ / 4;
const DEFAULT_SYNTH_VELOCITY = 96;
const DRUM_CHANNEL = 9;

const DRUM_NOTE_MAP: Record<DrumInstrument, number> = {
  kick: 36,
  snare: 38,
  openHH: 46,
  closedHH: 42,
  ride: 51,
  crash: 49,
  snare2: 40,
  clap: 39,
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function encodeVlq(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function writeU16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function writeU32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function textMetaEvent(tick: number, text: string): MidiEvent {
  const encoder = new TextEncoder();
  const payload = Array.from(encoder.encode(text));
  return { tick, data: [0xff, 0x03, ...encodeVlq(payload.length), ...payload] };
}

const midiNoteToName = (midi: number): string => {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
};

const noteNameToMidi = (note: string): number | null => {
  const normalized = note.trim().toUpperCase();
  const match = normalized.match(/^([A-G])(#?)(-?\d+)$/);
  if (!match) return null;
  const [, letter, sharp, octaveRaw] = match;
  const base = `${letter}${sharp}`;
  const semitone = NOTE_NAMES.indexOf(base);
  if (semitone < 0) return null;
  const octave = Number.parseInt(octaveRaw, 10);
  if (!Number.isFinite(octave)) return null;
  const midi = (octave + 1) * 12 + semitone;
  if (midi < 0 || midi > 127) return null;
  return midi;
};

function sortEvents(a: MidiEvent, b: MidiEvent): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  const aIsOff = (a.data[0] & 0xf0) === 0x80 || ((a.data[0] & 0xf0) === 0x90 && a.data[2] === 0);
  const bIsOff = (b.data[0] & 0xf0) === 0x80 || ((b.data[0] & 0xf0) === 0x90 && b.data[2] === 0);
  if (aIsOff === bIsOff) return 0;
  return aIsOff ? -1 : 1;
}

function encodeTrack(events: MidiEvent[]): number[] {
  const sorted = [...events].sort(sortEvents);
  let lastTick = 0;
  const out: number[] = [];
  for (const event of sorted) {
    const delta = Math.max(0, event.tick - lastTick);
    out.push(...encodeVlq(delta), ...event.data);
    lastTick = event.tick;
  }
  out.push(0x00, 0xff, 0x2f, 0x00);
  return out;
}

function makeTrackChunk(encodedTrack: number[]): number[] {
  return [
    0x4d, 0x54, 0x72, 0x6b,
    ...writeU32(encodedTrack.length),
    ...encodedTrack,
  ];
}

function clampVelocity(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(127, Math.round(value)));
}

function buildTempoTrack(tempo: number): number[] {
  const safeTempo = Math.max(20, Math.min(400, Math.round(tempo)));
  const mpqn = Math.round(60000000 / safeTempo);
  const events: MidiEvent[] = [
    textMetaEvent(0, 'Discobot MIDI Export'),
    { tick: 0, data: [0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff] },
    { tick: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ];
  return makeTrackChunk(encodeTrack(events));
}

function buildSynthTrack(lane: MidiSynthLane, channel: number): number[] {
  const events: MidiEvent[] = [textMetaEvent(0, `Synth ${lane.id}`)];
  for (let stepIndex = 0; stepIndex < lane.pattern.steps.length; stepIndex += 1) {
    const step = lane.pattern.steps[stepIndex];
    if (!step.note) continue;
    const midiNote = noteNameToMidi(step.note);
    if (midiNote === null) continue;
    const tick = stepIndex * TICKS_PER_STEP;
    const velocity = clampVelocity(step.velocity * 127, DEFAULT_SYNTH_VELOCITY);
    const noteOnStatus = 0x90 | (channel & 0x0f);
    const noteOffStatus = 0x80 | (channel & 0x0f);
    events.push({ tick, data: [noteOnStatus, midiNote, velocity] });
    events.push({ tick: tick + Math.max(1, Math.round(TICKS_PER_STEP * 0.92)), data: [noteOffStatus, midiNote, 0] });
  }
  return makeTrackChunk(encodeTrack(events));
}

function buildDrumTrack(drumState: DrumState): number[] {
  const events: MidiEvent[] = [textMetaEvent(0, 'Drums (GM ch10)')];
  for (const [instrument, note] of Object.entries(DRUM_NOTE_MAP) as Array<[DrumInstrument, number]>) {
    const track = drumState[instrument];
    if (!track) continue;
    const velocity = clampVelocity(track.settings.volume * 127, 100);
    for (let stepIndex = 0; stepIndex < track.steps.length; stepIndex += 1) {
      if (!track.steps[stepIndex]) continue;
      const tick = stepIndex * TICKS_PER_STEP;
      const noteOnStatus = 0x90 | DRUM_CHANNEL;
      const noteOffStatus = 0x80 | DRUM_CHANNEL;
      events.push({ tick, data: [noteOnStatus, note, velocity] });
      events.push({ tick: tick + Math.max(1, Math.round(TICKS_PER_STEP * 0.5)), data: [noteOffStatus, note, 0] });
    }
  }
  return makeTrackChunk(encodeTrack(events));
}

export function createMidiFile(payload: MidiExportPayload): Uint8Array {
  const activeSynths = payload.synthLanes.filter((lane) => lane.pattern.steps.some((step) => Boolean(step.note)));
  const trackChunks: number[][] = [buildTempoTrack(payload.tempo)];

  const nonDrumChannels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  activeSynths.forEach((lane, index) => {
    const channel = nonDrumChannels[index % nonDrumChannels.length];
    trackChunks.push(buildSynthTrack(lane, channel));
  });

  trackChunks.push(buildDrumTrack(payload.drumState));

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    ...writeU32(6),
    ...writeU16(1),
    ...writeU16(trackChunks.length),
    ...writeU16(PPQ),
  ];

  const bytes = new Uint8Array(header.length + trackChunks.reduce((sum, t) => sum + t.length, 0));
  bytes.set(header, 0);
  let offset = header.length;
  for (const chunk of trackChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function downloadMidiFile(payload: MidiExportPayload, fileName: string): void {
  const bytes = createMidiFile(payload);
  const stableBytes = new Uint8Array(Array.from(bytes));
  const blob = new Blob([stableBytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function transposeNote(note: string, semitones: number): string | null {
  const midi = noteNameToMidi(note);
  if (midi === null) return null;
  const shifted = midi + semitones;
  if (shifted < 0 || shifted > 127) return null;
  return midiNoteToName(shifted);
}
