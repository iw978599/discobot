let polyfilled = false;

export function ensureAudioContext(): void {
  if (polyfilled) return;
  polyfilled = true;

  if (typeof globalThis.AudioContext === 'undefined') {
    try {
      const { AudioContext, OfflineAudioContext } = require('node-web-audio-api');
      (globalThis as any).AudioContext = AudioContext;
      (globalThis as any).OfflineAudioContext = OfflineAudioContext;
      console.log('AudioContext polyfill installed (node-web-audio-api)');
    } catch (e) {
      console.warn('Failed to load node-web-audio-api, audio features disabled:', (e as Error).message);
    }
  }
}
