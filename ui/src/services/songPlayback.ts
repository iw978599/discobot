import type { DrumInstrument, DrumState, Scene, SequencerStep, Song } from '../types';

export interface SongPosition {
  sceneId: string;
  entryIndex: number;
  // which pass through this entry, counting from 0
  repeat: number;
}

export const MAX_SONG_ENTRIES = 128;
export const MAX_REPEATS = 64;

export function songLengthBars(song: Song): number {
  return song.entries.reduce((total, entry) => total + entry.repeats, 0);
}

// The first bar of an entry, so playback can start from any block in the chain.
export function entryStartBar(song: Song, entryIndex: number): number {
  return song.entries.slice(0, Math.max(0, entryIndex)).reduce((total, entry) => total + entry.repeats, 0);
}

// Which scene plays in a given bar of the song. Null means the song has ended.
export function sceneAtBar(song: Song, bar: number): SongPosition | null {
  const length = songLengthBars(song);
  if (length === 0 || bar < 0) return null;
  if (bar >= length && !song.loop) return null;
  let remaining = bar % length;
  for (let entryIndex = 0; entryIndex < song.entries.length; entryIndex++) {
    const entry = song.entries[entryIndex];
    if (remaining < entry.repeats) return { sceneId: entry.sceneId, entryIndex, repeat: remaining };
    remaining -= entry.repeats;
  }
  return null;
}

// The song as one scene per bar, in order, for export.
export function songBars(song: Song, scenes: Scene[]): Scene[] {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  return song.entries.flatMap(entry => {
    const scene = byId.get(entry.sceneId);
    return scene ? Array.from({ length: entry.repeats }, () => scene) : [];
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
      steps: pattern?.steps ?? Array(16).fill(false),
      ...(pattern?.stepVelocities ? { stepVelocities: pattern.stepVelocities } : {}),
      ...(pattern?.stepProbabilities ? { stepProbabilities: pattern.stepProbabilities } : {}),
      ...(pattern?.stepRatchets ? { stepRatchets: pattern.stepRatchets } : {}),
    }];
  })) as DrumState;
}
