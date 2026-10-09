// Draws the app icon and writes it as PNG at the sizes the web manifest needs.
// Run with: node ui/scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
};

const BACKGROUND = [0x1a, 0x1a, 0x1a];
const ACCENT = [0x00, 0xd4, 0xff];
const STEP_COLORS = [[0xf3, 0x6d, 0x63], [0xf7, 0x8d, 0x44], [0xdf, 0xcf, 0x58], [0xe5, 0xdf, 0xcc]];

// Colour of one point, in coordinates from -1 to 1. The art stays inside the middle 80%
// so the same image also works as a maskable icon.
function shade(x, y) {
  const radius = Math.hypot(x, y - -0.14);
  // a record: rings round a centre dot
  if (radius < 0.07) return ACCENT;
  if (radius > 0.2 && radius < 0.26) return ACCENT;
  if (radius > 0.36 && radius < 0.4) return ACCENT;
  if (radius > 0.5 && radius < 0.53) return ACCENT;
  // four sequencer steps underneath
  if (y > 0.5 && y < 0.66) {
    const column = Math.floor((x + 0.56) / 0.28);
    const within = (x + 0.56) - column * 0.28;
    if (column >= 0 && column < 4 && within > 0.04 && within < 0.24) return STEP_COLORS[column];
  }
  return BACKGROUND;
}

function render(size) {
  const samples = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1);
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const colour = shade(((px + (sx + 0.5) / samples) / size) * 2 - 1, ((py + (sy + 0.5) / samples) / size) * 2 - 1);
          sum[0] += colour[0]; sum[1] += colour[1]; sum[2] += colour[2];
        }
      }
      const at = row + 1 + px * 4;
      raw[at] = Math.round(sum[0] / samples ** 2);
      raw[at + 1] = Math.round(sum[1] / samples ** 2);
      raw[at + 2] = Math.round(sum[2] / samples ** 2);
      raw[at + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const directory = new URL('../public/icons/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(new URL(`icon-${size}.png`, directory), render(size));
  console.log(`icon-${size}.png`);
}
