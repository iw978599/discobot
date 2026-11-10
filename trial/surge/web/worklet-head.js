// Emscripten reads the time through performance.now(), which an audio worklet may not have.
if (typeof globalThis.performance !== 'object') {
  globalThis.performance = { now: () => Date.now() };
}

// An audio worklet has no crypto. Surge asks for random numbers from the system in a few effects;
// this answers with a fixed sequence, which is also what a repeatable export would want.
if (typeof globalThis.crypto !== 'object') {
  let state = 0x2545f491;
  globalThis.crypto = {
    getRandomValues(array) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        bytes[i] = state & 255;
      }
      return array;
    },
  };
}
