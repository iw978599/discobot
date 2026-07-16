// Note: Don't call ensureAudioContext() at module load time!
// AudioContext is browser-only and will crash in Node.js server environment.
// Let it initialize lazily when first used.

export { Synthesizer } from './Synthesizer';
export { StreamingSynth } from './StreamingSynth';
export { DrumSynthesizer } from './DrumSynthesizer';
export { DiscordAudioStreamer } from './Streaming';
export { Sequencer } from './Sequencer';
export { SequencerV2 } from './SequencerV2';
export { SamplePlayer } from './SamplePlayer';
export { audioContextManager } from './AudioContextManager';
export * from './types';
export * from './utils';
export * from './constants';
export * from './errors';
