export interface SoundFontPreset { name: string; bank: number; program: number; index: number }

export interface SoundFontZone {
  keyLow: number;
  keyHigh: number;
  root: number;
  rate: number;
  data: Float32Array;
  loopStart?: number;
  loopEnd?: number;
}

export interface SoundFontFile { name: string; presets: SoundFontPreset[] }

const MAX_ZONES = 2048;
const MAX_FRAMES = 48_000_000;
const MIN_FRAMES = 2;

const GEN = {
  startAddrs: 0,
  endAddrs: 1,
  startLoopAddrs: 2,
  endLoopAddrs: 3,
  startAddrsCoarse: 4,
  endAddrsCoarse: 12,
  instrument: 41,
  keyRange: 43,
  coarseTune: 51,
  fineTune: 52,
  sampleId: 53,
  sampleModes: 54,
  startLoopAddrsCoarse: 45,
  endLoopAddrsCoarse: 50,
  rootKey: 58,
};

interface Range { offset: number; size: number }

interface Layout {
  view: DataView;
  info: Range | null;
  smpl: Range;
  phdr: Range;
  pbag: Range;
  pgen: Range;
  inst: Range;
  ibag: Range;
  igen: Range;
  shdr: Range;
}

interface Gens { [oper: number]: number }

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function text(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim();
}

function chunksIn(view: DataView, start: number, end: number): { id: string; type: string; data: Range; }[] {
  const found: { id: string; type: string; data: Range; }[] = [];
  let at = start;
  while (at + 8 <= end) {
    const id = fourCC(view, at);
    const size = view.getUint32(at + 4, true);
    const data = at + 8;
    if (data + size > end) break;
    const isList = id === 'LIST' || id === 'RIFF';
    if (isList && size >= 4) {
      found.push({ id, type: fourCC(view, data), data: { offset: data + 4, size: size - 4 } });
    } else {
      found.push({ id, type: '', data: { offset: data, size } });
    }
    at = data + size + (size & 1);
  }
  return found;
}

function layoutOf(buffer: ArrayBuffer): Layout | null {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'sfbk') return null;
  const riffSize = view.getUint32(4, true);
  const end = Math.min(buffer.byteLength, 8 + riffSize);
  const top = chunksIn(view, 12, end);
  const parts: { [id: string]: Range } = {};
  let info: Range | null = null;
  for (const list of top) {
    if (list.id !== 'LIST') continue;
    const inner = chunksIn(view, list.data.offset, list.data.offset + list.data.size);
    if (list.type === 'INFO') {
      const name = inner.find(chunk => chunk.id === 'INAM');
      if (name) info = name.data;
    } else if (list.type === 'sdta' || list.type === 'pdta') {
      for (const chunk of inner) parts[chunk.id] = chunk.data;
    }
  }
  const { smpl, phdr, pbag, pgen, inst, ibag, igen, shdr } = parts;
  if (!smpl || !phdr || !pbag || !pgen || !inst || !ibag || !igen || !shdr) return null;
  if (phdr.size < 38 * 2 || inst.size < 22 || pbag.size < 4 || ibag.size < 4 || shdr.size < 46) return null;
  return { view, info, smpl, phdr, pbag, pgen, inst, ibag, igen, shdr };
}

export function readSoundFont(buffer: ArrayBuffer): SoundFontFile | null {
  try {
    const layout = layoutOf(buffer);
    if (!layout) return null;
    const { view, info, phdr } = layout;
    const count = Math.floor(phdr.size / 38) - 1;
    const presets: SoundFontPreset[] = [];
    for (let index = 0; index < count; index++) {
      const at = phdr.offset + index * 38;
      presets.push({
        name: text(view, at, 20),
        program: view.getUint16(at + 20, true),
        bank: view.getUint16(at + 22, true),
        index,
      });
    }
    presets.sort((a, b) => a.bank - b.bank || a.program - b.program || a.index - b.index);
    return { name: info ? text(view, info.offset, info.size) : '', presets };
  } catch {
    return null;
  }
}

function bagCount(range: Range): number {
  return Math.floor(range.size / 4);
}

function gensOfBag(view: DataView, bags: Range, gens: Range, bag: number): Gens | null {
  if (bag < 0 || bag + 1 >= bagCount(bags)) return null;
  const from = view.getUint16(bags.offset + bag * 4, true);
  const to = Math.min(view.getUint16(bags.offset + (bag + 1) * 4, true), Math.floor(gens.size / 4));
  const out: Gens = {};
  for (let i = from; i < to; i++) {
    const at = gens.offset + i * 4;
    const oper = view.getUint16(at, true);
    out[oper] = oper === GEN.keyRange ? view.getUint16(at + 2, true) : view.getInt16(at + 2, true);
  }
  return out;
}

interface Zone { gens: Gens; global: boolean }

// A first bag with no link generator is the global zone: its generators fill in what the others leave out.
function zonesOf(view: DataView, bags: Range, gens: Range, firstBag: number, endBag: number, link: number): Gens[] {
  const zones: Gens[] = [];
  let global: Gens = {};
  for (let bag = firstBag; bag < endBag; bag++) {
    const own = gensOfBag(view, bags, gens, bag);
    if (!own) break;
    const zone: Zone = { gens: own, global: own[link] === undefined };
    if (zone.global) {
      if (bag === firstBag) global = own;
      continue;
    }
    zones.push({ ...global, ...own });
  }
  return zones;
}

function keysOf(gens: Gens): [number, number] {
  const raw = gens[GEN.keyRange];
  if (raw === undefined) return [0, 127];
  return [raw & 255, (raw >> 8) & 255];
}

function numberOr(gens: Gens, oper: number, fallback: number): number {
  const value = gens[oper];
  return value === undefined ? fallback : value;
}

export function soundFontZones(buffer: ArrayBuffer, presetIndex: number): SoundFontZone[] {
  try {
    return readZones(buffer, presetIndex);
  } catch {
    return [];
  }
}

function readZones(buffer: ArrayBuffer, presetIndex: number): SoundFontZone[] {
  const layout = layoutOf(buffer);
  if (!layout || !Number.isInteger(presetIndex) || presetIndex < 0) return [];
  const { view, phdr, pbag, pgen, inst, ibag, igen, shdr, smpl } = layout;
  if (presetIndex >= Math.floor(phdr.size / 38) - 1) return [];
  const phdrAt = phdr.offset + presetIndex * 38;
  const firstPresetBag = view.getUint16(phdrAt + 24, true);
  const endPresetBag = view.getUint16(phdrAt + 38 + 24, true);
  const instrumentCount = Math.floor(inst.size / 22) - 1;
  const headerCount = Math.floor(shdr.size / 46) - 1;
  const smplWords = Math.floor(smpl.size / 2);
  const zones: SoundFontZone[] = [];
  let frames = 0;

  // Only the key range and the two tunings are taken from the preset level; its other generators are not applied.
  for (const presetGens of zonesOf(view, pbag, pgen, firstPresetBag, endPresetBag, GEN.instrument)) {
    const instrumentIndex = presetGens[GEN.instrument];
    if (instrumentIndex < 0 || instrumentIndex >= instrumentCount) continue;
    const instAt = inst.offset + instrumentIndex * 22;
    const firstBag = view.getUint16(instAt + 20, true);
    const endBag = view.getUint16(instAt + 22 + 20, true);
    const [presetLow, presetHigh] = keysOf(presetGens);

    for (const gens of zonesOf(view, ibag, igen, firstBag, endBag, GEN.sampleId)) {
      if (zones.length >= MAX_ZONES) return finish(zones);
      const [low, high] = keysOf(gens);
      const keyLow = Math.max(low, presetLow);
      const keyHigh = Math.min(high, presetHigh);
      if (keyLow > keyHigh) continue;
      const sampleId = gens[GEN.sampleId];
      if (sampleId < 0 || sampleId >= headerCount) continue;
      const at = shdr.offset + sampleId * 46;
      const type = view.getUint16(at + 44, true);
      if (type & 0x8000) continue;
      const headerStart = view.getUint32(at + 20, true);
      const headerEnd = view.getUint32(at + 24, true);
      const start = headerStart + numberOr(gens, GEN.startAddrs, 0) + numberOr(gens, GEN.startAddrsCoarse, 0) * 32768;
      const end = headerEnd + numberOr(gens, GEN.endAddrs, 0) + numberOr(gens, GEN.endAddrsCoarse, 0) * 32768;
      if (start < 0 || end > smplWords || end - start < MIN_FRAMES) continue;
      const length = end - start;
      if (frames + length > MAX_FRAMES) break;
      frames += length;

      const data = new Float32Array(length);
      for (let i = 0; i < length; i++) data[i] = view.getInt16(smpl.offset + (start + i) * 2, true) / 32768;

      const rate = view.getUint32(at + 36, true);
      const pitch = view.getUint8(at + 40);
      const correction = view.getInt8(at + 41);
      const override = gens[GEN.rootKey];
      const rootKey = override !== undefined && override >= 0 && override <= 127 ? override : pitch <= 127 ? pitch : 60;
      const coarse = numberOr(gens, GEN.coarseTune, 0) + numberOr(presetGens, GEN.coarseTune, 0);
      const fine = numberOr(gens, GEN.fineTune, 0) + numberOr(presetGens, GEN.fineTune, 0) + correction;
      const zone: SoundFontZone = { keyLow, keyHigh, root: rootKey - coarse - fine / 100, rate, data };

      const mode = numberOr(gens, GEN.sampleModes, 0) & 3;
      if (mode === 1 || mode === 3) {
        const loopStart = view.getUint32(at + 28, true)
          + numberOr(gens, GEN.startLoopAddrs, 0) + numberOr(gens, GEN.startLoopAddrsCoarse, 0) * 32768 - start;
        const loopEnd = view.getUint32(at + 32, true)
          + numberOr(gens, GEN.endLoopAddrs, 0) + numberOr(gens, GEN.endLoopAddrsCoarse, 0) * 32768 - start;
        if (loopStart >= 0 && loopEnd - loopStart >= MIN_FRAMES && loopEnd <= length) {
          zone.loopStart = loopStart;
          zone.loopEnd = loopEnd;
        }
      }
      zones.push(zone);
    }
  }
  return finish(zones);
}

function finish(zones: SoundFontZone[]): SoundFontZone[] {
  return zones.sort((a, b) => a.keyLow - b.keyLow || a.keyHigh - b.keyHigh);
}
