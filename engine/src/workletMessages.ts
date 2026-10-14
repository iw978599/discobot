import type { NoteOnMessage, SynthSample } from './synth/SynthCore';
import type { VoiceParams } from './synth/voiceParams';
import type { DrumHitMessage, DrumSample } from './drums/DrumCore';
import type { CymbalType, DrumInstrument } from './types';

// What the page sends to each audio processor. The hooks that send and the worklet that
// receives both use these, so a field renamed on one side is a compile error, not a sound
// that quietly stops.

export type SynthWorkletMessage =
  // With a time (seconds on the audio clock) the change is made then, not now: automation
  | { type: 'params'; params: Partial<VoiceParams>; time?: number }
  // forgets the timed changes that have not happened yet
  | { type: 'unschedule' }
  // null takes the lane's recording away, and it plays its oscillators
  | { type: 'sample'; sample: SynthSample | null }
  | ({ type: 'noteOn' } & NoteOnMessage)
  | { type: 'noteOff'; note: string; id?: number }
  // A controller's pitch bend (-1 to 1) and mod wheel (0 to 1): live gestures, never part of the sound
  | { type: 'live'; bend?: number; wheel?: number }
  | { type: 'allNotesOff'; release?: number };

export type DrumWorkletMessage =
  | ({ type: 'hit' } & DrumHitMessage)
  // null puts the lane back on its synthesized voice
  | { type: 'sample'; instrument: DrumInstrument; sample: DrumSample | null }
  // the recordings the cymbal lane plays, by kind of cymbal
  | { type: 'cymbals'; cymbals: Partial<Record<CymbalType, DrumSample>> }
  | { type: 'stopAll' };

export type GuestPlayerMessage =
  // `frame` is where the block starts on the audio context's clock
  | { type: 'block'; frame: number; left: Float32Array; right: Float32Array }
  | { type: 'clear' };
