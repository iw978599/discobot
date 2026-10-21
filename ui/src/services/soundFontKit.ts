import type { DrumInstrument } from '../types';
import { MAX_DRUM_SAMPLE_SECONDS } from './drumSamples';
import { soundFontZones, type SoundFontPreset } from './soundFont';
import { encodeWav } from './wavExport';

// A drum kit from a SoundFont, for the drum lanes (asked for by the owner on 2026-10-20). A kit is a
// preset whose keys are drums, numbered as General MIDI numbers them. Each key of the kit that
// General MIDI names becomes a short audio file, named for its drum, and each lane is offered the
// drum General MIDI has for it; the Import Kit dialog then shows those choices to be changed, and
// nothing is kept until they are confirmed. The font's own envelopes and filters are not taken.

// The drums General MIDI places on keys 35 to 81.
export const GM_DRUMS: Record<number, string> = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare', 39: 'Hand Clap', 40: 'Electric Snare',
  41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom', 44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat',
  47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom', 51: 'Ride Cymbal 1', 52: 'Chinese Cymbal',
  53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap',
  59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga',
  65: 'High Timbale', 66: 'Low Timbale', 67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block',
  77: 'Low Wood Block', 78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle',
};
// Which General MIDI drums suit each lane, the best first. The Low Tom and High Tom lanes are the
// snare2 and ride instruments; the Cymbal lane is crash.
export const LANE_DRUMS: Record<DrumInstrument, number[]> = {
  kick: [36, 35], snare: [38, 40], clap: [39], closedHH: [42, 44], openHH: [46],
  snare2: [45, 43, 41, 47], ride: [48, 50, 47], crash: [49, 57, 55, 52],
};

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keyName = (note: number) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

// Kits first in a list of a font's presets: General MIDI keeps them in bank 128.
export const isKit = (preset: SoundFontPreset) => preset.bank === 128;

export type SoundFontKit = { ok: true; files: File[]; choice: Partial<Record<DrumInstrument, number>> } | { ok: false; error: string };

export function soundFontKit(buffer: ArrayBuffer, preset: SoundFontPreset): SoundFontKit {
  const zones = soundFontZones(buffer, preset.index);
  const files: File[] = [], notes: number[] = [];
  for (const note of Object.keys(GM_DRUMS).map(Number)) {
    const zone = zones.find(entry => (entry.keyLow ?? 0) <= note && note <= (entry.keyHigh ?? 127));
    if (!zone) continue;
    // A recording for one key plays as it is: a kit usually leaves its drums untuned whatever note
    // it calls their root. One spread over several keys is a pitched sound and moves with the key.
    const spread = (zone.keyHigh ?? 127) > (zone.keyLow ?? 0);
    const rate = Math.round(zone.rate * (spread ? 2 ** ((note - zone.root) / 12) : 1));
    const data = zone.data.subarray(0, Math.floor(zone.rate * MAX_DRUM_SAMPLE_SECONDS));
    if (data.length < 2 || rate < 3000 || rate > 192000) continue;
    files.push(new File([encodeWav([data], rate)], `${GM_DRUMS[note]} (${keyName(note)}).wav`, { type: 'audio/wav' }));
    notes.push(note);
  }
  if (!files.length) return { ok: false, error: `“${preset.name}” has no drums on the keys General MIDI uses, so it is not a drum kit this app can read.` };
  const choice: Partial<Record<DrumInstrument, number>> = {};
  for (const [lane, wanted] of Object.entries(LANE_DRUMS) as Array<[DrumInstrument, number[]]>) {
    const found = wanted.map(note => notes.indexOf(note)).find(index => index >= 0);
    if (found !== undefined) choice[lane] = found;
  }
  return { ok: true, files, choice };
}
