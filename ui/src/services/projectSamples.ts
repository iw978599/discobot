import { getSample, isAudioFile, listSamples, putSample, type SampleRecord } from './sampleStore';
import { record } from './projectSanitization';
import { clipSampleIds } from './audioTracks';

// A saved project file carries the audio of the samples its drum lanes use, as base64 in a
// `samples` list beside `project`. It is beside the project and not in it on purpose: the
// project is what gets stored, synced, published and put in links, and none of those may
// hold audio. An app from before this reads only `project`, so it opens the file and shows
// the samples as missing.

export interface EmbeddedSample { id: string; name: string; type: string; data: string }
export interface SampleStore {
  list(): Promise<SampleRecord[]>;
  get(id: string): Promise<SampleRecord | undefined>;
  put(sample: SampleRecord): Promise<void>;
}
export const browserSampleStore: SampleStore = { list: listSamples, get: getSample, put: putSample };

// A drum hit is small. A file dropped on a lane by mistake (a whole song) is left out.
export const MAX_EMBEDDED_SAMPLE_BYTES = 4 * 1024 * 1024;
// A clip's recording on an audio track is longer, and may take all the room a file has.
const sampleLimit = (project: unknown, id: string) => (clipSampleIds(record(project).audioTracks).includes(id) ? MAX_EMBEDDED_TOTAL_BYTES : MAX_EMBEDDED_SAMPLE_BYTES);
// The largest file an import accepts, here and in every version before this.
export const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024;
// With base64 a third larger, this keeps a project file under that limit,
// in this version and in the ones before it.
export const MAX_EMBEDDED_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_EMBEDDED_SAMPLES = 32;

const SAMPLE_ID = /^[0-9a-f-]{36}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
// Bytes encoded, or characters decoded, between pauses that let the page breathe.
const SLICE_BYTES = 3 * 0x40000, SLICE_CHARS = 4 * 0x40000;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function toBase64(bytes: Uint8Array): Promise<string> {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += SLICE_BYTES) {
    if (start > 0) await pause();
    const end = Math.min(bytes.length, start + SLICE_BYTES);
    let binary = '';
    for (let at = start; at < end; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, Math.min(end, at + 0x8000)));
    parts.push(btoa(binary));
  }
  return parts.join('');
}

// Null for anything that is not base64 of between one and `limit` bytes. The size is known
// from the text's length, so nothing oversized is ever decoded.
export async function fromBase64(text: string, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (text.length === 0 || text.length % 4 !== 0 || text.length > Math.ceil(limit / 3) * 4) return null;
  const size = text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
  if (size < 1 || size > limit || !BASE64.test(text)) return null;
  const bytes = new Uint8Array(size);
  try {
    for (let start = 0, at = 0; start < text.length; start += SLICE_CHARS) {
      if (start > 0) await pause();
      const binary = atob(text.slice(start, start + SLICE_CHARS));
      for (let index = 0; index < binary.length; index++) bytes[at++] = binary.charCodeAt(index);
    }
  } catch { return null; }
  return bytes;
}

const synthLanes = (project: unknown): unknown[] => { const lanes = record(project).synths; return Array.isArray(lanes) ? lanes : []; };
const laneSample = (lane: unknown) => record(record(record(lane).synthParams).sample);

// The samples a project plays: its drum lanes', its synth lanes' whether or not the lane is set
// to the sample engine just now, and the recordings its audio tracks' clips play. A lane's sample
// belongs to the whole project, not to a scene, so a lane that is silent in the open scene still counts.
export function usedSampleIds(project: unknown): string[] {
  const ids = [
    ...Object.values(record(record(project).drumState)).map(track => record(track).sampleId),
    ...synthLanes(project).map(lane => laneSample(lane).id),
    ...clipSampleIds(record(project).audioTracks),
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && SAMPLE_ID.test(id)))];
}

// The audio to put in a project file. A sample that is not in this browser is simply absent,
// as it already is here; one that is too large is named in `skipped` so the user can be told.
export async function embedSamples(project: unknown, store: SampleStore = browserSampleStore, totalBytes = MAX_EMBEDDED_TOTAL_BYTES): Promise<{ samples: EmbeddedSample[]; skipped: string[] }> {
  const samples: EmbeddedSample[] = [], skipped: string[] = [];
  let room = Math.min(totalBytes, MAX_EMBEDDED_TOTAL_BYTES);
  for (const id of usedSampleIds(project).slice(0, MAX_EMBEDDED_SAMPLES)) {
    const stored = await store.get(id);
    if (!stored) continue;
    const size = stored.data.byteLength;
    if (size < 1 || size > sampleLimit(project, id) || size > room) { skipped.push(stored.name); continue; }
    room -= size;
    samples.push({ id, name: stored.name, type: stored.type, data: await toBase64(new Uint8Array(stored.data)) });
  }
  return { samples, skipped };
}

// The usable samples in a file. Everything in a file is untrusted: an entry that no lane of
// the project uses is ignored, and one that is malformed, not audio or too large is counted
// in `dropped` and left out. This never throws.
export async function readEmbeddedSamples(file: unknown): Promise<{ samples: SampleRecord[]; dropped: number }> {
  const input = record(file), wanted = new Set(usedSampleIds(input.project));
  const samples: SampleRecord[] = [];
  let dropped = 0, room = MAX_EMBEDDED_TOTAL_BYTES;
  if (!Array.isArray(input.samples)) return { samples, dropped };
  for (const value of input.samples.slice(0, MAX_EMBEDDED_SAMPLES)) {
    const entry = record(value), id = entry.id;
    if (typeof id !== 'string' || !wanted.delete(id)) continue;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 200) : '';
    const type = typeof entry.type === 'string' && /^audio\/[\w.+-]{1,60}$/.test(entry.type) ? entry.type : '';
    const bytes = name && isAudioFile({ name, type }) && typeof entry.data === 'string'
      ? await fromBase64(entry.data, Math.min(sampleLimit(input.project, id), room)) : null;
    if (!bytes) { dropped++; continue; }
    room -= bytes.length;
    samples.push({ id, name, type, data: bytes.buffer });
  }
  return { samples, dropped };
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

// Puts a file's samples in the store and returns the file without them, ready to import.
// A sample is the same sample when its bytes are the same; the id is only what the lanes
// call it. So audio already in the store is never stored twice (the lanes are pointed at
// the copy that is there), and an id that is taken by different audio is never overwritten
// (the incoming sample gets a new id and the lanes follow it). A file with no samples comes
// back as it was. A sample that cannot be stored is counted in `dropped`; its lane plays
// its synthesized voice.
export async function adoptSamples(file: unknown, store: SampleStore = browserSampleStore): Promise<{ file: unknown; added: number; dropped: number }> {
  if (!Array.isArray(record(file).samples)) return { file, added: 0, dropped: 0 };
  const read = await readEmbeddedSamples(file);
  const { samples: _audio, ...rest } = record(file);
  let added = 0, dropped = read.dropped;
  const renamed = new Map<string, string>();
  if (read.samples.length > 0) {
    let existing: SampleRecord[];
    try { existing = await store.list(); } catch { return { file: rest, added: 0, dropped: dropped + read.samples.length }; }
    for (const sample of read.samples) {
      const twin = existing.find(other => sameBytes(other.data, sample.data));
      if (twin) {
        if (twin.id !== sample.id) renamed.set(sample.id, twin.id);
        continue;
      }
      const stored = existing.some(other => other.id === sample.id) ? { ...sample, id: crypto.randomUUID() } : sample;
      try { await store.put(stored); } catch { dropped++; continue; }
      existing.push(stored);
      added++;
      if (stored.id !== sample.id) renamed.set(sample.id, stored.id);
    }
  }
  if (renamed.size === 0) return { file: rest, added, dropped };
  const project = record(rest.project);
  const drumState = Object.fromEntries(Object.entries(record(project.drumState)).map(([lane, track]) => {
    const to = renamed.get(record(track).sampleId);
    return [lane, to ? { ...track, sampleId: to } : track];
  }));
  const synths = synthLanes(project).map((lane) => {
    const to = renamed.get(laneSample(lane).id);
    return to ? { ...record(lane), synthParams: { ...record(record(lane).synthParams), sample: { ...laneSample(lane), id: to } } } : lane;
  });
  const audioTracks = Array.isArray(project.audioTracks) ? project.audioTracks.map((track) => ({
    ...record(track),
    clips: (Array.isArray(record(track).clips) ? record(track).clips as unknown[] : []).map((clip) => {
      const to = renamed.get(record(clip).sampleId as string);
      return to ? { ...record(clip), sampleId: to } : clip;
    }),
  })) : undefined;
  return { file: { ...rest, project: { ...project, drumState, ...(Array.isArray(project.synths) ? { synths } : {}), ...(audioTracks ? { audioTracks } : {}) } }, added, dropped };
}
