/**
 * Shared utility functions for audio synthesis
 */

/**
 * Clamps a value between min and max
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Note name to MIDI semitone mapping
 */
const NOTE_MAP: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1,
  D: 2, 'D#': 3, Eb: 3,
  E: 4,
  F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8,
  A: 9, 'A#': 10, Bb: 10,
  B: 11,
};

/**
 * Converts a note name (e.g., "C4", "A#3") to frequency in Hz
 * @param note - Note name with octave (e.g., "A4" = 440Hz)
 * @returns Frequency in Hz, or 440 if note is invalid
 */
export function noteToFrequency(note: string): number {
  const match = note.match(/^([A-G]#?b?)(-?\d+)$/);
  if (!match) {
    console.warn(`Invalid note format: ${note}, defaulting to A4 (440Hz)`);
    return 440;
  }

  const noteName = match[1];
  const octave = parseInt(match[2], 10);
  const semitone = NOTE_MAP[noteName] ?? 0;

  // A4 = 440Hz is MIDI note 69
  // Formula: frequency = 440 * 2^((midi - 69) / 12)
  const midiNote = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Deep merge two objects, properly handling nested structures
 * @param target - Base object
 * @param source - Object to merge into target
 * @returns New merged object
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  const output = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = output[key];

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        output[key] = deepMerge(targetValue, sourceValue as any);
      } else {
        output[key] = sourceValue as any;
      }
    }
  }

  return output;
}

/**
 * Creates a throttled version of a function that can only be called once per interval
 * @param fn - Function to throttle
 * @param ms - Minimum milliseconds between calls
 * @returns Throttled function
 */
export function throttle(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

/**
 * Validates if a value is a valid tempo (BPM)
 * @param tempo - Value to validate
 * @param min - Minimum allowed BPM (default 20)
 * @param max - Maximum allowed BPM (default 400)
 * @returns True if valid
 */
export function isValidTempo(tempo: unknown, min = 20, max = 400): tempo is number {
  return typeof tempo === 'number' && !isNaN(tempo) && tempo >= min && tempo <= max;
}

/**
 * Validates if a value is a valid velocity (0-1)
 * @param velocity - Value to validate
 * @returns True if valid
 */
export function isValidVelocity(velocity: unknown): velocity is number {
  return typeof velocity === 'number' && !isNaN(velocity) && velocity >= 0 && velocity <= 1;
}
