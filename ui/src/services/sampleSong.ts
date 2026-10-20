import type { Automation, DrumInstrument, DrumKitId, DrumSettings, EffectsLoopState, FxSendLevels, Scene, SequencerStep, Song, SynthParameters, SynthModelId, SynthModelParams, TimeSignature } from '../types';
import { withStepNotes } from './noteScheduling';
import { barSteps } from './patternLength';
import { EFFECTS_DEFAULT } from './effectSettings';

// Whole songs to open and take apart, offered on an empty project beside the starting beats. Each
// is described as data (`SampleSong`, the songs themselves are in sampleSongs.ts) and built as a
// project file from the project that is open, then opened the way any file is, as a new project,
// so nothing a person has is changed. Nobody can write a good song by reasoning alone: these were
// made, and are to be changed as the owner hears them.

// A note or a chord put on a step: the step in its bar (sixteenths from 0), the notes, how many
// steps they last, how hard, and anything else the step has (a strum, a slide, a late start).
export type Placed = [step: number, notes: string | string[], length?: number, velocity?: number, extra?: Partial<SequencerStep>];
// A bar of drums: for each drum, the steps it hits, with a strength and a number of repeats where
// they are not full and one.
export type Hits = Partial<Record<DrumInstrument, Array<number | [step: number, velocity: number, repeats?: number]>>>;
type Lanes = 1 | 2 | 3;

export interface SongScene {
  id: string;
  name: string;
  color: string;
  // absent is 4/4
  signature?: TimeSignature;
  // 1, 2, 4 or 8
  bars: number;
  // each lane's notes, a list of them for each bar; a lane left out is silent in the scene
  lanes: Partial<Record<Lanes, Placed[][]>>;
  // a lane's automation, a value or nothing for every step of the scene
  automation?: Partial<Record<Lanes, Automation>>;
  drums: Hits[];
}

export interface SongLane {
  // a built-in preset's id
  preset: string;
  // laid over the preset's sound: an insert, a send, the arpeggiator
  sound?: Record<string, unknown>;
  octaveShift?: number;
  swing?: boolean;
}

export interface SampleSong {
  id: string;
  name: string;
  // what it is, in a word or two, and what it shows
  genre: string;
  hint: string;
  tempo: number;
  drumSwing?: number;
  kit: DrumKitId;
  lanes: SongLane[];
  // laid over each drum's settings: another kind of cymbal, a percussion in place of a drum, a tune
  drums?: Partial<Record<DrumInstrument, Partial<DrumSettings>>>;
  drumSends?: Partial<FxSendLevels>;
  // laid over the effects a new project has
  effects?: Record<string, unknown>;
  scenes: SongScene[];
  order: Array<[sceneId: string, repeats: number]>;
}

const DRUMS: DrumInstrument[] = ['kick', 'snare', 'openHH', 'closedHH', 'ride', 'crash', 'snare2', 'clap'];
type Json = Record<string, any>;

// Objects are laid over objects; anything else takes the place of what was there.
export function layOver<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch) || base === null || typeof base !== 'object' || Array.isArray(base)) return (patch === undefined ? base : patch) as T;
  const out: Json = { ...(base as Json) };
  for (const [key, value] of Object.entries(patch as Json)) out[key] = layOver(out[key], value);
  return out as T;
}

function lane(blank: SequencerStep, scene: SongScene, bars: Placed[][]): SequencerStep[] {
  const per = barSteps(scene.signature);
  const steps = Array.from({ length: scene.bars * per }, () => ({ ...blank }));
  bars.forEach((bar, index) => {
    for (const [step, notes, length = 1, velocity = 0.9, extra = {}] of bar) {
      steps[index * per + step] = { ...withStepNotes(blank, Array.isArray(notes) ? notes : [notes]), velocity, ...(length > 1 ? { length } : {}), ...extra };
    }
  });
  return steps;
}

function grid(scene: SongScene): Scene['drums'] {
  const per = barSteps(scene.signature), length = scene.bars * per;
  return Object.fromEntries(DRUMS.map((instrument) => {
    const steps = Array<boolean>(length).fill(false), stepVelocities = Array<number>(length).fill(1), stepRatchets = Array<number>(length).fill(1);
    scene.drums.forEach((bar, index) => {
      for (const hit of bar[instrument] ?? []) {
        const [step, velocity, repeats = 1] = Array.isArray(hit) ? hit : [hit, 1];
        steps[index * per + step] = true;
        stepVelocities[index * per + step] = velocity;
        stepRatchets[index * per + step] = repeats;
      }
    });
    return [instrument, { steps, stepVelocities, ...(stepRatchets.some(count => count > 1) ? { stepRatchets } : {}) }];
  })) as Scene['drums'];
}

type Sound = { id: string; params: SynthParameters; modelId: SynthModelId; modelParams: SynthModelParams };

// The song as a project file, made from the file of the project that is open (for its shape) and
// the app's own sounds. Null if that file is not one, or a sound the song names is missing.
export function buildSampleSong(file: unknown, sounds: Sound[], song: SampleSong): unknown | null {
  const source = file as Json | null;
  const first = source?.project?.synths?.[0];
  const chosen = song.lanes.map(entry => sounds.find(sound => sound.id === entry.preset));
  if (!first?.pattern?.steps?.length || !source?.project?.drumState || chosen.some(sound => !sound)) return null;
  const project: Json = structuredClone(source.project);
  const blank = withStepNotes(first.pattern.steps[0] as SequencerStep, []);
  const ids = song.lanes.map((_, index) => (index + 1) as Lanes);

  const scenes: Scene[] = song.scenes.map(scene => ({
    id: scene.id, name: scene.name, color: scene.color,
    ...(scene.signature && scene.signature !== '4/4' ? { signature: scene.signature } : {}),
    lanes: Object.fromEntries(ids.map(id => [id, lane(blank, scene, scene.lanes[id] ?? [])])),
    laneBars: Object.fromEntries(ids.map(id => [id, scene.bars])),
    ...(scene.automation ? { laneAutomation: scene.automation as Record<number, Automation> } : {}),
    drums: grid(scene),
  }));
  const order: Song = { entries: song.order.map(([sceneId, repeats]) => ({ sceneId, repeats })), loop: false };

  // The lanes and the drum grid in a project are always its open scene: the first.
  const open = scenes[0], openScene = song.scenes[0];
  project.synths = ids.map((synthId, index) => {
    const from: Json = structuredClone(project.synths.find((entry: Json) => entry.synthId === synthId) ?? first);
    const sound = chosen[index]!, spec = song.lanes[index];
    const automation = openScene.automation?.[synthId];
    const { automation: _old, ...rest } = from.pattern;
    const pattern = { ...rest, id: `sample-lane-${synthId}`, steps: open.lanes[synthId], bars: openScene.bars, ...(automation ? { automation } : {}) };
    return {
      ...from, synthId, pattern, patterns: [pattern], muted: false, solo: false, isPlaying: false,
      synthParams: layOver(structuredClone(sound.params), spec.sound), synthModelId: sound.modelId, synthModelParams: { ...sound.modelParams },
      octaveShift: spec.octaveShift ?? 0, ...(spec.swing ? { swing: true } : {}),
    };
  });
  for (const instrument of DRUMS) {
    const was = project.drumState[instrument];
    const { stepProbabilities: _p, stepRatchets: _r, sampleId: _s, ...kept } = was;
    project.drumState[instrument] = {
      ...kept, ...open.drums[instrument], muted: false, solo: false,
      settings: { ...was.settings, ...(song.drums?.[instrument] ?? {}) },
    };
  }
  const effects: EffectsLoopState = layOver(structuredClone(EFFECTS_DEFAULT), song.effects ?? {});
  Object.assign(project, {
    name: song.name, tempo: song.tempo, drumSwing: song.drumSwing ?? 0, selectedDrumKitId: song.kit,
    effectsLoop: effects, drumFx: { ...project.drumFx, sends: { ...project.drumFx?.sends, ...song.drumSends } },
    scenes, currentSceneId: open.id, song: order, guests: [],
  });
  return { ...source, project };
}
