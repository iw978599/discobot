import { Mp3Encoder } from '@breezystack/lamejs';

// A recording as an MP3 file's bytes, by LAME (lamejs, LGPL-3.0, credited in Help). It is only ever
// loaded inside `mp3Worker.ts`, so the encoder stays a file of its own, as LAME's licence asks, and
// a long take is encoded without holding up the page. Always stereo at a constant bit rate; one
// channel is used for both sides.

export const MP3_KBPS = 320;
// The rates an MP3 at 320 kb/s can be: a take is decoded at 48 kHz for it (`takeMp3`).
export const MP3_RATES = [32000, 44100, 48000];
// Samples per MP3 frame, and how many frames are encoded between progress reports.
const FRAME = 1152, FRAMES_PER_PIECE = 64;

const toInt16 = (samples: Float32Array, from: number, to: number) => {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    out[i - from] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return out;
};

export function encodeMp3(channels: Float32Array[], sampleRate: number, onProgress?: (done: number) => void): Uint8Array[] {
  if (!MP3_RATES.includes(sampleRate)) throw new Error(`An MP3 cannot be ${sampleRate} Hz`);
  if (!channels.length) throw new Error('Nothing to encode');
  const left = channels[0], right = channels[1] ?? channels[0];
  const encoder = new Mp3Encoder(2, sampleRate, MP3_KBPS);
  const pieces: Uint8Array[] = [];
  const step = FRAME * FRAMES_PER_PIECE;
  for (let from = 0; from < left.length; from += step) {
    const to = Math.min(left.length, from + step);
    const bytes = encoder.encodeBuffer(toInt16(left, from, to), toInt16(right, from, to));
    if (bytes.length) pieces.push(new Uint8Array(bytes));
    onProgress?.(to / left.length);
  }
  const last = encoder.flush();
  if (last.length) pieces.push(new Uint8Array(last));
  return pieces;
}
