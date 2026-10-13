import type { DrumInstrument, DrumState, MuteFlags, Scene, SequencerStep, Song } from '../types';
import { barQuarters, barSteps, barTicks, sceneAsBars } from './patternLength';

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

// A scene's time signature, by its id. The song helpers that count time, not bars, ask for one.
// Without one every scene is in 4/4.
export type SceneSignature = (sceneId: string) => unknown;
const fourFour: SceneSignature = () => undefined;

export interface SongTick extends SongPosition {
  // how many of the transport's ticks into that bar
  tick: number;
}

// How many of the transport's ticks a song lasts. A scene's bars are as long as its time
// signature makes them, so this is not the bar count times anything.
export function songLengthTicks(song: Song, lengthOf: SceneLength = oneBar, signatureOf: SceneSignature = fourFour): number {
  return song.entries.reduce((total, entry) => total + entry.repeats * passBars(lengthOf, entry.sceneId) * barTicks(signatureOf(entry.sceneId)), 0);
}

// The first tick of an entry, so playback can start from any block in the chain.
export function entryStartTick(song: Song, entryIndex: number, lengthOf: SceneLength = oneBar, signatureOf: SceneSignature = fourFour): number {
  return songLengthTicks({ ...song, entries: song.entries.slice(0, Math.max(0, entryIndex)) }, lengthOf, signatureOf);
}

// Which scene plays on a given tick of the song, which bar of it, and where in that bar. This is
// what playback uses: scenes of different time signatures follow each other, so the transport's
// ticks cannot be turned into a bar number without walking the song. Null means the song has ended.
export function sceneAtTick(song: Song, tick: number, lengthOf: SceneLength = oneBar, signatureOf: SceneSignature = fourFour): SongTick | null {
  const length = songLengthTicks(song, lengthOf, signatureOf);
  if (length === 0 || tick < 0) return null;
  if (tick >= length && !song.loop) return null;
  let remaining = tick % length;
  for (let entryIndex = 0; entryIndex < song.entries.length; entryIndex++) {
    const entry = song.entries[entryIndex], perBar = barTicks(signatureOf(entry.sceneId)), pass = passBars(lengthOf, entry.sceneId) * perBar;
    if (remaining < entry.repeats * pass) {
      const inPass = remaining % pass;
      return { sceneId: entry.sceneId, entryIndex, repeat: Math.floor(remaining / pass), bar: Math.floor(inPass / perBar), tick: inPass % perBar };
    }
    remaining -= entry.repeats * pass;
  }
  return null;
}

// Minutes and seconds, to the nearest second.
export function songClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds) || 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export interface SongRow {
  sceneId: string;
  repeats: number;
  // one pass through the scene, and every pass of this entry together
  passBars: number;
  bars: number;
  startBar: number;
  startSeconds: number;
  seconds: number;
}

// The song an entry at a time, in playing order, with where each starts and how long it lasts.
// A bar lasts as long as its scene's time signature makes it: four beats in 4/4.
export function songRows(song: Song, lengthOf: SceneLength = oneBar, tempo = 120, signatureOf: SceneSignature = fourFour): SongRow[] {
  const beatSeconds = 60 / (tempo > 0 ? tempo : 120);
  let startBar = 0, startBeats = 0;
  return song.entries.map(entry => {
    const pass = passBars(lengthOf, entry.sceneId), bars = pass * entry.repeats, beats = bars * barQuarters(signatureOf(entry.sceneId));
    const row = { sceneId: entry.sceneId, repeats: entry.repeats, passBars: pass, bars, startBar, startSeconds: startBeats * beatSeconds, seconds: beats * beatSeconds };
    startBar += bars;
    startBeats += beats;
    return row;
  });
}

// How long a song lasts, in seconds: its quarter notes at the tempo.
export function songSeconds(song: Song, lengthOf: SceneLength = oneBar, tempo = 120, signatureOf: SceneSignature = fourFour): number {
  const beats = song.entries.reduce((total, entry) => total + entry.repeats * passBars(lengthOf, entry.sceneId) * barQuarters(signatureOf(entry.sceneId)), 0);
  return beats * 60 / (tempo > 0 ? tempo : 120);
}

// Edits to the order of a song. Each also says where the marked starting entry is afterwards,
// so the mark stays on the entry it was on (or the nearest, when that one is taken out).
export interface SongOrder { entries: Song['entries']; start: number }

export function moveSongEntry(entries: Song['entries'], start: number, from: number, to: number): SongOrder {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return { entries, start };
  const next = [...entries];
  next.splice(to, 0, ...next.splice(from, 1));
  const moved = start === from ? to : start > from && start <= to ? start - 1 : start < from && start >= to ? start + 1 : start;
  return { entries: next, start: moved };
}

// A song always has at least one entry, so the last one is never taken out.
export function removeSongEntry(entries: Song['entries'], start: number, index: number): SongOrder {
  if (entries.length < 2 || index < 0 || index >= entries.length) return { entries, start };
  const next = entries.filter((_, i) => i !== index);
  return { entries: next, start: Math.max(0, Math.min(next.length - 1, start > index ? start - 1 : start)) };
}

export function insertSongEntry(entries: Song['entries'], start: number, at: number, sceneId: string): SongOrder {
  if (entries.length >= MAX_SONG_ENTRIES) return { entries, start };
  const index = Math.max(0, Math.min(entries.length, at));
  return { entries: [...entries.slice(0, index), { sceneId, repeats: 1 }, ...entries.slice(index)], start: start >= index ? start + 1 : start };
}

export function repeatSongEntry(entries: Song['entries'], index: number, repeats: number): Song['entries'] {
  const held = Math.max(1, Math.min(MAX_REPEATS, Math.round(repeats) || 1));
  return entries.map((entry, i) => (i === index ? { ...entry, repeats: held } : entry));
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

// A lane's mute and solo in a scene: the scene's own where it has them, the project's otherwise.
export function laneFlags(scene: Pick<Scene, 'mutes'> | null | undefined, lane: { id: number; muted?: boolean; solo?: boolean }): MuteFlags {
  return scene?.mutes?.lanes?.[lane.id] ?? { muted: lane.muted === true, solo: lane.solo === true };
}

// The synth lanes heard in a scene, once its mutes and solos are applied.
export function audibleLanes(scene: Pick<Scene, 'mutes'> | null | undefined, lanes: Array<{ id: number; muted?: boolean; solo?: boolean }>): Set<number> {
  const flags = lanes.map(lane => ({ id: lane.id, ...laneFlags(scene, lane) }));
  const solo = flags.some(lane => lane.solo);
  return new Set(flags.filter(lane => !lane.muted && (!solo || lane.solo)).map(lane => lane.id));
}

// A song's bars with every lane that is silent in its scene emptied. Exporters then treat
// every lane as unmuted, because the muting has already happened bar by bar.
export function applySceneMutes(bars: Scene[], lanes: Array<{ id: number; muted?: boolean; solo?: boolean }>): Scene[] {
  return bars.map(bar => {
    const heard = audibleLanes(bar, lanes);
    return { ...bar, lanes: Object.fromEntries(Object.entries(bar.lanes).map(([id, steps]) => [id, heard.has(Number(id)) ? steps : []])) };
  });
}

// A guest's level in each bar of a song: its scene's own, and nothing where the scene mutes it.
// A scene from before the guest was added holds no level for it, and the guest carries on as it was.
export function guestBarGains(bars: Scene[], guest: { id: string; volume: number; muted: boolean }): number[] {
  let mix = { volume: guest.volume, muted: guest.muted };
  return bars.map(bar => {
    mix = bar.guestMix?.[guest.id] ?? mix;
    return mix.muted ? 0 : mix.volume;
  });
}

// A scene stores which drum steps are on and which lanes are muted. The sound of the kit
// belongs to the whole project; this puts the two together for playback.
export function sceneDrumState(scene: Scene, kit: DrumState): DrumState {
  return Object.fromEntries((Object.keys(kit) as DrumInstrument[]).map(instrument => {
    const pattern = scene.drums[instrument];
    return [instrument, {
      settings: kit[instrument].settings,
      muted: scene.mutes?.drums?.[instrument]?.muted ?? kit[instrument].muted, solo: scene.mutes?.drums?.[instrument]?.solo ?? kit[instrument].solo,
      ...(kit[instrument].sampleId ? { sampleId: kit[instrument].sampleId } : {}),
      steps: pattern?.steps ?? Array(barSteps(scene.signature)).fill(false),
      ...(pattern?.stepVelocities ? { stepVelocities: pattern.stepVelocities } : {}),
      ...(pattern?.stepProbabilities ? { stepProbabilities: pattern.stepProbabilities } : {}),
      ...(pattern?.stepRatchets ? { stepRatchets: pattern.stepRatchets } : {}),
    }];
  })) as DrumState;
}
