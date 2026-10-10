import type { NoteOnMessage } from './synth/SynthCore';
import type { VoiceParams } from './synth/voiceParams';
import type { DrumHitMessage, DrumSample } from './drums/DrumCore';
import type { DrumInstrument } from './types';

// What the page sends to each audio processor. The hooks that send and the worklet that
// receives both use these, so a field renamed on one side is a compile error, not a sound
// that quietly stops.

export type SynthWorkletMessage =
  | { type: 'params'; params: VoiceParams }
  | ({ type: 'noteOn' } & NoteOnMessage)
  | { type: 'noteOff'; note: string; id?: number }
  | { type: 'allNotesOff'; release?: number };

export type DrumWorkletMessage =
  | ({ type: 'hit' } & DrumHitMessage)
  // null puts the lane back on its synthesized voice
  | { type: 'sample'; instrument: DrumInstrument; sample: DrumSample | null }
  | { type: 'stopAll' };

export type GuestPlayerMessage =
  // `frame` is where the block starts on the audio context's clock
  | { type: 'block'; frame: number; left: Float32Array; right: Float32Array }
  | { type: 'clear' };
