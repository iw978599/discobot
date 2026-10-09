export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// A stored (uncompressed) zip archive. Audio does not deflate well, and storing keeps this
// dependency-free.
export function createZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const files = entries.map(entry => ({ name: encoder.encode(entry.name), data: entry.data, crc: crc32(entry.data) }));
  const localSize = files.reduce((sum, file) => sum + 30 + file.name.length + file.data.length, 0);
  const centralSize = files.reduce((sum, file) => sum + 46 + file.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let position = 0;
  for (const file of files) {
    offsets.push(position);
    view.setUint32(position, 0x04034b50, true);
    view.setUint16(position + 4, 20, true);
    // bit 11: file names are UTF-8
    view.setUint16(position + 6, 0x0800, true);
    view.setUint32(position + 14, file.crc, true);
    view.setUint32(position + 18, file.data.length, true);
    view.setUint32(position + 22, file.data.length, true);
    view.setUint16(position + 26, file.name.length, true);
    out.set(file.name, position + 30);
    out.set(file.data, position + 30 + file.name.length);
    position += 30 + file.name.length + file.data.length;
  }
  const centralStart = position;
  files.forEach((file, index) => {
    view.setUint32(position, 0x02014b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 20, true);
    view.setUint16(position + 8, 0x0800, true);
    view.setUint32(position + 16, file.crc, true);
    view.setUint32(position + 20, file.data.length, true);
    view.setUint32(position + 24, file.data.length, true);
    view.setUint16(position + 28, file.name.length, true);
    view.setUint32(position + 42, offsets[index], true);
    out.set(file.name, position + 46);
    position += 46 + file.name.length;
  });
  view.setUint32(position, 0x06054b50, true);
  view.setUint16(position + 8, files.length, true);
  view.setUint16(position + 10, files.length, true);
  view.setUint32(position + 12, centralSize, true);
  view.setUint32(position + 16, centralStart, true);
  return out;
}
