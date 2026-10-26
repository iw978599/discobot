import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORDING_TYPES, elapsed, extensionFor, recordingType, sessionRecorder, takeName, takeWav } from '../src/services/sessionRecorder.ts';

test('a recording is made in the first format the browser offers, and none when it offers none', () => {
  assert.equal(recordingType(() => true), RECORDING_TYPES[0]);
  assert.equal(recordingType(type => type.startsWith('audio/mp4')), 'audio/mp4;codecs=mp4a.40.2', 'Safari');
  assert.equal(recordingType(() => false), null);
  assert.equal(recordingType(() => { throw new Error('no'); }), null, 'a browser that throws is one that cannot');
});

test('a take is named for when it began, with the ending its format has', () => {
  assert.equal(takeName(new Date(2026, 9, 22, 21, 5)), 'Session 2026-10-22 21.05');
  assert.deepEqual(['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].map(extensionFor), ['webm', 'ogg', 'm4a', 'webm']);
});

test('the clock counts minutes and seconds, never backwards', () => {
  assert.equal(elapsed(0, 65_400), '1:05');
  assert.equal(elapsed(1000, 0), '0:00');
});

test('with nothing recording, the recorder is idle and stopping answers nothing', async () => {
  assert.deepEqual(sessionRecorder.get(), { recording: false, startedAt: 0, take: null });
  assert.equal(await sessionRecorder.stop(), null);
  assert.equal(sessionRecorder.supported(), false, 'Node has no MediaRecorder');
  assert.equal(sessionRecorder.start({ stream: {} as MediaStream, release: () => {} }, () => {}), false);
});

test('a take is made into a WAV of the same name, of at most two channels', async () => {
  const left = new Float32Array([0, 0.5, -0.5, 1]), right = new Float32Array([1, 0, 0, -1]);
  const decoded = { numberOfChannels: 3, sampleRate: 48000, getChannelData: (channel: number) => [left, right, left][channel]! };
  const wav = takeWav(new File([new Uint8Array(4)], 'Session 2026-10-22 21.05.webm'), decoded);
  assert.equal(wav.name, 'Session 2026-10-22 21.05.wav');
  assert.equal(wav.type, 'audio/wav');
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
  assert.equal(view.getUint16(22, true), 2, 'two channels');
  assert.equal(view.getUint32(24, true), 48000, 'at the rate it was decoded at');
  assert.equal(wav.size, 44 + 4 * 2 * 2);
});
