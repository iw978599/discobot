// Discobot's own Surge XT patches (surge/patches/, docs/SURGE_XT_PLAN.md). Each is a file in
// ui/public/surge/patches/, fetched the first time a lane plays it. Surge's factory patches are not
// offered: their licence is unsettled. `macros` are the names the patch gives its macros, in order;
// surgePatches.test.ts holds this list to the files.
export interface SurgePatch {
  id: string;
  name: string;
  macros: string[];
}

export const SURGE_PATCHES: SurgePatch[] = [
  { id: 'punk-bass', name: 'Punk Bass', macros: ['Cutoff', 'Drive'] },
  { id: 'clipped-stab', name: 'Clipped Stab', macros: ['Bright', 'Crunch'] },
];

export const surgePatch = (id: string | undefined): SurgePatch | undefined => SURGE_PATCHES.find(patch => patch.id === id);

// Where a patch's file is, under the app's own address.
export const surgePatchUrl = (base: string, id: string) => `${base}surge/patches/${id}.fxp`;
