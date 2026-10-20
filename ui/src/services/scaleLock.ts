import { noteNameToMidi, transposeNote } from '../utils/midiExport';
import { RANDOM_KEYS, RANDOM_SCALES, asRandomChoice, storeRandomChoice, storedRandomChoice, type RandomChoice } from './randomize';

// The scale lock (roadmap 16): one key and scale for the whole studio, the one Randomize uses, and
// whether the keys are held to it. With the lock on, a key played by hand (the on-screen keys, the
// computer keyboard, MIDI) sounds as the nearest note of the scale, the piano roll and the keyboard
// mark the notes outside it and the roll takes no new note there, and the chord menu has chords
// made of the scale's own notes. Like Randomize's key and scale, it is this browser's, not the
// project's: how the tools are being used, not part of the song.

const LOCK_KEY = 'discobot_scale_lock_v1';

export interface ScaleLock extends RandomChoice { locked: boolean }

const readLocked = () => { try { return localStorage.getItem(LOCK_KEY) === 'on'; } catch { return false; } };
let state: ScaleLock = { ...storedRandomChoice(), locked: readLocked() };
const listeners = new Set<() => void>();

export const scaleLock = {
  // The same object until something changes, as useSyncExternalStore needs.
  get: (): ScaleLock => state,
  choose(next: Partial<RandomChoice>) {
    const choice = asRandomChoice({ key: state.key, scale: state.scale, ...next });
    state = { ...choice, locked: state.locked };
    storeRandomChoice(choice);
    listeners.forEach(listener => listener());
  },
  setLocked(locked: boolean) {
    state = { ...state, locked };
    try { localStorage.setItem(LOCK_KEY, locked ? 'on' : 'off'); } catch { /* for this visit only */ }
    listeners.forEach(listener => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

const degrees = (choice: RandomChoice) => RANDOM_SCALES[choice.scale].notes.map(semitones => (RANDOM_KEYS.indexOf(choice.key) + semitones) % 12);

// Whether a note (`C#4`) is one of the scale's. A name that is not a note is not.
export function inScale(note: string, choice: RandomChoice): boolean {
  const midi = noteNameToMidi(note);
  return midi !== null && degrees(choice).includes(((midi % 12) + 12) % 12);
}

// The note of the scale nearest to `note`, the lower of two as near; the note itself if it is in
// the scale or is not a note.
export function toScale(note: string, choice: RandomChoice): string {
  const midi = noteNameToMidi(note);
  if (midi === null || inScale(note, choice)) return note;
  for (let distance = 1; distance < 12; distance++) {
    for (const way of [-1, 1]) {
      const next = transposeNote(note, way * distance);
      if (next && inScale(next, choice)) return next;
    }
  }
  return note;
}

// A chord of the scale's own notes on `root` (moved into the scale first): every other note of the
// scale upwards, three of them or four. In a pentatonic scale that is wider than a plain triad.
export function keyChord(root: string, choice: RandomChoice, size: 3 | 4): string[] {
  const start = toScale(root, choice);
  const midi = noteNameToMidi(start);
  if (midi === null) return [root];
  const ladder: string[] = [];
  for (let up = 0; ladder.length < size * 2 && up < 48; up++) {
    const note = transposeNote(start, up);
    if (note && inScale(note, choice)) ladder.push(note);
  }
  return ladder.filter((_, index) => index % 2 === 0).slice(0, size);
}
