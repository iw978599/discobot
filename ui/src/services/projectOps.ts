// The edits a project accepts, as data. `LocalProjectService.apply` is the one way in; the
// reducers that carry them out are in projectReducers.ts. See docs/TYPED_STORE_PLAN.md.
import type {
  DrumInstrument, DrumKitId, DrumSettings, DrumState, EffectsLoopState, FxSendLevels, Pattern, Scene, Song,
  SynthModelId, SynthModelParams, SynthParameters,
} from '../types';
import type { Guest } from './guests';
import type { ProjectLane } from './localService';

export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type DrumFxState = { sends: FxSendLevels; returnLevel: number };
// What can be changed on a guest. Each is changed only when it is there, and checked.
export type GuestPatch = Partial<Pick<Guest, 'name' | 'volume' | 'muted' | 'state' | 'sends'>>;

// Where an operation came from: an edit made here, one received from someone else, or undo and redo.
export type Origin = 'local' | 'remote' | 'history';

// An operation carries every id it creates, and nothing in it is read from the clock, so the
// same operation applied to the same project gives the same project anywhere.
export type Operation =
  | { type: 'tempo.set'; tempo: number }
  | { type: 'drum.swing'; swing: number }
  | { type: 'drum.masterVolume'; volume: number }
  | { type: 'drum.kit'; kitId: string; applyDefaults?: boolean }
  | { type: 'drum.state'; state: unknown }
  | { type: 'drum.reset' }
  | { type: 'drum.bars'; bars: number }
  | { type: 'drum.copyBar'; from: number; to: number[] }
  | { type: 'drum.step'; instrument: DrumInstrument; step: number; active: boolean }
  | { type: 'drum.stepVelocity'; instrument: DrumInstrument; step: number; velocity: number }
  | { type: 'drum.stepDetail'; instrument: DrumInstrument; step: number; probability?: number; ratchet?: number }
  | { type: 'drum.settings'; instrument: DrumInstrument; settings: Partial<DrumSettings> }
  | { type: 'drum.sample'; instrument: DrumInstrument; sampleId?: string }
  | { type: 'drum.mix'; instrument: DrumInstrument; muted?: boolean; solo?: boolean }
  | { type: 'drum.fx'; patch: DeepPartial<DrumFxState> }
  | { type: 'effects.set'; patch: DeepPartial<EffectsLoopState> }
  | { type: 'synth.create'; synthId?: number }
  | { type: 'synth.remove'; synthId: number }
  | { type: 'synth.params'; synthId: number; patch: DeepPartial<SynthParameters> }
  | { type: 'synth.model'; synthId: number; modelId?: SynthModelId; modelParams?: Partial<SynthModelParams> }
  | { type: 'synth.mix'; synthId: number; muted?: boolean; solo?: boolean }
  | { type: 'synth.prefs'; synthId: number; octaveShift?: number; keyboardMode?: 'keyboard' | 'piano-roll' }
  | { type: 'pattern.write'; synthId: number; patternId: string; patch: Partial<Pattern> }
  | { type: 'transport.play'; synthId: number; patternId?: string }
  | { type: 'transport.stop'; synthId: number; patternId?: string }
  | { type: 'scene.select'; sceneId: string }
  | { type: 'scene.delete'; sceneId: string }
  | { type: 'scene.create'; sceneId: string; name?: string; empty?: boolean }
  | { type: 'scene.rename'; sceneId: string; name: string }
  | { type: 'scene.color'; sceneId: string; color?: string }
  // The open scene's time signature: one of the six, with every lane and the drum grid resized to it.
  | { type: 'scene.signature'; signature: string }
  // One part of the open scene, a lane's notes or one drum's row, put into another scene.
  | { type: 'scene.copyPart'; toSceneId: string; synthId?: number; drum?: DrumInstrument }
  | { type: 'scene.replace'; scenes?: unknown; currentSceneId?: string; song?: unknown }
  | { type: 'song.set'; entries?: unknown; loop?: boolean }
  | { type: 'guest.add'; guestId: string; url: string; name?: string }
  | { type: 'guest.patch'; guestId: string; patch: GuestPatch }
  | { type: 'guest.remove'; guestId: string };

export type OpType = Operation['type'];

type DrumAnswer = { drumState: DrumState };
type GuestAnswer = { guests: Guest[] };
type SceneAnswer = {
  scenes: Scene[]; song: Song; currentSceneId: string;
  synths: Array<{ synthId: number; pattern: Pattern; muted: boolean; solo: boolean }>;
  drumState: DrumState; guests: Guest[];
};
type Total<T extends Record<OpType, unknown>> = T;
// What each operation answers when it is accepted: exactly what its route answered.
type OpResults = Total<{
  'tempo.set': { tempo: number };
  'drum.swing': { swing: number };
  'drum.masterVolume': { volume: number };
  'drum.kit': { selectedDrumKitId: DrumKitId; drumState: DrumState };
  'drum.state': DrumAnswer;
  'drum.reset': DrumAnswer;
  'drum.bars': DrumAnswer;
  'drum.copyBar': DrumAnswer;
  'drum.step': DrumAnswer;
  'drum.stepVelocity': DrumAnswer;
  'drum.stepDetail': DrumAnswer;
  'drum.settings': DrumAnswer;
  'drum.sample': DrumAnswer;
  'drum.mix': DrumAnswer;
  'drum.fx': { drumFx: DrumFxState };
  'effects.set': { effectsLoop: EffectsLoopState };
  'synth.create': ProjectLane;
  'synth.remove': { synthId: number };
  'synth.params': SynthParameters;
  'synth.model': { synthId: number; modelId: SynthModelId; modelParams: SynthModelParams };
  'synth.mix': { synthId: number; muted: boolean; solo: boolean };
  'synth.prefs': ProjectLane;
  'pattern.write': Pattern;
  'transport.play': { success: boolean };
  'transport.stop': { success: boolean };
  'scene.select': SceneAnswer;
  'scene.delete': SceneAnswer;
  'scene.create': SceneAnswer;
  'scene.rename': SceneAnswer;
  'scene.color': SceneAnswer;
  'scene.signature': SceneAnswer;
  'scene.copyPart': SceneAnswer;
  'scene.replace': SceneAnswer;
  'song.set': SceneAnswer;
  'guest.add': GuestAnswer;
  'guest.patch': GuestAnswer;
  'guest.remove': GuestAnswer;
}>;
export type OpResult<T extends OpType> = OpResults[T];

// What were answers of 400, 404 and 409. A refused operation has changed nothing.
export type Rejected = { ok: false; status: 400 | 404 | 409; error: string };
export type Applied<V> = { ok: true; value: V } | Rejected;
// What a reducer hands back: the answer, whether to save, and the event to send.
export type Outcome<V> = Applied<V> & { save?: boolean; event?: { type: string; data: unknown } };
// What `subscribeOps` listeners are told, once for each accepted operation.
export interface OpNotice { op: Operation; origin: Origin; saved: boolean }

// What kind of state each operation changes. `save`: an accepted one schedules a save.
// `undoable`: it belongs on the undo stack. `share`: it would be sent to someone editing the
// same project. Playing is not project state, and a lane's octave and keyboard are this
// person's view of it.
export const OP_META: Record<OpType, { save: boolean; undoable: boolean; share: boolean }> = {
  'tempo.set': { save: true, undoable: true, share: true },
  'drum.swing': { save: true, undoable: true, share: true },
  'drum.masterVolume': { save: true, undoable: true, share: true },
  'drum.kit': { save: true, undoable: false, share: true },
  'drum.state': { save: true, undoable: true, share: true },
  'drum.reset': { save: true, undoable: true, share: true },
  'drum.bars': { save: true, undoable: true, share: true },
  'drum.copyBar': { save: true, undoable: true, share: true },
  'drum.step': { save: true, undoable: true, share: true },
  'drum.stepVelocity': { save: true, undoable: true, share: true },
  'drum.stepDetail': { save: true, undoable: true, share: true },
  'drum.settings': { save: true, undoable: true, share: true },
  'drum.sample': { save: true, undoable: false, share: true },
  'drum.mix': { save: true, undoable: true, share: true },
  'drum.fx': { save: true, undoable: true, share: true },
  'effects.set': { save: true, undoable: true, share: true },
  'synth.create': { save: true, undoable: false, share: true },
  'synth.remove': { save: true, undoable: false, share: true },
  'synth.params': { save: true, undoable: true, share: true },
  'synth.model': { save: true, undoable: true, share: true },
  'synth.mix': { save: true, undoable: false, share: true },
  'synth.prefs': { save: true, undoable: false, share: false },
  'pattern.write': { save: true, undoable: true, share: true },
  'transport.play': { save: false, undoable: false, share: false },
  'transport.stop': { save: false, undoable: false, share: false },
  'scene.select': { save: true, undoable: false, share: true },
  'scene.delete': { save: true, undoable: false, share: true },
  'scene.create': { save: true, undoable: false, share: true },
  'scene.rename': { save: true, undoable: false, share: true },
  'scene.color': { save: true, undoable: false, share: true },
  'scene.signature': { save: true, undoable: true, share: true },
  'scene.copyPart': { save: true, undoable: false, share: true },
  'scene.replace': { save: true, undoable: false, share: true },
  'song.set': { save: true, undoable: false, share: true },
  'guest.add': { save: true, undoable: false, share: true },
  'guest.patch': { save: true, undoable: false, share: true },
  'guest.remove': { save: true, undoable: false, share: true },
};
