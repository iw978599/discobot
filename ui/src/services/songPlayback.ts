import type { DrumInstrument, DrumState, Scene, SequencerStep, Song } from '../types';
import { sceneAsBars } from './patternLength';

export interface SongPosition {
  sceneId: string;
  entryIndex: number;
  // which pass through this entry, counting from 0
  repeat: number;
  // how many bars into that pass; always 0 for a one-bar scene
  bar: number;
}

export const MAX_SONG_ENTRIES = 128;
export const MAX_REPEATS = 64;

// How many bars one pass through a scene lasts. The scene open for editing has to be asked
// about live, because its stored copy may be behind; callers supply this.
export type SceneLength = (sceneId: string) => number;
const oneBar: SceneLength = () => 1;
const passBars = (lengthOf: SceneLength, sceneId: string) => Math.max(1, Math.round(lengthOf(sceneId)) || 1);

export function songLengthBars(song: Song, lengthOf: SceneLength = oneBar): number {
  return song.entries.reduce((total, entry) => total + entry.repeats * passBars(lengthOf, entry.sceneId), 0);
}

// The first bar of an entry, so playback can start from any block in the chain.
export function entryStartBar(song: Song, entryIndex: number, lengthOf: SceneLength = oneBar): number {
  return songLengthBars({ ...song, entries: song.entries.slice(0, Math.max(0, entryIndex)) }, lengthOf);
}

// Which scene plays in a given bar of the song, and where in it. Null means the song has ended.
export function sceneAtBar(song: Song, bar: number, lengthOf: SceneLength = oneBar): SongPosition | null {
  const length = songLengthBars(song, lengthOf);
  if (length === 0 || bar < 0) return null;
  if (bar >= length && !song.loop) return null;
  let remaining = bar % length;
  for (let entryIndex = 0; entryIndex < song.entries.length; entryIndex++) {
    const entry = song.entries[entryIndex], pass = passBars(lengthOf, entry.sceneId);
    if (remaining < entry.repeats * pass) return { sceneId: entry.sceneId, entryIndex, repeat: Math.floor(remaining / pass), bar: remaining % pass };
    remaining -= entry.repeats * pass;
  }
  return null;
}

// The song a bar at a time, in order, for export: each entry is a one-bar slice of its scene.
export function songBars(song: Song, scenes: Scene[]): Scene[] {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  return song.entries.flatMap(entry => {
    const scene = byId.get(entry.sceneId);
    if (!scene) return [];
    const pass = sceneAsBars(scene);
    return Array.from({ length: entry.repeats }, () => pass).flat();
  });
}

export const emptySteps = (count = 16): SequencerStep[] => Array.from({ length: count }, () => ({ active: false, velocity: 0.7 }));

// A scene only stores which drum steps are on. The sound of the kit, and its mutes and
// solos, belong to the whole project; this puts the two together for playback.
export function sceneDrumState(scene: Scene, kit: DrumState): DrumState {
  return Object.fromEntries((Object.keys(kit) as DrumInstrument[]).map(instrument => {
    const pattern = scene.drums[instrument];
    return [instrument, {
      settings: kit[instrument].settings, muted: kit[instrument].muted, solo: kit[instrument].solo,
      ...(kit[instrument].sampleId ? { sampleId: kit[instrument].sampleId } : {}),
      steps: pattern?.steps ?? Array(16).fill(false),
      ...(pattern?.stepVelocities ? { stepVelocities: pattern.stepVelocities } : {}),
      ...(pattern?.stepProbabilities ? { stepProbabilities: pattern.stepProbabilities } : {}),
      ...(pattern?.stepRatchets ? { stepRatchets: pattern.stepRatchets } : {}),
    }];
  })) as DrumState;
}
