// Which part of the rack a narrow screen shows. A phone has room for one unit at a time, so the
// rack is paged: a lane, the drums, the mixer, the song, the effects or the guests, or all of them as one
// long page. The choice is kept per browser, not with the project: it is about the screen.
export const RACK_UNITS = ['song', 'synth-1', 'synth-2', 'synth-3', 'guests', 'drums', 'mixer', 'effects', 'all'] as const;
export type RackUnit = typeof RACK_UNITS[number];

const UNIT_KEY = 'discobot_rack_unit_v1';

export function asRackUnit(value: unknown): RackUnit | null {
  return RACK_UNITS.includes(value as RackUnit) ? value as RackUnit : null;
}

export const laneUnit = (synthId: number): RackUnit => asRackUnit(`synth-${synthId}`) ?? 'synth-1';

// The lane a unit is, or nothing for a unit that is not a lane.
export function unitLane(unit: RackUnit): number | null {
  const match = /^synth-(\d)$/.exec(unit);
  return match ? Number(match[1]) : null;
}

export function storedRackUnit(): RackUnit | null {
  try { return asRackUnit(localStorage.getItem(UNIT_KEY)); } catch { return null; }
}

export function storeRackUnit(unit: RackUnit) {
  try { localStorage.setItem(UNIT_KEY, unit); } catch { /* the next visit starts on the open lane */ }
}

// Whether the mixer's strips are put away behind its Hide button. Shown unless that was pressed.
const MIXER_KEY = 'discobot_mixer_hidden_v1';

export function storedMixerHidden(): boolean {
  try { return localStorage.getItem(MIXER_KEY) === '1'; } catch { return false; }
}

export function storeMixerHidden(hidden: boolean) {
  try { if (hidden) localStorage.setItem(MIXER_KEY, '1'); else localStorage.removeItem(MIXER_KEY); } catch { /* the next visit starts with the mixer shown */ }
}
