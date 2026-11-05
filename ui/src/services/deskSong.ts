import type { DrumState, Scene, SequencerStep, Song } from '../types';
import type { Guest } from './guests';
import type { AudioClip } from './audioTracks';
import { barTicks } from './patternLength';
import { stepNotes } from './noteScheduling';
import { audibleLanes, guestBarGains, sceneDrumState, type SceneLength, type SceneSignature } from './songPlayback';

// The desk's Song view (docs/DESK_LAYOUT_PLAN.md, stage 4): which of the tracks region's two views is
// shown, how the song's entries lie along it, and where each track plays. The view is this browser's,
// never the project's, and it only changes what the middle shows.

export const DESK_VIEWS = ['patterns', 'song'] as const;
export type DeskView = typeof DESK_VIEWS[number];

const VIEW_KEY = 'discobot_desk_view_v1';

export const asDeskView = (value: unknown): DeskView | null => (DESK_VIEWS.includes(value as DeskView) ? value as DeskView : null);

export function storedDeskView(): DeskView {
  try { return asDeskView(localStorage.getItem(VIEW_KEY)) ?? 'patterns'; } catch { return 'patterns'; }
}

export function storeDeskView(view: DeskView) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* the next visit starts on the patterns */ }
}

// One entry of the song laid along the ticks of the transport (32nd notes): `repeats` passes of its
// scene, each `bars` long at the scene's own bar length.
export interface EntryLayout {
  index: number;
  sceneId: string;
  name: string;
  color?: string;
  repeats: number;
  startTick: number;
  ticks: number;
  startBar: number;
  bars: number;
  perBar: number;
}

export interface SongLayout { entries: EntryLayout[]; ticks: number; bars: number }

export function songLayout(song: Song, scenes: Array<Pick<Scene, 'id' | 'name' | 'color'>>, lengthOf: SceneLength, signatureOf: SceneSignature): SongLayout {
  let tick = 0, bar = 0;
  const entries = song.entries.map((entry, index): EntryLayout => {
    const perBar = barTicks(signatureOf(entry.sceneId));
    const bars = entry.repeats * Math.max(1, Math.round(lengthOf(entry.sceneId)) || 1);
    const scene = scenes.find(item => item.id === entry.sceneId);
    const laid = { index, sceneId: entry.sceneId, name: scene?.name ?? '?', color: scene?.color, repeats: entry.repeats, startTick: tick, ticks: bars * perBar, startBar: bar, bars, perBar };
    tick += laid.ticks;
    bar += bars;
    return laid;
  });
  return { entries, ticks: tick, bars: bar };
}

// The bars the ruler labels, with the tick each starts on. A long song labels every few bars, so the
// numbers stay readable.
export function barMarks(layout: SongLayout, most = 40): Array<{ bar: number; tick: number }> {
  const every = Math.max(1, Math.ceil(layout.bars / most));
  const marks: Array<{ bar: number; tick: number }> = [];
  for (const entry of layout.entries) {
    for (let at = 0; at < entry.bars; at++) {
      const bar = entry.startBar + at;
      if (bar % every === 0) marks.push({ bar, tick: entry.startTick + at * entry.perBar });
    }
  }
  return marks;
}

// Where a clip ends, in ticks: at least one past where it starts.
export const clipEndTick = (clip: AudioClip, secondsOf: (tick: number) => number, tickAt: (seconds: number) => number) =>
  Math.max(clip.at + 1, tickAt(secondsOf(clip.at) + clip.length));

// The open scene as the live lanes and drums say it, because its stored copy may be behind. The mutes
// and the guests' levels are left to the live lanes, drums and guests, which are what they are in the
// open scene.
export function liveSceneOf(scene: Scene, synths: Array<{ id: number; pattern?: { steps: SequencerStep[] } | null }>, drums: DrumState, guests: Guest[]): Scene {
  return {
    ...scene,
    lanes: Object.fromEntries(synths.map(synth => [synth.id, synth.pattern?.steps ?? []])),
    drums: Object.fromEntries(Object.entries(drums).map(([row, track]) => [row, { steps: track.steps }])) as Scene['drums'],
    mutes: undefined,
    guestMix: Object.fromEntries(guests.map(guest => [guest.id, { volume: guest.volume, muted: guest.muted }])),
  };
}

type LaneFlags = { id: number; muted?: boolean; solo?: boolean };

// The synth lanes that make a sound in a scene: not muted there, not soloed over, and with a note.
export function lanesPlaying(scene: Scene, lanes: LaneFlags[]): Set<number> {
  const heard = audibleLanes(scene, lanes);
  return new Set(lanes.filter(lane => heard.has(lane.id) && (scene.lanes[lane.id] ?? []).some(step => stepNotes(step).length > 0)).map(lane => lane.id));
}

// Whether any drum row sounds in a scene, with the scene's own mutes and solos over the kit's.
export function drumsPlaying(scene: Scene, kit: DrumState): boolean {
  const state = sceneDrumState(scene, kit);
  const rows = Object.values(state);
  const solo = rows.some(row => row.solo);
  return rows.some(row => !row.muted && (!solo || row.solo) && row.steps.some(Boolean));
}

// For each scene in the order given (the song's entries, in order), whether the guest is up and not
// muted there. A scene that holds nothing for the guest carries on from the one before.
export function guestPlaying(scenes: Scene[], guest: Pick<Guest, 'id' | 'volume' | 'muted'>): boolean[] {
  return guestBarGains(scenes, guest).map(gain => gain > 0);
}

// The initials a person is shown by: up to two, from the starts of the parts of the name.
export function initials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length > 1 ? parts.slice(0, 2).map(part => [...part][0]) : [...parts[0]].slice(0, 2);
  return letters.join('').toUpperCase();
}

// What a place in a live session marks: the rack's unit, its switch on the bar of units, and, in the
// desk, the header of the track of that name. A place comes from another browser, so one that is not a
// plain unit name marks nothing.
export function presenceSelector(at: string): string | null {
  if (!/^[a-z0-9-]{1,40}$/.test(at)) return null;
  return `.rack [data-unit="${at}"], .unit-bar [data-tab="${at}"], .desk-tracks .desk-track[data-track="${at}"] > .desk-track-head`;
}
