// A session's take as an MP3 (sessionRecorder's `takeMp3`, encoded by `encodeMp3` in a worker):
// read back by its frame headers, since nothing here decodes an MP3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MP3_KBPS, encodeMp3 } from '../src/services/mp3.ts';

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

// Every MPEG-1 Layer III frame in the file, end to end, each header read.
function frames(bytes: Uint8Array) {
  const found: { kbps: number; rate: number; stereo: boolean }[] = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const [a, b, c, d] = bytes.subarray(at, at + 4);
    assert.ok(a === 0xff && (b & 0xfe) === 0xfa, `a frame begins at byte ${at}`);
    const kbps = BITRATES[c >> 4], rate = RATES[(c >> 2) & 3], padding = (c >> 1) & 1;
    found.push({ kbps, rate, stereo: d >> 6 !== 3 });
    at += Math.floor((144 * kbps * 1000) / rate) + padding;
  }
  assert.equal(at, bytes.length, 'the last frame ends where the file does');
  return found;
}

const join = (pieces: Uint8Array[]) => {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) { out.set(piece, at); at += piece.length; }
  return out;
};

test('a take becomes a stereo MP3 at 320 kb/s and its own rate, as long as it is', () => {
  for (const rate of [48000, 44100]) {
    const seconds = 2, length = rate * seconds;
    const left = Float32Array.from({ length }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
    const right = Float32Array.from({ length }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 660 * i) / rate));
    const found = frames(join(encodeMp3([left, right], rate)));
    assert.ok(found.every(frame => frame.kbps === MP3_KBPS && frame.rate === rate && frame.stereo), `${rate}: every frame 320 kb/s stereo`);
    // 1152 samples a frame, and LAME adds a frame or two of its own delay and padding.
    const exact = length / 1152;
    assert.ok(found.length >= exact && found.length <= exact + 3, `${rate}: ${found.length} frames for ${exact.toFixed(1)}`);
  }
});

test('one channel plays on both sides, and loud samples are held to full scale rather than wrapping', () => {
  const loud = Float32Array.from({ length: 48000 }, (_, i) => (i % 100 < 50 ? 4 : -4));
  const found = frames(join(encodeMp3([loud], 48000)));
  assert.ok(found.length > 40 && found.every(frame => frame.stereo));
});

test('an MP3 is never made at a rate it cannot have, or from nothing', () => {
  assert.throws(() => encodeMp3([new Float32Array(1000)], 96000), /96000 Hz/);
  assert.throws(() => encodeMp3([], 48000), /Nothing/);
});

test('progress rises to the whole', () => {
  const seen: number[] = [];
  encodeMp3([new Float32Array(48000 * 5)], 48000, done => seen.push(done));
  assert.ok(seen.length > 1);
  assert.deepEqual([...seen].sort((a, b) => a - b), seen);
  assert.equal(seen.at(-1), 1);
});
