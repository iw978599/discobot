// Which part of the rack a narrow screen shows. A phone has room for one unit at a time, so the
// rack is paged: a lane, the drums, the mixer, the song, the effects or the guests, or all of them as one
// long page. The choice is kept per browser, not with the project: it is about the screen.
export const RACK_UNITS = ['song', 'synth-1', 'synth-2', 'synth-3', 'synth-4', 'synth-5', 'guests', 'drums', 'mixer', 'effects', 'all'] as const;
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

// Which units are folded down to their name plate by their Hide button (design review 27), kept per
// browser like the unit on show. The mixer's Hide came first, under a key of its own: a browser that
// has only that one starts with the mixer folded and nothing else. Guests never fold, since their
// page would be closed and their sound stopped.
const FOLDED_KEY = 'discobot_folded_units_v1';
const MIXER_KEY = 'discobot_mixer_hidden_v1';
export const FOLDING_UNITS: readonly RackUnit[] = RACK_UNITS.filter(unit => unit !== 'guests' && unit !== 'all');

export function readFolded(stored: { getItem(key: string): string | null }): ReadonlySet<RackUnit> {
  const raw = stored.getItem(FOLDED_KEY);
  if (raw === null) return new Set<RackUnit>(stored.getItem(MIXER_KEY) === '1' ? ['mixer'] : []);
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return new Set(); }
  return new Set(Array.isArray(list) ? list.filter((unit): unit is RackUnit => FOLDING_UNITS.includes(unit as RackUnit)) : []);
}

let folded: ReadonlySet<RackUnit> | null = null;
const foldListeners = new Set<() => void>();
export const foldedUnits = {
  get(): ReadonlySet<RackUnit> {
    if (!folded) { try { folded = readFolded(localStorage); } catch { folded = new Set(); } }
    return folded;
  },
  set(unit: RackUnit, fold: boolean) {
    if (!FOLDING_UNITS.includes(unit) || foldedUnits.get().has(unit) === fold) return;
    const next = new Set(foldedUnits.get());
    if (fold) next.add(unit); else next.delete(unit);
    folded = next;
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...next])); localStorage.removeItem(MIXER_KEY); } catch { /* folded for this visit only */ }
    foldListeners.forEach(listener => listener());
  },
  subscribe(listener: () => void) { foldListeners.add(listener); return () => { foldListeners.delete(listener); }; },
};
