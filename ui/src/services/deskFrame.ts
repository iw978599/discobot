import { RACK_UNITS, asRackUnit, laneUnit, unitLane, type RackUnit } from './rackView';

// The desk layout's frame (docs/DESK_LAYOUT_PLAN.md, stage 2): which track the dock is about, which
// of its tabs shows, and how tall it is. All of it is this browser's, never the project's, and none
// of it is the studio's: the units are hidden by CSS, never taken away.

// A track the dock can be about: a lane, the drums or the guests.
export type DeskTrack = Exclude<RackUnit, 'song' | 'mixer' | 'effects' | 'all'>;
// What the dock shows: the selected track's unit, the mixer or the effects.
export type DeskTab = 'track' | 'mixer' | 'effects';

export const DESK_TRACKS: readonly DeskTrack[] = RACK_UNITS.filter((unit): unit is DeskTrack => unit !== 'song' && unit !== 'mixer' && unit !== 'effects' && unit !== 'all');
export const DESK_TABS: readonly DeskTab[] = ['track', 'mixer', 'effects'];

export const asDeskTrack = (value: unknown): DeskTrack | null => {
  const unit = asRackUnit(value);
  return unit !== null && DESK_TRACKS.includes(unit as DeskTrack) ? unit as DeskTrack : null;
};
export const asDeskTab = (value: unknown): DeskTab | null => (DESK_TABS.includes(value as DeskTab) ? value as DeskTab : null);

// The unit the dock shows, as the page's data-dock says it.
export const dockUnit = (track: DeskTrack, tab: DeskTab): RackUnit => (tab === 'track' ? track : tab);
export const trackLane = (track: DeskTrack): number | null => unitLane(track);

export interface DeskDock { track: DeskTrack | null; tab: DeskTab }

const DOCK_KEY = 'discobot_desk_dock_v1';
const HEIGHT_KEY = 'discobot_desk_dock_height_v1';

export function readDock(raw: string | null): DeskDock {
  let value: unknown;
  try { value = raw === null ? null : JSON.parse(raw); } catch { value = null; }
  const entry = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { track: asDeskTrack(entry.track), tab: asDeskTab(entry.tab) ?? 'track' };
}

export function storedDock(): DeskDock {
  try { return readDock(localStorage.getItem(DOCK_KEY)); } catch { return readDock(null); }
}

export function storeDock(dock: DeskDock) {
  try { localStorage.setItem(DOCK_KEY, JSON.stringify({ track: dock.track ?? undefined, tab: dock.tab })); } catch { /* the next visit starts on the open lane */ }
}

export const DOCK_MIN = 160;
export const DOCK_DEFAULT = 300;
export const DOCK_STEP = 24;
const DOCK_MAX_SHARE = 0.85;

// The tallest the dock may be on a screen this high: most of it, but never so tall that the top bar, the
// song and the track rows lose the room they need (DOCK_ROOM), or the rows are squeezed out of reach.
const DOCK_ROOM = 380;
export const dockMax = (viewport: number) => Math.max(DOCK_MIN, Math.min(Math.floor(viewport * DOCK_MAX_SHARE), viewport - DOCK_ROOM));

export function clampDockHeight(height: number, viewport: number): number {
  const value = Number.isFinite(height) ? Math.round(height) : DOCK_DEFAULT;
  return Math.min(dockMax(viewport), Math.max(DOCK_MIN, value));
}

// A stored height as a number, or nothing when it is not one. It is clamped only where it is applied,
// so a window made smaller and larger again keeps what was chosen.
export function readDockHeight(raw: string | null): number {
  const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DOCK_DEFAULT;
}

export function storedDockHeight(): number {
  try { return readDockHeight(localStorage.getItem(HEIGHT_KEY)); } catch { return DOCK_DEFAULT; }
}

export function storeDockHeight(height: number) {
  try { localStorage.setItem(HEIGHT_KEY, String(Math.round(height))); } catch { /* kept for this visit only */ }
}

// What a key does to the dock's height: an arrow moves it a step (Up is taller, as the handle is above
// the dock), Home is the shortest and End the tallest. Anything else is not for the handle.
export function dockKeyHeight(key: string, height: number, viewport: number): number | null {
  const next = key === 'ArrowUp' ? height + DOCK_STEP : key === 'ArrowDown' ? height - DOCK_STEP
    : key === 'Home' ? DOCK_MIN : key === 'End' ? dockMax(viewport) : null;
  return next === null ? null : clampDockHeight(next, viewport);
}

export const laneTrack = (id: number): DeskTrack => laneUnit(id) as DeskTrack;

// Whether the drums are folded open into their rows in the overview. This browser's, like the dock.
const DRUMS_OPEN_KEY = 'discobot_desk_drums_open_v1';

export const readDrumsOpen = (raw: string | null): boolean => raw === 'open';

export function storedDrumsOpen(): boolean {
  try { return readDrumsOpen(localStorage.getItem(DRUMS_OPEN_KEY)); } catch { return false; }
}

export function storeDrumsOpen(open: boolean) {
  try { localStorage.setItem(DRUMS_OPEN_KEY, open ? 'open' : 'closed'); } catch { /* kept for this visit only */ }
}
