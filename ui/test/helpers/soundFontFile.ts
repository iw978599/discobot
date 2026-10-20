// A SoundFont 2 file built from a description, for the tests that read one (soundFont.test.ts,
// soundFontImport.test.ts), so no fixture file is needed.
export type Gen = [number, number];

export interface SampleSpec {
  name?: string;
  data: number[];
  rate?: number;
  pitch?: number;
  correction?: number;
  loop?: [number, number];
  type?: number;
}
export interface ZoneSpec { gens: Gen[] }
export interface InstrumentSpec { name: string; zones: ZoneSpec[] }
export interface PresetSpec { name: string; bank: number; program: number; zones: ZoneSpec[] }
export interface FontSpec { name?: string; samples: SampleSpec[]; instruments: InstrumentSpec[]; presets: PresetSpec[] }

export const KEY = 43, INSTRUMENT = 41, SAMPLE_ID = 53, MODES = 54, ROOT = 58;
export const COARSE = 51, FINE = 52, START = 0, END = 1, LOOP_START = 2, LOOP_END = 3;

export const keys = (low: number, high: number): Gen => [KEY, low | (high << 8)];

export function bytes(length: number, fill: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(length);
  fill(new DataView(out.buffer));
  return out;
}

export function name(view: DataView, at: number, text: string) {
  for (let i = 0; i < text.length && i < 19; i++) view.setUint8(at + i, text.charCodeAt(i));
}

export function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length + (body.length & 1);
  const out = new Uint8Array(8 + padded);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, id.charCodeAt(i));
  view.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

export function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

export function list(type: string, parts: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(4);
  for (let i = 0; i < 4; i++) head[i] = type.charCodeAt(i);
  return chunk('LIST', join([head, ...parts]));
}

export function bagsAndGens(zoneLists: ZoneSpec[][]) {
  const bags: number[][] = [];
  const gens: Gen[] = [];
  const firstBag: number[] = [];
  for (const zones of zoneLists) {
    firstBag.push(bags.length);
    for (const zone of zones) {
      bags.push([gens.length, 0]);
      gens.push(...zone.gens);
    }
  }
  firstBag.push(bags.length);
  bags.push([gens.length, 0]);
  gens.push([0, 0]);
  const bagBytes = bytes(bags.length * 4, view => bags.forEach(([g, m], i) => {
    view.setUint16(i * 4, g, true);
    view.setUint16(i * 4 + 2, m, true);
  }));
  const genBytes = bytes(gens.length * 4, view => gens.forEach(([oper, amount], i) => {
    view.setUint16(i * 4, oper, true);
    view.setInt16(i * 4 + 2, amount, true);
  }));
  return { bagBytes, genBytes, firstBag };
}

export function buildSoundFont(spec: FontSpec): ArrayBuffer {
  const words: number[] = [];
  const starts: number[] = [];
  for (const sample of spec.samples) {
    starts.push(words.length);
    words.push(...sample.data);
    words.push(0, 0, 0, 0, 0, 0, 0, 0);
  }
  const smpl = bytes(words.length * 2, view => words.forEach((w, i) => view.setInt16(i * 2, w, true)));

  const shdr = bytes((spec.samples.length + 1) * 46, view => spec.samples.forEach((sample, i) => {
    const at = i * 46;
    const start = starts[i];
    name(view, at, sample.name ?? `S${i}`);
    view.setUint32(at + 20, start, true);
    view.setUint32(at + 24, start + sample.data.length, true);
    view.setUint32(at + 28, start + (sample.loop ? sample.loop[0] : 0), true);
    view.setUint32(at + 32, start + (sample.loop ? sample.loop[1] : sample.data.length), true);
    view.setUint32(at + 36, sample.rate ?? 44100, true);
    view.setUint8(at + 40, sample.pitch ?? 60);
    view.setInt8(at + 41, sample.correction ?? 0);
    view.setUint16(at + 44, sample.type ?? 1, true);
  }));
  name(new DataView(shdr.buffer), spec.samples.length * 46, 'EOS');

  const pre = bagsAndGens(spec.presets.map(p => p.zones));
  const ins = bagsAndGens(spec.instruments.map(i => i.zones));
  const phdr = bytes((spec.presets.length + 1) * 38, view => {
    spec.presets.forEach((p, i) => {
      name(view, i * 38, p.name);
      view.setUint16(i * 38 + 20, p.program, true);
      view.setUint16(i * 38 + 22, p.bank, true);
      view.setUint16(i * 38 + 24, pre.firstBag[i], true);
    });
    name(view, spec.presets.length * 38, 'EOP');
    view.setUint16(spec.presets.length * 38 + 24, pre.firstBag[spec.presets.length], true);
  });
  const inst = bytes((spec.instruments.length + 1) * 22, view => {
    spec.instruments.forEach((p, i) => {
      name(view, i * 22, p.name);
      view.setUint16(i * 22 + 20, ins.firstBag[i], true);
    });
    name(view, spec.instruments.length * 22, 'EOI');
    view.setUint16(spec.instruments.length * 22 + 20, ins.firstBag[spec.instruments.length], true);
  });

  const info = list('INFO', [chunk('INAM', new TextEncoder().encode(spec.name ?? 'Test font'))]);
  const sdta = list('sdta', [chunk('smpl', smpl)]);
  const pdta = list('pdta', [
    chunk('phdr', phdr), chunk('pbag', pre.bagBytes), chunk('pmod', new Uint8Array(10)), chunk('pgen', pre.genBytes),
    chunk('inst', inst), chunk('ibag', ins.bagBytes), chunk('imod', new Uint8Array(10)), chunk('igen', ins.genBytes),
    chunk('shdr', shdr),
  ]);
  const body = join([new TextEncoder().encode('sfbk'), info, sdta, pdta]);
  const out = join([new TextEncoder().encode('RIFF'), new Uint8Array(4), body]);
  new DataView(out.buffer).setUint32(4, body.length, true);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
