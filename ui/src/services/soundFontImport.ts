import { encodeWaveBundle } from './builtInWaves';
import { INSTRUMENT_TYPE } from './sampleStore';
import { soundFontZones, type SoundFontPreset } from './soundFont';

// Importing one instrument (a preset) of a SoundFont (roadmap 14a): its recordings, the keys each is
// for, the note each sounds at and its loop, kept in the sample store as one sample of its own kind
// (`INSTRUMENT_TYPE`, the format the app's own instruments are in) and played by the sample engine
// like the bundled pianos. The font's own envelopes, filter and velocity layers are not taken: the
// lane's sound stands in for them, and of recordings for the same keys the first is kept.

// The sample store takes up to 50 MB a sample; the recordings are kept as 16-bit audio.
export const MAX_INSTRUMENT_BYTES = 48 * 1024 * 1024;

export type InstrumentImport = { ok: true; file: File; loops: boolean } | { ok: false; error: string };

export function soundFontInstrument(buffer: ArrayBuffer, preset: SoundFontPreset): InstrumentImport {
  const seen = new Set<string>();
  const zones = soundFontZones(buffer, preset.index).filter(zone => {
    const keys = `${zone.keyLow}:${zone.keyHigh}`;
    if (seen.has(keys)) return false;
    seen.add(keys);
    return true;
  });
  if (!zones.length) return { ok: false, error: `“${preset.name}” has no recordings this app can play.` };
  const bytes = zones.reduce((sum, zone) => sum + zone.data.length * 2, 0);
  if (bytes > MAX_INSTRUMENT_BYTES) return { ok: false, error: `“${preset.name}” is too big to keep in this browser (${Math.round(bytes / 1024 / 1024)} MB; up to ${MAX_INSTRUMENT_BYTES / 1024 / 1024} MB).` };
  const bundle = encodeWaveBundle('instrument', zones);
  const name = preset.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'SoundFont instrument';
  return { ok: true, file: new File([bundle], `${name}.instrument`, { type: INSTRUMENT_TYPE }), loops: zones.some(zone => zone.loopEnd !== undefined) };
}
