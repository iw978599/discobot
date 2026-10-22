import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORDING_TYPES, elapsed, extensionFor, recordingType, sessionRecorder, takeName } from '../src/services/sessionRecorder.ts';

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
  assert.deepEqual(sessionRecorder.get(), { recording: false, startedAt: 0 });
  assert.equal(await sessionRecorder.stop(), null);
  assert.equal(sessionRecorder.supported(), false, 'Node has no MediaRecorder');
  assert.equal(sessionRecorder.start({ stream: {} as MediaStream, release: () => {} }, () => {}), false);
});
