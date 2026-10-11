// What a preset is for. The presets menu groups by it. The kinds are agreed (roadmap, sound 7).
export const PRESET_KINDS = ['bass', 'lead', 'pad', 'keys', 'pluck', 'effects'] as const;
export type PresetKind = typeof PRESET_KINDS[number];

export const PRESET_KIND_LABELS: Record<PresetKind, string> = {
  bass: 'Bass',
  lead: 'Lead',
  pad: 'Pad',
  keys: 'Keys',
  pluck: 'Pluck',
  effects: 'Effects',
};

// The group a person's own presets are in, after the ones that come with the app.
export const USER_PRESET_GROUP = 'My presets';

export interface PresetGroup<T> {
  label: string;
  presets: T[];
}

// The built-in presets by kind in the order of PRESET_KINDS, then the person's own in a group of
// their own. A group with nothing in it is left out. Each keeps the order it was given in.
export function groupPresets<T extends { builtIn?: boolean; kind?: PresetKind }>(presets: T[]): PresetGroup<T>[] {
  const groups: PresetGroup<T>[] = [];
  for (const kind of PRESET_KINDS) {
    const members = presets.filter(preset => preset.builtIn && preset.kind === kind);
    if (members.length > 0) groups.push({ label: PRESET_KIND_LABELS[kind], presets: members });
  }
  const own = presets.filter(preset => !preset.builtIn || !preset.kind);
  if (own.length > 0) groups.push({ label: USER_PRESET_GROUP, presets: own });
  return groups;
}
