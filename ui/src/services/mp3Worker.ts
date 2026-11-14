// Encodes a take as an MP3 off the page (`takeMp3` in sessionRecorder.ts starts it): handed the
// channels and their rate, it answers how far it has got and then the file's bytes.
import { encodeMp3 } from './mp3';

export type Mp3Request = { channels: Float32Array[]; sampleRate: number };
export type Mp3Reply = { type: 'progress'; done: number } | { type: 'done'; pieces: Uint8Array[] } | { type: 'failed'; error: string };

const scope = self as unknown as { onmessage: ((event: MessageEvent<Mp3Request>) => void) | null; postMessage: (message: Mp3Reply, transfer?: Transferable[]) => void };

scope.onmessage = ({ data }) => {
  try {
    let shown = 0;
    const pieces = encodeMp3(data.channels, data.sampleRate, done => {
      if (done - shown >= 0.02 || done === 1) { shown = done; scope.postMessage({ type: 'progress', done }); }
    });
    scope.postMessage({ type: 'done', pieces }, pieces.map(piece => piece.buffer as ArrayBuffer));
  } catch (error) {
    scope.postMessage({ type: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
};
