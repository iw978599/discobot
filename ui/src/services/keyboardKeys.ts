const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The keys of the on-screen keyboard from the lowest to the highest, black keys in their places.
export function keyboardNotes(octaves: readonly number[]): string[] {
  return octaves.flatMap(octave => NOTE_NAMES.map(name => `${name}${octave}`));
}

// Where an arrow key, Home or End takes the keyboard along the keys, which are one tab stop.
// Left and right go a semitone, so the black keys are reached too. Returns the note to focus,
// or nothing when the key is not one of these or there is no key that way.
export function keyboardKeyTarget(key: string, notes: readonly string[], from: string): string | null {
  const at = notes.indexOf(from);
  if (at < 0) return null;
  if (key === 'ArrowLeft') return notes[at - 1] ?? null;
  if (key === 'ArrowRight') return notes[at + 1] ?? null;
  if (key === 'Home') return at === 0 ? null : notes[0];
  if (key === 'End') return at === notes.length - 1 ? null : notes[notes.length - 1];
  return null;
}

// On a narrow screen the strip shows `across` of its octaves, starting at octave `at`. Which
// octave it should start at for octave `index` to be on show, moving it no further than needed.
export function octaveOnShow(index: number, at: number, across: number): number {
  if (index < at) return index;
  if (index > at + across - 1) return index - across + 1;
  return at;
}
