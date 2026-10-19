export { SynthCore } from './synth/SynthCore';
export type { NoteOnMessage, SynthSample } from './synth/SynthCore';
export { createDefaultSynthParameters, syncedLfoHz, syncedRateHz, toVoiceParams } from './synth/voiceParams';
export type { VoiceParams } from './synth/voiceParams';
export { InsertChain, insertsActive } from './synth/inserts';
export type { InsertSettings } from './synth/inserts';
export { DrumCore } from './drums/DrumCore';
export type { DrumHitMessage, DrumRecordings, DrumSample } from './drums/DrumCore';
export type { DrumWorkletMessage, GuestPlayerMessage, GuestTapMessage, SynthWorkletMessage } from './workletMessages';
export { GUEST_TAP_FRAMES } from './workletMessages';
export * from './types';
// The values types.ts holds are named here as well: a star export does not carry them to every way this file is loaded.
export { MAX_MOD_ROUTES, MOD_DESTINATIONS, MOD_SOURCES, RATE_SYNCS, CYMBAL_TYPES, PERC_CHOICES, AUX_KINDS } from './types';
