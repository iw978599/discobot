import { CYMBAL_TYPES, type DrumKitId, type DrumRecordings, type PercType, type SampleZone, type SynthParameters, type SynthSample } from '@discobot/engine';
import { loadDrumSample } from './drumSamples';
import { INSTRUMENT_TYPE, getSample } from './sampleStore';
import { sampleKey } from './sceneSounds';

// The sounds that come with the app for the sample engine: recordings of instruments and single
// cycles of waves, in `public/waves.bin`. `scripts/build-waves.mjs` makes that file, and
// `docs/BUNDLED_AUDIO.md` says where each sound is from and why the project may ship it.
// `steps` is how many waves a sequence has; a sound with more than one can be stepped through.
// `file` is set for an instrument too big for waves.bin: its own file under public/, fetched on demand.
export const BUILT_IN_WAVES: Array<{ id: string; name: string; steps?: number; file?: string }> = [
  { id: 'piano', name: 'Piano' },
  { id: 'mallet', name: 'Marimba' },
  { id: 'organ', name: 'Organ', steps: 1 },
  { id: 'choir', name: 'Voice', steps: 1 },
  { id: 'attack-pluck', name: 'Harp attack' },
  { id: 'attack-bell', name: 'Bell attack' },
  { id: 'attack-breath', name: 'Flute attack' },
  { id: 'attack-mallet', name: 'Mallet attack' },
  { id: 'seq-voices', name: 'Sequence: voices', steps: 8 },
  { id: 'seq-overtones', name: 'Sequence: overtones', steps: 8 },
  { id: 'seq-fm', name: 'Sequence: FM', steps: 8 },
  { id: 'seq-harmonics', name: 'Sequence: harmonics', steps: 8 },
  { id: 'kawai-piano', name: 'Grand Piano (Kawai)', file: 'sounds/kawai-piano.bin' },
  { id: 'steinway-piano', name: 'Grand Piano (Steinway B)', file: 'sounds/steinway-piano.bin' },
  { id: 'pipe-organ', name: 'Pipe Organ', file: 'sounds/pipe-organ.bin' },
  { id: 'tenor-sax', name: 'Tenor Sax', file: 'sounds/tenor-sax.bin' },
  { id: 'fm-piano', name: 'FM Piano', file: 'sounds/fm-piano.bin' },
  { id: 'fm-piano-1', name: 'FM Piano 1', file: 'sounds/fm-piano-1.bin' },
  { id: 'fm-clavisynth', name: 'FM Clavisynth', file: 'sounds/fm-clavisynth.bin' },
  { id: 'caveman-organ', name: 'Caveman Organ', file: 'sounds/caveman-organ.bin' },
];

// A zone's own loop (frames into its recording) and the keys it is for, which a SoundFont's zones
// have (`soundFontImport.ts`); kept only when they make sense.
const whole = (value: unknown, low: number, high: number) => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
function extras(zone: Record<string, unknown>): Pick<SampleZone, 'loopStart' | 'loopEnd' | 'keyLow' | 'keyHigh'> {
  const length = Number(zone.length);
  const loop = whole(zone.loopStart, 0, length) && whole(zone.loopEnd, 0, length) && (zone.loopEnd as number) - (zone.loopStart as number) >= 2;
  const keys = whole(zone.keyLow, 0, 127) && whole(zone.keyHigh, 0, 127) && (zone.keyLow as number) <= (zone.keyHigh as number);
  return { ...(loop ? { loopStart: zone.loopStart as number, loopEnd: zone.loopEnd as number } : {}), ...(keys ? { keyLow: zone.keyLow as number, keyHigh: zone.keyHigh as number } : {}) };
}

// Writes the same file for one instrument, `id`: how an imported SoundFont instrument is kept in the
// sample store. The recordings are kept as 16-bit audio, as the app's own are.
export function encodeWaveBundle(id: string, zones: SampleZone[]): ArrayBuffer {
  let at = 0;
  const listed = zones.map(zone => {
    const entry = { offset: at, length: zone.data.length, rate: zone.rate, root: zone.root, loopStart: zone.loopStart, loopEnd: zone.loopEnd, keyLow: zone.keyLow, keyHigh: zone.keyHigh };
    at += zone.data.length;
    return entry;
  });
  const list = new TextEncoder().encode(JSON.stringify({ waves: [{ id, zones: listed }] }));
  const buffer = new ArrayBuffer(12 + list.length + at * 2), view = new DataView(buffer);
  view.setUint32(0, 0x56574244, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, list.length, true);
  new Uint8Array(buffer, 12, list.length).set(list);
  let frame = 0;
  for (const zone of zones) for (const value of zone.data) view.setInt16(12 + list.length + 2 * frame++, Math.max(-32768, Math.min(32767, Math.round(value * 32768))), true);
  return buffer;
}

// Reads the file the build script writes: a short header, a list of what is in it, then 16-bit audio.
// A file that is not one, or is cut short, gives nothing: the lanes then play their oscillators.
export function parseWaveBundle(buffer: ArrayBuffer): Map<string, SynthSample> {
  const waves = new Map<string, SynthSample>();
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== 0x56574244 || view.getUint32(4, true) !== 1) return waves;
  const listBytes = view.getUint32(8, true), audioAt = 12 + listBytes;
  if (audioAt > buffer.byteLength) return waves;
  let list: unknown;
  try { list = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, listBytes))); } catch { return waves; }
  const total = Math.floor((buffer.byteLength - audioAt) / 2);
  const audio = (offset: unknown, length: unknown): Float32Array | null => {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || (offset as number) < 0 || (length as number) < 2 || (offset as number) + (length as number) > total) return null;
    const data = new Float32Array(length as number);
    for (let index = 0; index < data.length; index++) data[index] = view.getInt16(audioAt + ((offset as number) + index) * 2, true) / 32768;
    return data;
  };
  for (const wave of (list as { waves?: Array<Record<string, unknown>> })?.waves ?? []) {
    const zones = (Array.isArray(wave.zones) ? wave.zones as Array<Record<string, unknown>> : [])
      .map(zone => ({ data: audio(zone.offset, zone.length), rate: Number(zone.rate), root: Number(zone.root), ...extras(zone) }))
      .filter((zone): zone is SampleZone => zone.data !== null);
    if (typeof wave.id !== 'string' || zones.length === 0) continue;
    const [first, ...rest] = zones;
    if (Number.isInteger(wave.frame) && (wave.frame as number) > 1) waves.set(wave.id, { data: first.data, rate: 1, frame: wave.frame as number });
    else if (zones.every(zone => zone.rate > 0 && zone.root >= 0 && zone.root <= 127)) waves.set(wave.id, { ...first, ...(rest.length ? { zones: rest } : {}) });
  }
  return waves;
}

// Each file is fetched once, the first time a sound in it is wanted, and kept in memory. One that
// could not be fetched (offline, and not seen before) is tried again at the next ask.
const loading = new Map<string, Promise<Map<string, SynthSample>>>();
function loadBundle(path: string): Promise<Map<string, SynthSample>> {
  let found = loading.get(path);
  if (!found) {
    const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    found = fetch(`${base}${path}`)
      .then(response => { if (!response.ok) throw new Error('not found'); return response.arrayBuffer(); })
      .then(parseWaveBundle)
      .catch(() => { loading.delete(path); return new Map<string, SynthSample>(); });
    loading.set(path, found);
  }
  return found;
}

// One of the app's own sounds, fetched with the rest of them the first time one is wanted. The
// small ones are all in `waves.bin`; a big instrument has a file of its own (`file` in the list
// above), fetched when a lane, an export or the share page first asks for it. The files are part
// of the build, on this site; the service worker keeps what has been fetched for use offline.
export function loadBuiltInWave(id: string): Promise<SynthSample | null> {
  const file = BUILT_IN_WAVES.find(wave => wave.id === id)?.file ?? 'waves.bin';
  return loadBundle(file).then(waves => waves.get(id) ?? null);
}

// The drum machine's recordings: the cymbals by kind (`crash`), the drums of the recorded kit
// as `kit-<instrument>`, and for `kitId` when it is one of the later recorded kits, its drums as
// `<kit>-<instrument>`, from a file of that kit's own fetched only then (`KIT_FILES`). One that
// could not be fetched is left out, and the drum voice plays the first kit's recording or its
// synthesized voice for it. Live playback, export and the share page all take this one list.
export const KIT_RECORDINGS = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride'];
export const KIT_FILES: Partial<Record<DrumKitId, string>> = { gogodze: 'sounds/kit-gogodze.bin', swirly: 'sounds/kit-swirly.bin' };
export const PERC_TYPES: PercType[] = ['tambourine', 'shaker', 'cowbell', 'sidestick', 'conga', 'bongo'];
export async function loadCymbals(kitId?: string): Promise<DrumRecordings> {
  const recordings: DrumRecordings = {};
  const names: Array<[string, string]> = [
    ...CYMBAL_TYPES.map((kind): [string, string] => [kind, `cymbal-${kind}`]),
    ...KIT_RECORDINGS.map((drum): [string, string] => [`kit-${drum}`, `kit-${drum}`]),
    ...PERC_TYPES.map((kind): [string, string] => [`perc-${kind}`, `perc-${kind}`]),
  ];
  for (const [name, id] of names) {
    const sample = await loadBuiltInWave(id);
    if (sample) recordings[name] = { data: sample.data, rate: sample.rate };
  }
  const file = kitId ? KIT_FILES[kitId as DrumKitId] : undefined;
  if (file) {
    for (const [id, sample] of await loadBundle(file)) {
      if (KIT_RECORDINGS.some(drum => id === `${kitId}-${drum}`)) recordings[id] = { data: sample.data, rate: sample.rate };
    }
  }
  return recordings;
}

// An imported sample: an instrument from a SoundFont is read as its recordings, kept in memory once
// read; anything else is decoded as the drum lanes' samples are.
const instruments = new Map<string, Promise<SynthSample | null>>();
function loadImported(id: string): Promise<SynthSample | null> {
  let found = instruments.get(id);
  if (!found) {
    found = getSample(id).then(stored => (stored?.type === INSTRUMENT_TYPE ? [...parseWaveBundle(stored.data).values()][0] ?? null : loadDrumSample(id))).catch(() => null);
    instruments.set(id, found);
    void found.then(sample => { if (!sample) instruments.delete(id); });
  }
  return found;
}

// What a lane's sample engine plays: one of the app's sounds, an imported sample, or nothing.
export function loadLaneSample(params: SynthParameters | null | undefined): Promise<SynthSample | null> {
  const sample = params?.sample;
  if (sample?.wave) return loadBuiltInWave(sample.wave);
  return sample?.id ? loadImported(sample.id) : Promise.resolve(null);
}

// The recordings a set of sounds play, by `sampleKey` (services/sceneSounds.ts): every one a song's
// scenes use, for a render outside the studio.
export async function loadSoundSamples(sounds: SynthParameters[]): Promise<Record<string, SynthSample>> {
  const loaded: Record<string, SynthSample> = {};
  for (const params of sounds) {
    const key = sampleKey(params);
    if (!key || key in loaded || params.engine !== 'sample') continue;
    const sample = await loadLaneSample(params);
    if (sample) loaded[key] = sample;
  }
  return loaded;
}

// The lanes' samples by lane id, for a render outside the studio (the page a share link opens).
export async function loadLaneSamples(lanes: Array<{ id: number; synthParams?: SynthParameters | null }>): Promise<Record<number, SynthSample>> {
  const loaded: Record<number, SynthSample> = {};
  for (const lane of lanes) {
    const sample = lane.synthParams?.engine === 'sample' ? await loadLaneSample(lane.synthParams) : null;
    if (sample) loaded[lane.id] = sample;
  }
  return loaded;
}
