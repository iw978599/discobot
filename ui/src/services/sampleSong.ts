import type { Automation, DrumInstrument, DrumKitId, DrumSettings, EffectsLoopState, FxSendLevels, LaneSound, Scene, SequencerStep, Song, SynthParameters, SynthModelId, SynthModelParams, TimeSignature } from '../types';
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
// A bar of drums: for each drum, the steps it hits, with a strength, a number of repeats and a
// chance of playing where they are not full, one and always.
export type Hits = Partial<Record<DrumInstrument, Array<number | [step: number, velocity: number, repeats?: number, chance?: number]>>>;
// A lane by its number, 1 to 5.
type Lanes = number;

export interface SongScene {
  id: string;
  name: string;
  color: string;
  // absent is 4/4
  signature?: TimeSignature;
  // 1, 2, 4 or 8
  bars: number;
  // the scene's own tempo; absent is the song's
  tempo?: number;
  // each lane's notes, a list of them for each bar; a lane left out is silent in the scene
  lanes: Partial<Record<Lanes, Placed[][]>>;
  // a lane shorter than the scene (1, 2 or 4 bars), which loops against the rest; absent is the
  // scene's length. Its notes and automation are that many bars long.
  laneBars?: Partial<Record<Lanes, number>>;
  // a lane's automation, a value or nothing for every step of the lane
  automation?: Partial<Record<Lanes, Automation>>;
  // lanes and drums that keep their notes in the scene but are muted in it, to be unmuted
  mutes?: { lanes?: Lanes[]; drums?: DrumInstrument[] };
  // a lane's own instrument in this scene (docs/SCENE_SOUNDS_PLAN.md): a built-in preset at its own
  // level, with the lane's pan, sends and duck, and a sound laid over that.
  sounds?: Partial<Record<Lanes, SceneSound>>;
  // each guest's settings, level and mute in this scene, by the song's id for it; a guest the scene
  // does not name is muted in it. The settings are the guest's own, and only it reads them.
  guests?: Record<string, { state?: unknown; volume?: number }>;
  drums: Hits[];
}

export interface SceneSound {
  preset: string;
  sound?: Record<string, unknown>;
}

// A guest instrument the song plays (one of FEATURED_GUESTS), under an id of the guest id's shape.
// It is loaded only once the person allows its site, as any guest arriving in a project is.
export interface SongGuest {
  id: string;
  url: string;
  name: string;
  sends?: Partial<FxSendLevels>;
}

export interface SongLane {
  // a built-in preset's id
  preset: string;
  // what the lane is called, in place of "Synth N"
  name?: string;
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
  // the drums' master level, 0 to 1; absent is the project's own
  drumVolume?: number;
  // what every lane's level, and every automated level, is multiplied by, so that the song is mixed
  // as a whole without retuning each lane; absent is 1
  level?: number;
  kit: DrumKitId;
  lanes: SongLane[];
  // laid over each drum's settings: another kind of cymbal, a percussion in place of a drum, a tune
  drums?: Partial<Record<DrumInstrument, Partial<DrumSettings>>>;
  drumSends?: Partial<FxSendLevels>;
  // laid over the effects a new project has
  effects?: Record<string, unknown>;
  guests?: SongGuest[];
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

const barsOf = (scene: SongScene, id: Lanes) => scene.laneBars?.[id] ?? scene.bars;

function lane(blank: SequencerStep, scene: SongScene, id: Lanes): SequencerStep[] {
  const per = barSteps(scene.signature), bars = scene.lanes[id] ?? [];
  const steps = Array.from({ length: barsOf(scene, id) * per }, () => ({ ...blank }));
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
    const stepProbabilities = Array<number>(length).fill(1);
    scene.drums.forEach((bar, index) => {
      for (const hit of bar[instrument] ?? []) {
        const [step, velocity, repeats = 1, chance = 1] = Array.isArray(hit) ? hit : [hit, 1];
        steps[index * per + step] = true;
        stepVelocities[index * per + step] = velocity;
        stepRatchets[index * per + step] = repeats;
        stepProbabilities[index * per + step] = chance;
      }
    });
    return [instrument, {
      steps, stepVelocities, ...(stepProbabilities.some(chance => chance < 1) ? { stepProbabilities } : {}),
      ...(stepRatchets.some(count => count > 1) ? { stepRatchets } : {}),
    }];
  })) as Scene['drums'];
}

// A lane's level, and its automated levels, at the song's overall level.
const levelled = (params: SynthParameters, level: number): SynthParameters => ({ ...params, gain: Number((params.gain * level).toFixed(3)) });
const scaled = (automation: Record<number, Automation>, level: number): Record<number, Automation> => Object.fromEntries(Object.entries(automation).map(([lane, keys]) => [lane,
  Object.fromEntries(Object.entries(keys).map(([key, values]) => [key, key === 'level' ? values.map(value => (value === null ? null : Number((value * level).toFixed(3)))) : values])),
]));

type Sound = { id: string; name: string; params: SynthParameters; modelId: SynthModelId; modelParams: SynthModelParams };

// The song as a project file, made from the file of the project that is open (for its shape) and
// the app's own sounds. Null if that file is not one, or a sound the song names is missing.
export function buildSampleSong(file: unknown, sounds: Sound[], song: SampleSong): unknown | null {
  const source = file as Json | null;
  const first = source?.project?.synths?.[0];
  const chosen = song.lanes.map(entry => sounds.find(sound => sound.id === entry.preset));
  const sceneSounds = song.scenes.flatMap(scene => Object.values(scene.sounds ?? {})).map(entry => sounds.find(sound => sound.id === entry?.preset));
  if (!first?.pattern?.steps?.length || !source?.project?.drumState || [...chosen, ...sceneSounds].some(sound => !sound)) return null;
  // A scene's own instrument for a lane, made as a lane's sound is. It keeps where the lane is placed
  // and what it sends (its pan, sends and duck, as the song gives them) and takes the preset's level,
  // which is set so that presets of a kind are as loud as each other.
  const ownSound = (entry: SceneSound, lane: SongLane | undefined): LaneSound => {
    const sound = sounds.find(item => item.id === entry.preset)!;
    const placed = Object.fromEntries(['pan', 'fxSends', 'duck'].flatMap(key => (lane?.sound?.[key] !== undefined ? [[key, lane.sound[key]]] : [])));
    return { synthParams: levelled(layOver(layOver(structuredClone(sound.params), placed), entry.sound), song.level ?? 1), synthModelId: sound.modelId, synthModelParams: { ...sound.modelParams }, preset: sound.name };
  };
  const project: Json = structuredClone(source.project);
  const blank = withStepNotes(first.pattern.steps[0] as SequencerStep, []);
  const ids = song.lanes.map((_, index) => index + 1);

  const muted = (scene: SongScene) => ({
    lanes: Object.fromEntries(ids.map(id => [id, { muted: Boolean(scene.mutes?.lanes?.includes(id)), solo: false }])),
    drums: Object.fromEntries(DRUMS.map(instrument => [instrument, { muted: Boolean(scene.mutes?.drums?.includes(instrument)), solo: false }])),
  });
  const scenes: Scene[] = song.scenes.map(scene => ({
    id: scene.id, name: scene.name, color: scene.color,
    ...(scene.signature && scene.signature !== '4/4' ? { signature: scene.signature } : {}),
    ...(scene.tempo !== undefined ? { tempo: scene.tempo } : {}),
    lanes: Object.fromEntries(ids.map(id => [id, lane(blank, scene, id)])),
    laneBars: Object.fromEntries(ids.map(id => [id, barsOf(scene, id)])),
    ...(scene.automation ? { laneAutomation: scaled(scene.automation as Record<number, Automation>, song.level ?? 1) } : {}),
    // Every scene says its mutes, or one after a scene that mutes a lane would keep it muted.
    mutes: muted(scene),
    ...(scene.sounds ? { sounds: Object.fromEntries(Object.entries(scene.sounds).map(([id, entry]) => [id, ownSound(entry!, song.lanes[Number(id) - 1])])) } : {}),
    // Every scene says each guest's level and mute, for the same reason.
    ...(song.guests?.length ? {
      guestMix: Object.fromEntries(song.guests.map(guest => [guest.id, { volume: scene.guests?.[guest.id]?.volume ?? 0, muted: !scene.guests?.[guest.id] }])),
      ...(song.guests.some(guest => scene.guests?.[guest.id]?.state !== undefined)
        ? { guests: Object.fromEntries(song.guests.filter(guest => scene.guests?.[guest.id]?.state !== undefined).map(guest => [guest.id, scene.guests![guest.id].state])) } : {}),
    } : {}),
    drums: grid(scene),
  }));
  const order: Song = { entries: song.order.map(([sceneId, repeats]) => ({ sceneId, repeats })), loop: false };

  // The lanes and the drum grid in a project are always its open scene: the first.
  const open = scenes[0], openScene = song.scenes[0];
  project.synths = ids.map((synthId, index) => {
    const from: Json = structuredClone(project.synths.find((entry: Json) => entry.synthId === synthId) ?? first);
    const sound = chosen[index]!, spec = song.lanes[index];
    const automation = openScene.automation?.[synthId] && scaled({ [synthId]: openScene.automation[synthId]! }, song.level ?? 1)[synthId];
    const { automation: _old, ...rest } = from.pattern;
    const pattern = { ...rest, id: `sample-lane-${synthId}`, steps: open.lanes[synthId], bars: barsOf(openScene, synthId), ...(automation ? { automation } : {}) };
    return {
      ...from, synthId, pattern, patterns: [pattern], muted: Boolean(openScene.mutes?.lanes?.includes(synthId)), solo: false, isPlaying: false,
      synthParams: levelled(layOver(structuredClone(sound.params), spec.sound), song.level ?? 1), synthModelId: sound.modelId, synthModelParams: { ...sound.modelParams },
      octaveShift: spec.octaveShift ?? 0, ...(spec.swing ? { swing: true } : {}), name: spec.name, preset: sound.name,
    };
  });
  for (const instrument of DRUMS) {
    const was = project.drumState[instrument];
    const { stepProbabilities: _p, stepRatchets: _r, sampleId: _s, ...kept } = was;
    project.drumState[instrument] = {
      ...kept, ...open.drums[instrument], muted: Boolean(openScene.mutes?.drums?.includes(instrument)), solo: false,
      settings: { ...was.settings, ...(song.drums?.[instrument] ?? {}) },
    };
  }
  const effects: EffectsLoopState = layOver(structuredClone(EFFECTS_DEFAULT), song.effects ?? {});
  Object.assign(project, {
    name: song.name, tempo: song.tempo, drumSwing: song.drumSwing ?? 0, selectedDrumKitId: song.kit,    ...(song.drumVolume !== undefined ? { drumMasterVolume: song.drumVolume } : {}),
    effectsLoop: effects, drumFx: { ...project.drumFx, sends: { ...project.drumFx?.sends, ...song.drumSends } },
    scenes, currentSceneId: open.id, song: order,
    // The guests as the first scene has them; the store gives each the settings of the scene it opens.
    guests: (song.guests ?? []).map(guest => ({
      id: guest.id, url: guest.url, name: guest.name, ...open.guestMix?.[guest.id],
      ...(open.guests?.[guest.id] !== undefined ? { state: open.guests[guest.id] } : {}),
      ...(guest.sends ? { sends: { reverb: 0, delay: 0, drive: 0, phaser: 0, chorus: 0, ...guest.sends } } : {}),
    })),
  });
  return { ...source, project };
}
