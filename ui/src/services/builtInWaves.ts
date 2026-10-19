import { CYMBAL_TYPES, type DrumRecordings, type PercType, type SynthParameters, type SynthSample } from '@discobot/engine';
import { loadDrumSample } from './drumSamples';

// The sounds that come with the app for the sample engine: recordings of instruments and single
// cycles of waves, in `public/waves.bin`. `scripts/build-waves.mjs` makes that file, and
// `docs/BUNDLED_AUDIO.md` says where each sound is from and why the project may ship it.
// `steps` is how many waves a sequence has; a sound with more than one can be stepped through.
export const BUILT_IN_WAVES: Array<{ id: string; name: string; steps?: number }> = [
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
];

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
      .map(zone => ({ data: audio(zone.offset, zone.length), rate: Number(zone.rate), root: Number(zone.root) }))
      .filter((zone): zone is { data: Float32Array; rate: number; root: number } => zone.data !== null);
    if (typeof wave.id !== 'string' || zones.length === 0) continue;
    const [first, ...rest] = zones;
    if (Number.isInteger(wave.frame) && (wave.frame as number) > 1) waves.set(wave.id, { data: first.data, rate: 1, frame: wave.frame as number });
    else if (zones.every(zone => zone.rate > 0 && zone.root >= 0 && zone.root <= 127)) waves.set(wave.id, { ...first, ...(rest.length ? { zones: rest } : {}) });
  }
  return waves;
}

let loading: Promise<Map<string, SynthSample>> | undefined;

// One of the app's own sounds, fetched with the rest of them the first time one is wanted. The
// file is part of the build, on this site, and the service worker keeps it for use offline.
export function loadBuiltInWave(id: string): Promise<SynthSample | null> {
  if (!loading) {
    const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    loading = fetch(`${base}waves.bin`)
      .then(response => { if (!response.ok) throw new Error('not found'); return response.arrayBuffer(); })
      .then(parseWaveBundle)
      .catch(() => { loading = undefined; return new Map<string, SynthSample>(); });
  }
  return loading.then(waves => waves.get(id) ?? null);
}

// The drum machine's recordings: the cymbals by kind (`crash`), and the drums of the recorded kit
// as `kit-<instrument>`. One that could not be fetched is left out, and the drum voice plays its
// synthesized voice for it. Live playback, export and the share page all take this one list.
export const KIT_RECORDINGS = ['kick', 'snare', 'clap', 'closedHH', 'openHH', 'snare2', 'ride'];
export const PERC_TYPES: PercType[] = ['tambourine', 'shaker', 'cowbell', 'sidestick', 'conga', 'bongo'];
export async function loadCymbals(): Promise<DrumRecordings> {
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
  return recordings;
}

// What a lane's sample engine plays: one of the app's sounds, an imported sample, or nothing.
export function loadLaneSample(params: SynthParameters | null | undefined): Promise<SynthSample | null> {
  const sample = params?.sample;
  if (sample?.wave) return loadBuiltInWave(sample.wave);
  return sample?.id ? loadDrumSample(sample.id) : Promise.resolve(null);
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
