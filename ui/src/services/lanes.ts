// The synth lanes a project can have. Synths 1 to 3 are where they have always been: a new project
// has all three, and one that is removed leaves an empty place on the rack to add it back. Synths 4
// and 5 are more, added one at a time from an Add Lane unit after the third, and shown only while
// they exist. Lane N plays on MIDI channel N.
export const MAX_LANES = 5;
export const STANDING_LANES = [1, 2, 3];
export const LANE_IDS = Array.from({ length: MAX_LANES }, (_, index) => index + 1);
// The longest name a lane can be given.
export const MAX_LANE_NAME = 24;

export const isLaneId = (id: unknown): id is number => Number.isInteger(id) && (id as number) >= 1 && (id as number) <= MAX_LANES;

// The order the lanes are shown in (`laneOrder` on the project, roadmap 20): every lane once. The
// owner decided on 2026-10-20 that moving a lane changes only where it is shown, never its number,
// its MIDI channel or its name. Anything else, or 1 to 5 in order, is none: the order as before.
export function laneOrderOf(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== MAX_LANES || !value.every(isLaneId) || new Set(value).size !== MAX_LANES) return undefined;
  return value.every((id, index) => id === LANE_IDS[index]) ? undefined : [...value];
}

// The lanes the rack shows, in order: the standing three (each a lane or an empty place), then any
// more there are, all in the project's order when it has one.
export function shownLanes(existing: number[], order?: number[]): number[] {
  const place = (id: number) => (order ?? LANE_IDS).indexOf(id);
  return [...STANDING_LANES, ...existing.filter(id => id > STANDING_LANES.length)].sort((a, b) => place(a) - place(b));
}

// The order after a lane is moved to `to` among the lanes on show. The lanes not on show keep their
// order after them, so a lane added later comes in after the ones there are.
export function movedLaneOrder(order: number[] | undefined, shown: number[], id: number, to: number): number[] {
  const from = shown.indexOf(id);
  if (from < 0) return order ?? LANE_IDS;
  const next = [...shown];
  next.splice(Math.max(0, Math.min(shown.length - 1, to)), 0, ...next.splice(from, 1));
  return [...next, ...(order ?? LANE_IDS).filter(lane => !next.includes(lane))];
}

// The lane the Add Lane unit would make next, or null when every lane past the standing three exists.
export function nextExtraLane(existing: number[]): number | null {
  return LANE_IDS.find(id => id > STANDING_LANES.length && !existing.includes(id)) ?? null;
}

// What a lane is called where it is shown: its own name, or "Synth N".
export function laneName(id: number, name?: string | null): string {
  return name?.trim() || `Synth ${id}`;
}

// The longest preset name a lane keeps.
export const MAX_PRESET_NAME = 60;
// A preset's name as a lane keeps it, or nothing.
export function storedPresetName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME).trim() || undefined;
}

// What a lane says under its name: the preset loaded on it, where its model is the plain engine and
// it has one, or else its model.
export function laneSound(modelId: string, modelName: string, preset?: string | null): string {
  return modelId === 'generic' && preset ? preset : modelName;
}

// A name as it is stored: trimmed, cut to its length, and nothing at all when it is empty.
export function storedLaneName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_LANE_NAME).trim();
  return name || undefined;
}
