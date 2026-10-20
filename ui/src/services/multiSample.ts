import { encodeWaveBundle } from './builtInWaves';
import { INSTRUMENT_TYPE } from './sampleStore';
import { MAX_INSTRUMENT_BYTES, type InstrumentImport } from './soundFontImport';

// Several recordings of one instrument, each a note of its own, played as one instrument (roadmap
// 22): a lane plays whichever recording is nearest the note, as the app's own pianos do. Kept in the
// sample store as an instrument, the same kind of sample an imported SoundFont instrument is.

export const MAX_RECORDINGS = 32;
// A recording longer than this is cut short: a note is rarely held longer, and each costs memory.
export const MAX_RECORDING_SECONDS = 30;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// A note's name as the app writes it, C4 being middle C (60).
export const noteLabel = (note: number) => `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;

// The note a file's name says it is: "Piano C4.wav", "harp_a#3", "Cello-Bb2-soft", "Fs5". A letter A
// to G, then a sharp (#, s or ♯) or a flat (b or ♭), then an octave from -1 to 9, standing apart from
// any other letter or figure. Where a name has more than one, the last is taken, since a name
// usually starts with the instrument's. None, for a name that says no note.
export function noteFromName(fileName: string): number | undefined {
  const name = fileName.replace(/\.[a-z0-9]+$/i, '');
  const pattern = /(?:^|[^a-z0-9])([a-g])(#|♯|s|b|♭)?(-1|\d)(?![0-9])/gi;
  let found: number | undefined;
  for (const match of name.matchAll(pattern)) {
    const letter = LETTERS[match[1].toLowerCase()], sign = match[2]?.toLowerCase();
    const shift = sign === '#' || sign === '♯' || sign === 's' ? 1 : sign === 'b' || sign === '♭' ? -1 : 0;
    const note = (Number(match[3]) + 1) * 12 + letter + shift;
    if (note >= 0 && note <= 127) found = note;
  }
  return found;
}

export interface Recording { name: string; data: Float32Array; rate: number }

// A decoded file mixed to one channel and cut to `MAX_RECORDING_SECONDS`.
export function toRecording(name: string, channels: Float32Array[], rate: number): Recording {
  const length = Math.min(channels[0]?.length ?? 0, Math.floor(rate * MAX_RECORDING_SECONDS));
  const data = new Float32Array(length);
  for (const channel of channels) for (let index = 0; index < length; index++) data[index] += channel[index] / channels.length;
  return { name, data, rate };
}

// The recordings as one instrument, each at the note it was given. Two recordings of one note, a
// note out of range, or too much audio to keep, and nothing is made.
export function recordingsInstrument(name: string, recordings: Array<Recording & { note: number }>): InstrumentImport {
  if (!recordings.length) return { ok: false, error: 'There are no recordings to put together.' };
  if (recordings.length > MAX_RECORDINGS) return { ok: false, error: `An instrument can have up to ${MAX_RECORDINGS} recordings.` };
  const notes = new Set<number>();
  for (const recording of recordings) {
    if (!Number.isInteger(recording.note) || recording.note < 0 || recording.note > 127) return { ok: false, error: `“${recording.name}” needs a note.` };
    if (notes.has(recording.note)) return { ok: false, error: `Two recordings are both ${noteLabel(recording.note)}. Give each a note of its own.` };
    if (recording.data.length < 2) return { ok: false, error: `“${recording.name}” has no sound in it.` };
    notes.add(recording.note);
  }
  const bytes = recordings.reduce((sum, recording) => sum + recording.data.length * 2, 0);
  if (bytes > MAX_INSTRUMENT_BYTES) return { ok: false, error: `These recordings are too big to keep in this browser (${Math.round(bytes / 1024 / 1024)} MB; up to ${MAX_INSTRUMENT_BYTES / 1024 / 1024} MB).` };
  const zones = [...recordings].sort((a, b) => a.note - b.note).map(recording => ({ data: recording.data, rate: recording.rate, root: recording.note }));
  const title = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Instrument';
  return { ok: true, file: new File([encodeWaveBundle('instrument', zones)], `${title}.instrument`, { type: INSTRUMENT_TYPE }), loops: false };
}

// What to call an instrument made of these files: the part of their names they share, or the first.
export function instrumentName(fileNames: string[]): string {
  const bare = fileNames.map(name => name.replace(/\.[a-z0-9]+$/i, ''));
  if (!bare.length) return 'Instrument';
  let shared = bare[0];
  for (const name of bare.slice(1)) while (!name.startsWith(shared)) shared = shared.slice(0, -1);
  // What they share may end in the start of a note's name ("Piano C" of C4 and C5), which goes.
  shared = shared.replace(/[\s_\-.]+[a-g](#|♯|s|b|♭)?$/i, '').replace(/[\s_\-.]+$/, '');
  return shared.length >= 2 ? shared : bare[0];
}
